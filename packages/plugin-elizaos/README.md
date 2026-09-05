# @xfuel/plugin-elizaos

Minimal first-party [ElizaOS](https://docs.elizaos.ai/) plugin for **Chit402** — the spend book, not a cheaper LLM router.

Routes `TEXT_SMALL` / `TEXT_LARGE` through Chit’s OpenAI-compatible API, caches signed receipts (`verify_url` + HMAC/JWS fields), exposes a `CHIT_BOOK` provider for last-N spend context, and ships **Eliza actions** to register an agent identity and show the possession-gated book on demand.

Differentiation vs `@elizaos/plugin-x402` / BlockRun / OpenRelay: **verify_url + signed receipt + agent book**, not “can pay 402.”

## Install

```bash
npm install @xfuel/plugin-elizaos
# public alias (same package, re-export):
npm install chit402-elizaos
```

Peer dependencies: `@elizaos/core` (≥1.6), optional `ethers` (required for production USDC / EIP-3009 payer).

## Character snippet

```json
{
  "name": "ChitDemo",
  "plugins": [
    "@elizaos/plugin-sql",
    "@elizaos/plugin-openai",
    "@xfuel/plugin-elizaos"
  ],
  "settings": {
    "CHIT_API_URL": "https://api.chit402.com",
    "CHIT_API_KEY": "chit402-demo",
    "CHIT_SMALL_MODEL": "xfuel/auto",
    "CHIT_LARGE_MODEL": "xfuel/auto",
    "CHIT_MAX_USD_PER_CALL": "0.05",
    "CHIT_MAX_USD_SESSION": "1.00"
  },
  "system": "You are a Chit402 design-partner agent. Every inference call should produce a shareable verify_url receipt."
}
```

Production (real USDC on Base — handles HTTP 402 via `createEip3009Payer` from `xfuel-sdk/onchain`):

```json
{
  "settings": {
    "CHIT_API_URL": "https://api.chit402.com",
    "CHIT_API_KEY": "your-partner-key",
    "CHIT_PAYER_PK": "0x…",
    "CHIT_NETWORK": "base"
  }
}
```

After the first **paid** inference, run the `REGISTER_CHIT_AGENT` action (or say “register my chit agent”) — the plugin calls `POST /v1/agents/register` and stores `agent_id` + possession `session` on the runtime. You no longer need to hand-paste `CHIT_AGENT_ID` / `CHIT_BOOK_SESSION` every session.

Optional manual override (CI / cold start):

```json
{
  "settings": {
    "CHIT_AGENT_ID": "7",
    "CHIT_BOOK_SESSION": "session-from-register"
  }
}
```

Keep `@elizaos/plugin-openai` (or `@elizaos/plugin-ollama`) **below** Chit priority for `TEXT_EMBEDDING` only. This plugin registers `TEXT_SMALL` / `TEXT_LARGE` at priority **100** so Chit wins for text generation.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `CHIT_API_URL` | Gateway base URL (default `https://api.chit402.com`; wire alias `XFUEL_API_URL`) |
| `CHIT_API_KEY` | `X-API-Key` header (default demo `chit402-demo`) |
| `CHIT_SMALL_MODEL` | Catalog id for `TEXT_SMALL` (default `xfuel/auto`) |
| `CHIT_LARGE_MODEL` | Catalog id for `TEXT_LARGE` (default `xfuel/auto`) |
| `CHIT_PAYER_PK` | EIP-3009 private key on Base → paid `/task-request` path |
| `CHIT_SENDER` | Sender address when no payer key (ignored when payer PK set) |
| `CHIT_NETWORK` | x402 network: `base` (default), `base-sepolia`, `solana` |
| `CHIT_AGENT_ID` | Integer agent id for possession-gated book API |
| `CHIT_BOOK_SESSION` | Possession secret from `POST /v1/agents/register` |
| `CHIT_BOOK_LIMIT` | Rows injected by `CHIT_BOOK` provider (default 10) |
| `CHIT_MAX_USD_PER_CALL` | Best-effort per-call USDC cap |
| `CHIT_MAX_USD_SESSION` | Best-effort session USDC cap (runtime cache) |

## Paths

- **Demo / first hour:** no `CHIT_PAYER_PK` → `POST /v1/chat/completions` via `xfuel-sdk` `chatCompletions()` (signed receipt, unmetered with demo key).
- **Production:** `CHIT_PAYER_PK` set → `submitInference()` + `createEip3009Payer()` (402 handshake, collected USDC row + `verify_url`).

Tier-2 SP1 proofs are **not** enabled on every call (default signed receipts only).

## Design-partner demo path (door #4)

1. **Install** `@xfuel/plugin-elizaos` (or alias `chit402-elizaos`) on your Eliza character with `CHIT_API_KEY` + `CHIT_PAYER_PK`.
2. **Inference** — trigger `TEXT_SMALL` / `TEXT_LARGE` (paid path). Each call logs `verify_url` and caches the receipt on the runtime.
3. **Register** — invoke action **`REGISTER_CHIT_AGENT`** (similes: `REGISTER_AGENT`, `CHIT_REGISTER`). Binds your payer wallet + latest paid `task_id` via `POST /v1/agents/register`; stores `agent_id` + possession `session` in character settings.
4. **Show book** — invoke action **`SHOW_CHIT_BOOK`** (similes: `CHIT_BOOK`, `SHOW_BOOK`, `SPEND_BOOK`). Returns “this agent spent Y; here is the row” with `verify_url` lines from `POST /v1/agents/:id/book`. Before register, falls back to the runtime receipt cache with a clear note.

Example user prompts:

- “Register my chit agent” → `REGISTER_CHIT_AGENT`
- “Show my chit spend book” → `SHOW_CHIT_BOOK`

## Actions

| Action | Purpose |
|--------|---------|
| `REGISTER_CHIT_AGENT` | `POST /v1/agents/register` — persist `agent_id` + `session` on runtime |
| `SHOW_CHIT_BOOK` | Possession-gated book fetch + human-readable spend / verify_url rows |

## Provider: `CHIT_BOOK`

Inject into prompts via Eliza provider selection:

- If `CHIT_AGENT_ID` + `CHIT_BOOK_SESSION` are set → `POST /v1/agents/:id/book` (possession-gated last-N collected spend).
- Else → last-N receipts cached on this runtime from recent model calls.

## Streaming

Eliza `useModel(..., { stream: true })` is **not** supported in v1. Non-streaming calls return full text; a warning is logged if streaming is requested.

## Verify receipts in logs

After each model call, the plugin logs:

```
[chit402] receipt task_id=… verify_url=https://api.chit402.com/receipt/…
```

Receipts are also available on the runtime cache (`CHIT_BOOK` fallback).

## Development

```bash
cd packages/sdk && npm install && npm run build
cd ../plugin-elizaos && npm install && npm test
```

## License

Apache-2.0
