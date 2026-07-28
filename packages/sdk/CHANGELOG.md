# Changelog — xfuel-sdk

All notable changes to the XFuel SDK are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

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
