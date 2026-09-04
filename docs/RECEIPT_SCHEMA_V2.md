# Receipt Schema v2 — Payment-Bound Receipt

Additive fields on the v1 receipt. Implementation: `services/gateway/src/receipt.js`.  
Build plan: [TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md](./TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md).

Public receipts now stamp `schema: "xfuel.receipt.v3"`. The filename stays V2 for link stability; v3 is the additive signed-payload bump below.

## Why

- PoMA — bind model identity ([POMA_SPEC.md](./POMA_SPEC.md))
- PBR — bind assurance to x402 `payment_ref` so paid + authentic + verified is one checkable object

## Additive fields

| Field | Meaning |
|-------|---------|
| `schema` | `xfuel.receipt.v3` |
| `route.model_commitment` | Claimed on-chain model commitment |
| `route.provider` | Actual compute source (signed as of payload v2) |
| `proof.tier` | `signed` · `settlement` · `inference` |
| `binding.covers` | What the payment binding attests |
| `verified_inference` | Tier-3 mechanism + result (when applicable) |
| `privacy` | Private Spend / confidential mode when set |
| `lineage` | Multi-hop: `parent_task_id`, `a2a_message_id`, `receipt_chain` |
| `provider_cogs` | Prepaid float burn (ADR 0005) — not a buyer rail |
| Optional HMAC `signature` | Gated by `RECEIPT_SIGNING_SECRET` |

v1 fields keep their meaning. Missing Tier-3 fields are null/absent until produced.

## Signed payload v2 (`signature.payload_version: 2`)

Tier-1 HMAC covers (order-stable; must match SDK `canonicalReceiptPayload`):

`task_id`, `payment.rail`, `payment.ref`, `payment.net_amount`, `payment.fee_amount`, `route.model`, `route.model_commitment.commitment`, **`route.provider`**, `output.hash`, `binding.expected_commitment`.

Adding `route.provider` is a breaking change for verifiers that recompute the old field set — republish `xfuel-sdk` in lockstep. Old unsigned receipts are unaffected.

## Provider COGS (ADR 0005)

Buyer `payment.rail` stays USDC / x402 (default). Provider inventory burn is separate and is reconciled **after** inference against the provider that actually served:

```json
"provider_cogs": {
  "provider": "akash-network",
  "float_id": "akash-network",
  "currency": "USDC",
  "estimated": "7000",
  "actual": "7000",
  "usd_mark": "7000",
  "below_low_water": false
}
```

Amounts are integer strings in the float asset's smallest units (USDC = 6dp).  
Impl: `services/gateway/src/provider-float.js` · ops: [PROVIDER_FLOAT_TREASURY.md](./PROVIDER_FLOAT_TREASURY.md).

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

### A receipt attests a live provider forward pass

**XFuel never serves model output from its own cache.** Every receipt corresponds to a request the
named provider actually executed. Stating this as a guarantee, not an implementation detail, because
it constrains what we are allowed to build:

- **Provider-side prefix/KV caching is fine and we rely on it.** Reusing attention state for a
  repeated prefix still runs a full forward pass over the sequence on the provider's hardware with
  the committed weights; only redundant prefill arithmetic is skipped. `route.provider` stays true.
- **Gateway-side response or semantic caching is forbidden.** There, no provider runs anything, and
  a receipt naming one would be false. This is the line, and it rules out a latency optimisation
  that gateways built on Portkey-style semantic caches do ship.

One caveat for Tier-3: cached and fresh prefill can reduce in different orders and yield
bitwise-different logits. Quality is unaffected — providers commit that the output distribution is
unchanged and sampling is independent per request either way — but no provider commits to bitwise
determinism under caching. Any verified-inference scheme that assumes reproducible prefill must
account for it.

Third-party verify without trusting HTML: `GET /receipt/:taskId?format=json` or SDK `client.getReceipt(taskId)` + `verifyPaymentBinding`.

When a reusable session is bound at settle, the JWS also stamps `agent_pubkey`, `delegation_hash`, and `session_expiry` (secp256k1, Base). Verify: JWKS → JWS → payer on-chain → `iat` inside the session window → optional `GET /v1/sessions/:delegation_hash` / `/.well-known/revocations` → agent proves `agent_pubkey` via EIP-712 `SessionAct` (`POST /v1/sessions/:delegation_hash/challenge` then `/act`, or 1-shot `/act` with client nonce + deadline) for privileged acts. Types are stable — see [VERIFY_ALGORITHM.md](./VERIFY_ALGORITHM.md) §11. Late assign is a child receipt (`parent_receipt_id`); the genesis JWS is never re-signed. Child signed claims include `kind`/`action`, `session_act` (SessionAct types + signature + nonce), `target_agent`, and `settlement.kind=inherited` (do not re-sum parent `payment.ref` / `gross_amount` / `provider_cogs`).

API surface: [M2M_API.md](./M2M_API.md).
