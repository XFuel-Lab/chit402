/**
 * XFuel — Flagship demo: pay → infer → prove → ONE shareable receipt.
 *
 * The whole XFuel value proposition in a single runnable script. An agent pays
 * for a verifiable inference task in USDC over x402, the task settles with an SP1
 * settlement proof, and the demo ends with the hero output: one public, no-auth
 * `verify_url` you can open or share that renders the route, the payment (with a
 * block-explorer link), the proof status, and an INDEPENDENT re-derivation of the
 * x402 payment binding. No login. No trust-me.
 *
 * This is the paid-path hero: `/task-request` → USDC → shareable receipt.
 * Design partners start on the free OpenAI surface (`/v1`) — see
 * docs/DESIGN_PARTNER_ONBOARDING.md. Rolling settlement means the *first*
 * paid call from a new payer has no settlement ref (the bill lands on the next
 * request). A short prompt will not mint an on-chain proof unless you pass
 * `proof_tier: 'settlement'` (opt-in $0.08); automatic proofs need ≥ $2.00 of
 * provider cost.
 *
 * ─── Run it ──────────────────────────────────────────────────────────────────
 *   From packages/sdk:
 *     # Loads repo-root .env.local automatically (DEPLOYER_* → payer/sender).
 *     $env:XFUEL_API_URL="http://localhost:3002"
 *     npx tsx examples/flagship-demo.ts
 *
 *     # Explicit overrides still win over .env.local:
 *     #   XFUEL_PAYER_PK / XFUEL_SENDER / XFUEL_API_URL
 *
 *   Dry run (no key in env): uses createMockPayer (no real funds).
 *   Live: the hosted endpoint settles real USDC on Base mainnet (X402_NETWORK=base),
 *   so fund DEPLOYER with Base mainnet ETH + USDC. The quote's network is used, so
 *   pointing at a Sepolia gateway works unchanged.
 *
 * Published-package users import from 'xfuel-sdk' / 'xfuel-sdk/onchain'.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  XFuelClient,
  ChainId,
  createMockPayer,
  type X402Payer,
} from '../src/index.js';

/** Load repo-root `.env.local` / `.env` without adding a dotenv dependency to the SDK. */
function loadRootEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(here, '../../..');
  for (const name of ['.env.local', '.env'] as const) {
    const path = resolve(root, name);
    if (!existsSync(path)) continue;
    const parsed = new Map<string, string>();
    for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      parsed.set(key, val); // last duplicate wins (matches dotenv)
    }
    for (const [key, val] of parsed) {
      if (process.env[key] === undefined) process.env[key] = val;
    }
    break; // prefer .env.local over .env
  }
}

loadRootEnv();

/** True for a 32-byte hex private key (0x + 64 hex). Rejects placeholders like 0xYOUR_…. */
function isPrivateKey(v: string | undefined): v is string {
  return !!v && /^0x[0-9a-fA-F]{64}$/.test(v.trim());
}

function pickPrivateKey(): string | undefined {
  for (const v of [process.env.XFUEL_PAYER_PK, process.env.DEPLOYER_PRIVATE_KEY]) {
    if (isPrivateKey(v)) return v!.trim();
  }
  return undefined;
}

const XFUEL_API_URL = process.env.XFUEL_API_URL || 'https://api.xfuel.app';
const XFUEL_API_KEY = process.env.XFUEL_API_KEY;
// xfuel/auto resolves to the best live chat model in the hub catalog, so this
// never goes stale. `GET /v1/models` lists the concrete ids (e.g. theta/glm_5_2).
const XFUEL_MODEL = process.env.XFUEL_MODEL || 'xfuel/auto';
// Declared task value (min 10000). The gateway reports the amount actually
// SETTLED as receipt gross, so this no longer inflates the receipt — but keep it
// aligned with the quote so the demo shows one consistent number end to end.
const XFUEL_AMOUNT = process.env.XFUEL_AMOUNT || '10000';
// Real signer: valid XFUEL_PAYER_PK, else DEPLOYER_PRIVATE_KEY from .env.local
const XFUEL_PAYER_PK = pickPrivateKey();
const XFUEL_SENDER =
  process.env.XFUEL_SENDER ||
  process.env.DEPLOYER_ADDRESS ||
  '0x000000000000000000000000000000000000dEaD';

if (process.env.XFUEL_PAYER_PK && !isPrivateKey(process.env.XFUEL_PAYER_PK)) {
  console.warn(
    '\n  Warning: XFUEL_PAYER_PK looks like a placeholder — ignoring it and using DEPLOYER_PRIVATE_KEY from .env.local if present.\n' +
      '  Clear it in this shell:  Remove-Item Env:XFUEL_PAYER_PK\n',
  );
}

const b = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const grn = (s: string) => `\x1b[32m${s}\x1b[0m`;
const cyn = (s: string) => `\x1b[36m${s}\x1b[0m`;
const rule = (c = '─') => c.repeat(64);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll /prove-result until the SP1 proof attaches (proving lags settlement). */
async function pollForProof(client: XFuelClient, taskId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let last = await client.getProof(taskId);
  while (!last.sp1_proof?.nullifier && Date.now() < deadline) {
    await sleep(1500);
    last = await client.getProof(taskId);
  }
  return last;
}

async function buildPayer(): Promise<{ payer: X402Payer; label: string }> {
  if (!XFUEL_PAYER_PK) {
    return { payer: createMockPayer(), label: 'mock (no real funds moved)' };
  }
  const { Wallet } = await import('ethers');
  const { createEip3009Payer } = await import('../src/onchain.js');
  const wallet = new Wallet(XFUEL_PAYER_PK);
  return { payer: createEip3009Payer(wallet), label: `EIP-3009 signer ${wallet.address}` };
}

async function main() {
  const client = new XFuelClient({ baseUrl: XFUEL_API_URL, apiKey: XFUEL_API_KEY });
  const { payer, label } = await buildPayer();

  console.log('');
  console.log(b('  XFuel — route any model, prove every dollar'));
  console.log(dim('  Flagship demo: pay → infer → prove → one shareable receipt'));
  console.log('');
  console.log(`  ${dim('Endpoint')} : ${XFUEL_API_URL}`);
  console.log(`  ${dim('Model')}    : ${XFUEL_MODEL}`);
  console.log(`  ${dim('Rail')}     : USDC via x402  ${dim('[payer: ' + label + ']')}`);
  console.log('');

  // ① Quote — preview per-rail pricing (no side effects).
  const quote = await client.quoteTask({ model_id: XFUEL_MODEL, amount: XFUEL_AMOUNT });
  const usdc = quote.rails.usdc;
  console.log(`  ${b('①')} Quote     ${grn('✓')} recommended=${quote.recommended} · ${usdc.amount} ${usdc.asset} on ${usdc.network}`);

  // ② Pay & submit — the payer runs the 402 → pay → retry handshake automatically.
  // Raw `input` is required for live DePIN (EdgeCloud). Hash-only submits settle
  // + prove on a mock output and will NOT show usage on Theta.
  const prompt =
    process.env.XFUEL_PROMPT ||
    'In one short sentence: what is a payment-bound ZK receipt?';
  // Declare the quoted amount, so declared gross == settled gross.
  const task = await client.submitInference(XFUEL_MODEL, XFUEL_SENDER, usdc.amount ?? XFUEL_AMOUNT, {
    chain_id: ChainId.BASE,
    input: prompt,
    // Use the network the gateway quoted (base / base-sepolia), not a hardcode.
    payment: { rail: 'usdc', network: usdc.network, maxAmount: usdc.amount },
    payer,
    ...(process.env.XFUEL_PROOF_TIER ? { proof_tier: process.env.XFUEL_PROOF_TIER } : {}),
  });
  const rail = task.payment_rail ?? 'usdc';
  console.log(`  ${b('②')} Pay+submit ${grn('✓')} task=${task.task_id} · rail=${rail}` +
    `${task.payment_ref ? ' · ref=' + task.payment_ref : ''}`);

  // ③ Settle — poll until terminal.
  const settled = await client.waitForCompletion(task.task_id);
  const routed = settled.result as { mock?: boolean; provider?: string } | undefined;
  const computeNote = routed?.mock
    ? `compute=MOCK (${routed.provider || 'mock'}) — no EdgeCloud usage`
    : `compute=${routed?.provider || 'unknown'}`;
  console.log(`  ${b('③')} Settle    ${grn('✓')} status=${settled.status} · proof=${settled.proof_outcome} · ${computeNote}`);

  // ④ Proof — fetch the SP1 settlement proof (+ payment binding). Proving can lag
  //    settlement (the prover batches), so poll briefly for the proof to attach.
  let nullifier: string | undefined;
  try {
    const proof = await pollForProof(client, task.task_id, 20_000);
    nullifier = proof.sp1_proof?.nullifier ?? undefined;
    const ms = proof.sp1_proof?.provingTimeMs;
    if (nullifier) {
      console.log(`  ${b('④')} Proof     ${grn('✓')} nullifier=${String(nullifier).slice(0, 14)}…` +
        `${ms != null ? ' · ' + ms + 'ms' : ''}`);
    } else {
      console.log(`  ${b('④')} Proof     ${dim('· still proving (batched) — check the receipt link in a moment')}`);
    }
    const pb = proof.payment_binding;
    if (pb) {
      console.log(`  ${b('⑤')} Binding   ${grn('✓')} ${pb.in_proof ? 'in-proof' : 'server-attested'} · commitment ${String(pb.commitment).slice(0, 14)}…`);
    } else {
      console.log(`  ${b('⑤')} Binding   ${dim('· none (TFUEL rail or X402_PROOF_BINDING off)')}`);
    }
  } catch {
    console.log(`  ${b('④')} Proof     ${dim('· not available yet (no prover wired on this endpoint)')}`);
  }

  // ─── Hero: the one shareable, public proof link ────────────────────────────
  const verifyUrl = task.verify_url ?? settled.verify_url ?? client.receiptUrl(task.task_id);
  console.log('');
  console.log('  ' + rule());
  console.log('  ' + grn('✔ Done.') + ' One shareable, public proof link:');
  console.log('');
  console.log('      ' + cyn(b(verifyUrl)));
  console.log('');
  console.log(dim('      Open it: route, payment (+ block-explorer link), proof status,'));
  console.log(dim('      and an independent payment-binding check — no login, no trust-me.'));
  console.log('  ' + rule());
  console.log('');
  console.log(dim('  Proof scope: attests settlement metadata (correct fee split + payment'));
  console.log(dim('  binding) + a commitment to the output hash, anchored on-chain with a'));
  console.log(dim('  single-use nullifier. It does NOT attest that a black-box provider ran'));
  console.log(dim('  the model correctly — that is Tier-2 proof-of-inference (roadmap).'));
  console.log('');
}

main().catch((err) => {
  console.error('\nDemo failed:', err?.message ?? err);
  if (err?.code || err?.status) {
    console.error(dim(`  code=${err.code ?? '?'} status=${err.status ?? '?'}`));
  }
  if (Array.isArray(err?.details) && err.details.length) {
    for (const d of err.details) console.error(dim(`  · ${d}`));
  }
  process.exit(1);
});
