# Principal dashboard v1

**Product fit locked:** 2026-09-06  
**Greenlit (build):** Christopher, 2026-09-24  
**Shipped:** www `/book` on chit402.com (possession-gated live book + specimen first paint)

## Buyer

Principal / treasury who funds agent USDC spend — not another agent door.

## Wire (live)

`GET|POST /v1/agents/:agent_id/book` — possession-gated last-N collected spend (cap, spent, remaining). POST may set budget **Y**. Not a public index.

Session: `session` in JSON body and/or `X-XFuel-Session` header (gateway wire name; human UI says Chit / Chit402 only).

## v1 surface

Thin web on [chit402.com/book](https://www.chit402.com/book) — extend `/book`, no new SPA.

| Beat | Source | UI |
|------|--------|-----|
| Last-N rows | `entries[]` | hub, model, amount, payer ↔ tx, verify links |
| Budget | `cap`, `spent`, `remaining` | Y / spent / remaining |
| Burn rate | derive from `entries` + `collected_at` | spend over 24h window |
| Model mix | derive from `entries` | share by hub/model |
| Verify | `verify_url` pattern `/receipt/:task_id` | link + offline `?format=auditor` |

## Out of v1

- Bankr Club native pipeline
- Second skill / Discover
- Public unauthenticated book browse
- SP1 / Tier-2 as default chrome (tier-2 policy stays under “Treasury advanced”)

## Success

Possession session opens the book, sees last-N + burn + budget + model mix, clicks a live `verify_url`. Missing/wrong possession → 401/403.

## Live smoke (www + API)

**Specimen (no session):**

1. Open [https://www.chit402.com/book](https://www.chit402.com/book).
2. Confirm orange banner **Specimen — not live money**, budget strip, burn rate, model mix, and table (one live verify link on row 0).
3. Homepage receipt hero and `/register` flow unchanged.

**Live book (possession):**

1. Complete a collected USDC call, then `POST /v1/agents/register` (or reuse register output). Hold `agent_id` and possession `session` — not an API key.
2. On `/book`, enter `agent_id` + `session` → **Load book** (or land from `/register` with `?agent_id=`; session is stripped from the URL after load and kept in local storage).
3. Expect budget **Y** / spent / remaining, 24h burn rate, model mix, and last-N rows with **verify** + **offline** (`?format=auditor`) on collected rows.
4. Click **verify** on a row → public receipt page resolves without possession.
5. Wrong or missing session → 401/403 cards (no public book index).

**API-only check (same shape as UI):**

```bash
curl -sS -X POST "https://api.chit402.com/v1/agents/AGENT_ID/book" \
  -H "Content-Type: application/json" \
  -H "X-XFuel-Session: SESSION" \
  -d '{"session":"SESSION","limit":50}' | jq '{agent_id,cap,spent,remaining,entries:(.entries|length)}'
```

## Implementation map

- UI: `apps/web/src/pages/Book.tsx`, specimen: `apps/web/src/components/BookSpecimenPanel.tsx`
- Helpers: `apps/web/src/lib/agentBookCore.mjs` (`computeBurnRate`, `computeModelMix`, `verifyUrlFor`, `auditorVerifyUrlFor`)
- API: `services/gateway/src/agent-book.js` (no parallel public index)
