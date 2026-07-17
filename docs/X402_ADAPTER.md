# x402 Adapter

Status: **Flag-gated** (`X402_ENABLED`). Module: `services/gateway/src/x402-adapter.js`.
Facilitator protocols: **standard x402** (`services/gateway/src/x402-facilitator.js`,
provider `x402` — **default**, live public Base Sepolia facilitator) and **ZAN** (bespoke
gateway, provider `zan`). Mock facilitator (speaks both shapes):
`services/gateway/src/x402-mock-facilitator.js`.
Tests: `services/gateway/test/x402-*.test.mjs`.

Default rail: **`usdc`** on Base ([ADR 0002](adr/0002-base-settlement-home.md)).

## Live public facilitator (Base Sepolia) — recommended for testnet

The standard x402 provider points at a public **Coinbase reference facilitator**
(`https://x402.org/facilitator`) which settles real (test) USDC on Base Sepolia and
needs **no API key**. This is the fastest way to make the USDC/x402 loop real without
waiting on a bespoke gateway.

```bash
X402_ENABLED=true
X402_DEFAULT_RAIL=usdc
X402_FACILITATOR_PROVIDER=x402         # speak the standard x402 protocol
# X402_FACILITATOR_URL=                # optional; defaults to https://x402.org/facilitator
X402_NETWORK=base-sepolia              # challenge network (client signs USDC on Base Sepolia)
X402_PAY_TO=0x<your-base-sepolia-treasury>
X402_USDC_PRICE_DEFAULT=10000          # $0.01 (6dp)
```

The agent-side payer signs a spec EIP-3009 `transferWithAuthorization` with
`createEip3009Payer` (`xfuel-sdk/onchain`) — the SDK already knows the Base Sepolia
USDC address + EIP-712 domain, so no client change is needed. The backend translates
the X-PAYMENT blob into the standard `paymentPayload` + `paymentRequirements` and calls
the facilitator's `/verify` then `/settle`. `paymentRef` comes back as
`base-sepolia:<txHash>`.

> To move to **Base mainnet** later, use a facilitator that supports mainnet (e.g.
> Coinbase CDP via `X402_FACILITATOR_URL` + `X402_FACILITATOR_API_KEY`), set
> `X402_NETWORK=base`, and fund a mainnet treasury. No code change.

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
node services/gateway/src/x402-mock-facilitator.js   # PORT=X402_MOCK_PORT|8402
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
X402_DEFAULT_RAIL=usdc             # default on Base (ADR 0002)
X402_FALLBACK_TFUEL=true          # usdc unavailable → fall back to TFUEL vs 503

# Facilitator protocol selection
X402_FACILITATOR_PROVIDER=zan     # 'x402' (standard/public) | 'zan' (bespoke; default)
X402_FACILITATOR_URL=             # standard facilitator; blank → https://x402.org/facilitator
X402_FACILITATOR_API_KEY=         # optional; not needed for the public testnet facilitator

# ZAN gateway (only used when provider=zan)
ZAN_X402_GATEWAY_URL=https://<zan-x402-facilitator>
ZAN_X402_API_KEY=<key>

X402_PAY_TO=0x<usdc-treasury>
X402_NETWORK=base-sepolia         # base-sepolia (testnet) | base | solana
X402_ASSET=USDC
X402_CHALLENGE_TTL_MS=120000
X402_USDC_PRICE_DEFAULT=10000     # $0.01 (6dp)
X402_USDC_PRICES={"llama-3-70b":"50000"}
# Optional overrides for the standard facilitator's EIP-712 domain / token:
# X402_ASSET_ADDRESS=0x...  X402_EIP712_NAME=USDC  X402_EIP712_VERSION=2
```

## Open / next (Phase 1 wiring)

1. **`/task-request` 402 handshake** behind `X402_ENABLED` (see plan): return the
   challenge when `rail=usdc` and no `X-PAYMENT`; verify+settle on retry; attach
   `paymentRail`/`paymentRef` to the task + status + `TaskSettled` webhook.
2. **`/task-quote`** endpoint using `priceTaskUSDC`.
3. **Facilitator** — ✅ standard x402 provider wired to the public Base Sepolia
   reference (`provider=x402`, no key). ZAN remains an option (`provider=zan`) once
   its gateway is provisioned; the mock facilitator (both shapes) covers dev/CI.
4. **Phase 2** — commit `paymentRef` into SP1 public values (proof attests
   paid+computed); Base→Theta fee-split bridge/accounting; Solana network option.

## Phase 2 proof binding (flag-gated — started)

Goal: a verified proof attests **both** computation **and** payment.

- **Commitment (source of truth):** `SP1ProofHooks.computePaymentCommitment(
  paymentRefHash, taskIdHash, paymentRail, amount) = keccak256(abi.encodePacked(...))`.
  Mirrored byte-for-byte off-chain by `services/gateway/src/payment-binding.js`
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
↔ `services/gateway/src/payment-binding.js` ↔ `SP1ProofHooks.computePaymentCommitment`.

**Rollback:** unset `SP1_PUBLIC_VALUES_V2` on the prover (falls back to v1 layout);
keep serving v1 `programVKey` until cutover is complete.
