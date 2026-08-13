# Changelog — xfuel-sdk

All notable changes to the XFuel SDK are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## 0.5.2 — Receipt signed payload v2 (`route.provider`)

### Changed
- **`canonicalReceiptPayload` / `verifyReceiptSignature`** — HMAC field set now includes
  `route.provider` (payload version 2), matching the gateway. Signatures produced by
  older SDKs / gateways will not verify against this set and vice versa. Required
  republish when the gateway ships receipt schema `xfuel.receipt.v3`.

## 0.5.1 — Security: axios advisories cleared

No API changes. Publish so installs stop resolving a vulnerable `axios`.

### Security
- **`axios` `^1.14.0` → `^1.19.0`** — clears the high-severity advisories that
  `npm audit` reported against every `npm install xfuel-sdk`, including SSRF via
  `NO_PROXY` bypass, prototype-pollution gadgets enabling credential injection and
  request hijacking, and `Proxy-Authorization` leakage across redirects.
  `npm audit` on this package now reports no high findings in the runtime tree.

### Changed
- Build moved to `module`/`moduleResolution` `node16`, so the compiler validates the
  published `exports` map. Emitted output is unchanged CommonJS.
- Examples typecheck as ESM (`module: esnext`), matching how `tsx` actually runs them.
- Dev tooling: jest 29 → 30, `@types/jest` 30, `ts-jest` 29.4.12.
  TypeScript stays on 5.9 — ts-jest does not yet support the TypeScript 7 native
  compiler, which no longer exposes the JS compiler API ts-jest relies on.

## 0.5.0 — Live hub catalog + buyer stats (design-partner readiness)

Additive and backward-compatible, but a **required publish**: `getMyStats` and the
live-catalog model ids exist only in this repo, so `xfuel-mcp` cannot build against
0.4.0.

### Added
- **`getMyStats()`** — buyer-scoped usage (`GET /stats/me`): your paid tasks and USDC
  fees only. Referenced by `xfuel-mcp`'s `get_my_stats` tool and the design-partner
  onboarding flow.
- **`X402Network` type** — exported union (`base` | `base-sepolia` | `solana`) now shared
  by `PaymentParams.network` and `TaskQuoteResponse.rails.usdc.network`, so
  `quote.rails.usdc.network` can be passed straight into `payment.network` without a
  cast in strict TypeScript.

### Changed
- **Examples default to `xfuel/auto`** — resolves to the best live chat model in the hub
  catalog instead of the retired `llama-3-70b`, which the gateway now rejects with
  `model_retired`. Concrete ids (e.g. `theta/glm_5_2`) come from `listModels()`.
- **Examples take the settlement network from the quote** rather than hardcoding
  `base-sepolia`; the hosted endpoint settles USDC on **Base mainnet**.
- **`quickstart` and `private-spend-budget` now pass a `payer`** — both previously hit a
  402 against the hosted endpoint (`private-spend-budget` built a payer but never
  passed it).

## 0.4.0 — Verified Inference (Tier-3): tiered trust engine (TEE + spot-check + staking)

Additive, backward-compatible. All new surface lives in `xfuel-sdk/onchain`.

### Changed (Base settlement home — ADR 0002)
- **`submitInference` defaults** — `chain_id: base` and `payment: { rail: 'usdc' }` when omitted (TFUEL is explicit/legacy only).
- **Examples** — `quickstart`, `pay-with-usdc`, `pay-prove-verify`, `flagship-demo` use Base + USDC; display fallbacks no longer imply TFUEL.
- **Types** — `PaymentParams.network` includes `base-sepolia`; status JSDoc no longer claims TFUEL as default rail.
- **package metadata** — keywords prefer `usdc` / `x402` / `base`; homepage path `packages/sdk`.

### Added
- **Tier selection mirror** (Phase 4) — predict a task's assurance tier before submitting:
  - `selectTier(task, policy)` + `normalizeRequestedTier(...)`, a faithful mirror of the gateway
    `tier-policy.js` (value-at-risk floor; a `proof_tier` request can *raise* but not lower the
    tier; unavailable mechanisms degrade with a reason). New `TIER_ORDER`, `TierPolicy`,
    `TierSelection`, `Tier`, `Mechanism` types.
- **ProviderStaking** helpers (T3b economics):
  - `XFuelOnChain` reads: `getProviderStake`, `getProviderStatus` (stake / active / slashCount /
    minStake / pending unbonding), plus `encodeStake`, `encodeRequestUnstake`, `encodeWithdrawStake`
    calldata builders. New `providerStakingAddress` option + `PROVIDER_STAKING_ABI`.

## 0.3.0 — Verified Inference (Tier-3): PoMA + PBR + ERC-8004 helpers

Additive, backward-compatible. All new surface lives in `xfuel-sdk/onchain`.

### Added
- **ERC-8004 Validation Registry** helpers (moat #2):
  - `receiptToValidationVerdict(receipt, { requestHash, agentId })` — map a receipt to an
    ERC-8004 verdict (score 0..100 + tag + evidence), byte-identical to the gateway.
  - `encodeValidationResponse` / `encodeSubmitValidation` calldata builders + the
    `ERC8004_VALIDATION_REGISTRY_ABI` / `XFUEL_VALIDATION_ADAPTER_ABI`.
  - `XFuelOnChain` reads: `getValidationStatus`, `getValidationSummary`, `getAgentValidations`,
    `validationProvenance`, plus `erc8004RegistryAddress` / `xfuelValidationAdapterAddress` options.
- **PoMA — Proof of Model Authenticity** helpers (anti-downgrade):
  - `modelIdFromSlug(slug)`, `shardLeaf(buf)`, `keccakMerkleRoot(leaves)`,
    `computeModelCommitment({ shards, slug })` — compute a model commitment client-side,
    byte-identical to the gateway and `ModelRegistry.sol` (parity-tested).
  - `XFuelOnChain` reads: `latestModelVersion`, `getModel`, `getLatestModel`,
    `verifyModelCommitment`, `lookupModelCommitment`, and the `encodeRegisterModel` calldata
    builder. New `modelRegistryAddress` option + `MODEL_REGISTRY_ABI`, `ModelInfo`,
    `COMMITMENT_SCHEMES`.
- **PBR — Payment-Bound Receipt** helpers:
  - `computeInferenceBinding({ paymentRef, taskId, rail, amount, modelCommitment, outputHash })` —
    re-derive the payment-bound commitment (payment + model authenticity + output), mirroring
    `SP1ProofHooks.computeInferenceBindingCommitment` and the gateway.
  - `canonicalReceiptPayload(receipt)` + `verifyReceiptSignature(receipt, secret)` — verify a
    receipt's Tier-1 HMAC signature (tamper-evidence over the payment-bound tuple).

### Notes
- No breaking changes to `xfuel-sdk` or existing `xfuel-sdk/onchain` exports.
- `ethers` v6 remains a peer dependency for `xfuel-sdk/onchain`.

## 0.2.0

- On-chain module (`xfuel-sdk/onchain`): calldata builders + reads (A2A, ZK verifier,
  governance), `verifyProof`, `verifyPaymentBinding`, and the USDC EIP-3009 x402 payer.
