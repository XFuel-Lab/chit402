# ZAN x402 Adapter

Status: **Flag-gated** (`X402_ENABLED`). Module: `backend/theta-bridge/src/x402-adapter.js`.
Mock facilitator: `backend/theta-bridge/src/x402-mock-facilitator.js`.
Tests: `backend/theta-bridge/test/x402-adapter.test.mjs`.

## Why

x402 is an agent-native payment protocol: machine-parseable HTTP 402 challenges,
wallet-as-identity, USDC settlement on Base/Solana. **USDC via x402 is XFuel's
default payment rail**; TFUEL/TDROP on Theta is the secondary rail. Adopting x402
as the standardized payment interface means any x402-speaking agent can pay for
XFuel compute with zero custom integration — a direct fit for the orchestration
thesis. See `skills/_shared/reference/payments-x402.md`.

## Flow

```
Agent → POST /task-request { payment:{ rail:"usdc" } }  → 402 + accepts[]   (buildPaymentChallenge)
Agent → agent-side payer signs USDC on Base             → obtains X-PAYMENT
Agent → retry with X-PAYMENT                            → verifyPayment()  (facilitator + binding)
verified → settlePayment()                              → marks nonce spent, returns txRef (paymentRef)
settled  → planA2ASettlement()                          → relayer submits settleBidFairExchange (A2A)
```

## Surface (implemented + hardened)

- `isX402Enabled()`, `defaultRail()`, `fallbackToTfuel()` — flag helpers.
- `priceTaskUSDC({ model, serviceType }, { prices?, default? })` → USDC smallest-unit
  string (per-model override via `X402_USDC_PRICES` JSON, else `X402_USDC_PRICE_DEFAULT`).
- `ChallengeStore` (+ module `challengeStore`) — nonce store binding a challenge to
  `{ amount, asset, network, payTo, resource, expiresAt }`; TTL GC; spent-set for
  replay protection.
- `buildPaymentChallenge({ taskId, maxAmountRequired, network, asset, payTo }, { store })`
  → standards-shaped 402 body; records the challenge (nonce + expiry).
- `verifyPayment(header, { gatewayUrl, apiKey, store, nonce })` → facilitator verify
  with challenge binding (rejects `payment_replayed`, `challenge_expired_or_unknown`,
  amount mismatch). Idempotent; does not mark spent.
- `settlePayment(header, { gatewayUrl, apiKey, store, nonce })` → facilitator settle;
  marks the nonce spent on success. Returns `{ settled, txRef }`.
- `planA2ASettlement({ bidId, resultHash, txRef })` → maps a verified+settled payment
  to `settleBidFairExchange` (calldata via `xfuel-sdk/onchain`).

## Mock facilitator (dev/CI)

Emulates the ZAN gateway's `/verify` + `/settle` so the full handshake is testable
before a real gateway exists:

```bash
node backend/theta-bridge/src/x402-mock-facilitator.js   # PORT=X402_MOCK_PORT|8402
```

In tests: `const { url, close } = await startMockFacilitator();` then point
`gatewayUrl` at `url`. Configurable: `{ valid:false }`, `{ requireApiKey:true }`.

## Settlement model (Phase 1 — decided)

USDC lands in a **Base treasury** (`X402_PAY_TO`). The Theta-side fee split is
reconciled by `paymentRef` via a **deferred/periodic bridge** — not synchronous
(avoids early bridging complexity). TFUEL payments settle directly on Theta. The
payer is **agent-side / pluggable** (no server-custodial keys).

## Env

```bash
X402_ENABLED=true
X402_DEFAULT_RAIL=tfuel            # start tfuel; flip to usdc once gateway is stable
X402_FALLBACK_TFUEL=true          # usdc unavailable → fall back to TFUEL vs 503
ZAN_X402_GATEWAY_URL=https://<zan-x402-facilitator>
ZAN_X402_API_KEY=<key>
X402_PAY_TO=0x<base-usdc-treasury>
X402_NETWORK=base                 # base | solana
X402_ASSET=USDC
X402_CHALLENGE_TTL_MS=120000
X402_USDC_PRICE_DEFAULT=10000     # $0.01 (6dp)
X402_USDC_PRICES={"llama-3-70b":"50000"}
```

## Open / next (Phase 1 wiring)

1. **`/task-request` 402 handshake** behind `X402_ENABLED` (see plan): return the
   challenge when `rail=usdc` and no `X-PAYMENT`; verify+settle on retry; attach
   `paymentRail`/`paymentRef` to the task + status + `TaskSettled` webhook.
2. **`/task-quote`** endpoint using `priceTaskUSDC`.
3. **ZAN facilitator** — provision the real gateway + key; until then the mock
   facilitator covers dev/CI.
4. **Phase 2** — commit `paymentRef` into SP1 public values (proof attests
   paid+computed); Base→Theta fee-split bridge/accounting; Solana network option.

## Phase 2 proof binding (flag-gated — started)

Goal: a verified proof attests **both** computation **and** payment.

- **Commitment (source of truth):** `SP1ProofHooks.computePaymentCommitment(
  paymentRefHash, taskIdHash, paymentRail, amount) = keccak256(abi.encodePacked(...))`.
  Mirrored byte-for-byte off-chain by `backend/theta-bridge/src/payment-binding.js`
  (parity-tested in `test/security/SP1ProofHooksHarness.test.cjs`).
- **v2 public values:** `SP1ProofHooks.encodeAITaskPublicValuesV2(...)` appends a
  trailing `paymentCommitment` (13th field). The v1 12-field layout is untouched
  (audit-stable); `bytes32(0)` marks an unbound task.
- **Flag:** `X402_PROOF_BINDING` (default off). When on, for a USDC-settled task the
  backend computes the commitment, threads `payment_commitment` to the prover, and
  surfaces `payment_binding` in `/task-status` + `/prove-result` (and the SDK
  `PaymentBinding` type). Fully reversible: off ⇒ pre-Phase-2 behaviour.
- **Activation (remaining):** the SP1 **guest** must commit the v2 layout so the
  proof cryptographically attests the commitment — this changes the `programVKey`
  (guest rebuild + re-key + circuit decodes 13 fields), same toolchain-gated step as
  the prover upgrades. Until then `payment_binding.in_proof = false` (server-attested
  settlement metadata); it flips to `true` on guest activation with **no API change**.

### Guest activation checklist (SP1 v2)

The guest-side code ships **disabled by default**. Turn it on only after rebuilding
the ELF and registering the new verification key.

| Step | Where | Action |
|------|-------|--------|
| 1 | `sp1-prover/` | Rebuild guest + host (`./script/build.sh` or `build.ps1`). Requires SP1 toolchain (`sp1up`). |
| 2 | Deploy / manifest | Register the new `programVKey` for the AI-task circuit on `ZKVerifierSP1` (v2 decodes 13 fields). |
| 3 | Prover host env | Set `SP1_PUBLIC_VALUES_V2=true` on the **prover host** (CUDA / ZAN / local). |
| 4 | Backend env | Set `X402_PROOF_BINDING=true` (and `X402_ENABLED=true` for USDC rail). |
| 5 | Smoke test | Run `sdk/js/examples/pay-prove-verify.ts` — expect `payment_binding.in_proof: true` and matching `ai_public_values_abi`. |

**Version switch:** the host reads `SP1_PUBLIC_VALUES_V2` and only selects v2 when the
flag is on **and** the proof request carries a non-zero `payment_commitment` (threaded
by the backend when `X402_PROOF_BINDING` is enabled). Deposit / v1 AI proofs stay on
v1 (`public_values_version: 1`).

**Shared formula (Rust / JS / Solidity):** `core-layer/sp1-hooks/src/payment_binding.rs`
↔ `backend/theta-bridge/src/payment-binding.js` ↔ `SP1ProofHooks.computePaymentCommitment`.

**Rollback:** unset `SP1_PUBLIC_VALUES_V2` on the prover (falls back to v1 layout);
keep serving v1 `programVKey` until cutover is complete.
