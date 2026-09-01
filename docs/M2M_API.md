# M2M API

REST API for agents and applications. Submit tasks, retrieve proofs, send A2A messages, and poll status.

Server: `services/gateway` (default port 3002).  
Hosted: `https://api.xfuel.app`.  
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

**You pay for the last call.** Rolling settlement is live on `/task-request` (`X402_ROLLING_SETTLEMENT=true`). The 402 on this request is the previous call's measured cost-plus bill (`max($0.01, provider_cogs × 1.10)`). `/task-quote` is a forecast of the next one, not the invoice. First small call is the free funnel; a call whose ceiling exceeds $1 still prepays. `/v1` stays free.

| Field | Required | Notes |
|-------|----------|-------|
| `message_type` | yes | `inference_request`, `compute_bid`, `compute_result`, `capability_query`, `data_attestation` |
| `chain_id` | yes | Prefer `base` (settlement home). Others are routing hints. |
| `amount` | yes | Gross task value (≥ 10000) |
| `sender` | yes | Address / agent id |
| `model_id` | for inference | Live catalog id, e.g. `xfuel/auto`, `theta/glm_5_2`. List with `GET /v1/models`. Retired `llama-*` names are rejected. |
| `input_hash` | for inference | keccak256 of input |
| `messages` | for inference | OpenAI-shaped chat messages. Alternative to `input`. |
| `tools` | no | OpenAI tool definitions (`{type:"function", function:{name,...}}`), forwarded to the hub. Tool calls come back on `result.tool_calls`. |
| `tool_choice` | no | `auto` \| `none` \| `{type:"function",function:{name}}` |
| `max_tokens` | no | Output budget. Default 500 (same as the adapters). `/task-quote` forecasts at this ceiling; under rolling settlement you pay measured usage on the next request. |
| `temperature` | no | Sampling temperature; default 0.7 |
| `fee_bps` | no | Default 50 (0.5%); range 50–100 |
| `payment` | no | `{ "rail": "usdc", "network": "base" }` — default USDC/x402. Take `network` from `POST /task-quote` rather than hardcoding. |
| `callback_url` | no | Per-task webhook |
| `callback_secret` | no | HMAC secret for per-task webhook |

**First hour** is unmetered `/v1` — [DESIGN_PARTNER_ONBOARDING.md](./DESIGN_PARTNER_ONBOARDING.md). `flagship-demo.ts` is the paid `/task-request` path (402 without a payer).

Optional raw HTTP — on **Windows PowerShell use `curl.exe`** (plain `curl` is not real curl):

```bash
curl -X POST https://api.xfuel.app/task-request \
  -H "Content-Type: application/json" \
  -H "X-API-Key: xfuel-demo" \
  -d '{
    "message_type": "inference_request",
    "chain_id": "base",
    "amount": "1000000",
    "sender": "0xYourAddress",
    "model_id": "xfuel/auto",
    "input_hash": "0xabc...",
    "payment": { "rail": "usdc", "network": "base" }
  }'
```

Response includes `task_id`, status, and links to status / proof / receipt.

#### Tool calling (agent loops)

`tools` is forwarded to the hub unchanged, and a tool call comes back on
`result.tool_calls` with `result.finish_reason: "tool_calls"` — feed it into the
next `/task-request` as an `assistant` turn plus a `tool` turn, exactly as you
would against the OpenAI API.

Two things follow from asking for tools:

- **`xfuel/auto` routes differently.** A request carrying tools (or a tool result)
  is agent work, and resolves to the model that completes multi-turn loops; a
  plain completion resolves to the cheaper, non-reasoning model. See
  [MODEL_QUALITY_EVAL.md](./MODEL_QUALITY_EVAL.md).
- **Not every hub can serve them.** Theta EdgeCloud's on-demand API has no tools
  parameter, so a tool request routed there fails with `tools_unsupported_on_hub`
  rather than returning prose your loop cannot parse. Name an AkashML model, or
  drop `tools`.

### GET /task-status

`GET /task-status?task_id=<id>`

Returns the task's status, `result` (including `tool_calls` when the model called
one), and — on `status: "failed"` — an `error` object with `code`, `message` and
often a `hint`. Codes you should handle: `model_not_found`,
`tools_unsupported_on_hub`, `no_provider_available`.

A task that no configured provider can serve **fails**. It is never answered with
a synthetic result: `/task-request` has already taken payment by then, so a mock
would be a signed receipt for an inference that never ran.

### GET /prove-result

`GET /prove-result?task_id=<id>` — Tier-2 SP1 settlement proof when available.

### GET /receipt/:taskId

Public receipt (HTML or `?format=json`). No auth.

### POST /task-quote

Price a task for a payment rail before submit. This is a **forecast of the next call**, not the invoice — under rolling settlement you pay the previous call's measured bill. Send the same body you intend to submit (`messages`, `max_tokens`, `tools`, `proof_tier`) so the forecast matches what will run. Omitted `max_tokens` is quoted at 500, the adapter default.

`rails.usdc.pricing` shows the working, including which model the price is for:

```json
"pricing": {
  "basis": "metered",
  "requested_model": "xfuel/auto",
  "priced_model": "akash/zai-org/GLM-5.2",
  "prompt_tokens": 68000,
  "max_output_tokens": 247,
  "rate_per_million": { "in": 3000000, "out": 9000000 },
  "floor_applied": false
}
```

**`xfuel/auto` is not one price.** It resolves per request shape, and the models sit in different
rate-card rows, so agent work (anything carrying `tools` or a tool-result turn) prices roughly 10x a
short completion — about $0.21 against $0.021 on a median 68k-token prompt. `priced_model` is what
makes the number explainable; name a model explicitly if you want a price you can predict without
quoting.

### Webhooks

- Global: `PUT /webhook` `{ url, secret, events? }` · `GET /webhook` · `DELETE /webhook?id=` or `?url=`
- Per-task: `callback_url` / `callback_secret` on `/task-request`
- Signature header: `X-XFuel-Signature: sha256=<hmac>`

Events currently include `TaskSettled`, `A2ASettled`.

### A2A

- `POST /a2a-message` — agent-to-agent message with optional escrow
- `POST /a2a-settle-fair-exchange` — Fair Exchange / PAS settlement

### Chat completions surface

Same server: `/v1/models`, `/v1/chat/completions`, `/llms.txt`.  
See [CHAT_COMPLETIONS_GATEWAY.md](./CHAT_COMPLETIONS_GATEWAY.md).

### GET /health

Liveness, fee config, chains, message types. No auth.

## Payments

Default rail: USDC via x402 on Base. See [X402_ADAPTER.md](./X402_ADAPTER.md).

Fees settle to `X402_PAY_TO` / Splits v2 (token-light). See [ADR 0001](./adr/0001-usdc-revenue-and-router-verifier-positioning.md).

## Related

- [CHAT_COMPLETIONS_GATEWAY.md](./CHAT_COMPLETIONS_GATEWAY.md)
- [X402_ADAPTER.md](./X402_ADAPTER.md)
- SDK: `packages/sdk`
- MCP: `packages/mcp`
