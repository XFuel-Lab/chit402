# XFuel Gateway (`xfuel-gateway`)

Agent-facing API for **routing, USDC payments (x402 on Base), proving, and receipts**.

Money + proof home is **Base** ([ADR 0002](../../docs/adr/0002-base-settlement-home.md)). EdgeCloud / Theta RPC are optional provider ops only.

## Quick start

```bash
cd services/gateway
npm install
cp .env.base-testnet.example .env   # USDC on Base Sepolia
npm run m2m-server                  # AI listener + M2M API on :3002
npm test
```

## Loading `.env`

Every gateway `.env` load goes through `loadDotenvFile(path)` in `src/dotenv-load.js`. Don't call `dotenv.config()` or import `dotenv/config` anywhere else; `test/dotenv-load-pin.test.mjs` fails if you do.
- It passes every option explicitly (`override: false`, `quiet: true`, `debug: false`, `encoding: 'utf8'`, `fast: false` and the path). That way `DOTENV_*` variables can't pick a different file or make `.env` overwrite values already exported from the shell. dotenv 18 fills any option you leave out from those variables.
- It calls `dotenv.configDotenv`, the plain file loader in dotenv 17 and 18, rather than `config()`, which on 17 switches to `.env.vault` when `DOTENV_KEY` is set.
- On dotenv 17, `DOTENV_CONFIG_DEBUG`/`DOTENV_CONFIG_QUIET` (in the environment or as lines in `.env`) can still turn on its "injected env (N) from <path>" line. That line shows counts and paths only, never values.

## Key surfaces

| Path | Role |
|------|------|
| `POST /task-request` | M2M inference / tasks (+ x402) |
| `GET/POST /v1/*` | Chat completions gateway |
| `POST /v1/agents/register` | Bind agentWallet + collected receipt → `agent_id` |
| `GET /.well-known/agent-card.json` | A2A v1.0 agent card |
| `GET /.well-known/x402list.txt` | x402-list domain verification (text/plain) |
| `GET /receipt/:taskId` | Public receipt / `verify_url` |
| `GET /openapi.json` | x402scan OpenAPI (chat first) |
| `/.well-known/x402` | x402 Bazaar discovery |

## Revenue (token-light)

Fees land at `X402_PAY_TO` / `REVENUE_SPLIT_ADDRESS` on Base. See `src/revenue-split.js` and `npm run split:emit`.

## Docs

- [`docs/M2M_API.md`](../../docs/M2M_API.md)
- [`docs/X402_ADAPTER.md`](../../docs/X402_ADAPTER.md)
- [`docs/CHAT_COMPLETIONS_GATEWAY.md`](../../docs/CHAT_COMPLETIONS_GATEWAY.md)
