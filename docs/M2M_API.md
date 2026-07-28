# M2M API

REST API for agents and applications. Submit tasks, retrieve proofs, send A2A messages, and poll status.

Server: `services/gateway` (default port 3002).  
Hosted testnet: `https://api-testnet.xfuel.app`.  
As-deployed notes: [RUNTIME_STATE.md](./RUNTIME_STATE.md).

## Quick start

```
cd services/gateway
npm install
npm run m2m-server
```

```
M2M_API_PORT=3002 M2M_API_KEYS=my-secret-key npm run m2m-server
```

## Authentication

All endpoints except `GET /health` require one of:

- `X-API-Key: <key>` — from `M2M_API_KEYS` (comma-separated)
- `X-Signature` + `X-Sig-Timestamp` — ECDSA over `method+path+sha256(body)+timestamp`; signer in `M2M_RELAYER_ADDRESSES`

If neither env is set, the server runs open (dev only).

## Rate limiting

Sliding window by API key (or IP). Default: 120 requests / 60s. `429` includes `Retry-After`.

## Endpoints

### POST /task-request

Submit an AI task.

| Field | Required | Notes |
|-------|----------|-------|
| `message_type` | yes | `inference_request`, `compute_bid`, `compute_result`, `capability_query`, `data_attestation` |
| `chain_id` | yes | Prefer `base` (settlement home). Others are routing hints. |
| `amount` | yes | Gross task value (≥ 10000) |
| `sender` | yes | Address / agent id |
| `model_id` | for inference | e.g. `llama-3-70b` |
| `input_hash` | for inference | keccak256 of input |
| `fee_bps` | no | Default 50 (0.5%); range 50–100 |
| `payment` | no | `{ "rail": "usdc", "network": "base-sepolia" }` — default USDC/x402 |
| `callback_url` | no | Per-task webhook |
| `callback_secret` | no | HMAC secret for per-task webhook |

**Easiest path:** from `packages/sdk`, run `npx tsx examples/flagship-demo.ts` (see [HOSTED_TESTNET_ENDPOINT.md](./HOSTED_TESTNET_ENDPOINT.md)).

Optional raw HTTP — on **Windows PowerShell use `curl.exe`** (plain `curl` is not real curl):

```bash
curl -X POST https://api-testnet.xfuel.app/task-request \
  -H "Content-Type: application/json" \
  -H "X-API-Key: xfuel-demo" \
  -d '{
    "message_type": "inference_request",
    "chain_id": "base",
    "amount": "1000000",
    "sender": "0xYourAddress",
    "model_id": "llama-3-70b",
    "input_hash": "0xabc...",
    "payment": { "rail": "usdc", "network": "base-sepolia" }
  }'
```

Response includes `task_id`, status, and links to status / proof / receipt.

### GET /task-status

`GET /task-status?task_id=<id>`

### GET /prove-result

`GET /prove-result?task_id=<id>` — Tier-2 SP1 settlement proof when available.

### GET /receipt/:taskId

Public receipt (HTML or `?format=json`). No auth.

### POST /task-quote

Price a task for a payment rail before submit.

### Webhooks

- Global: `PUT /webhook` `{ url, secret, events? }` · `GET /webhook` · `DELETE /webhook?id=` or `?url=`
- Per-task: `callback_url` / `callback_secret` on `/task-request`
- Signature header: `X-XFuel-Signature: sha256=<hmac>`

Events currently include `TaskSettled`, `A2ASettled`.

### A2A

- `POST /a2a-message` — agent-to-agent message with optional escrow
- `POST /a2a-settle-fair-exchange` — Fair Exchange / PAS settlement

### OpenAI surface

Same server: `/v1/models`, `/v1/chat/completions`, `/llms.txt`.  
See [OPENAI_COMPATIBLE_GATEWAY.md](./OPENAI_COMPATIBLE_GATEWAY.md).

### GET /health

Liveness, fee config, chains, message types. No auth.

## Payments

Default rail: USDC via x402 on Base. See [X402_ADAPTER.md](./X402_ADAPTER.md).

Fees settle to `X402_PAY_TO` / Splits v2 (token-light). See [ADR 0001](./adr/0001-usdc-revenue-and-router-verifier-positioning.md).

## Related

- [OPENAI_COMPATIBLE_GATEWAY.md](./OPENAI_COMPATIBLE_GATEWAY.md)
- [X402_ADAPTER.md](./X402_ADAPTER.md)
- [HOSTED_TESTNET_ENDPOINT.md](./HOSTED_TESTNET_ENDPOINT.md)
- SDK: `packages/sdk`
- MCP: `packages/mcp`
