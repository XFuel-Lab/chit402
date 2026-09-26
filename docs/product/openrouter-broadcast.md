# Chit receipts for OpenRouter (Broadcast)

Chit is the book. A book holder points OpenRouter Broadcast at Chit; Chit stamps one signed receipt per generation. The payment rail is `reported`. OpenRouter does not sign these payloads, and Chit does not check them with OpenRouter. Anyone who holds a book ingest key can POST a span. The receipt says that: `attested_by` is `book_holder_report`, and the badge is "Reported via OpenRouter Broadcast (unverified)". Chit did not settle the payment. The reference is the OpenRouter generation id. Anyone who has the `verify_url` can open that one receipt. The receipt id is random. It is not the generation id.

Prompt and completion text is not required and is not stored. Turn on Privacy Mode for the destination. If a trace still carries prompt or completion text, the receiver drops it before the receipt is built.

The stamp fee is recorded at $0.002 and is not charged during the free pilot (`OPENROUTER_BROADCAST_PILOT_FREE`, default on). A per-book daily cap limits how many new receipts one book can take (`OPENROUTER_BROADCAST_DAILY_CAP`, default 10000). A replay of the same generation id inside the same book family does not count again. The same generation id on another family is a different receipt.

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

Idempotency is `(book family, generation id)`. One family cannot claim another family's generation id or its `verify_url`. `payment.rail` is `reported`. `payment.ref` is `openrouter:<family_id>:<generation_id>`. The signed settlement kind is `reported` with `attested_by: book_holder_report`. `job_kind` and `source` are `openrouter_broadcast`.

`GET /stats`, `GET /stats/door`, and an agent's USDC spent total do not include these rows. Chit did not collect them. The public summary counts a generation only after Chit has checked it against OpenRouter's generation API.

## Check the generation

Attach the book holder's OpenRouter API key. Chit encrypts it with `OPENROUTER_KEY_ENCRYPTION_SECRET` and stores only the ciphertext. The key is never logged and never returned. Rotate by sending a new key. Delete clears it.

```bash
curl -sS -X PUT "https://api.chit402.com/v1/openrouter/books/$BOOK_ID/openrouter-key" \
  -H "Authorization: Bearer $INGEST_KEY" \
  -H "Content-Type: application/json" \
  -d '{"api_key":"'"$OPENROUTER_API_KEY"'"}'
```

```bash
curl -sS -X DELETE "https://api.chit402.com/v1/openrouter/books/$BOOK_ID/openrouter-key" \
  -H "Authorization: Bearer $INGEST_KEY"
```

On each new generation, Chit calls `GET https://openrouter.ai/api/v1/generation?id=<generation_id>` with that key. The record can lag, so Chit retries with backoff. The webhook response does not wait.

When model, native prompt tokens, native completion tokens, and total cost match, the receipt gets `verified_with: openrouter_generation_api`, the badge "Verified with OpenRouter", and the note "Chit checked this generation against OpenRouter's own record. Chit did not settle the payment."

When those fields differ, the receipt gets `verification.status: mismatch` and `verification.fields` listing the differences. The badge stays unverified.

With no key, the badge stays "Reported via OpenRouter Broadcast (unverified)".
