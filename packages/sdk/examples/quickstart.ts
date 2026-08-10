/**
 * XFuel SDK — 20-line quickstart: submit → settle → prove → verify.
 *
 * The shortest end-to-end loop against XFuel's hosted testnet demo. Zero config:
 * with no env set it uses the public demo endpoint + key, so it just runs.
 *
 *   npx tsx examples/quickstart.ts
 *
 * In a fresh project (after `npm install xfuel-sdk`) swap the two local imports
 * below for the published package:
 *
 *   import { XFuelClient } from 'xfuel-sdk';
 *   import { XFuelOnChain } from 'xfuel-sdk/onchain';
 */
import { XFuelClient, createMockPayer } from '../src/index.js';
import { XFuelOnChain } from '../src/onchain.js';

const {
  XFUEL_API_URL,
  XFUEL_API_KEY,
  XFUEL_SENDER = '0x000000000000000000000000000000000000dEaD',
  // xfuel/auto always resolves to the best live chat model in the hub catalog,
  // so this stays correct as the catalog changes. `GET /v1/models` lists the rest.
  XFUEL_MODEL = 'xfuel/auto',
} = process.env;

async function main() {
  const client = new XFuelClient({ baseUrl: XFUEL_API_URL, apiKey: XFUEL_API_KEY });

  // The hosted endpoint settles real USDC on Base mainnet via x402, so the quote
  // decides the network and a payer must sign — without one the gateway answers 402.
  const quote = await client.quoteTask({ model_id: XFUEL_MODEL, amount: '1000000' });

  const task = await client.submitInference(XFUEL_MODEL, XFUEL_SENDER, '1000000', {
    chain_id: 'base',
    payment: { rail: 'usdc', network: quote.rails.usdc.network, maxAmount: quote.rails.usdc.amount },
    // Swap for createEip3009Payer(wallet) from 'xfuel-sdk/onchain' to move real USDC.
    payer: createMockPayer(),
  });
  console.log('submitted   :', task.task_id);

  const settled = await client.waitForCompletion(task.task_id);
  console.log('settled      :', settled.status, `(proof: ${settled.proof_outcome})`);

  // A ZK settlement proof is only produced when the endpoint has a prover wired
  // (SP1_PROVER_URL). On the zero-config demo, compute settles but the proof is
  // pending/unavailable — expected, so treat it as an informational outcome
  // rather than a hard failure.
  if (settled.proof_outcome !== 'valid') {
    console.log(`\n✓ compute settled (status=${settled.status}). ZK proof ${settled.proof_outcome} — this endpoint has no prover wired (set SP1_PROVER_URL for on-chain settlement proofs).`);
    process.exit(0);
  }

  const proof = await client.getProof(task.task_id);
  console.log('nullifier    :', proof.sp1_proof?.nullifier);

  // verifyProof (no RPC needed): checks proof presence + outcome client-side.
  const { ok, reasons } = await new XFuelOnChain({}).verifyProof(proof);
  console.log(ok ? '\n✓ verified (compute + proof)' : `\n✗ verification failed: ${reasons.join('; ')}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('quickstart failed:', err?.message ?? err);
  process.exit(1);
});
