# PoMA — Proof of Model Authenticity (Spec)

> **Status:** Phase 1 of [`TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md`](./TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md).
> Defines the model-commitment scheme, the on-chain registry, and how a served task
> carries a `model_commitment` into the receipt. This is the **anti-downgrade wedge**:
> a provider cannot silently serve a smaller/cheaper model than the one committed for the
> version it claims. Clean-room / permissive per [ADR 0003](./adr/0003-verified-inference-cleanroom.md).

---

## 1. What PoMA proves (and doesn't)

- **Proves (Phase 1):** the output was produced against a **committed model identity**
  `(modelId, version, commitment)` that is registered on-chain and immutable. A mismatch
  between the claimed version's commitment and the weights actually used is **detectable**.
- **Does NOT prove (yet):** that the provider *cryptographically* ran that exact model on
  that exact input. Phase 1 binds the commitment into the receipt (attested); Phases 4–5
  (TEE attestation / ZK spot-check) upgrade "detectable" → "provable" with the **same
  commitment** as the anchor.

The commitment is chosen so the ZK tier can reuse it (see §5 upgrade path).

---

## 2. Identifiers

- **Canonical slug:** `"<family-or-model>:<quant>"`, lowercased. Examples:
  `llama-3-70b:q4_k_m`, `tinyllama-1.1b:fp16`. The `:quant` matters — a different
  quantization is a different served artifact and gets its own commitment.
- **`modelId`:** `keccak256(utf8(canonicalSlug))`. Stable, collision-resistant, cheap on-chain.
- **`version`:** 1-based, append-only per `modelId`. New weights (fine-tune, requant,
  re-export) → new version. Versions are never mutated or deleted.

---

## 3. Commitment scheme — `KECCAK_MERKLE` (scheme id `0`)

Weights ship as ordered **shards** (safetensors/GGUF/ONNX parts — the formats agents
actually distribute). The commitment is a domain-separated Merkle root over those shards:

```
leaf(i)   = keccak256( 0x00 || shardBytes(i) )      # ordered by shard index
node(l,r) = keccak256( 0x01 || l || r )             # 0x00/0x01 = domain separation
odd tail  = promoted (carried up) unchanged
commitment = Merkle root over [leaf(0), leaf(1), ...]   # single shard → its own leaf
empty     = 0x000…0 (rejected on-chain: CommitmentZero)
```

- **Ordering is significant** — the shard order is part of the commitment and MUST be
  recorded in the off-chain manifest (`metadataURI`).
- **Domain separation** (`0x00` leaves, `0x01` nodes) prevents leaf/node confusion and
  second-preimage attacks.
- **Global uniqueness:** the registry rejects a commitment already registered to any
  `(modelId, version)` — one artifact ↔ one commitment.

**Reference implementation:** [`services/gateway/src/model-commitment.js`](../services/gateway/src/model-commitment.js)
(`computeCommitmentFromFiles`, `merkleRoot`, `shardLeaf`, `modelIdFromSlug`).

### CLI

```bash
# from services/gateway
node src/model-commitment.js --slug "llama-3-70b:q4_k_m" --arch llama-3 --quant q4_k_m \
  model-00001-of-00003.safetensors model-00002-of-00003.safetensors model-00003-of-00003.safetensors
# → { modelId, commitment, scheme:0, slug, shardCount, shards:[{file,bytes,leaf}, ...] }
```

The printed `modelId` + `commitment` are the arguments for `registerModel(...)`.

---

## 4. On-chain registry

[`contracts/core/ModelRegistry.sol`](../contracts/core/ModelRegistry.sol) (interface
[`IModelRegistry.sol`](../contracts/interfaces/IModelRegistry.sol)) — deployed on **Base**
(ADR 0002).

| Function | Purpose |
|---|---|
| `registerModel(modelId, commitment, scheme, arch, quant, metadataURI) → version` | Append an immutable version (REGISTRAR_ROLE). Emits `ModelRegistered`. |
| `retireVersion(modelId, version)` | Stop active serving; commitment stays readable (historical receipts stay verifiable). |
| `getModel / getLatestModel / latestVersion / versionCount` | Reads. |
| `isActive(modelId, version)` | Registered and not retired. |
| `verifyCommitment(modelId, version, commitment) → bool` | True iff active version's commitment matches (the downgrade check). |
| `lookupCommitment(commitment) → (modelId, version)` | Reverse lookup from a receipt's commitment. |

Properties: append-only versions, immutable commitments, global commitment uniqueness,
`REGISTRAR_ROLE`-gated writes, pausable. `registerModel` ≈ 244K gas (under the 300K target).

---

## 5. Serving-time binding (receipt)

At serve time the gateway stamps `route.model_commitment` onto the public receipt:

```jsonc
"route": {
  "model": "llama-3-70b:q4_k_m",
  "model_commitment": {
    "commitment": "0x…",   // Merkle root registered on-chain
    "model_id": "0x…",     // keccak256(slug)
    "version": 1,
    "scheme": 0
  }
}
```

Resolution order ([`receipt.js` → `modelCommitmentOf`](../services/gateway/src/receipt.js)):
1. `task.meta.modelCommitment` stamped by the serving path, else
2. `resolveModelCommitment(model)` against local config:
   - `MODEL_COMMITMENTS` — inline JSON `{"<slug>": "<commitment>"}` or
     `{"<slug>": { commitment, version, modelId, arch, quant }}`
   - `MODEL_REGISTRY_FILE` — path to the same JSON.

When neither is configured, the field is `null` and the receipt is byte-compatible with
pre-PoMA output (no behavior change). Phase 2 (PBR) binds this commitment to the x402
payment; Phase 4/5 replace attestation with TEE/ZK checks against the **same** commitment.

---

## 6. Upgrade path — `MLE_POLY` (scheme id `1`)

The keccak-Merkle root is perfect for cheap on-chain equality checks but is **opaque to a
ZK circuit**. The ZK tier (Phase 5) needs the commitment to be a **multilinear-extension /
polynomial commitment** over the weight tensors so a proof can open individual weights.

Plan:
- Add scheme `MLE_POLY` (id `1`) computed with the permissive PCS from
  `scroll-tech/gkr-backend` (BaseFold/WHIR) — see [ADR 0003](./adr/0003-verified-inference-cleanroom.md)
  allow-list and [`PROVENANCE_LOG.md`](./verified-inference/PROVENANCE_LOG.md).
- Register it as an **additional version** of the same `modelId` (both schemes coexist):
  keccak version for fast checks, MLE version referenced by ZK proofs.
- `IVerifiedInference.commitmentBundle` carries whichever commitment the mechanism needs.

---

## 7. Threat model (Phase 1)

| Threat | Phase 1 mitigation | Hardened by |
|---|---|---|
| **Model downgrade** (serve smaller model) | Commitment mismatch detectable via `verifyCommitment` | TEE/ZK (P4/P5) makes it provable |
| **Commitment reuse across models** | Global uniqueness (registry rejects dup) | — |
| **Silent weight swap under same version** | Versions immutable; new weights need new version | on-chain audit trail |
| **Registrar compromise** | `REGISTRAR_ROLE` + pausable; deploy admin = Safe (ADR 0002) | governance / multi-sig |
| **Provider lies about which version it served** | Bound into receipt; Phase 2 binds to payment | attestation/ZK proof of use |

---

## 8. References

- Build spec: [`TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md`](./TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md) §4
- Strategy: [`research/tier3-verifiable-inference-strategy.md`](./research/tier3-verifiable-inference-strategy.md)
- Clean-room policy: [`adr/0003-verified-inference-cleanroom.md`](./adr/0003-verified-inference-cleanroom.md)
- Receipt v2 (PBR): [`RECEIPT_SCHEMA_V2.md`](./RECEIPT_SCHEMA_V2.md)
- Verifier seam: [`../contracts/interfaces/IVerifiedInference.sol`](../contracts/interfaces/IVerifiedInference.sol)
