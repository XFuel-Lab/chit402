# zkGPT Tier-3 Unblock Decision

Historical decision memo. Outcome: do **not** depend on encumbered zkGPT/DeepProve/Expander stacks for the product path.

Go-forward: self-owned zkLLM — [ADR 0003](../adr/0003-verified-inference-cleanroom.md), [ADR 0004](../adr/0004-zkllm-prover-stack.md), [VERIFIED_INFERENCE_HANDOFF.md](../VERIFIED_INFERENCE_HANDOFF.md).

Key facts retained:

- Upstream zkGPT-class work is high-RAM CPU, not GPU-bound
- Lagrange `zkml` / Polyhedra Expander are license-blocked for commercial settlement
- `services/zkgpt-prover` mock is never a live proof
