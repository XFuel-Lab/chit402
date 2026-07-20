# Receipt Schema v2 — Payment-Bound Receipt

Additive fields on the v1 receipt. Implementation: `services/gateway/src/receipt.js`.  
Build plan: [TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md](./TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md).

## Why

- PoMA — bind model identity ([POMA_SPEC.md](./POMA_SPEC.md))
- PBR — bind assurance to x402 `payment_ref` so paid + authentic + verified is one checkable object

## Additive fields

| Field | Meaning |
|-------|---------|
| `route.model_commitment` | Claimed on-chain model commitment |
| `proof.tier` | `signed` · `settlement` · `inference` |
| `binding.covers` | What the payment binding attests |
| `verified_inference` | Tier-3 mechanism + result (when applicable) |
| Optional HMAC `signature` | Gated by `RECEIPT_SIGNING_SECRET` |

v1 fields keep their meaning. Missing Tier-3 fields are null/absent until produced.

## Trust honesty

Tier-2 settlement proofs attest fees / binding / output commitment — not black-box model correctness. Tier-3 fills that gap for open-weight models via zkLLM / TEE.

API surface: [M2M_API.md](./M2M_API.md).
