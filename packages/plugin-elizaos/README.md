# @xfuel/plugin-elizaos

Minimal first-party [ElizaOS](https://docs.elizaos.ai/) plugin for **Chit402** — the spend book, not a cheaper LLM router.

Routes `TEXT_SMALL` / `TEXT_LARGE` through Chit’s OpenAI-compatible API, caches signed receipts (`verify_url` + HMAC/JWS fields), and exposes a `CHIT_BOOK` provider for last-N spend context.

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
    "CHIT_NETWORK": "base",
    "CHIT_AGENT_ID": "7",
    "CHIT_BOOK_SESSION": "session-from-register_agent"
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
