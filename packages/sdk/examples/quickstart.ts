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
import { XFuelClient } from '../src/index.js';
import { XFuelOnChain } from '../src/onchain.js';

const { XFUEL_API_URL, XFUEL_API_KEY, XFUEL_SENDER = '0x000000000000000000000000000000000000dEaD' } = process.env;

async function main() {
  const client = new XFuelClient({ baseUrl: XFUEL_API_URL, apiKey: XFUEL_API_KEY });

  const task = await client.submitInference('llama-3-70b', XFUEL_SENDER, '1000000', { chain_id: 'theta' });
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
