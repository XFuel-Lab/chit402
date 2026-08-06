# Verified Inference — Agent Handoff

Self-contained brief for Tier-3 / zkLLM work. Master plan: [TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md](./TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md).  
Where this and the spec disagree, the spec’s phase checkboxes win.

Last updated: 2026-07-20.

## What we are building

Settlement-native, payment-bound proof-of-inference for agents (Tier 3 on the trust ladder). Wedge: anti-downgrade (PoMA) + payment-bound receipts on Base — not a race to out-prove DeepProve on raw zkML. Stack: [ADR 0003](./adr/0003-verified-inference-cleanroom.md), [ADR 0004](./adr/0004-zkllm-prover-stack.md). Code: `services/zkllm-prover/`.

## Session stop (2026-07-20)

Done / merged:

- Committed transformer block (attention → FFN); `cargo test` green in the prover crate
- PoMA `MLE_POLY` model-authenticity anchor (registry scheme-agnostic; no contract change)
- SP1-compat spike scaffold: `services/sp1-inference-spike/` (isolated from CI)

Resume (in order):

1. SP1 spike make-or-break — `cd services/sp1-inference-spike/sp1 && cargo prove build` (Linux/Docker). Prior run: arkworks compiled to zkVM; blocked on `sp1-zkvm` ↔ toolchain mismatch. Resume on a matched SP1 image; then C1 (SP1-wrap) vs C2.
2. RAM bench on a high-RAM host; pin spot-check window `k`.
3. Verifier via SP1-wrap (C1) → Groth16 → existing Base verifier surface.
4. E2E: task → spot-check proof → on-chain verify → settle (not run yet).

Product note: Tier 1 + Tier 2 is the traction surface; Tier 3 is the moat. Keep docs honest about real vs mock — [RUNTIME_STATE.md](./RUNTIME_STATE.md).

**Sprint 4 decision:** [TIER3_TIMEBOX_DECISION.md](./TIER3_TIMEBOX_DECISION.md) — narrow premium SKU, ≤20% eng until Seed gates, SP1 spike make-or-break gate.

## Tests and benchmarks

Phase 5 is RAM-bound (CPU), not GPU. Record prove/verify time, proof size, and peak RAM on the host you use — laptop numbers are not capacity planning.

```bash
cd services/zkllm-prover
cargo test
cargo run --release --example prove_block -- <args>
```

Skill for new gadgets: `.cursor/skills/add-zkp-gadget/SKILL.md`.
