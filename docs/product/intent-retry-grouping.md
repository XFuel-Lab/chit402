# Intent / retry grouping on the possession book

The book is the product — not the router. When an agent retries a paid hop (402 settle loop,
transient inference failure, model swap), treasury should see **one intent bill with many
attempt rows**, not three unrelated charges for one user intent.

## Client contract

Pass intent metadata on `POST /v1/chat/completions` (and `/a2a-message`):

| Field | Header | Body | Notes |
|-------|--------|------|-------|
| `intent_id` | `X-XFuel-Intent` | `intent_id` | Prefer explicit. Groups N hops under one bill. |
| `attempt_index` | `X-XFuel-Attempt` | `attempt_index` | Zero-based retry/attempt index within the intent. |

**Generation rule:** if `attempt_index` (or retry metadata) is present but `intent_id` is
absent, the gateway generates an `intent_id`. If neither is present, the hop is standalone
(no grouping).

When `intent_id` is set without `attempt_index`, the gateway auto-increments based on
existing rows for that agent + intent.

## Book shape

Collected rows and `policy_blocked` events may carry:

- `intent_id` — shared across attempts
- `attempt_index` — position within the intent
- `parent_ref` — lineage chain (A→B→inference), orthogonal to intent grouping

`GET|POST /v1/agents/:agent_id/book` returns:

- `entries[]` — each row includes `intent_id` / `attempt_index` when set
- `intents` — optional map grouping attempts under each `intent_id` (treasury view)

`GET /v1/agents/:agent_id/book/lineage/:task_id` adds `intent_attempts[]` when the task
row has an `intent_id`.

## Principal UI

`/book` badges rows by `intent_id` when present and highlights `policy_blocked` events.

## Deploy

- **Gateway (Lightsail / ECS):** intent fields + grouping — redeploy required.
- **Web (Vercel):** `/book` badges — Vercel deploy sufficient.
