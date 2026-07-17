# M2M Dev Dashboard — Internal Tool

> **Status:** Internal development tool — NOT the production frontend
> **Production frontend:** [`xfuel-app/`](../../xfuel-app/)

## What This Is

A minimal React dashboard for testing the **XFuel M2M (Machine-to-Machine) API** locally during backend development. It provides a quick UI to:
- Submit inference tasks to `/theta-ai/infer`
- Send agent-to-agent (A2A) messages to `/theta-ai/agent-intent`
- Check task status and proof retrieval
- Monitor fee pipeline events

## Intended Users

Backend and protocol developers who want a quick browser-based way to fire requests at the local gateway (`services/gateway/`) without using `curl` or Postman.

## How to Run

```bash
cd tools/m2m-dev-dashboard
npm install
# Copy and fill env vars
cp .env.example .env.local
npm run dev        # starts on http://localhost:5173
```

Required env (see `.env.example`):
- `VITE_API_URL` — base URL of the running `services/gateway` server

## What This Is NOT

- **Not the production app** — `xfuel-app/` is the canonical user-facing frontend deployed to [xfuel.app](https://xfuel.app)
- **Not for end users** — no wallet connection, no token UI, no governance
- **Not maintained for visual polish** — function over form, quick iteration

## SDK Alternative

For automated integration testing, prefer the TypeScript SDK instead:

```typescript
import { XFuelClient } from 'xfuel-sdk'
const client = new XFuelClient({ baseUrl: 'http://localhost:3002' })
await client.submitInference({ model: 'llama3', prompt: 'Hello' })
```

See [`packages/sdk/README.md`](../../packages/sdk/README.md) for full API reference.
