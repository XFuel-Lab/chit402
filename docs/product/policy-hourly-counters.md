# Hourly policy_blocked counters

Extends [policy v2](./policy-and-audit.md) — cap blocks leave durable counter fields on `policy_blocked` book rows (transport `403`, not a soft `200` flag).

## Fields (cap blocks only)

Present on `GET|POST /v1/agents/:agent_id/book`, export (`csv` / `json`), webhooks, and OpenAPI when a hop is refused by `hourly_cap` or `daily_cap`:

| Field | Type | Example | Notes |
|-------|------|---------|-------|
| `policy_key` | string | `hourly_cap` | Native policy type (`hourly_cap`, `daily_cap`) |
| `spent_atomic` | string | `50000` | USDC atomic collected in the period at block time |
| `cap_atomic` | string | `60000` | Cap limit for `policy_key` |
| `period_start` | string (ISO8601 UTC) | `2026-09-08T12:00:00.000Z` | Joinable period id — clock-hour or calendar-day start |

Also present (unchanged): `event: policy_blocked`, `policy_code` (e.g. `hourly_cap_exceeded`), `reason`, `collected: false`.

Non-cap blocks (`kill_switch`, `model_not_allowed`, etc.) omit counter fields.

## Flow

1. Principal sets `hourly_cap` via `POST /v1/agents/:agent_id/book/policy`.
2. Next paid hop runs `enforcePolicy` before x402 settle.
3. On exceed: gateway appends `policy_blocked` with counters, returns `403` (`type: policy_blocked`).
4. Principal reads counters on `/book`, export, or webhook — no SSH.

## Smoke path (fixtures)

Unit + integration coverage lives in:

- `services/gateway/test/intent-retry-policy-blocked.test.mjs` — hourly cap → book row + CSV/JSON export columns
- `services/gateway/test/book-extensions.test.mjs` — `enforcePolicy` cap snapshot

Local run:

```bash
node --test services/gateway/test/intent-retry-policy-blocked.test.mjs
```

## Live smoke (agent session)

1. Register or reuse an agent; hold possession `session`.
2. `POST /v1/agents/:agent_id/book/policy` with `{ "session", "policy_type": "hourly_cap", "value": "60000" }`.
3. Spend until near cap (collected rows in the current UTC hour).
4. `POST /v1/chat/completions` with session + payment headers for the next hop.
5. Expect `403` with `code: hourly_cap_exceeded` and `spent_atomic` / `cap_atomic` / `period_start` in the error body.
6. `GET|POST /v1/agents/:agent_id/book` — newest `policy_blocked` row carries the same counter fields.

Public specimen (export shape): `GET /public/specimens/hemei-stranger-export.json` → row `xfuel-hemei-blocked-1`.
