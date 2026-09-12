# Principal dashboard v1

**Product fit locked:** 2026-09-06  
**Greenlit:** Christopher, 2026-09-12

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

## Implementation map

- UI: `apps/web/src/pages/Book.tsx`
- Helpers: `apps/web/src/lib/agentBookCore.mjs` (`computeBurnRate`, `computeModelMix`, `verifyUrlFor`, `auditorVerifyUrlFor`)
- API: `services/gateway/src/agent-book.js` (no parallel public index)
