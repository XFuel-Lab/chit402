# PoMA — Proof of Model Authenticity

Anti-downgrade: bind a served task to a committed model identity. Phase 1 of [TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md](./TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md). Clean-room: [ADR 0003](./adr/0003-verified-inference-cleanroom.md).

## Proves / does not prove

Proves: output is tied to registered `(modelId, version, commitment)` — silent downgrade is detectable.  
Does not yet prove by itself: cryptographic execution of that model on that input (TEE / zkLLM upgrade the same commitment).

## Identifiers

- Canonical slug: `"<model>:<quant>"` (lowercase) — e.g. `llama-3-70b:q4_k_m`
- `modelId` = `keccak256(utf8(slug))`
- `version` = append-only per `modelId`

## Schemes

| Id | Scheme | Notes |
|----|--------|--------|
| 0 | `KECCAK_MERKLE` | Shard Merkle root over weight parts |
| (later) | `MLE_POLY` | PCS-friendly PoMA root for zkLLM binding |

Registry: `contracts/core/ModelRegistry.sol` (scheme-agnostic). Gateway attaches `model_commitment` on receipts. MCP: `verify_model_commitment`.

## Related

- [RECEIPT_SCHEMA_V2.md](./RECEIPT_SCHEMA_V2.md)
- [VERIFIED_INFERENCE_TIERS.md](./VERIFIED_INFERENCE_TIERS.md)
- `services/zkllm-prover` (arch-bound PoMA in public inputs)
