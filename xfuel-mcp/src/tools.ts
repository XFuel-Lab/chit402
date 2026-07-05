/**
 * XFuel MCP tools.
 *
 * A focused set that covers the agent settlement loop end-to-end:
 *   submit_inference → get_task_status → get_proof → verify_proof
 * plus quote_task (pricing) and get_health (discovery). Each tool wraps the
 * official `xfuel-sdk` so behaviour stays identical to the SDK/examples.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { XFuelClient, ChainId } from 'xfuel-sdk';
import { XFuelOnChain } from 'xfuel-sdk/onchain';
import type { McpConfig } from './config.js';
import { ok, fail, describeError } from './format.js';

export interface ToolContext {
  client: XFuelClient;
  config: McpConfig;
}

const CHAIN_IDS = ['theta', 'bittensor', 'akash', 'osmosis', 'persistence'] as const;
const AMOUNT_RE = /^\d+$/;

/** Register every XFuel tool on `server`. */
export function registerTools(server: McpServer, ctx: ToolContext): void {
  const { client, config } = ctx;

  // ── submit_inference ───────────────────────────────────────────────────────
  server.registerTool(
    'submit_inference',
    {
      title: 'Submit AI inference task',
      description: `Submit an AI inference task to the XFuel Protocol. XFuel routes it to a GPU provider (Theta EdgeCloud → DePIN fallbacks), and settles with a ZK proof.

Args:
  - model (string): model id, e.g. "llama-3-70b"
  - sender (string): the 0x address that owns/pays for the task
  - amount (string): gross task value in the smallest unit (wei); minimum 10000
  - chain_id ('theta'|'bittensor'|'akash'|'osmosis'|'persistence'): settlement network (default 'theta')
  - input_hash (string, optional): keccak256 of your input (recommended for inference)
  - memo (string, optional): free-form note echoed on the task
  - max_gpu_hours (string, optional): compute budget hint
  - subnet_id (number, optional): Bittensor subnet id when chain_id='bittensor'
  - callback_url (string, optional): webhook that receives a signed TaskSettled event

Returns JSON: { task_id, status, payment_rail, fee_bps, gross_amount, fee_amount, net_amount, links }.
Poll progress with get_task_status(task_id); fetch settlement with get_proof(task_id).

Note: this submits with the server's default (unpaid/TFUEL) rail. For USDC/x402
settlement (which needs an agent-side signer) use the xfuel-sdk directly.`,
      inputSchema: {
        model: z.string().min(1).describe('Model id, e.g. "llama-3-70b"'),
        sender: z.string().min(1).describe('0x address that owns/pays for the task'),
        amount: z
          .string()
          .regex(AMOUNT_RE, 'amount must be an integer string (wei/smallest unit)')
          .describe('Gross task value in smallest unit (wei); min 10000'),
        chain_id: z.enum(CHAIN_IDS).default('theta').describe('Settlement network (default theta)'),
        input_hash: z.string().optional().describe('keccak256 of your input'),
        memo: z.string().optional().describe('Free-form note'),
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
          input_hash: args.input_hash,
          memo: args.memo,
          max_gpu_hours: args.max_gpu_hours,
          subnet_id: args.subnet_id,
          callback_url: args.callback_url,
        });
        return ok(
          res as unknown as Record<string, unknown>,
          `Submitted task ${res.task_id} (status: ${res.status}, rail: ${res.payment_rail ?? 'tfuel'}).`,
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
  - task_id (string): the id returned by submit_inference

Returns JSON: { task_id, status, proof_outcome, message_type, chain_id, gross_amount,
fee_amount, net_amount, fee_bps, payment_rail, payment_ref, result, sp1_proof, created_at, updated_at }.
'status' reaches a terminal value ('completed' | 'fee_collected' | 'failed'); 'proof_outcome'
is one of 'pending' | 'valid' | 'regenerable' | 'invalid'.`,
      inputSchema: {
        task_id: z.string().min(1).describe('Task id from submit_inference'),
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
          `Task ${res.task_id}: status=${res.status}, proof=${res.proof_outcome}.`,
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
  - task_id (string): the id returned by submit_inference

Returns JSON: { task_id, status, proof_outcome, payment_binding, sp1_proof: { proof,
publicInputs, nullifier, provingTimeMs }, fee }.

The proof attests settlement metadata + a commitment to the output hash (NOT inference
correctness). To validate it, use verify_proof(task_id). Fails if the task has not
settled yet — poll get_task_status until proof_outcome is 'valid'.`,
      inputSchema: {
        task_id: z.string().min(1).describe('Task id from submit_inference'),
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
          `Proof for ${res.task_id}: outcome=${res.proof_outcome}, nullifier=${res.sp1_proof?.nullifier ?? 'n/a'}.`,
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
  - task_id (string): the id returned by submit_inference
  - check_nullifier (boolean, optional): also read the on-chain nullifier state (default false)

Returns JSON: { ok, checks: { hasProof, proofOutcomeValid, paymentBinding, nullifier }, reasons }.
'ok' is true when the proof is present + valid and any present payment binding is consistent.
The nullifier read is informational and does not gate 'ok'.`,
      inputSchema: {
        task_id: z.string().min(1).describe('Task id from submit_inference'),
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
      description: `Preview per-rail pricing for a task WITHOUT creating it (no side effects). Use this
before submit_inference to show the user cost across payment rails.

Args:
  - model_id (string, optional): model id to price (some models have overrides)
  - amount (string, optional): TFUEL task value in wei (echoed back in the tfuel rail)

Returns JSON: { recommended, default_rail, rails: { usdc: { enabled, asset, network,
decimals, amount, pay_to }, tfuel: { amount } } }.`,
      inputSchema: {
        model_id: z.string().optional().describe('Model id to price'),
        amount: z
          .string()
          .regex(AMOUNT_RE, 'amount must be an integer string (wei)')
          .optional()
          .describe('TFUEL task value in wei'),
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
        const res = await client.quoteTask({ model_id: args.model_id, amount: args.amount });
        return ok(
          res as unknown as Record<string, unknown>,
          `Quote: recommended=${res.recommended}, default_rail=${res.default_rail}.`,
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
}
