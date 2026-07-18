# XFuel Verified Inference — Clean-Room Provenance Log

> **Purpose:** IP hygiene + auditor evidence for XFuel's own Tier-3 prover/verifier.
> Every proof-system component is implemented **clean-room from public papers** on
> **permissively-licensed** primitives. This log records, per component: what it does,
> which **paper/idea** it derives from, and which **permissive dependency** it uses.
> Governed by [ADR 0003](../adr/0003-verified-inference-cleanroom.md).
>
> **Rule:** no source copied from encumbered repos (Lagrange `zkml` — Lagrange License;
> Polyhedra Expander/ECC — AGPL). Implement from the paper + allow-listed crates only.
> Any new dependency **must** be added here with its license before it lands.

---

## Dependency allow-list (permissive only)

| Dependency | License | Use |
|---|---|---|
| `arkworks-rs/sumcheck` (`ark-linear-sumcheck`) | Apache-2.0 + MIT | Sumcheck / GKR round |
| `scroll-tech/ceno` | Apache-2.0 | GKR proving backbone |
| `scroll-tech/gkr-backend` | Apache-2.0 | Sumcheck, MPCS (BaseFold/WHIR), MLE, Poseidon2 transcript, curves |
| `Plonky3` | MIT/Apache-2.0 | Field arithmetic (Goldilocks/BabyBear) |
| a16z `jolt` / Lasso | MIT/Apache-2.0 | Lookups (non-linear layers) |
| `mcl` | permissive (BSD-style) | BN254 for on-chain-compatible ops |

**Forbidden in product path:** Lagrange `zkml` crate; Polyhedra Expander/ECC; any AGPL/GPL
code; verbatim source from zkGPT/DeepProve/Expander implementations.

---

## Reference papers (implement FROM these, not from others' code)

| Ref | Paper | Used for |
|---|---|---|
| 2025/1184 | zkGPT | Linear/non-linear LLM layer proving; constraint fusion; circuit squeeze |
| 2026/1112 | DeepProve (methodology, paper only) | logup-GKR end-to-end approach (ideas, not code) |
| 2023/1216 | Lasso | Lookup argument for range/exp/activation |
| 2017/1132 | Hyrax | Transparent polynomial commitment |
| 2603.18046 | NANOZK | Layerwise / constant-size per-layer proofs; selective verification |
| 2025/1294 | Interstellar | GKR folding / collaborative proving (scale) |
| 2024/1873 | Cirrus | Distributed proving + accountability |

---

## Component log

> Add a row when a component is implemented. Keep it truthful and specific.

| Component | Status | Derived from (paper/idea) | Permissive dep(s) | Notes / clean-room evidence |
|---|---|---|---|---|
| _(example)_ Sumcheck engine | planned | GKR (Thaler); 2025/1184 | `arkworks-rs/sumcheck` | Implemented from paper + crate API; no code from `zkml`/Expander |
| Weight-commitment (PoMA) | planned | XFuel design (§6.1 strategy) | keccak/MLE (own) | Novel differentiator; document scheme in `POMA_SPEC.md` |
| Matmul/attention GKR proof | planned | 2025/1184 §linear; Libra | `ceno`, `gkr-backend` | — |
| Non-linear (GeLU/softmax/LN) | planned | 2025/1184 §non-linear; Lasso | `jolt`/Lasso | Constraint-fusion technique from paper |
| Polynomial commitment | planned | Hyrax 2017/1132; BaseFold | `gkr-backend/mpcs`, `mcl` | — |
| On-chain verifier | planned | ZKG2_VERIFIER_SPEC | BN254 precompiles | Solidity/Yul or Groth16 wrapper |

---

## Change control

- New dependency → add to allow-list table **and** open the license for review (ADR 0003 §5).
- New component → add a row with paper + dep + a one-line clean-room note.
- Any suspected contamination (code lifted from an encumbered repo) → remove, re-implement
  from the paper, and note the remediation here.
