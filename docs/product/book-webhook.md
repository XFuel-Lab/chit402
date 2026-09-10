# Book webhook push (treasury desk v1)

Chit402 is the **book** — possession-gated source of record for agent spend. The book webhook is a **treasury extension**: when a row lands on an agent's book, the gateway pushes a signed envelope to a URL the principal registered. Their treasury desk renders rows without Chit white-labeling `/book`.

Register once → automatic push on every new book row. Not request-per-row polling.

## Register (possession-gated)

Same session as `/book` — header `X-XFuel-Session` (or `session` in JSON body).

```bash
curl -X PUT "https://api.chit402.com/v1/agents/149/book/webhook" \
  -H "Content-Type: application/json" \
  -H "X-XFuel-Session: YOUR_SESSION" \
  -d '{"url":"https://treasury.example/hooks/chit402","events":["settle","collected","inflow","policy_blocked"]}'
```

| Method | Path | Action |
|--------|------|--------|
| `PUT` or `POST` | `/v1/agents/:agent_id/book/webhook` | Register or update |
| `GET` | same | Redacted config (`url_host`, `enabled`, `events`; no full secret) |
| `DELETE` | same | Clear webhook |

Rules:

- **HTTPS only** (non-HTTPS and localhost rejected in production).
- Optional `secret` — if omitted, the server generates one and returns `secret_once` **once** on create.
- Optional `events` — subset of `settle`, `inflow`, `policy_blocked`, `collected` (default: all).

## Delivery

When a book row is written (settle, collected, inflow, policy_blocked), the gateway POSTs asynchronously. Settle path is never blocked on webhook failure; failures are logged with one retry.

**Headers**

| Header | Value |
|--------|--------|
| `Content-Type` | `application/json` |
| `X-Chit-Signature` | `sha256=<hex>` HMAC-SHA256(secret, raw body) |
| `X-XFuel-Signature` | same (house alias) |
| `X-Chit-Event` / `X-XFuel-Event` | envelope `event` field |

Verify with `crypto.timingSafeEqual` on the hex digest (after `sha256=` prefix).

## Envelope (`chit402.book_webhook.v1`)

Flat fields aligned with `/book/export` and [hemei stranger specimens](hemei-stranger-specimens.md):

| Field | Notes |
|-------|--------|
| `schema` | `chit402.book_webhook.v1` |
| `delivery_id` | Idempotency key — dedupe retries safely |
| `event` | `settle` \| `inflow` \| `policy_blocked` \| `collected` |
| `agent_id`, `task_id`, `receipt_id` | `receipt_id` = `task_id` |
| `evidence` | Book evidence enum (export column) |
| `collected_at`, `hub`, `model`, `amount`, `payment_ref`, `rail` | Export columns |
| `bucket`, `payer_wallet`, `intent_id`, `attempt_index`, `replay_count` | Export columns |
| `verify_url`, `explorer_url` | Receipt links |
| `policy_code`, `reason` | Present on `policy_blocked` |
| `inflow_claim` | Present on `inflow` |
| `emitted_at` | Push timestamp |

## Not in v1

- Embed iframe / row card (separate PR)
- Unauthenticated webhook admin
- Architecture handoff beyond this envelope
