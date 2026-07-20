# ADR 0003 — Verified Inference: Clean-Room, Permissive-Only

Status: Accepted. Date: 2026-07-18.  
Related: [ADR 0004](./0004-zkllm-prover-stack.md), [TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md](../TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md).

## Context

Tier-3 (proof-of-inference) needs an owned path. Upstream zkGPT-style work is high-RAM CPU, not GPU-bound. Strong open zkML stacks are encumbered for commercial settlement (custom license / AGPL). XFuel builds clean-room from public papers on permissive primitives.

## Decisions

1. Build in-house — no runtime dependency on Lagrange `zkml` or Polyhedra Expander/ECC in the product path.
2. Allow-list: Apache-2.0 / MIT / BSD only for prover + on-chain verifier path (arkworks family, permissive GKR/sumcheck/lookup crates as recorded in provenance).
3. Forbidden: custom Lagrange license crates, AGPL/GPL, copying source from encumbered implementations. Implement from papers + allow-listed crates.
4. Provenance: every component logged in [verified-inference/PROVENANCE_LOG.md](../verified-inference/PROVENANCE_LOG.md).
5. Product wedge: anti-downgrade (PoMA) + payment-bound receipts; tiered hybrid (TEE + ZK spot-check + staking) — not a race on raw zkML alone.

## Consequences

Ownable IP and license posture; longer build; honest tiering until full ZK path ships. Stack detail: [ADR 0004](./0004-zkllm-prover-stack.md).
