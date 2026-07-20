# Verified Inference — Provenance Log

IP hygiene for the self-owned Tier-3 prover. Governed by [ADR 0003](../adr/0003-verified-inference-cleanroom.md).  
Implement from papers + allow-listed crates only — no source from encumbered zkML repos.

## Allow-list (permissive)

| Dependency | License | Use |
|------------|---------|-----|
| arkworks (`ark-ff`, `ark-bn254`, `ark-poly`, `ark-poly-commit`, …) | Apache-2.0 OR MIT | Fields, BN254, multilinear-KZG PCS |
| `ark-linear-sumcheck` / sumcheck crates | Apache-2.0 OR MIT | Sumcheck rounds |
| Other Apache/MIT GKR / lookup crates as recorded in crate `Cargo.toml` | Apache-2.0 / MIT | Only if added here first |

Forbidden: Lagrange `zkml` (custom license), Polyhedra Expander/ECC (AGPL), verbatim copy from zkGPT/DeepProve implementations.

## Rule

New proof-system dependency → add row here with license **before** merge. Component → paper/idea → crate mapping lives beside the module in `services/zkllm-prover`.
