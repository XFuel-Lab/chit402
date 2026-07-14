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
 * This is the "aha": route any model, prove every dollar.
 *
 * ─── Run it ──────────────────────────────────────────────────────────────────
 *   From sdk/js:
 *     # Dry run (mock payer — no real funds, great for a first look):
 *     npx tsx examples/flagship-demo.ts
 *
 *     # Real USDC on Base Sepolia (agent signs EIP-3009):
 *     XFUEL_PAYER_PK=0x<funded-key> XFUEL_SENDER=0x<your-addr> \
 *     npx tsx examples/flagship-demo.ts
 *
 *   Override the endpoint with XFUEL_API_URL (default: hosted testnet). The public
 *   verify_url resolves once the target server serves /receipt/:id (merged main).
 *
 * Published-package users import from 'xfuel-sdk' / 'xfuel-sdk/onchain'.
 */
import {
  XFuelClient,
  ChainId,
  createMockPayer,
  type X402Payer,
} from '../src/index.js';

const {
  XFUEL_API_URL = 'https://api-testnet.xfuel.app',
  XFUEL_API_KEY,
  XFUEL_SENDER = '0x000000000000000000000000000000000000dEaD',
  XFUEL_MODEL = 'llama-3-70b',
  XFUEL_AMOUNT = '1000000', // gross task value in base units (min 10000)
  XFUEL_PAYER_PK, // set to sign real USDC EIP-3009 on Base; else a mock payer is used
} = process.env;

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
  const task = await client.submitInference(XFUEL_MODEL, XFUEL_SENDER, XFUEL_AMOUNT, {
    chain_id: ChainId.THETA,
    payment: { rail: 'usdc', network: 'base', maxAmount: usdc.amount },
    payer,
  });
  const rail = task.payment_rail ?? 'tfuel';
  console.log(`  ${b('②')} Pay+submit ${grn('✓')} task=${task.task_id} · rail=${rail}` +
    `${task.payment_ref ? ' · ref=' + task.payment_ref : ''}`);

  // ③ Settle — poll until terminal.
  const settled = await client.waitForCompletion(task.task_id);
  console.log(`  ${b('③')} Settle    ${grn('✓')} status=${settled.status} · proof=${settled.proof_outcome}`);

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
  process.exit(1);
});
