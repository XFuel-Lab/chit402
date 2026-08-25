/**
 * XFuel MCP tools.
 *
 * First-hour path: chat_completions (unmetered POST /v1/chat/completions).
 * Paid loop: submit_inference → get_task_status → get_proof → verify_proof.
 * Each tool wraps official `xfuel-sdk` so behaviour matches the SDK.
 */
import { z } from 'zod';
import { Contract, JsonRpcProvider, keccak256, toUtf8Bytes } from 'ethers';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { XFuelClient, ChainId, PUBLIC_DEMO_API_KEY } from 'xfuel-sdk';
import type { TaskQuoteParams } from 'xfuel-sdk';
import { XFuelOnChain } from 'xfuel-sdk/onchain';
import type { McpConfig } from './config.js';
import { ok, fail, describeError } from './format.js';

/**
 * Minimal ModelRegistry read ABI (PoMA). Kept local to the MCP package so this tool
 * works against the published xfuel-sdk + MCP's own `ethers` dep — no unpublished SDK
 * surface required. Mirrors contracts/core/ModelRegistry.sol (see docs/POMA_SPEC.md).
 */
const MODEL_REGISTRY_READ_ABI = [
  'function latestVersion(bytes32 modelId) view returns (uint256)',
  'function getModel(bytes32 modelId, uint256 version) view returns (tuple(bytes32 commitment, uint8 scheme, string arch, string quant, string metadataURI, uint64 registeredAt, address registrar))',
  'function verifyCommitment(bytes32 modelId, uint256 version, bytes32 commitment) view returns (bool)',
] as const;

const COMMITMENT_SCHEME_NAMES = ['KECCAK_MERKLE', 'MLE_POLY'] as const;

/** Minimal read ABI for the ERC-8004 Validation Registry (get_validation_status tool). */
const ERC8004_READ_ABI = [
  'function getValidationStatus(bytes32 requestHash) view returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string tag, uint256 lastUpdate)',
] as const;

const REQUEST_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Minimal read ABI for ProviderStaking (get_provider_stake tool). */
const PROVIDER_STAKING_READ_ABI = [
  'function stakeOf(address provider) view returns (uint256)',
  'function pendingOf(address provider) view returns (uint256 amount, uint256 unlockAt)',
  'function isActiveProvider(address provider) view returns (bool)',
  'function slashCount(address provider) view returns (uint256)',
  'function minStake() view returns (uint256)',
] as const;

/** Canonical model slug → modelId (keccak256 of the lowercased slug); pass through a 0x bytes32. */
function toModelId(model: string): string {
  return model.startsWith('0x') && model.length === 66
    ? model
    : keccak256(toUtf8Bytes(model.trim().toLowerCase()));
}

export interface ToolContext {
  client: XFuelClient;
  config: McpConfig;
}

const CHAIN_IDS = ['base', 'theta', 'bittensor', 'akash', 'osmosis', 'persistence'] as const;
const AMOUNT_RE = /^\d+$/;
const USDC_AMOUNT =
  'USDC smallest unit, 6 decimals (10000 = $0.01). Not wei. Minimum 10000.';
const chatMessageSchema = z.object({
  role: z.string().describe('system | user | assistant | tool'),
  content: z.string().nullable().describe('Message text'),
});

/**
 * The shareable public receipt link for a task. Prefer the server-provided
 * `verify_url`; fall back to constructing it from the configured API URL so a tool
 * always surfaces one link an agent (or its user) can open/share.
 */
function verifyUrlOf(res: { task_id?: string; verify_url?: string }, apiUrl: string): string {
  if (res.verify_url) return res.verify_url;
  const base = apiUrl.replace(/\/$/, '');
  return res.task_id ? `${base}/receipt/${res.task_id}` : '';
}

/** Register every XFuel tool on `server`. */
export function registerTools(server: McpServer, ctx: ToolContext): void {
  const { client, config } = ctx;

  // ── chat_completions (default / first-hour) ────────────────────────────────
  server.registerTool(
    'chat_completions',
    {
      title: 'Chat completions (unmetered /v1)',
      description: `Generate text via XFuel's OpenAI-compatible POST /v1/chat/completions.
This is the first-hour / demo path. With the demo key it is unmetered (rate-limited).
It is NOT submit_inference and does NOT spend USDC.

Args:
  - messages (required): OpenAI chat messages, e.g. [{role:"user", content:"Say hello"}]
  - model (optional): catalog id from list_models (default xfuel/auto)
  - max_tokens, temperature (optional)

Returns the completion plus xfuel.task_id, xfuel.payment.rail (usually unmetered),
and xfuel.verify_url. proof_outcome may still be pending — poll get_task_status
if you need the later SP1 proof. Do not wait in this tool.`,
      inputSchema: {
        messages: z
          .array(chatMessageSchema)
          .min(1)
          .describe('OpenAI chat messages (required)'),
        model: z.string().min(1).default('xfuel/auto').describe('Catalog id from list_models'),
        max_tokens: z.number().int().positive().optional().describe('Output budget'),
        temperature: z.number().optional().describe('Sampling temperature'),
      },
      annotations: {
        title: 'Chat completions (unmetered /v1)',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const res = await client.chatCompletions({
          model: args.model,
          messages: args.messages,
          max_tokens: args.max_tokens,
          temperature: args.temperature,
        });
        const xf = res.xfuel;
        const text = res.choices?.[0]?.message?.content ?? '';
        return ok(
          res as unknown as Record<string, unknown>,
          `chat_completions model=${res.model} rail=${xf?.payment?.rail ?? 'unmetered'}` +
            (xf?.task_id ? ` task_id=${xf.task_id}` : '') +
            `\n${text}` +
            (xf?.verify_url ? `\nVerify/share: ${xf.verify_url}` : ''),
        );
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );

  // ── submit_inference ───────────────────────────────────────────────────────
  server.registerTool(
    'submit_inference',
    {
      title: 'Submit paid AI inference task',
      description: `Submit a PAID M2M inference task (POST /task-request). Default rail is USDC on Base.
Without a payer this returns HTTP 402. This is NOT the unmetered demo path —
use chat_completions to generate text with the demo key.

Pass messages or input so a live provider is actually called. input_hash/memo alone
do not send a prompt to the model.

Args:
  - model (string): live catalog id from list_models
  - sender (string): 0x address that owns/pays for the task
  - amount (string): USDC 6 decimals; 10000 = $0.01; minimum 10000
  - messages / input (optional): the prompt. Required for live routing.
  - max_tokens, temperature (optional)

Poll get_task_status(task_id). Pay the live $0.01 door at POST /v1/chat/completions
from the agent's wallet — MCP does not take a human private key.`,
      inputSchema: {
        model: z.string().min(1).describe('Live catalog id from list_models, e.g. "xfuel/auto" or "theta/glm_5_2"'),
        sender: z.string().min(1).describe('0x address that owns/pays for the task'),
        amount: z
          .string()
          .regex(AMOUNT_RE, 'amount must be an integer string (USDC 6 decimals)')
          .describe(USDC_AMOUNT),
        chain_id: z.enum(CHAIN_IDS).default('base').describe('Settlement / routing hint (default base)'),
        messages: z.array(chatMessageSchema).optional().describe('Chat messages for live routing'),
        input: z.string().optional().describe('Raw prompt for live routing'),
        max_tokens: z.number().int().positive().optional().describe('Output budget'),
        temperature: z.number().optional().describe('Sampling temperature'),
        input_hash: z.string().optional().describe('keccak256 of your input'),
        memo: z.string().optional().describe('Free-form note — NOT the prompt'),
        max_gpu_hours: z.string().optional().describe('Compute budget hint'),
        subnet_id: z.number().int().optional().describe('Bittensor subnet id'),
        callback_url: z.string().url().optional().describe('Webhook for signed TaskSettled event'),
      },
      annotations: {
        title: 'Submit AI inference task',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const res = await client.submitInference(args.model, args.sender, args.amount, {
          chain_id: args.chain_id as ChainId,
          messages: args.messages,
          input: args.input,
          max_tokens: args.max_tokens,
          temperature: args.temperature,
          input_hash: args.input_hash,
          memo: args.memo,
          max_gpu_hours: args.max_gpu_hours,
          subnet_id: args.subnet_id,
          callback_url: args.callback_url,
        });
        return ok(
          res as unknown as Record<string, unknown>,
          `Submitted task ${res.task_id} (status: ${res.status}, rail: ${res.payment_rail ?? 'tfuel'}).\n` +
            `Verify/share: ${verifyUrlOf(res, config.apiUrl)}`,
        );
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );

  // ── register_agent ─────────────────────────────────────────────────────
  server.registerTool(
    'register_agent',
    {
      title: 'Register agent identity',
      description: `POST /v1/agents/register. Binds an AAWP official or smart-account agentWallet
to an integer agent_id using a collected HMAC-valid receipt (task_id from a paid
POST /v1/chat/completions). Demo receipts do not qualify. API key is not a wallet.
Does not accept a human private key.

Returns agent_id (required later by POST /erc8004/validate) and validate_score.`,
      inputSchema: {
        agent_wallet: z
          .string()
          .regex(ADDRESS_RE, 'agent_wallet must be a 0x address')
          .describe('AAWP official or smart-account address. Not an API key.'),
        task_id: z.string().min(1).describe('Collected receipt task_id from a paid chat completion'),
        request_hash: z
          .string()
          .regex(REQUEST_HASH_RE, 'request_hash must be a 0x-prefixed 32-byte hex string')
          .optional()
          .describe('Optional ERC-8004 request hash'),
      },
      annotations: {
        title: 'Register agent identity',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const url = `${config.apiUrl.replace(/\/$/, '')}/v1/agents/register`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(config.apiKey ? { 'X-API-Key': config.apiKey } : {}),
          },
          body: JSON.stringify({
            agentWallet: args.agent_wallet,
            task_id: args.task_id,
            request_hash: args.request_hash,
          }),
        });
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          return fail(
            `register_agent HTTP ${res.status}: ${String(data.message || data.error || 'request failed')}`,
          );
        }
        return ok(
          data,
          `Registered agent_id=${String(data.agent_id)} wallet=${String(data.agentWallet)}` +
            (data.validate_score != null ? ` score=${String(data.validate_score)}` : ''),
        );
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );

  // ── get_task_status ──────────────────────────────────────────────────────
  server.registerTool(
    'get_task_status',
    {
      title: 'Get task status',
      description: `Get the current status of an XFuel task, including proof outcome and fee breakdown.

Args:
  - task_id (string): from chat_completions (xfuel.task_id) or submit_inference

Returns JSON: { task_id, status, proof_outcome, verify_url, message_type, chain_id, gross_amount,
fee_amount, net_amount, fee_bps, payment_rail, payment_ref, result, sp1_proof, created_at, updated_at }.
'verify_url' is a public, no-auth receipt page you can open or share to prove settlement.
'status' reaches a terminal value ('completed' | 'fee_collected' | 'failed'); 'proof_outcome'
is one of 'pending' | 'valid' | 'regenerable' | 'invalid'.`,
      inputSchema: {
        task_id: z.string().min(1).describe('Task id from chat_completions or submit_inference'),
      },
      annotations: {
        title: 'Get task status',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const res = await client.getTaskStatus(args.task_id);
        return ok(
          res as unknown as Record<string, unknown>,
          `Task ${res.task_id}: status=${res.status}, proof=${res.proof_outcome}.\n` +
            `Verify/share: ${verifyUrlOf(res, config.apiUrl)}`,
        );
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );

  // ── get_proof ──────────────────────────────────────────────────────────────
  server.registerTool(
    'get_proof',
    {
      title: 'Get ZK settlement proof',
      description: `Fetch the SP1 ZK settlement proof for a settled task.

Args:
  - task_id (string): from chat_completions (xfuel.task_id) or submit_inference

Returns JSON: { task_id, status, proof_outcome, verify_url, payment_binding, sp1_proof: { proof,
publicInputs, nullifier, provingTimeMs }, fee }.
'verify_url' is a public, no-auth receipt page you can open or share to prove settlement.

The proof attests settlement metadata + a commitment to the output hash (NOT inference
correctness). To validate it, use verify_proof(task_id). Fails if the task has not
settled yet — poll get_task_status until proof_outcome is 'valid'.`,
      inputSchema: {
        task_id: z.string().min(1).describe('Task id from chat_completions or submit_inference'),
      },
      annotations: {
        title: 'Get ZK settlement proof',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const res = await client.getProof(args.task_id);
        return ok(
          res as unknown as Record<string, unknown>,
          `Proof for ${res.task_id}: outcome=${res.proof_outcome}, nullifier=${res.sp1_proof?.nullifier ?? 'n/a'}.\n` +
            `Verify/share: ${verifyUrlOf(res, config.apiUrl)}`,
        );
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );

  // ── verify_proof ─────────────────────────────────────────────────────────
  server.registerTool(
    'verify_proof',
    {
      title: 'Verify a task proof',
      description: `Independently verify a settled task's proof client-side (the "prove it" flow in one call):
  1. a proof is present and proof_outcome === 'valid';
  2. the x402 payment binding (if present) re-derives to the committed value;
  3. (optional) the on-chain nullifier's spent state, when check_nullifier=true AND the
     server was started with XFUEL_RPC_URL + ZK_VERIFIER_ADDRESS.

Args:
  - task_id (string): from chat_completions (xfuel.task_id) or submit_inference
  - check_nullifier (boolean, optional): also read the on-chain nullifier state (default false)

Returns JSON: { ok, checks: { hasProof, proofOutcomeValid, paymentBinding, nullifier }, reasons }.
'ok' is true when the proof is present + valid and any present payment binding is consistent.
The nullifier read is informational and does not gate 'ok'.`,
      inputSchema: {
        task_id: z.string().min(1).describe('Task id from chat_completions or submit_inference'),
        check_nullifier: z
          .boolean()
          .default(false)
          .describe('Also read the on-chain nullifier state (needs RPC + zkVerifier configured)'),
      },
      annotations: {
        title: 'Verify a task proof',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const [proof, status] = await Promise.all([
          client.getProof(args.task_id),
          client.getTaskStatus(args.task_id).catch(() => null),
        ]);

        const onchain = new XFuelOnChain({
          rpcUrl: config.rpcUrl,
          zkVerifierAddress: config.zkVerifierAddress,
        });
        const result = await onchain.verifyProof(proof, {
          paymentRef: status?.payment_ref ?? undefined,
          checkNullifier: args.check_nullifier,
        });

        return ok(
          result as unknown as Record<string, unknown>,
          `verify_proof(${args.task_id}): ${result.ok ? 'OK' : 'FAILED'}${
            result.reasons.length ? ` — ${result.reasons.join('; ')}` : ''
          }`,
        );
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );

  // ── quote_task ─────────────────────────────────────────────────────────────
  server.registerTool(
    'quote_task',
    {
      title: 'Quote / price a task',
      description: `Preview per-rail pricing WITHOUT creating a task. Use before submit_inference.
Unknown model ids still return the $0.01 USDC floor — the human summary warns when
priced_model is null (inference will fail).

Args:
  - model (preferred) or model_id: catalog id to price
  - amount (optional): USDC 6 decimals for the USDC rail
  - messages / max_tokens / tools: forecast the request you will submit

Unmetered chat_completions does not need this quote.`,
      inputSchema: {
        model: z.string().optional().describe('Preferred: catalog id to price'),
        model_id: z.string().optional().describe('Deprecated alias for model'),
        amount: z
          .string()
          .regex(AMOUNT_RE, 'amount must be an integer string (USDC 6 decimals)')
          .optional()
          .describe('USDC 6 decimals (10000 = $0.01). Legacy TFUEL quotes still echo this field.'),
        messages: z.array(z.unknown()).optional().describe('Chat messages to forecast (same as the request you will submit)'),
        max_tokens: z.number().int().positive().optional().describe('Output budget to forecast'),
        tools: z.array(z.unknown()).optional().describe('Tool definitions (counted as prompt tokens)'),
        proof_tier: z.string().optional().describe('Requested assurance tier (only `settlement` adds the SP1 surcharge)'),
      },
      annotations: {
        title: 'Quote / price a task',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const modelId = args.model ?? args.model_id;
        const res = await client.quoteTask({
          model_id: modelId,
          amount: args.amount,
          messages: args.messages as TaskQuoteParams['messages'],
          max_tokens: args.max_tokens,
          tools: args.tools as TaskQuoteParams['tools'],
          proof_tier: args.proof_tier,
        });
        const priced = (res as { priced_model?: string | null }).priced_model;
        const unknown =
          modelId && (priced == null || priced === '')
            ? ` priced_model=null — "${modelId}" is not in the catalog; the $0.01 floor is not a real quote.`
            : '';
        return ok(
          res as unknown as Record<string, unknown>,
          `Quote: recommended=${res.recommended}, default_rail=${res.default_rail}.${unknown}`,
        );
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );

  // ── get_health ─────────────────────────────────────────────────────────────
  server.registerTool(
    'get_health',
    {
      title: 'Get XFuel API health',
      description: `Check the connected XFuel API's health and configuration (fee config, supported
chains, message types, demo limits). Useful for discovery/diagnostics.

Args: none.

Returns JSON: the /health payload (status, server, version, fee_config, chains, message_types, …).`,
      inputSchema: {},
      annotations: {
        title: 'Get XFuel API health',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const res = await client.getHealth();
        return ok(
          res as unknown as Record<string, unknown>,
          `API ${config.apiUrl}: ${res.status} (v${res.version}).`,
        );
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );

  // ── get_my_stats ───────────────────────────────────────────────────────────
  server.registerTool(
    'get_my_stats',
    {
      title: 'Get buyer usage stats (Private Spend)',
      description: `Fetch usage for the configured API key (GET /stats/me).
The public demo key xfuel-demo is SHARED — numbers are not this client.
Bring your own XFUEL_API_KEY for buyer-scoped stats.`,
      inputSchema: {},
      annotations: {
        title: 'Get buyer usage stats',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const res = await client.getMyStats();
        const ns = (res as { north_star?: { paid_tasks_7d?: number; usdc_fees_7d?: string } }).north_star;
        const shared =
          !config.apiKey || config.apiKey === PUBLIC_DEMO_API_KEY
            ? 'SHARED demo key (xfuel-demo) — not this client. '
            : '';
        return ok(
          res,
          `${shared}Buyer stats: paid_tasks_7d=${ns?.paid_tasks_7d ?? '?'} usdc_fees_7d=${ns?.usdc_fees_7d ?? '?'}.`,
        );
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );

  // ── list_models ────────────────────────────────────────────────────────────
  server.registerTool(
    'list_models',
    {
      title: 'List routable models',
      description: `List models XFuel can route (GET /v1/models). Call first, then pass an id to
chat_completions (unmetered) or submit_inference (paid).

Rows include hub, modality, pricing, availability. Unmetered vs paid is the TOOL
(chat_completions vs submit_inference), not a per-id flag. No side effects.

Returns OpenAI {object,data} plus XFuel extras on each row.`,
      inputSchema: {},
      annotations: {
        title: 'List routable models',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const res = await client.listModels();
        const ids = res.data?.map((m) => m.id) ?? [];
        return ok(
          res as unknown as Record<string, unknown>,
          `${ids.length} model(s): ${ids.join(', ') || 'none'}.`,
        );
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );

  // ── verify_model_commitment ──────────────────────────────────────────────────
  server.registerTool(
    'verify_model_commitment',
    {
      title: 'Verify model authenticity (PoMA)',
      description: `Look up a model's on-chain authenticity commitment and (optionally) check a claimed
commitment against it — the anti-downgrade check for XFuel Verified Inference (Tier-3).
Reads the ModelRegistry on Base; requires the server to be started with XFUEL_RPC_URL +
MODEL_REGISTRY_ADDRESS.

Args:
  - model (string): canonical slug ("llama-3-70b:q4_k_m") or a 0x modelId (bytes32)
  - version (number, optional): version to read/verify (default: latest registered)
  - commitment (string, optional): a claimed 0x commitment to check for a match

Returns JSON: { model_id, version, registered: { commitment, scheme, arch, quant, metadataURI,
registeredAt, registrar }, match }. 'match' is true/false when a commitment is supplied
(false = possible model downgrade), or null when only reading the registered model.`,
      inputSchema: {
        model: z.string().min(1).describe('Model slug ("family:quant") or 0x modelId'),
        version: z.number().int().positive().optional().describe('Version to read/verify (default: latest)'),
        commitment: z.string().optional().describe('Claimed 0x commitment to check for a match'),
      },
      annotations: {
        title: 'Verify model authenticity (PoMA)',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        if (!config.rpcUrl || !config.modelRegistryAddress) {
          return fail(
            'verify_model_commitment needs the server started with XFUEL_RPC_URL + MODEL_REGISTRY_ADDRESS.',
          );
        }
        const provider = new JsonRpcProvider(config.rpcUrl);
        const registry = new Contract(
          config.modelRegistryAddress,
          MODEL_REGISTRY_READ_ABI as unknown as string[],
          provider,
        );
        const modelId = toModelId(args.model);
        const version = args.version ?? Number(await registry.latestVersion(modelId));
        if (!version) {
          return fail(`No registered version found for model "${args.model}" (${modelId}).`);
        }
        const v = await registry.getModel(modelId, version);
        const scheme = Number(v.scheme);
        const registered = {
          commitment: v.commitment as string,
          scheme,
          scheme_name: COMMITMENT_SCHEME_NAMES[scheme] ?? 'KECCAK_MERKLE',
          arch: v.arch as string,
          quant: v.quant as string,
          metadata_uri: v.metadataURI as string,
          registered_at: Number(v.registeredAt),
          registrar: v.registrar as string,
        };
        const match = args.commitment
          ? Boolean(await registry.verifyCommitment(modelId, version, args.commitment))
          : null;

        return ok(
          { model_id: modelId, version, registered, match } as unknown as Record<string, unknown>,
          `Model ${args.model} v${version}: commitment=${registered.commitment.slice(0, 18)}…` +
            (match === null ? '' : match ? ' — MATCH (authentic)' : ' — MISMATCH (possible downgrade)'),
        );
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );

  // ── get_verified_quote ───────────────────────────────────────────────────────
  server.registerTool(
    'get_verified_quote',
    {
      title: 'Quote a task with assurance tiers',
      description: `Preview a task's price AND the verifiable-assurance available for the model — so an
agent can shop on trust, not just cost. Combines quote_task pricing with Verified Inference
(Tier-3) metadata: whether the model is registered on-chain for model-authenticity (PoMA)
and which trust tiers apply. No side effects.

Tiers: 'signed' (Tier-1 signed receipt) and 'settlement' (Tier-2 SP1 proof on Base) are
always available; 'inference' (Tier-3 TEE / ZK proof-of-inference) is roadmap. When the
server has XFUEL_RPC_URL + MODEL_REGISTRY_ADDRESS, model_registered reflects the on-chain
PoMA registry.

Args:
  - model (string): model slug ("llama-3-70b:q4_k_m") or id (used for pricing + PoMA lookup)
  - amount (string, optional): task value in wei (echoed in the tfuel rail)

Returns JSON: { quote, verified_inference: { model, model_registered, model_commitment,
tiers_available, note } }.`,
      inputSchema: {
        model: z.string().min(1).describe('Model slug or id'),
        amount: z
          .string()
          .regex(AMOUNT_RE, 'amount must be an integer string (wei)')
          .optional()
          .describe('Task value in wei'),
      },
      annotations: {
        title: 'Quote a task with assurance tiers',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const quote = await client.quoteTask({
          model_id: args.model,
          amount: args.amount,
        });

        // Tier-1/Tier-2 are live for every XFuel task; Tier-3 is roadmap.
        const tiers_available = ['signed', 'settlement'];
        let model_registered: boolean | null = null;
        let model_commitment: string | null = null;

        if (config.rpcUrl && config.modelRegistryAddress) {
          try {
            const provider = new JsonRpcProvider(config.rpcUrl);
            const registry = new Contract(
              config.modelRegistryAddress,
              MODEL_REGISTRY_READ_ABI as unknown as string[],
              provider,
            );
            const modelId = toModelId(args.model);
            const version = Number(await registry.latestVersion(modelId));
            model_registered = version > 0;
            if (version > 0) {
              const v = await registry.getModel(modelId, version);
              model_commitment = v.commitment as string;
            }
          } catch {
            model_registered = null; // registry read failed; leave unknown
          }
        }

        const note =
          'signed + settlement are live on Base; inference (TEE/ZK proof-of-inference) is roadmap. ' +
          (model_registered === null
            ? 'Model-authenticity (PoMA) status unknown — configure XFUEL_RPC_URL + MODEL_REGISTRY_ADDRESS.'
            : model_registered
              ? 'Model is registered for on-chain authenticity (PoMA).'
              : 'Model is NOT yet registered for on-chain authenticity (PoMA).');

        return ok(
          {
            quote,
            verified_inference: {
              model: args.model,
              model_registered,
              model_commitment,
              tiers_available,
              note,
            },
          } as unknown as Record<string, unknown>,
          `Quote for ${args.model}: default_rail=${quote.default_rail}; tiers=${tiers_available.join('/')}` +
            (model_registered === null ? '' : model_registered ? '; PoMA-registered ✓' : '; not PoMA-registered'),
        );
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );

  // ── get_validation_status ──────────────────────────────────────────────────────
  server.registerTool(
    'get_validation_status',
    {
      title: 'Read an ERC-8004 validation record',
      description: `Read an ERC-8004 Validation Registry record by requestHash — the on-chain verdict a
validator (e.g. XFuel) posted for an agent task. Lets an agent independently check "was this
task independently validated, by whom, and did it pass?" before trusting/paying a counterparty.
Read-only.

Score semantics: 0 = failed, 100 = passed; the tag conveys the validator's assurance category
(XFuel uses "xfuel:settlement", "xfuel:signed", "xfuel:...+pbr", "xfuel:binding-mismatch").

Requires the server to be configured with XFUEL_RPC_URL + ERC8004_VALIDATION_REGISTRY.

Args:
  - request_hash (string): the 0x 32-byte requestHash of the validation.

Returns JSON: { request_hash, validator_address, agent_id, response, passed, response_hash, tag, last_update }.`,
      inputSchema: {
        request_hash: z
          .string()
          .regex(REQUEST_HASH_RE, 'request_hash must be a 0x-prefixed 32-byte hex string')
          .describe('ERC-8004 requestHash (0x, 32 bytes)'),
      },
      annotations: {
        title: 'Read an ERC-8004 validation record',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        if (!config.rpcUrl || !config.erc8004RegistryAddress) {
          return fail(
            'get_validation_status needs the server configured with XFUEL_RPC_URL + ERC8004_VALIDATION_REGISTRY.',
          );
        }
        const provider = new JsonRpcProvider(config.rpcUrl);
        const registry = new Contract(
          config.erc8004RegistryAddress,
          ERC8004_READ_ABI as unknown as string[],
          provider,
        );
        const r = await registry.getValidationStatus(args.request_hash);
        const validatorAddress = (r.validatorAddress ?? r[0]) as string;
        const agentId = (r.agentId ?? r[1]) as bigint;
        const response = Number(r.response ?? r[2]);
        const lastUpdate = Number(r.lastUpdate ?? r[5]);

        if (validatorAddress === '0x0000000000000000000000000000000000000000' && lastUpdate === 0) {
          return ok(
            { request_hash: args.request_hash, found: false } as unknown as Record<string, unknown>,
            `No validation record found for ${args.request_hash.slice(0, 18)}… (request may be open/unanswered).`,
          );
        }

        return ok(
          {
            request_hash: args.request_hash,
            found: true,
            validator_address: validatorAddress,
            agent_id: agentId.toString(),
            response,
            passed: response >= 100,
            response_hash: (r.responseHash ?? r[3]) as string,
            tag: (r.tag ?? r[4]) as string,
            last_update: lastUpdate,
          } as unknown as Record<string, unknown>,
          `Validation ${args.request_hash.slice(0, 18)}…: response=${response}/100 (${response >= 100 ? 'passed' : 'failed'}), tag="${(r.tag ?? r[4]) as string}".`,
        );
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );

  // ── get_provider_stake ─────────────────────────────────────────────────────────
  server.registerTool(
    'get_provider_stake',
    {
      title: 'Read a provider stake + slash history',
      description: `Read an XFuel Verified Inference provider's economic security: how much it has staked,
whether it's an active provider, and how many times it's been slashed for a failed spot-check.
Lets an agent "shop on trust" — check a counterparty's skin-in-the-game before paying.
Read-only. See docs/VERIFIED_INFERENCE_TIERS.md.

Requires the server configured with XFUEL_RPC_URL + PROVIDER_STAKING_ADDRESS.

Args:
  - provider (string): the provider's 0x address.

Returns JSON: { provider, stake, min_stake, is_active, slash_count, pending, unlock_at }.`,
      inputSchema: {
        provider: z
          .string()
          .regex(ADDRESS_RE, 'provider must be a 0x-prefixed 20-byte address')
          .describe('Provider address (0x, 20 bytes)'),
      },
      annotations: {
        title: 'Read a provider stake + slash history',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        if (!config.rpcUrl || !config.providerStakingAddress) {
          return fail(
            'get_provider_stake needs the server configured with XFUEL_RPC_URL + PROVIDER_STAKING_ADDRESS.',
          );
        }
        const provider = new JsonRpcProvider(config.rpcUrl);
        const staking = new Contract(
          config.providerStakingAddress,
          PROVIDER_STAKING_READ_ABI as unknown as string[],
          provider,
        );
        const [stake, isActive, slashes, minStake, pending] = await Promise.all([
          staking.stakeOf(args.provider),
          staking.isActiveProvider(args.provider),
          staking.slashCount(args.provider),
          staking.minStake(),
          staking.pendingOf(args.provider),
        ]);
        const pendingAmount = (pending.amount ?? pending[0]) as bigint;
        const unlockAt = Number(pending.unlockAt ?? pending[1]);
        return ok(
          {
            provider: args.provider,
            stake: (stake as bigint).toString(),
            min_stake: (minStake as bigint).toString(),
            is_active: Boolean(isActive),
            slash_count: (slashes as bigint).toString(),
            pending: pendingAmount.toString(),
            unlock_at: unlockAt,
          } as unknown as Record<string, unknown>,
          `Provider ${args.provider.slice(0, 10)}…: stake=${(stake as bigint).toString()} (${isActive ? 'active' : 'inactive'}), slashed ${(slashes as bigint).toString()}×.`,
        );
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );
}
