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

- **csv** — `task_id,evidence,collected_at,hub,model,amount,payment_ref,rail,bucket,verify_url,explorer_url`
- **json** — `chit402.book_audit.v1` pack with per-row `evidence` (`collected` | `RECORDED_BY_SETTLE` | `ARRIVAL_UNVERIFIED` | `inflow_claimed` | `UNVERIFIED` | `policy_blocked`) and `auditor_url` (`?format=auditor`)
- **html** — print-friendly page; use browser Print to PDF

### Evidence status (greenspan + ellie-v2)

Book and export never treat missing possession evidence as zero payment. Each row carries `evidence`:

| Value | Meaning |
|-------|---------|
| `collected` | Proven `payment.ref` + settle amount + `ingress_receipt` (arrival confirmed) |
| `RECORDED_BY_SETTLE` | Recorder accepted at settle cutoff (`recorded_by: settle`) — amount shown, excluded from totals until ingress |
| `ARRIVAL_UNVERIFIED` | Explicit omission at cutoff when `ingress_receipt` is absent — row visible, `amount` null, excluded from totals |
| `inflow_claimed` | Signed `bucket` / `allocation` claim (no `payment.ref`) — patron-style inflow; corrections append-only |
| `UNVERIFIED` | Payer / `payment.ref` / amount cannot be proven — `amount` is null, excluded from totals |
| `policy_blocked` | Policy hop with no USDC collected |

**Ingress receipt:** attach `payment.ingress_receipt` (or `payment.arrival_receipt`) with at least `ref` or `confirmed_at` to promote `RECORDED_BY_SETTLE` → `collected`. At cutoff, call `markArrivalUnverified` or rely on explicit `omission_rule: no_ingress_receipt_at_cutoff` for `ARRIVAL_UNVERIFIED` rows — silence must not read as exclusion.

**Unaffiliated inflow:** `POST /v1/agents/:agent_id/book/inflow` writes a settle-time signed `inflow_claim` (`bucket`, `allocation`). Revise only via `POST .../book/inflow/correct` (append-only `inflow_corrections`).

Export reads **ledger rows only** (UsageSettled) — not live wallet scrape or task-store re-derivation.

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
