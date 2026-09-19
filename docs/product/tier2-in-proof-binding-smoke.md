# Tier-2 in-proof payment binding (guest v5.1) — smoke

Tier-2 SP1 proofs attest **settlement metadata** (fee, nullifier, optional x402 payment binding). They do **not** attest that a specific model weights file ran (that is Tier-3 / zkLLM scope).

## What the guest checks (v2)

When `public_values_version == 2` and `paymentCommitment != 0`, the SP1 guest verifies:

```
paymentCommitment === keccak256(abi.encodePacked(paymentRefHash, taskIdHash, paymentRail, netAmount))
```

- `paymentRefHash` = `keccak256(utf8(payment_ref))` (witness, private input)
- `taskIdHash` = `keccak256(utf8(task_id))` (public)
- `paymentRail` = `1` (USDC/x402) or `2` (TFUEL)
- `netAmount` = bound economic amount (uint256 BE, matches task `net_amount`)

Parity: `SP1ProofHooks.computePaymentCommitment`, `services/gateway/src/payment-binding.js`, `core-layer/sp1-hooks`.

Gateway sets `payment_binding.in_proof === true` only when the prover returns v2 public values **and** the echoed `payment_commitment` matches the server-derived commitment (`finalizePaymentBindingForProof`).

## Ops taps (production)

1. **Rebuild + redeploy** SP1 guest/host (`services/sp1-prover/Dockerfile` or `scripts/build-sp1-prover.sh`).
2. **Register** new `programVKey` on Base `ZKVerifierSP1` (`0x9373499645292715a2275A78eD65B14215C41c06`) — required for **on-chain** verify of v2 public values; off-chain receipt verify works once steps 3–4 are live.
3. **Prover ECS:** `SP1_PUBLIC_VALUES_V2=true` (see `services/sp1-prover/task-definition.json`).
4. **Gateway:** `X402_PROOF_BINDING=true` (and USDC/x402 enabled).
5. Confirm prover health: `GET {SP1_PROVER_URL}/healthz` → `guest_version: "5.1"`, `public_values_v2_enabled: true`.

Rollback: unset `SP1_PUBLIC_VALUES_V2`; v1 layout + existing vKey keep working.

## Smoke (under ~$1)

Public specimen shape (no live Tier-2 proof required):  
`GET https://api.chit402.com/public/specimens/tier2-in-proof-binding.json`

Live path (opt-in Tier-2 + $0.08 proof line when cost-plus is on):

```bash
export CHIT402_BASE_URL=https://api.chit402.com
export X_API_KEY=…   # your key — demo key is rate-limited

# 1) Paid call with settlement proof opt-in
curl -sS -X POST "$CHIT402_BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $X_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "akash/meta-llama/Llama-3.3-70B-Instruct",
    "messages": [{"role":"user","content":"Reply with the word ok."}],
    "max_tokens": 8,
    "proof_tier": "settlement"
  }'

# 2) Poll task-status (use task_id from response / receipt)
curl -sS "$CHIT402_BASE_URL/task-status?task_id=<task_id>" \
  -H "Authorization: Bearer $X_API_KEY" | jq '.payment_binding, .sp1_proof.public_values_version'

# Expect when fully activated:
#   payment_binding.in_proof == true
#   payment_binding.commitment matches recomputation from payment_ref + task_id + amount
```

Public Tier-1 receipt (signed, no SP1 artifact yet):  
https://api.chit402.com/receipt/chit-1e57cdd7-4fde-4525-bea3-5ffd1d1d909e?format=json

SDK end-to-end: `packages/sdk/examples/pay-prove-verify.ts` with `X402_PROOF_BINDING=true`.
