# Principal policy v2 and book audit export

Products that sit **beside** the book — not inside the router.

## Policy v2 (`GET|POST /v1/agents/:agent_id/book/policy`)

Possession-gated (same session as the book). Demo keys cannot write policy rows.

| Policy type | Value | Enforcement |
|-------------|-------|-------------|
| `daily_cap` | USDC atomic string | Max spend per UTC calendar day |
| `hourly_cap` | USDC atomic string | Max spend per UTC clock hour |
| `model_allowlist` | `string[]` | Reject models not in list |
| `kill_switch` | `boolean` | Block all metered spend |
| `require_payment_ref` | `boolean` | Pause spend when any collected ledger row lacks `payment.ref` |
| `tier2_above` | USDC atomic string | At/above threshold, request must include `proof_tier: settlement` or `inference` |

Enforcement runs on the paid `POST /v1/chat/completions` path via `enforcePolicy` before x402 settle. When a possession session is active and the **next** hop would violate policy, the gateway:

1. **Does not settle** USDC (no charge).
2. Appends a **`policy_blocked`** row to the book (`event: policy_blocked`, `collected: false`).
3. Returns `403` with `type: policy_blocked` and `code` (`kill_switch`, `daily_cap_exceeded`, `hourly_cap_exceeded`, `model_not_allowed`, `payment_ref_required`, `tier2_required`).

The principal sees the block on `GET|POST /v1/agents/:agent_id/book` and `/book` — no SSH or PID required.

Caps sit on the book the principal holds — not inside the router.

## Audit export (`GET|POST /v1/agents/:agent_id/book/export`)

Possession-gated. Query/body: `format=csv|json|html`, optional `limit` (max 200).

- **csv** — `task_id,collected_at,hub,model,amount,payment_ref,rail,verify_url,explorer_url`
- **json** — `chit402.book_audit.v1` pack with per-row `auditor_url` (`?format=auditor`)
- **html** — print-friendly page; use browser Print to PDF

### On-chain attestations (v1)

No separate attestation chain. Each row is verifiable offline via:

1. `payment.ref` → block explorer (Basescan / Solana)
2. `verify_url` → signed receipt (issuer JWS)
3. `?format=auditor` → selective disclosure export per receipt

## Principal UI

`/book` on the web app: policy controls + export buttons when the book is loaded with possession.

## Deploy

- **Gateway (Lightsail / ECS):** policy enforcement + export endpoint — redeploy required.
- **Web (Vercel):** `/book` UI only — Vercel deploy sufficient.
