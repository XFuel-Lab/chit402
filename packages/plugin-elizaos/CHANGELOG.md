# Changelog

## 0.1.2 — 2026-09-05

- **Eliza actions (door #4):** `REGISTER_CHIT_AGENT` calls `POST /v1/agents/register` and persists `agent_id` + possession `session` on the runtime (character settings + optional `setSetting`) so `CHIT_BOOK` works without hand-pasting env vars each session.
- **`SHOW_CHIT_BOOK`:** possession-gated `POST /v1/agents/:id/book` with human-readable spend summary and `verify_url` rows; falls back to runtime receipt cache with a clear note when not registered.
- **`formatRemoteBook`:** maps gateway `entries` / `cap` / `spent` / `remaining` (not legacy `rows` / `budget`).
- Shared gateway helpers: `registerAgent`, `fetchAgentBook`.

## 0.1.1

- Initial `TEXT_SMALL` / `TEXT_LARGE`, `CHIT_BOOK` provider, receipt cache.
