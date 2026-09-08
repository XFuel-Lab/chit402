# Treasury receipt: idempotent replay + path rotation

Treasury-grade receipts must support **idempotent replay** and **path rotation**
without dashboard trust. Intent/attempt grouping is documented in
[intent-retry-grouping.md](./intent-retry-grouping.md).

## Idempotent replay

Submitting the same collected receipt (same `payment.ref` or same `task_id`) twice
yields **one** canonical ledger row and **one** USDC collect.

| Field | Where | Meaning |
|-------|-------|---------|
| `settlement_status` | register response, `usage_settled` on receipt | `settled` on first collect; `idempotent_replay` on replay |
| `idempotent_replay` | same | `true` when the request matched an existing row |
| `replay_of` | same | `task_id` of the canonical settled row |

On replay, the ledger appends audit evidence only (`replay_events[]` on the
canonical row — each event has `replay_of` → `task_id`). Totals and caps use the
single collected amount; replays never double-count.

Cross-task reuse of the same `payment.ref` still returns **409** `duplicate_ref`
(not idempotent replay).

## Path rotation

`POST /v1/agents/:agent_id/book/rotate` issues a new possession `session`. The
old session is invalid; **ledger rows stay on `agent_id`**.

Bindings that survive rotate (no live dashboard):

- `payer_wallet` on each book row (from settle-time ledger)
- `payment.ref` ↔ row (on-chain attestation via `verify_url` + explorer)
- `intent_id` / `attempt_index` when set (#338)

Public `GET /receipt/:taskId` remains valid after rotate — settlement proof is
receipt + chain, not session.

## Deploy

- **Gateway (Lightsail / ECS):** idempotent replay fields + book export columns —
  redeploy required.
- **Web (Vercel):** optional `/book` badges for `replay_count` — not required for
  treasury acceptance.
