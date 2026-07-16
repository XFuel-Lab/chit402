# OpenAI-Compatible Gateway

XFuel exposes the standard OpenAI HTTP surface so **any** OpenAI-compatible
client or agent framework can use XFuel by swapping a single `baseURL` — no
XFuel-specific integration required. Every response additionally carries a
**verifiable-compute receipt**.

- Source: `backend/theta-bridge/src/openai-gateway.js`
- Wired into the M2M server: `services/gateway/src/server.js`
- Runnable example: `sdk/js/examples/openai-drop-in.ts` (`npm run example:openai`)

---

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/v1/models` | List routable models (OpenAI `list` shape) |
| `GET`  | `/v1/models/:id` | Retrieve one model (404 if not advertised) |
| `POST` | `/v1/chat/completions` | Chat completions — streaming and non-streaming |

Base URL is `${XFUEL_API_URL}/v1` — the hosted testnet demo is
`https://api-testnet.xfuel.app/v1` (self-host: `http://localhost:3002/v1`). The
public demo key (`xfuel-demo`) works out of the box, rate-limited per IP.

## Auth

Send either header — the gateway accepts both:

- `Authorization: Bearer <key>` (what OpenAI clients send by default)
- `X-API-Key: <key>` (native XFuel header)

The bearer token is mapped onto `X-API-Key` internally, so a stock OpenAI client
configured with `apiKey` authenticates unchanged. In open mode (no
`M2M_API_KEYS` / `M2M_RELAYER_ADDRESSES` configured) auth is skipped for dev.
Rate limiting is shared with the rest of the M2M API.

## Request / response

Standard OpenAI chat completions. Supported request fields: `model`, `messages`
(required, non-empty; each needs string `role` + `content`), `max_tokens`,
`temperature`, `stream`.

Non-streaming response is a normal `chat.completion` object with an added
`xfuel` receipt field. Streaming (`stream: true`) emits OpenAI
`chat.completion.chunk` SSE frames, then a trailing `event: xfuel.receipt`
frame, then `data: [DONE]`. In both cases the receipt is also mirrored in
`x-xfuel-*` response headers (headers are the reliable channel for strict
clients that drop unknown body fields).

### Verification receipt

```jsonc
"xfuel": {
  "task_id": "openai-…",
  "verify_url": "https://api-testnet.xfuel.app/receipt/openai-…",
  "compute": { "provider": "edgecloud", "real": true, "note": "…" },
  "payment": { "rail": "unmetered", "note": "…" },
  "proof":   {
    "status": "pending",          // pending | unavailable | skipped
    "system": "sp1",
    "attests": "settlement metadata + commitment to the output hash (NOT inference correctness)",
    "links": { "status": "/task-status?task_id=…", "proof": "/prove-result?task_id=…", "receipt": "https://api-testnet.xfuel.app/receipt/openai-…" }
  }
}
```

Headers: `x-xfuel-task-id`, `x-xfuel-provider`, `x-xfuel-compute-real`,
`x-xfuel-payment-rail`, `x-xfuel-proof-status`, `x-xfuel-proof-url`,
`x-xfuel-verify-url`.

**`verify_url`** is the canonical, **public, no-auth** shareable proof link (the
`/receipt/:taskId` page) — the same field name used across the M2M API, SDK, and MCP
tools. It's mirrored in the `x-xfuel-verify-url` header (the reliable channel for strict
OpenAI clients that drop unknown body fields) and in `proof.links.receipt`. Absolute when
`PUBLIC_BASE_URL` is set.

**Honesty semantics (do not over-read the receipt):**

- `compute.real=false` → no DePIN provider is configured; the text is a
  clearly-labelled **mock**. Set `THETA_EDGECLOUD_API_KEY` (or a fallback tier)
  for real compute.
- `proof.status`:
  - `pending` — an SP1 prover is configured and a settlement proof is being
    generated asynchronously (poll `proof.links.proof`).
  - `unavailable` — no prover configured (`SP1_PROVER_URL` unset).
  - `skipped` — compute was mock, so no proof was attempted.
- `proof.attests` — the SP1 proof binds **settlement metadata + a commitment to
  the output hash**, not that the model executed the inference correctly. This
  is deliberately stated so adopters are never misled.
- `payment.rail=unmetered` — the OpenAI path is not x402-metered in Phase 1. For
  USDC settlement over x402, use `POST /task-request` with
  `payment.rail="usdc"` (see `docs/payments-x402.md`).

## How it works

1. The request is routed through the 6-tier DePIN `ComputeRouter`
   (`circuits/theta-inference/`). Real compute runs when a provider key is set;
   otherwise a labelled mock is returned.
2. A completed task is registered in the `AIListener` so the existing
   `/task-status`, `/prove-result`, and webhook machinery work unchanged.
3. An SP1 settlement proof is generated **asynchronously and non-fatally**
   (identical to the M2M `/task-request` path).

## Configuration

| Env var | Default | Meaning |
|---------|---------|---------|
| `OPENAI_GATEWAY_MODELS` | `llama-3-70b,xfuel-auto` | CSV of advertised model IDs. `xfuel-auto` lets the router choose. |
| `OPENAI_GATEWAY_TASK_AMOUNT` | `10000` | Accounting amount (wei) for the fee/proof record on the unmetered path. |
| `THETA_EDGECLOUD_API_KEY` | — | Enables real EdgeCloud compute (else mock). |
| `SP1_PROVER_URL` | — | Enables async settlement proofs. |
| `M2M_API_KEYS` | — | CSV of accepted API keys (open mode if unset). |

## Roadmap

- True provider-token streaming (Phase 1 chunks the completed text).
- x402 metering of the OpenAI path.
- `/v1/completions` (legacy) and embeddings, if agent demand warrants.
