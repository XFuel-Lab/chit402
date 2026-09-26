# Chit receipts for OpenRouter (Broadcast)

Chit is the book. OpenRouter reports each generation; Chit stamps one signed receipt per generation. The payment rail is `reported`: the spend figure is OpenRouter's report, and Chit did not settle it. The receipt says so. The reference is the OpenRouter generation id. Anyone can open the `verify_url`.

Prompt and completion text is not required and is not stored. Turn on Privacy Mode for the destination. If a trace still carries prompt or completion text, the receiver drops it before the receipt is built.

The stamp fee is recorded at $0.002 and is not charged during the free pilot (`OPENROUTER_BROADCAST_PILOT_FREE`, default on). A per-book daily cap limits how many new receipts one book can take (`OPENROUTER_BROADCAST_DAILY_CAP`, default 10000). Replays of the same generation id do not count again.

## 1. Mint a book

```bash
curl -sS -X POST "https://api.chit402.com/v1/openrouter/books" \
  -H "Content-Type: application/json" \
  -d '{"label":"openrouter"}'
```

The response includes `book_id` and `ingest_key`. The key is shown once. Chit stores only its hash. Send it as `Authorization: Bearer <ingest_key>` or `X-Chit-Ingest-Key`.

Another book in the same family (same key can stamp it when a trace is tagged):

```bash
curl -sS -X POST "https://api.chit402.com/v1/openrouter/books" \
  -H "Authorization: Bearer $INGEST_KEY" \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"fixture-agent","label":"agent"}'
```

`agent_id` is the tag you will send as `trace.metadata.agent_id`. A positive integer that matches a registered Chit agent also lands the row on that possession-gated book. Reported rows are not added to the agent's USDC spent total.

## 2. Settings > Observability > Webhook

In OpenRouter, open Settings > Observability and enable Broadcast. Edit the Webhook destination.

## 3. URL and header

| Field | Value |
|-------|--------|
| URL | `https://api.chit402.com/v1/openrouter/broadcast` |
| Method | `POST` (PUT is also accepted) |
| Header | `Authorization: Bearer <ingest_key>` |

Or use `X-Chit-Ingest-Key: <ingest_key>`.

Test Connection sends an empty payload with `X-Test-Connection: true`. Chit returns 200. Save the destination, and enable Privacy Mode.

Optional per-generation tags on the OpenRouter request:

```json
{
  "trace": {
    "chit_book": "orb_…",
    "agent_id": "fixture-agent"
  }
}
```

`chit_book` and `agent_id` select another book in the same family. A tag that does not match stays on the book that owns the ingest key.

## Read the book

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/v1/openrouter/books/:book_id/receipts` | Ingest key for that family |
| `GET` | `/v1/openrouter/books/:book_id/summary` | None. Counts and reported USD only. Not a receipt index. |
| `GET` | `/receipt/:task_id` | None. One receipt, including `verify_url`. |

The possession-gated principal book (`GET|POST /v1/agents/:agent_id/book`) stays possession-gated. It is not a public index. The public summary follows that rule: aggregates only.

Each receipt is idempotent on generation id. `payment.rail` is `reported`, `payment.ref` is `openrouter:<generation_id>`, and the signed settlement kind is `reported` with `attested_by: openrouter_report`. `job_kind` and `source` are `openrouter_broadcast`.
