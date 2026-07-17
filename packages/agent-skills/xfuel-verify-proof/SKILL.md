---
name: xfuel-verify-proof
description: >-
  Retrieve and validate the zero-knowledge proof (SP1 Groth16/PLONK or zkGPT) for
  a completed XFuel task, confirm the result hash matches, check the nullifier for
  replay protection, and optionally verify on-chain settlement. Use after
  submitting a task when the user asks "is this result actually proven?", "verify
  the proof", "show me the ZK attestation", or needs audit evidence of compute.
---

# XFuel: Verify Proof

Confirm that an XFuel task produced a valid ZK proof and settled on-chain.

## Prerequisites

- `XFUEL_API_URL`, `XFUEL_API_KEY`.
- Optional on-chain check: `THETA_RPC_URL` (a Theta ETH-RPC endpoint — public or
  dedicated; **not** ZAN, which does not serve Theta) and `ZK_VERIFIER_ADDRESS`.
  See `../_shared/reference/env-and-endpoints.md`.

## Parameters

| Name | Required | Description |
|------|----------|-------------|
| `task_id` | yes | Task id from `xfuel-submit-inference`. |
| `expected_output` | no | If provided, the skill recomputes the output hash and compares. |
| `on_chain` | no | If true, read `ZKVerifierSP1` to confirm the nullifier was spent. Default false. |

## Procedure

1. Fetch the proof:

   ```js
   import { XFuelClient } from 'xfuel-sdk';
   const client = new XFuelClient({ baseUrl: process.env.XFUEL_API_URL, apiKey: process.env.XFUEL_API_KEY });
   const proof = await client.getProof(task_id);
   // proof.sp1_proof = { proof, publicInputs/publicValues, nullifier, provingTimeMs }
   ```

   If it returns `409 task_not_settled`, the task is not complete yet — poll
   `client.getTaskStatus(task_id)` first.

2. Inspect the public values (`AITaskPublicValues`): taskType, sourceChain,
   destChain, taskIdHash, senderHash, netAmount, feeAmount, feeBps, outputHash,
   blockHeight, timestamp, nonce. See `../_shared/reference/public-values.md`.

3. If `expected_output` was given, compute `keccak256(expected_output)` and assert
   it equals `outputHash`.

4. If `on_chain`, read the verifier (read-only, no key needed) via the SDK
   on-chain module (uses the verified `usedNullifiers` accessor):

   ```js
   import { XFuelOnChain } from 'xfuel-sdk/onchain'; // requires `ethers` peer dep
   const chain = new XFuelOnChain({
     rpcUrl: process.env.THETA_RPC_URL,            // Theta ETH-RPC (public or dedicated; not ZAN)
     zkVerifierAddress: process.env.ZK_VERIFIER_ADDRESS,
   });
   const spent = await chain.isNullifierUsed(proof.sp1_proof.nullifier);
   ```

5. Read the settlement/payment metadata from the task status (rail-agnostic — the
   proof attests *computation*; payment is attached as settlement metadata). Fields
   are snake_case, matching the API/SDK response:

   ```js
   const status = await client.getTaskStatus(task_id);
   // status.payment_rail ("usdc" | "tfuel"), status.payment_ref ("<network>:<txRef>" | null)
   // Derive the settlement network from the payment_ref prefix (USDC only):
   const settlement_network =
     status.payment_rail === 'usdc' && status.payment_ref
       ? status.payment_ref.split(':')[0]   // e.g. "base"
       : (status.payment_rail === 'tfuel' ? 'theta' : null);
   ```

6. Return a verdict (including the payment rail so a verifier sees "paid + proven"):

   ```json
   {
     "verified": true, "proof_system": "sp1",
     "nullifier": "0x...", "nullifier_spent": true, "output_match": true,
     "payment_rail": "usdc", "payment_ref": "base:0x...", "settlement_network": "base"
   }
   ```

   > `payment_rail`/`payment_ref` are informational in Phase 1 (USDC/x402 default,
   > TFUEL secondary). **Phase 2 (flag-gated, `X402_PROOF_BINDING`)** binds `payment_ref`
   > into the proof: when enabled for a USDC task, the status/proof responses carry a
   > `payment_binding` object with a deterministic `commitment` (mirrors
   > `SP1ProofHooks.computePaymentCommitment`). `payment_binding.in_proof` is `false`
   > until the SP1 guest commits the v2 public-values layout (new programVKey) — until
   > then treat the commitment as server-attested settlement metadata; once `true`,
   > the proof itself attests both computation and payment.

7. If `payment_binding` is present, surface it in the verdict so a verifier sees the
   payment↔task binding:

   ```js
   const proof = await client.getProof(task_id);
   // proof.payment_binding = { version, rail, commitment, payment_ref_hash, amount, in_proof }
   ```

## Failure modes

- `404 not_found` → unknown `task_id`.
- `proof_outcome: regenerable` → proving failed transiently; re-submit or retry.
- `proof_outcome: invalid` → do NOT trust the result.
- On-chain read reverts → check `ZK_VERIFIER_ADDRESS` matches the network of `THETA_RPC_URL`.

## Runnable example

[`examples/pay-prove-verify.ts`](../../sdk/examples/pay-prove-verify.ts)
(`npm run example:verify` from `packages/sdk`) walks the full **pay → prove → verify**
loop end-to-end against the mock facilitator + mock prover, including an independent
re-derivation of the `payment_binding` commitment.

## Notes

- The verifier is proof-system-agnostic (Groth16/PLONK), so SP1 and future
  prover upgrades (Interstellar / PowerZebra-accelerated) verify the same way.
