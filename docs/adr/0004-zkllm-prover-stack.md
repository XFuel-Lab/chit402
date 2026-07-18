# ADR 0004 — XFuel zkLLM Prover Stack (arkworks; model-agnostic, op-first)

- **Status:** Accepted
- **Date:** 2026-07-18
- **Deciders:** Founder + engineering
- **Related:** ADR 0003 (clean-room, permissive-only), ADR 0002 (Base settlement home),
  [`docs/TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md`](../TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md) §8,
  [`docs/VERIFIED_INFERENCE_TIERS.md`](../VERIFIED_INFERENCE_TIERS.md)

---

## Context

Phase 5 builds XFuel's **own** ZK prover for Tier-3 (T3b spot-check / T3c full). ADR 0003 committed
us to a clean-room, permissive-only build. This ADR pins the concrete crypto stack and the
architecture that lets **one codebase cover the whole ZK-addressable LLM market**.

Two findings drive the design:

1. **The specific LLM barely matters for the expensive core.** Every mainstream open LLM (Llama,
   Mistral, Qwen, Gemma, GPT-2, MoE variants) is a decoder-only transformer whose cost is
   ~90%+ **matmul** — architecture-independent (only dimensions change). Positional encoding,
   normalization, activation, and attention grouping differ, but they are a small, swappable
   "long tail." So we build **op-first + config-driven**, not model-specific. "zkGPT" was the wrong
   label; this is **XFuel zkLLM**.
2. **ZK proof-of-inference only applies to open-weight models.** You can only prove a computation
   you run. Closed models (GPT-4o/Claude/Gemini) have no weight access → un-provable by anyone;
   they are honestly covered by the **T3a TEE** and signed tiers. Open-weight models — exactly what
   XFuel routes to on DePIN/neocloud, overwhelmingly Llama-lineage — are the ZK-addressable set.

## Decision

**Proving stack: [arkworks](https://github.com/arkworks-rs)** (`ark-ff`, `ark-bn254`, `ark-std`) —
mature, modular, **Apache-2.0 / MIT** dual-licensed, with the sumcheck/MLE and BN254 +
Groth16-wrap primitives we need for on-chain verification. We **avoid** AGPL/encumbered stacks
(Polyhedra Expander = AGPL-3.0; Lagrange `zkml` = custom license) per ADR 0003.

**Architecture:**
- **Matmul-first.** Implement a generic **sumcheck-based matmul argument** (Thaler-style: reduce
  `C = A·B` to evaluations of the multilinear extensions of `A`, `B` at a Fiat-Shamir point). This
  is the model-agnostic 90% and the first shippable slice (M5.1).
- **Model manifest.** A compact architecture config drives gadget selection. Committing the
  manifest **extends PoMA**: the proof attests "*these* weights **+ this** architecture produced
  this output," closing a model-substitution/downgrade gap.
- **Gadgets as pluggable modules**, added Llama-family first (RMSNorm → SwiGLU/SiLU → RoPE → GQA),
  via Lasso/logup lookups for non-linearities. GPT-2-style (LayerNorm/GeLU/learned-pos) is a subset.
- **Quantized-integer first.** Finite-field-native and market-real; floats are deferred.
- **Spot-check granularity = one block.** Every block is structurally identical, so one block
  prover + the manifest covers any depth / any model without whole-model RAM.

**Public-input binding.** Proof public inputs bind the **arch-bound PoMA model commitment** + the
**PBR tuple** (payment_ref, task_id, rail, amount, output_hash) using `keccak256`/`abi.encodePacked`
semantics identical to `SP1ProofHooks.computeInferenceBindingCommitment` and the gateway/SDK —
so a zkLLM proof slots into the same settlement path as the SP1 settlement proof.

## Approved dependencies (provenance log)

| Crate | Version | License | Role |
|-------|---------|---------|------|
| `ark-ff` | 0.4 | Apache-2.0 OR MIT | Prime field arithmetic (BN254 `Fr`) |
| `ark-bn254` | 0.4 | Apache-2.0 OR MIT | BN254 scalar field (on-chain-friendly) |
| `ark-std` | 0.4 | Apache-2.0 OR MIT | RNG / no-std shims / test utils |
| `sha3` | 0.10 | Apache-2.0 OR MIT | `Keccak256` — Ethereum-compatible commitments + Fiat-Shamir |

Every future component (GKR backend, lookups, Groth16 wrapper) gets a row here with its license
verified **before** it is added. Nothing enters the tree that isn't OSI-permissive.

## Consequences

- **Positive:** one model-agnostic codebase; day-one coverage of the matmul-dominated cost for all
  open LLMs; clean licensing; proofs bind to the same PoMA+PBR settlement tuple; container-portable
  (CPU-only), so it runs on any AWS container (RAM-sized instance for model-scale).
- **Negative / risk:** specialist crypto and time (XL). M5.1 is a verifiable-computation reduction;
  the polynomial-commitment opening that binds `A,B` to the on-chain weight commitment, and the
  Groth16 wrap for cheap on-chain verification, are explicit later milestones (M5.4).
- **Honesty boundary:** until M5.4 lands on Base, zkLLM proofs are generated + verified off-chain;
  the tier engine keeps serving `tee`/`settlement`/`signed` and never labels a task `zk-full`
  unless a real full-proof verifier is configured.
