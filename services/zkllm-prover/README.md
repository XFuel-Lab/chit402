# zkLLM Prover

Self-owned, model-agnostic ZK prover for XFuel Verified Inference (Tier-3). Clean-room, permissive-only — [ADR 0003](../../docs/adr/0003-verified-inference-cleanroom.md), [ADR 0004](../../docs/adr/0004-zkllm-prover-stack.md).

CPU-only / RAM-bound. Not “zkGPT.” Op-first + config-driven for open-weight decoder transformers (Llama, Mistral, Qwen, …). Closed models stay on signed / TEE tiers.

Build plan: [docs/TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md](../../docs/TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md).

## Crate

Workspace under `crates/xfuel-zkp` — matmul / sumcheck / PCS / gadgets / attention / FFN / block / spot-check / PoMA binding.

New gadgets: `.cursor/skills/add-zkp-gadget/SKILL.md`.

## Test

```
cd services/zkllm-prover
cargo test
```

## Trust boundary

Lookup-backed non-linearities expose typed `LookupObligations`. Public inputs bind arch-bound PoMA + payment-bound receipt tuple for Base settlement.
