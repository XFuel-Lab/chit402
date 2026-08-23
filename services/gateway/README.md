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

## Key surfaces

| Path | Role |
|------|------|
| `POST /task-request` | M2M inference / tasks (+ x402) |
| `GET/POST /v1/*` | OpenAI-compatible gateway |
| `GET /receipt/:taskId` | Public receipt / `verify_url` |
| `GET /openapi.json` | x402scan OpenAPI (chat first) |
| `/.well-known/x402` | x402 Bazaar discovery |

## Revenue (token-light)

Fees land at `X402_PAY_TO` / `REVENUE_SPLIT_ADDRESS` on Base. See `src/revenue-split.js` and `npm run split:emit`.

## Docs

- [`docs/M2M_API.md`](../../docs/M2M_API.md)
- [`docs/X402_ADAPTER.md`](../../docs/X402_ADAPTER.md)
- [`docs/OPENAI_COMPATIBLE_GATEWAY.md`](../../docs/OPENAI_COMPATIBLE_GATEWAY.md)
