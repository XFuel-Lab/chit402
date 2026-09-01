# Tier-3 — Verifiable Inference Build Spec

Master plan for Verified Inference.  
ADRs: [0003](./adr/0003-verified-inference-cleanroom.md), [0004](./adr/0004-zkllm-prover-stack.md).  
Tiers: [VERIFIED_INFERENCE_TIERS.md](./VERIFIED_INFERENCE_TIERS.md).

## Product

Settlement-native, payment-bound proof-of-inference for agents. Trust ladder: signed → SP1 settlement → Verified Inference (TEE / zk-spotcheck / zk-full). Wedge: PoMA anti-downgrade + PBR on Base. Prover: self-owned zkLLM (`services/zkllm-prover`), not encumbered zkML stacks.

## Pipeline

| Phase | Focus | Status |
|-------|--------|--------|
| 0 | Foundations / IP policy | Shipped |
| 1 | PoMA ModelRegistry | Shipped |
| 2 | Payment-bound receipt | Shipped (in-proof binding awaits SP1 guest v2) |
| 3 | ERC-8004 validation adapter | Shipped |
| 4 | Tier engine (TEE + spot-check harness + staking) | Shipped (hardware TEE host optional) |
| 5 | zkLLM prover (T3b/T3c) | Active — see resume |
| 6 | Scale (streaming, Interstellar, DePIN accountability) | Later |

## Phase 5 milestones

| Slice | Status |
|-------|--------|
| M5.1 Matmul / crate skeleton + manifest / PBR binding | Done |
| M5.2 Transformer block + gadgets (attention, FFN, lookups) | Done (composition) |
| M5.3 Requant + spot-check orchestration | Largely done |
| M5.4a PCS binding (succinct ops) | Done |
| M5.4b On-chain verify (SP1-wrap C1 preferred) + E2E | **Resume here** |
| M5.5 Full-pass premium (T3c) | Later |

## Resume here

1. SP1 spike make-or-break — `services/sp1-inference-spike/` (`cargo prove build` on matched SP1 image). C1 = SP1-wrap → Groth16 → Base verifier; else C2.
2. RAM bench; pin spot-check window `k`.
3. Wire on-chain verify path (minimize new audit-scope Solidity).
4. E2E: task → spot-check proof → on-chain verify → settle.

Tests: `cd services/zkllm-prover && cargo test`.  
Runtime honesty: [RUNTIME_STATE.md](./RUNTIME_STATE.md).

## Phase 6 (later)

Streaming / per-token proofs; Interstellar folding; broader DePIN accountability; larger models via distributed proving as demand appears.
