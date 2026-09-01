# ADR 0004 — zkLLM Prover Stack

Status: Accepted for Tier-3 on-demand proof. Not company identity. Not on GTM roadmap.  
Date: 2026-07-18.  
Related: [ADR 0003](./0003-verified-inference-cleanroom.md), [VERIFIED_INFERENCE_TIERS.md](../VERIFIED_INFERENCE_TIERS.md), `services/zkllm-prover/`.

> **Current reading (2026-09):** zkLLM is a technical capability for open-weight model authenticity, available on demand. It is not XFuel's identity, not the product, and not part of GTM messaging. The product is the book (possession + lineage of spend receipts). Lead with signed receipts (Tier-1) and SP1 settlement proofs (Tier-2), not zkLLM.

## Context

Tier-3 needs a self-owned ZK prover. Mainstream open LLMs are decoder-only transformers whose cost is mostly matmul — so the stack is op-first and config-driven (zkLLM), not a single-model “zkGPT.” ZK proof-of-inference applies to open-weight models only; closed models stay on signed / TEE tiers.

## Decisions

1. Proving stack: arkworks (`ark-ff`, `ark-bn254`, …) — Apache-2.0 / MIT; avoid AGPL/encumbered stacks (ADR 0003).
2. Architecture: matmul-first sumcheck argument; model manifest for gadget selection; pluggable gadgets (Llama-family first); quantized-integer first; spot-check granularity = one block.
3. Public inputs bind arch-bound PoMA + payment-bound receipt tuple with the same keccak / ABI semantics as `SP1ProofHooks` / gateway so proofs settle on the existing Base path.
4. On-chain verify target: wrap to Groth16 / existing Base verifier surface where possible (minimize new audit-scope Solidity).

## Resume / make-or-break

See the build-spec resume section: SP1-compat spike (`services/sp1-inference-spike`) decides wrap path C1 vs C2; then RAM bench, on-chain verify, E2E.

## Consequences

One codebase covers the ZK-addressable open-weight market; honest exclusion of closed models; Base settlement binding preserved.
