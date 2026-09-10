# Hemei stranger-auditable specimens (gaps A + B)

Public, unauthenticated fixtures for design-partner smoke **D** (path-rotate observe) and **E** (stranger export shape). Possession gates on live `/book`, `/book/export`, and `/book/rotate` are unchanged.

## Gap A — redacted stranger export specimen

Strangers can GET the export **shape** without a session:

| Format | URL |
|--------|-----|
| CSV | `https://api.chit402.com/public/specimens/hemei-stranger-export.csv` |
| JSON | `https://api.chit402.com/public/specimens/hemei-stranger-export.json` |

Columns match live `GET|POST /v1/agents/:agent_id/book/export` (`format=csv|json`): `task_id`, `evidence`, `collected_at`, `hub`, `model`, `amount`, `payment_ref`, `rail`, `bucket`, `payer_wallet`, `intent_id`, `attempt_index`, `replay_count`, `verify_url`, `explorer_url`. JSON rows also include `inflow_claim`, `inflow_corrections`, `auditor_url`, and related evidence fields.

- Wallets are truncated (`0xREDACTED…`).
- One row uses the public house receipt `chit-1e57cdd7-4fde-4525-bea3-5ffd1d1d909e` (on-chain `payment.ref` is already public).
- Other task ids are synthetic specimens — not live book sessions.

## Gap B — path-rotate observe fixture

Observation-only JSON (no unauth `POST /book/rotate`):

`https://api.chit402.com/public/specimens/hemei-path-rotate-observe.json`

Documents that after `POST /v1/agents/:agent_id/book/rotate`, `payer_wallet` and `payment.ref` survive on ledger rows while the possession session changes. The parent receipt's public `verify_url` still resolves without a session.

Acceptance logic: `services/gateway/test/nak-nanaz-acceptance.test.mjs` (describe B).

## Smoke check

```bash
curl -sf -o /dev/null -w '%{http_code}\n' \
  https://api.chit402.com/public/specimens/hemei-stranger-export.csv
curl -sf -o /dev/null -w '%{http_code}\n' \
  https://api.chit402.com/public/specimens/hemei-stranger-export.json
curl -sf -o /dev/null -w '%{http_code}\n' \
  https://api.chit402.com/public/specimens/hemei-path-rotate-observe.json
```

Gateway unit test: `services/gateway/test/hemei-stranger-specimens.test.mjs`.
