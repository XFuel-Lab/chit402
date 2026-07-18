# ADR 0003 — Verified Inference (Tier-3): Clean-Room, Permissive-Only Build

- **Status:** Accepted
- **Date:** 2026-07-18
- **Deciders:** Founder + engineering
- **Related:** ADR 0001 (USDC revenue), ADR 0002 (Base settlement home),
  [`docs/TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md`](../TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md),
  [`docs/research/tier3-verifiable-inference-strategy.md`](../research/tier3-verifiable-inference-strategy.md),
  [`docs/research/zkGPT-tier3-unblock-decision.md`](../research/zkGPT-tier3-unblock-decision.md)

---

## Context

XFuel Tier-3 (proof-of-inference) was blocked. Investigation
([`zkGPT-tier3-unblock-decision.md`](../research/zkGPT-tier3-unblock-decision.md))
found two things:

1. The original blocker was **misdiagnosed as GPU capacity**; the upstream zkGPT prover
   is a **high-RAM CPU** workload (~200 GB RAM, 16+ cores), not a GPU one.
2. The wider zkML field has productized what we set out to build. The two strongest
   open stacks are **encumbered for our use**:
   - **Lagrange DeepProve** — core `zkml` crate under a custom **Lagrange License**
     (GitHub reports the repo as `Other / NOASSERTION`). Not OSI/permissive; risky for a
     commercial settlement layer and a strategic dependency on a competitor.
   - **Polyhedra Expander / ECC** — **AGPL-3.0** (viral copyleft); unsafe to link into a
     commercial network service.

Rather than depend on either, XFuel will **build its own** Verified Inference layer
**clean-room from the public research papers**, assembled on **permissively-licensed
primitives** — the same *category* of components the incumbents used (that is standard
practice, not appropriation). The headline value is **anti-downgrade (Proof of Model
Authenticity) + payment-bound receipts**, delivered as a **tiered hybrid** (TEE +
ZK spot-check + staking), not a race to out-prove DeepProve on raw zkML.

## Decisions

1. **Build our own.** XFuel's Verified Inference prover/verifier is developed in-house.
   We do **not** take a runtime dependency on the Lagrange `zkml` crate or on
   Polyhedra Expander/ECC in the product path.

2. **Permissive-only dependency allow-list** (Apache-2.0 / MIT / BSD) for the prover +
   on-chain verifier path:
   - `arkworks-rs/sumcheck` (Apache-2.0 + MIT) — sumcheck / GKR round.
   - `scroll-tech/ceno` (Apache-2.0) — GKR proving backbone.
   - `scroll-tech/gkr-backend` (sumcheck, MPCS: BaseFold/WHIR, MLE, Poseidon2 transcript,
     curves BN254/BLS12-381).
   - `Plonky3` (MIT/Apache) — field arithmetic.
   - a16z `jolt` / Lasso (MIT/Apache) — lookups for non-linear layers.
   - `mcl` (permissive) — BN254 for on-chain-compatible ops.

3. **Forbidden in the product path:**
   - Lagrange **`zkml`** crate (custom Lagrange License).
   - Polyhedra **Expander / ECC** and anything **AGPL/GPL** (viral).
   - Copying source from any zkGPT/DeepProve/Expander implementation. We implement from
     the **papers** and the allow-listed crates only.

4. **Clean-room discipline & provenance.** Every proof-system component records, in
   [`docs/verified-inference/PROVENANCE_LOG.md`](../verified-inference/PROVENANCE_LOG.md),
   which **paper/idea** it derives from and which **permissive dependency** it uses. No
   contaminating code lifted from encumbered repos. This log is auditor- and IP-facing.

5. **License review is a gate, not a formality.** Before any dependency lands, confirm its
   license is on the allow-list. Any new dependency requires a provenance-log entry.

6. **Reuse is legitimate; reinvention is last resort.** Assembling known primitives from
   permissive crates + public papers is the plan. Novel cryptography is reserved only for
   a deliberate differentiator (e.g. the model-authenticity commitment / spot-check
   design), not the baseline.

## Consequences

- **Positive:** XFuel **owns** its Tier-3 prover/verifier outright — no license overhang,
  auditable, embeddable, licensable on our terms. Ownership is itself a moat.
- **Positive:** No strategic dependency on a competitor's crown-jewel crate or on AGPL.
- **Trade-off:** More engineering than adopting DeepProve; mitigated by (a) shipping the
  non-ZK moats first (PoMA registry, payment-bound receipt, TEE tier) and (b) scoping the
  ZK build to commitment + spot-check before full-pass proving.
- **Non-consequence:** We may still *read* encumbered papers/whitepapers and benchmark
  against DeepProve/Polyhedra; we just don't ship their restricted code.

## Alternatives considered

- **Rent/self-host DeepProve OSS:** rejected as the core path — Lagrange License risk +
  strategic dependency; acceptable only as a throwaway benchmark or stopgap.
- **Use Polyhedra Expander:** rejected for the product path — AGPL-3.0 viral copyleft.
- **Re-implement full zkGPT/DeepProve head-on:** rejected as the *headline* — a treadmill
  vs funded teams and loses the verifiability trilemma on latency/cost.
- **Invent a new proof system from scratch:** rejected as baseline; reserved for a chosen
  differentiator only.
