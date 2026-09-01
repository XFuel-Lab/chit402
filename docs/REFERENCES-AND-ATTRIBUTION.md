# References & Attribution

Third-party research cited or used by XFuel. Full academic credit to the authors.

## Fair Exchange (PAS)

Used for optional A2A atomic settlement (`settleBidFairExchange`).

- Paper: *Delegated Payments for AI Agents: Fair Exchange on Bitcoin/EVM*
- https://eprint.iacr.org/2026/395

## zkGPT (cited prior art)

Cited for the Tier-3 research landscape. Go-forward path is the self-owned zkLLM prover (`services/zkllm-prover`). The `ZKVerifierZkGPT` stub and `services/zkgpt-prover` mock are dev-only — never a live proof path.

- Paper: *zkGPT: Efficient Non-Interactive Zero-Knowledge Proof Framework for Large Language Model Inference*
- https://eprint.iacr.org/2025/1184
- Upstream reference impl: https://github.com/security-Anonymous/zkgpt

## Interstellar (research track)

Prover-side upgrade candidate (GKR IVC folding). No on-chain verifier change required (`ZKVerifierSP1` remains Groth16/PLONK). Not yet integrated.

- Paper: Jieyi Long (Theta Labs) — https://eprint.iacr.org/2025/1294

## Related

- [adr/0003-verified-inference-cleanroom.md](./adr/0003-verified-inference-cleanroom.md)
- [adr/0004-zkllm-prover-stack.md](./adr/0004-zkllm-prover-stack.md)
