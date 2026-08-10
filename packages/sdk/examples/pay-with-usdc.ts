/**
 * XFuel SDK — "pay and prove" quickstart (USDC via x402).
 *
 * Submits a verifiable inference task, pays for it in USDC over the x402 handshake,
 * waits for settlement, and retrieves the ZK proof — end to end, in one script.
 *
 * ─── What it demonstrates ────────────────────────────────────────────────────
 *   1. quoteTask()            → preview per-rail pricing (USDC / TFUEL)
 *   2. submitInference(payer) → submit + run the 402 → pay → retry loop
 *   3. waitForCompletion()    → poll until settled
 *   4. getProof()             → fetch the SP1 proof + revenue split
 *
 * ─── Payer selection ─────────────────────────────────────────────────────────
 *   • No XFUEL_PAYER_PK set  → createMockPayer()  (dev/CI; does NOT move real funds)
 *   • XFUEL_PAYER_PK set     → createEip3009Payer(new Wallet(pk))
 *                              (signs USDC EIP-3009 transferWithAuthorization on Base;
 *                               the key never leaves your machine)
 *
 * ─── Run it ──────────────────────────────────────────────────────────────────
 *   # 1. Start the XFuel backend with x402 + the mock facilitator wired:
 *   #    (backend/theta-bridge)
 *   #      X402_ENABLED=true \
 *   #      ZAN_X402_GATEWAY_URL=http://127.0.0.1:8402 \
 *   #      ZAN_X402_API_KEY=dev \
 *   #      X402_PAY_TO=0x000000000000000000000000000000000000cafe \
 *   #      node src/server.js
 *   #    and in another shell:  node src/x402-mock-facilitator.js
 *   #
 *   # 2. Run this example (from packages/sdk):
 *   #      XFUEL_API_URL=http://localhost:3002 \
 *   #      XFUEL_SENDER=0xYourAddress \
 *   #      npx tsx examples/pay-with-usdc.ts
 *   #
 *   # Note: if a local gateway has X402_ENABLED=off, USDC handshake is skipped and
 *   # the server may fall back to legacy TFUEL — not the public demo default.
 *
 * Published-package users import from 'xfuel-sdk' / 'xfuel-sdk/onchain' instead of
 * the relative '../src/...' paths used here.
 */
import { XFuelClient, ChainId, createMockPayer, type X402Payer } from '../src/index.js';

const {
  XFUEL_API_URL = 'https://api-testnet.xfuel.app', // hosted testnet demo; override with http://localhost:3002 for local dev
  XFUEL_API_KEY,
  XFUEL_SENDER = '0x000000000000000000000000000000000000dEaD',
  XFUEL_MODEL = 'xfuel/auto',
  XFUEL_AMOUNT = '1000000', // gross task value (wei for TFUEL fallback; min 10000)
  XFUEL_PAYER_PK, // set to sign real USDC EIP-3009 on Base (else mock payer)
} = process.env;

/** Build the agent-side payer. EIP-3009 signer when a key is present, else mock. */
async function buildPayer(): Promise<X402Payer> {
  if (!XFUEL_PAYER_PK) {
    console.log('· payer: createMockPayer (dev — no real funds moved)');
    return createMockPayer();
  }
  // Lazy-load the on-chain module so the ethers peer dep is only needed for real signing.
  const { Wallet } = await import('ethers');
  const { createEip3009Payer } = await import('../src/onchain.js');
  const wallet = new Wallet(XFUEL_PAYER_PK);
  console.log(`· payer: createEip3009Payer (USDC on Base, from ${wallet.address})`);
  return createEip3009Payer(wallet);
}

async function main() {
  const client = new XFuelClient({ baseUrl: XFUEL_API_URL, apiKey: XFUEL_API_KEY });

  // 1) Preview pricing across rails (no side effects).
  const quote = await client.quoteTask({ model_id: XFUEL_MODEL, amount: XFUEL_AMOUNT });
  console.log('\nQuote:');
  console.log(`  recommended : ${quote.recommended}`);
  console.log(`  USDC        : ${quote.rails.usdc.amount} (${quote.rails.usdc.asset} on ${quote.rails.usdc.network}, enabled=${quote.rails.usdc.enabled})`);
  console.log(`  TFUEL       : ${quote.rails.tfuel.amount ?? '(pass amount)'}`);

  // 2) Submit + pay in USDC (the payer runs the 402 handshake automatically).
  const payer = await buildPayer();
  console.log('\nSubmitting inference task (payment.rail=usdc)…');
  const task = await client.submitInference(XFUEL_MODEL, XFUEL_SENDER, XFUEL_AMOUNT, {
    chain_id: ChainId.BASE,
    payment: { rail: 'usdc', network: quote.rails.usdc.network, maxAmount: quote.rails.usdc.amount },
    payer,
  });
  console.log(`  task_id      : ${task.task_id}`);
  console.log(`  payment_rail : ${task.payment_rail ?? 'usdc'}`);
  console.log(`  payment_ref  : ${task.payment_ref ?? '(none — x402 pending or disabled)'}`);
  console.log(`  net_amount   : ${task.net_amount} (fee ${task.fee_amount}, ${task.fee_bps} bps)`);
  // One shareable, public proof link (falls back to client-side construction).
  console.log(`  verify_url   : ${task.verify_url ?? client.receiptUrl(task.task_id)}`);

  // 3) Wait for settlement.
  console.log('\nWaiting for settlement…');
  const settled = await client.waitForCompletion(task.task_id, {
    onPoll: (s, n) => console.log(`  poll #${n}: ${s.status}`),
  });
  console.log(`  status       : ${settled.status} (proof: ${settled.proof_outcome})`);

  // 4) Retrieve the proof.
  if (settled.status === 'completed') {
    const proof = await client.getProof(task.task_id);
    console.log('\nProof:');
    console.log(`  nullifier    : ${proof.sp1_proof?.nullifier}`);
    console.log(`  proving_time : ${proof.sp1_proof?.provingTimeMs} ms`);
    console.log(`  revenue split: ${JSON.stringify(proof.fee.revenue_split)}`);
  }

  console.log(`\nShareable receipt: ${settled.verify_url ?? client.receiptUrl(task.task_id)}`);
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('\nExample failed:', err?.message ?? err);
  process.exit(1);
});
