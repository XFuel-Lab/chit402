/**
 * XFuel SDK — "pay → prove → verify (with payment binding)" end-to-end.
 *
 * The full agent settlement loop in one script: pay for a verifiable inference
 * task in USDC over x402, retrieve the SP1 proof, and then VERIFY both the proof
 * and its Phase-2 x402 payment binding — independently re-deriving the payment
 * commitment client-side (never just trusting the server's echo).
 *
 * ─── What it demonstrates ────────────────────────────────────────────────────
 *   1. quoteTask()            → preview per-rail pricing
 *   2. submitInference(payer) → submit + run the 402 → pay → retry loop
 *   3. waitForCompletion()    → poll until settled (carries payment_binding)
 *   4. getProof()             → fetch the SP1 proof + payment_binding
 *   5. verifyProof()          → SDK helper: proof integrity + independent binding
 *                               re-derivation (+ optional on-chain replay check)
 *
 * ─── Payment binding (Phase 2) ───────────────────────────────────────────────
 *   With X402_PROOF_BINDING=on and a USDC-settled task, the proof carries a
 *   `payment_binding = { commitment, payment_ref_hash, amount, rail, in_proof }`.
 *   `verifyProof` re-computes the commitment from the returned payment_ref +
 *   task_id using the SAME formula as SP1ProofHooks.computePaymentCommitment and
 *   asserts a byte-for-byte match — proving the settlement is bound to this exact
 *   task. `in_proof` is false until the SP1 guest commits the v2 layout
 *   (server-attested metadata for now); the helper verifies the commitment either way.
 *
 * ─── Run it (mock facilitator + mock prover) ─────────────────────────────────
 *   # 1. Backend (backend/theta-bridge) with x402 + binding + a prover wired:
 *   #      X402_ENABLED=true \
 *   #      X402_PROOF_BINDING=true \
 *   #      ZAN_X402_GATEWAY_URL=http://127.0.0.1:8402 ZAN_X402_API_KEY=dev \
 *   #      X402_PAY_TO=0x000000000000000000000000000000000000cafe \
 *   #      SP1_PROVER_URL=http://127.0.0.1:8097 \
 *   #      node src/server.js
 *   #    plus:  node src/x402-mock-facilitator.js
 *   #    plus:  node scripts/mock-prover-server.js --port 8097
 *   #
 *   # 2. Run this example (from packages/sdk):
 *   #      XFUEL_API_URL=http://localhost:3002 XFUEL_SENDER=0xYourAddress \
 *   #      npx tsx examples/pay-prove-verify.ts
 *   #
 *   # Optional on-chain replay check:
 *   #      XFUEL_RPC_URL=... ZK_VERIFIER_ADDRESS=0x... (added to the above)
 *   #
 *   # With X402_PROOF_BINDING=off (default) the task still pays + proves; the
 *   # binding is simply absent and the script explains how to enable it.
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
  XFUEL_API_URL = 'https://api-testnet.xfuel.app', // hosted testnet demo; override with http://localhost:3002 for local dev
  XFUEL_API_KEY,
  XFUEL_SENDER = '0x000000000000000000000000000000000000dEaD',
  XFUEL_MODEL = 'xfuel/auto',
  XFUEL_AMOUNT = '1000000', // gross task value (min 10000)
  XFUEL_PAYER_PK, // set to sign real USDC EIP-3009 on Base (else mock payer)
  XFUEL_RPC_URL, // optional: enable the on-chain nullifier/replay check
  ZK_VERIFIER_ADDRESS, // optional: paired with XFUEL_RPC_URL
} = process.env;

/** Build the agent-side payer. EIP-3009 signer when a key is present, else mock. */
async function buildPayer(): Promise<X402Payer> {
  if (!XFUEL_PAYER_PK) {
    console.log('· payer: createMockPayer (dev — no real funds moved)');
    return createMockPayer();
  }
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
  console.log('1) Quote:');
  console.log(`   recommended : ${quote.recommended}`);
  console.log(`   USDC        : ${quote.rails.usdc.amount} (${quote.rails.usdc.asset} on ${quote.rails.usdc.network}, enabled=${quote.rails.usdc.enabled})`);

  // 2) Submit + pay in USDC (the payer runs the 402 handshake automatically).
  const payer = await buildPayer();
  console.log('\n2) Submitting inference task (payment.rail=usdc)…');
  const task = await client.submitInference(XFUEL_MODEL, XFUEL_SENDER, XFUEL_AMOUNT, {
    chain_id: ChainId.BASE,
    payment: { rail: 'usdc', network: quote.rails.usdc.network, maxAmount: quote.rails.usdc.amount },
    payer,
  });
  console.log(`   task_id      : ${task.task_id}`);
  console.log(`   payment_rail : ${task.payment_rail ?? 'usdc'}`);
  console.log(`   payment_ref  : ${task.payment_ref ?? '(none — x402 pending or disabled)'}`);

  // 3) Wait for settlement.
  console.log('\n3) Waiting for settlement…');
  const settled = await client.waitForCompletion(task.task_id, {
    onPoll: (s, n) => console.log(`   poll #${n}: ${s.status}`),
  });
  console.log(`   status       : ${settled.status} (proof: ${settled.proof_outcome})`);

  // A task is settled at 'completed' OR 'fee_collected' (fee step is the terminal
  // state in the mock/dev flow). Either way the proof has been attempted by now.
  const SETTLED = new Set(['completed', 'fee_collected', 'settled']);
  if (!SETTLED.has(settled.status)) {
    console.log(`\nTask not settled (status=${settled.status}); nothing to verify.`);
    process.exit(1);
  }

  // 4) Retrieve the proof (+ payment binding).
  const proof = await client.getProof(task.task_id);
  console.log('\n4) Proof:');
  console.log(`   nullifier    : ${proof.sp1_proof?.nullifier}`);
  console.log(`   proving_time : ${proof.sp1_proof?.provingTimeMs} ms`);

  // 5) Verify — one call. verifyProof re-derives the payment-binding commitment
  //    from payment_ref + task_id, checks proof integrity, and (when an RPC +
  //    zkVerifier are configured) reads the on-chain nullifier state.
  const { XFuelOnChain } = await import('../src/onchain.js');
  const onchain = new XFuelOnChain({
    rpcUrl: XFUEL_RPC_URL,
    zkVerifierAddress: ZK_VERIFIER_ADDRESS,
  });
  const paymentRef = task.payment_ref ?? settled.payment_ref ?? undefined;
  const result = await onchain.verifyProof(proof, {
    paymentRef,
    checkNullifier: !!(XFUEL_RPC_URL && ZK_VERIFIER_ADDRESS),
  });

  console.log('\n5) Verify — verifyProof():');
  console.log(`   proof present         : ${result.checks.hasProof}`);
  console.log(`   proof outcome valid   : ${result.checks.proofOutcomeValid}`);
  const pb = result.checks.paymentBinding;
  if (pb.checked) {
    console.log(`   payment binding valid : ${pb.valid} (${String(pb.expectedCommitment).slice(0, 18)}…)`);
    console.log(
      `   attestation           : ${proof.payment_binding?.in_proof
        ? 'in-proof (SP1 guest committed the v2 layout)'
        : 'server-attested metadata (guest v2 not yet activated)'}`,
    );
  } else {
    console.log('   payment binding       : (absent — enable X402_ENABLED + X402_PROOF_BINDING and settle via USDC)');
  }
  const nf = result.checks.nullifier;
  if (nf.checkedOnChain) {
    console.log(`   nullifier on-chain    : ${nf.used ? 'ALREADY SPENT (replay!)' : 'fresh (not replayed)'}`);
  }
  if (result.reasons.length) {
    console.log(`   notes                 : ${result.reasons.join('; ')}`);
  }

  console.log(`\n${result.ok ? '✓ verifyProof: OK' : '✗ verifyProof: FAILED'}`);
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error('\nExample failed:', err?.message ?? err);
  process.exit(1);
});
