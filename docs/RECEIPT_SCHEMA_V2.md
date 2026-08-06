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
| `privacy` | Private Spend / confidential mode when set |
| `lineage` | Multi-hop: `parent_task_id`, `a2a_message_id`, `receipt_chain` |
| Optional HMAC `signature` | Gated by `RECEIPT_SIGNING_SECRET` |

v1 fields keep their meaning. Missing Tier-3 fields are null/absent until produced.

## Privacy (Private Spend v0)

When `PRIVATE_SPEND_ENABLED=true`, receipts may include:

```json
"privacy": {
  "mode": "vendor_blind",
  "trust": "gateway",
  "notes": "…"
}
```

This does **not** mean prompts are encrypted. See [PRIVATE_SPEND_THESIS.md](./PRIVATE_SPEND_THESIS.md).

Buyer-only usage: authenticated `GET /stats/me` (API key hash filter).

## Auditor export (Sprint 4)

`GET /receipt/:taskId?format=auditor` → selective disclosure (`xfuel.auditor_export.v1`):

- Policy checks + totals + binding + privacy/lineage
- **Redacts** prompts, raw outputs, proof bytes, keys
- Optional HTML: `?format=auditor&view=html`
- Override policy: `AUDITOR_POLICY_JSON` env

SDK: `client.getAuditorExport(taskId)`.

## Trust honesty

Tier-2 settlement proofs attest fees / binding / output commitment — not black-box model correctness. Tier-3 fills that gap for open-weight models via zkLLM / TEE.

Third-party verify without trusting HTML: `GET /receipt/:taskId?format=json` or SDK `client.getReceipt(taskId)` + `verifyPaymentBinding`.

API surface: [M2M_API.md](./M2M_API.md).
