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

## Persistence

The gateway stores the webhook map in `book-webhooks.json` under the agents data directory:

```
<data>/agents/book-webhooks.json
```

The file is mode `600`. From this release on, a webhook survives a gateway restart.

Anything registered before the deploy that ships this release was already dropped at that deploy's restart, and at every restart before it. The owner has to register again.

Register again with the book session:

```
PUT /v1/agents/:agent_id/book/webhook
```

`POST` on that same path updates the hook too. Use your Chit402 book session (`session` in the JSON body, or the session header) and a JSON body:

```
{"url":"https://treasury.example/hooks/chit402","events":["settle","collected"],"secret":"optional"}
```

If no webhook is stored and `secret` is omitted, the response includes a new `secret_once`. The integrator has to update its signature check to that value. A later `PUT`/`POST` without `secret` keeps the current secret. To change it, send a new `secret`.

## Rollback to older code

An older gateway build does not read `book-webhooks.json`. It keeps the webhook map in memory only.

A change made while that older build is running is dropped when this build starts again. The file on disk is the one from before the rollback:

- A webhook created or edited during the rollback is not in the file, so the roll-forward load does not have it.
- A hook deleted during the rollback is still in the file, so it comes back.
- A new signing secret set during the rollback is only in memory. The file still has the previous secret, so the secret reverts.
- The older build rewrites `identities.json` at mode `644`. The next boot of this build tightens that file to mode `600` again.

Known gaps:

- The webhook signing secret is plaintext at rest (mode `600`).
- Rotating the book session does not revoke the webhook. A hook set by an earlier session holder stays until `DELETE` or a later `PUT`/`POST`.
