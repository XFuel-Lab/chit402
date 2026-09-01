# Chat Completions Gateway

XFuel is the book: this agent spent Y on this job, and you hold hub, model, and amount. The wire is standard chat-completions HTTP — any client that speaks `POST /v1/chat/completions` (Grok, dePIN agents, Cursor, LangChain, the Vercel AI SDK) can point `baseURL` here and get a signed receipt on every call.

Source: `services/gateway/src/openai-gateway.js`  
Example: `packages/sdk/examples/openai-drop-in.ts` (`npm run example:openai`)

## Endpoints

- `GET /v1/models` — list models
- `GET /v1/models/:id` — one model
- `POST /v1/chat/completions` — streaming and non-streaming

Base URL: `${XFUEL_API_URL}/v1`  
Hosted: `https://api.xfuel.app/v1`  
Local: `http://localhost:3002/v1`

## Auth

- `Authorization: Bearer <key>` (chat-completions clients)
- or `X-API-Key: <key>`

Rate limits match the M2M API. Open mode (no keys configured) skips auth for local dev.

## Receipts

Responses include:

- `x-xfuel-*` headers (task id, proof status, verify URL, …)
- `xfuel` body field (`compute.real`, `proof.status`, `proof.attests`, links)

Tier-2 SP1 proofs attest settlement metadata and an output-hash commitment — not black-box model correctness. See [POSITIONING.md](./POSITIONING.md).

The chat-completions path is unmetered in Phase 1. For x402 USDC metering use `POST /task-request` with `payment.rail: "usdc"`. Full REST: [M2M_API.md](./M2M_API.md).

## Client example

```js
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.XFUEL_API_KEY,
  baseURL: 'https://api.xfuel.app/v1',
});

const res = await client.chat.completions.create({
  model: 'xfuel/auto',
  messages: [{ role: 'user', content: 'Hello' }],
});
```

Works with any chat-completions client: Grok, LangChain, Vercel AI SDK, Cursor, dePIN agent frameworks.
