# Private door traffic metrics

House-only counters derived from **stamped receipt snapshots** in the gateway task store (same source as `GET /receipt/:taskId` and `GET /receipt/by-tx`). This is not a public explorer and does not scrape third-party indexers.

## Endpoint

`GET /v1/internal/door-metrics`

**Auth (required):** set `DOOR_METRICS_TOKEN` in the gateway environment. Call with either:

- `Authorization: Bearer <DOOR_METRICS_TOKEN>`, or
- `X-Door-Metrics-Token: <DOOR_METRICS_TOKEN>`

When `DOOR_METRICS_TOKEN` is unset, the route returns **503 disabled** (fail closed). It is intentionally omitted from public OpenAPI and marketing docs.

## What counts as “door”

A task is included when all of the following hold on the durable snapshot:

1. `issuer_signature.jws` (or `issuerSignature.jws`) is present — Chit stamped the receipt.
2. `intent.paymentRail` is `usdc` with a non-empty `intent.paymentRef` — x402 settlement occurred.
3. `meta.source` (or `intent.sender`) is `openai-gateway` — public paid chat surfaces (`POST /v1/chat/completions`, `/v1/responses`, `POST /a2a-message`).

Rolling windows use `task.createdAt`.

## Example

```bash
curl -sS -H "Authorization: Bearer $DOOR_METRICS_TOKEN" \
  https://api.chit402.com/v1/internal/door-metrics | jq .
```

Sample shape (counts only — no wallets or tx refs):

```json
{
  "generated_at": "2026-08-20T12:00:00.000Z",
  "source": "receipt_task_store",
  "windows": {
    "24h": {
      "stamped_receipts": 12,
      "outcome": { "completed": 11, "failed": 1, "in_progress": 0 },
      "unique_payer_wallets": 8,
      "by_network": { "solana": 5, "evm": 7, "unknown": 0 }
    },
    "7d": { "...": "..." }
  }
}
```

Public `/stats` remains aggregate and marketing-safe; this route is for internal ops (e.g. morning brief bots) and must stay token-gated.
