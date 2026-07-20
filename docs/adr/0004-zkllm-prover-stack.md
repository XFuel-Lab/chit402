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
| `ark-bn254` | 0.4 | Apache-2.0 OR MIT | BN254 scalar field + pairing (on-chain-friendly) |
| `ark-ec` | 0.4 | Apache-2.0 OR MIT | Elliptic-curve / `Pairing` trait for the multilinear-KZG PCS |
| `ark-poly` | 0.4 | Apache-2.0 OR MIT | `DenseMultilinearExtension` (tensor → MLE) for the PCS |
| `ark-poly-commit` | 0.4 | Apache-2.0 OR MIT | `multilinear_pc::MultilinearPC` — multilinear KZG (PST) commitment (M5.4) |
| `ark-serialize` | 0.4 | Apache-2.0 OR MIT | Canonical commitment encoding, absorbed into the Fiat–Shamir transcript (M5.4) |
| `ark-std` | 0.4 | Apache-2.0 OR MIT | RNG / no-std shims / test utils |
| `sha3` | 0.10 | Apache-2.0 OR MIT | `Keccak256` — Ethereum-compatible commitments + Fiat-Shamir |

**M5.4 PCS choice (2026-07-19).** The succinctness binding uses **multilinear KZG** (the Marlin
variant of Papamanthou–Shi–Tamassia, `ark_poly_commit::multilinear_pc`) over BN254. Rationale:
(1) pairing-based on BN254 ⇒ an opening verifies with the `ecPairing` precompile (`0x08`), keeping
the future on-chain `IVerifiedInference` verifier a **native-Solidity** path rather than forcing a
non-native-pairing Groth16 wrap of the whole verifier; (2) constant-size commitments/openings;
(3) Apache/MIT (ADR 0003). **Trust cost:** a per-`num_vars` trusted-setup SRS (powers-of-tau) — the
same assumption Groth16 already carries; keys are generated once, never on the hot path
(`pcs::setup`). A transparent alternative (Hyrax, also in `ark-poly-commit`) is available if we later
choose to drop the setup at the cost of `√n` opening size.

**On-chain verifier decision — SP1-wrap (C1) (2026-07-20).** Rather than ship a hand-rolled
native-Solidity multilinear-KZG + sumcheck verifier (large new audit surface, high gas), we run our
**verifier inside an SP1 guest** and let Succinct wrap it to a cheap on-chain proof verified by the
**existing `SP1Verifier.sol` on Base** — no new audit-scope Solidity, no GPU, and the *same* wrap
serves Tier-2 settlement and Tier-3 inference (only the guest's checks differ). Two variants were
weighed:

- **C1 (chosen): keep KZG.** The guest runs `pcs::verify` (multilinear-KZG); each opening is O(1)
  BN254 pairings (SP1 has a `bn254` pairing precompile), so the guest stays small.
- **C2 (fallback): drop KZG.** The guest commits tensors by keccak (native in SP1) and recomputes
  `mle_eval` in-guest — no SRS/ceremony, but O(n) field ops per opening.

**Two honest caveats, deliberately deferred to a spike (not yet resolved):**
1. **SRS.** Multilinear KZG needs a *multilinear* SRS; public powers-of-tau ceremonies are
   *univariate* (see [`docs/POMA_SPEC.md`](../POMA_SPEC.md) §6). C1 therefore implies either a small
   first-party setup or a scheme swap (e.g. Zeromorph over a univariate SRS). This does **not** block
   the PoMA commitment, which is PCS-agnostic.
2. **zkVM compile.** Whether `ark-poly-commit` + BN254 pairings compile to the SP1 `riscv32im`
   target (with SP1's patched arkworks crates) is the make-or-break for C1 vs C2. It is measured by a
   throwaway spike, **not** by touching product code.

**Spike status:** scaffolded + isolated in [`services/sp1-inference-spike/`](../../services/sp1-inference-spike/README.md)
(PR #149). The SP1-independent core (serialize a KZG opening → `pcs::verify` → bundle) compiles and
passes tests on any host incl. Windows; the zkVM build is the one remaining unknown.

> **▶ RESUME HERE (Tier-3 on-chain verifier):** in Linux/Docker/WSL/AWS with the SP1 toolchain
> (`sp1up`), run `cd services/sp1-inference-spike/sp1 && cargo prove build -p xfuel-inference-spike-guest`.
> If it compiles → C1 confirmed; record the guest cycle count (`host` execute) here. If it fails on
> `ark-poly-commit` → adopt **C2** and record why. **No audit-scope Solidity until this passes.**

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
