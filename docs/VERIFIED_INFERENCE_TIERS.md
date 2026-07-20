# Verified Inference — Trust Tiers

XFuel prices trust to value at risk. Spec: [TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md](./TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md).  
Handoff: [VERIFIED_INFERENCE_HANDOFF.md](./VERIFIED_INFERENCE_HANDOFF.md).

## Ladder

| Tier | Mechanism | Attests | Cost |
|------|-----------|---------|------|
| 1 `signed` | — | Route, model, cost, output hash (XFuel-signed) | ~free |
| 2 `settlement` | SP1 | Fees + payment binding + output commitment on Base | seconds |
| 3a `inference` | `tee` | Enclave loaded committed model (PoMA) | low* |
| 3b `inference` | `zk-spotcheck` | Random ZK / re-exec fraction + staking deterrence | tunable |
| 3c `inference` | `zk-full` | Full forward-pass proof (eligible models) | premium |

\* Real TEE host when wired; today `tee` may use a `dev` attestor (software signature — honestly labeled).

Tier 2 proves settlement metadata, not black-box model correctness. Tier 3 targets computation authenticity for open-weight models via `services/zkllm-prover`.

## Selection

`services/gateway/src/tier-policy.js` — pure function of task value, requested `proof_tier` (may raise, not silently lower), and availability. Defaults overridable via env; disabled until configured.

## Related

- [POMA_SPEC.md](./POMA_SPEC.md) (if present) / ModelRegistry
- [ADR 0003](./adr/0003-verified-inference-cleanroom.md), [ADR 0004](./adr/0004-zkllm-prover-stack.md)
- [RUNTIME_STATE.md](./RUNTIME_STATE.md)
