# XFuel Protocol — M2M API Documentation

> REST API for programmatic access to the AI DePIN module. Agents, bots, and orchestrators use these endpoints to submit AI tasks, retrieve ZK settlement proofs, send A2A messages, and query task status.

**Back to:** [README.md](../README.md)

---

## Quick Start

```bash
cd backend/theta-bridge
npm install

# Start the M2M API server (port 3002)
npm run m2m-server

# With explicit port and auth
M2M_API_PORT=3002 M2M_API_KEYS=my-secret-key npm run m2m-server
```

---

## Authentication

All endpoints (except `GET /health`) require one of:

| Method | Header | Description |
|--------|--------|-------------|
| API Key | `X-API-Key: <key>` | Static key from `M2M_API_KEYS` env var (comma-separated) |
| Relayer ECDSA | `X-Signature: <0x-sig>` + `X-Sig-Timestamp: <epoch>` | ECDSA over `method+path+sha256(body)+timestamp`; signer in `M2M_RELAYER_ADDRESSES` |

If neither is set, the server runs in **open mode** (dev only).

---

## Rate Limiting

Sliding-window rate limiter keyed by API key (or IP). Defaults: **120 requests / 60s**. A `429` response includes `Retry-After` header.

---

## Endpoints

### `POST /task-request` — Submit an AI Intent

Submit an AI task for routing to Akash, Bittensor (TAO), Osmosis, or Theta Edge Cloud.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message_type` | string | Yes | `compute_bid`, `compute_result`, `inference_request`, `capability_query`, `data_attestation` |
| `chain_id` | string | Yes | `theta`, `osmosis`, `akash`, `bittensor`, `persistence` |
| `amount` | string | Yes | Gross task value (≥ 10000, dust protection) |
| `sender` | string | Yes | Sender address / agent identifier |
| `fee_bps` | number | No | Fee override (50–100 BPS). Default: 50 (0.5%) |
| `model_id` | string | Cond. | Required for `inference_request` |
| `input_hash` | string | Cond. | Required for `inference_request`, `data_attestation` |
| `output_hash` | string | Cond. | Required for `compute_result` |
| `proof_system` | string | No | For `inference_request`: `sp1` (default) or `zkgpt` (Phase 1 zkGPT path). |
| `subnet_id` | number | Cond. | Required for `bittensor` routing |
| `theta_recipient` | string | No | Theta EVM settlement address |
| `max_gpu_hours` | string | No | Akash GPU lease duration |

**Examples:**

Default (SP1 proof):
```bash
curl -X POST http://localhost:3002/task-request \
  -H "Content-Type: application/json" \
  -H "X-API-Key: my-secret-key" \
  -d '{
    "message_type": "inference_request",
    "chain_id": "akash",
    "amount": "1000000",
    "sender": "0xYourAgentAddress",
    "model_id": "llama-3-70b",
    "input_hash": "0xabcdef...",
    "proof_system": "sp1"
  }'
```

Phase 1 zkGPT path (requires `ZKGPT_PROVER_URL` configured):
```bash
curl -X POST http://localhost:3002/task-request \
  -H "Content-Type: application/json" \
  -H "X-API-Key: my-secret-key" \
  -d '{
    "message_type": "inference_request",
    "chain_id": "theta",
    "amount": "1000000",
    "sender": "0xYourAgentAddress",
    "model_id": "llama-3-70b",
    "input_hash": "0xabcdef...",
    "proof_system": "zkgpt"
  }'
```

**Response (202 Accepted):**

```json
{
  "task_id": "m2m-task-1-1739299200000",
  "status": "accepted",
  "message_type": "inference_request",
  "chain_id": "akash",
  "gross_amount": "1000000",
  "fee_amount": "5000",
  "net_amount": "995000",
  "fee_bps": 50,
  "verify_url": "http://localhost:3002/receipt/m2m-task-1-1739299200000",
  "fee_info": {
    "description": "0.5% protocol fee → CoreRevenueSplitter (30% BBB / 30% GET / 25% veXF / 15% Treasury)",
    "collector": "FeeCollector.wasm → CW20 Send → RevenueSplitter"
  },
  "_links": {
    "status": "/task-status?task_id=m2m-task-1-1739299200000",
    "proof": "/prove-result?task_id=m2m-task-1-1739299200000",
    "receipt": "http://localhost:3002/receipt/m2m-task-1-1739299200000"
  }
}
```

**`verify_url`** is the canonical, **public, no-auth** proof link — the same value is
threaded consistently across every surface (this API's `/task-status` + `/prove-result`
responses, the OpenAI gateway `xfuel.verify_url` body field + `x-xfuel-verify-url` header,
the SDK, and the MCP tools). Open or share it to prove settlement. It's absolute when the
server knows its public base URL (set `PUBLIC_BASE_URL` behind a proxy/CDN) and matches
`_links.receipt`.

---

### `GET /prove-result` — Retrieve ZK Settlement Proof

Fetch the SP1 ZK proof and fee breakdown for a completed task.

| Param | Required | Description |
|-------|----------|-------------|
| `task_id` | Yes | Task ID from `/task-request` response |

```bash
curl "http://localhost:3002/prove-result?task_id=m2m-task-1-1739299200000" \
  -H "X-API-Key: my-secret-key"
```

**Response (200 OK):**

```json
{
  "task_id": "m2m-task-1-1739299200000",
  "status": "fee_collected",
  "proof_outcome": "valid",
  "verify_url": "http://localhost:3002/receipt/m2m-task-1-1739299200000",
  "sp1_proof": {
    "proof": "0x...",
    "publicInputs": "0x...",
    "nullifier": "0xabc123...",
    "provingTimeMs": 9200
  },
  "fee": {
    "gross_amount": "1000000",
    "fee_amount": "5000",
    "net_amount": "995000",
    "fee_bps": 50,
    "revenue_split": { "bbb": "30%", "lp": "30%", "vexf": "25%", "treasury": "15%" }
  }
}
```

Returns **409 Conflict** if the task is not yet settled.

---

### `POST /a2a-message` — Send an A2A Message

Submit a ZK-verifiable agent-to-agent message with optional escrow.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message_type` | string | Yes | One of the five message types |
| `sender_chain` | string | Yes | Origin chain |
| `recipient_chain` | string | Yes | Destination chain |
| `payload_hash` | string | Yes | SHA-256 hex of message payload |
| `escrow_amount` | string | Cond. | Required non-zero for `compute_bid` and `inference_request` |
| `ttl` | number | Yes | Time-to-live in seconds (1–86400) |
| `sender_address` | string | Yes | Sender agent address |
| `sender_identity` | string | Yes | Agent identity commitment (Poseidon hash hex) |
| `recipient_address` | string | No | Recipient agent address |
| `ibc_channel` | string | Cond. | Required for cross-chain messages |

**Example:**

```bash
curl -X POST http://localhost:3002/a2a-message \
  -H "Content-Type: application/json" \
  -H "X-API-Key: my-secret-key" \
  -d '{
    "message_type": "compute_bid",
    "sender_chain": "theta",
    "recipient_chain": "akash",
    "payload_hash": "0xdeadbeef...",
    "escrow_amount": "250000",
    "ttl": 3600,
    "sender_address": "0xYourAgentAddress",
    "sender_identity": "0xPoseidonCommitmentHash",
    "ibc_channel": "channel-42"
  }'
```

**Response (202 Accepted):**

```json
{
  "message_id": "a2a-550e8400-...",
  "status": "accepted",
  "message_type": "compute_bid",
  "escrow_amount": "250000",
  "relay_fee": "25",
  "relay_fee_info": "0.1% on escrowed amount → CoreRevenueSplitter (30/30/25/15)",
  "nonce": 1,
  "ttl": 3600
}
```

---

### `POST /a2a-settle-fair-exchange` — Settle A2A bid via Fair Exchange (Phase 1)

Settle an accepted A2A bid using a PAS (Proxy Adaptor Signature) instead of a ZK proof. Requires `A2A_CIRCUIT_ADDRESS`; if `RELAYER_PRIVATE_KEY` is set, the server submits the tx; otherwise returns encoded calldata.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `bid_id` | string | Yes | Bytes32 bid ID (0x-prefixed 64 hex chars) |
| `result_hash` | string | Yes | Hash of delivered result (0x-prefixed 64 hex chars) |
| `v` | number | Yes | ECDSA recovery id (0–255) |
| `r` | string | Yes | Signature r (0x-prefixed 64 hex chars) |
| `s` | string | Yes | Signature s (0x-prefixed 64 hex chars) |

**Responses:** 202 + `tx_hash` when relayer configured; 200 + `calldata` when not; 503 if `A2A_CIRCUIT_ADDRESS` unset.

---

### `GET /task-status` — Query Status

| Param | Description |
|-------|-------------|
| `task_id` | Query an AI task |
| `message_id` | Query an A2A message |

```bash
curl "http://localhost:3002/task-status?task_id=m2m-task-1-..." -H "X-API-Key: ..."
```

The task response includes `verify_url` — the public, shareable receipt link (see below).

---

### `GET /receipt/:taskId` — Public verifiable receipt (no auth)

A **public, no-auth, shareable** receipt for a task. Returns a clean **HTML** page by
default (great for sharing a link / unfurling), or **JSON** with `?format=json` (or
`Accept: application/json`) for agents. Rate-limited per-IP.

It exposes **no secrets** — no proof bytes, no raw model output, no keys. It shows the
route, payment (rail + settlement ref, with a block-explorer link for Base/Base Sepolia
txs), proof status (system, outcome, nullifier, proving time), an output-hash
commitment, and an **independent re-derivation of the x402 payment-binding commitment**
so anyone can confirm "paid + proven" without trusting the server.

```bash
# Shareable HTML page (open in a browser)
curl "http://localhost:3002/receipt/m2m-task-1-..."

# Machine-readable JSON (agents)
curl "http://localhost:3002/receipt/m2m-task-1-...?format=json"
```

The JSON `binding` block includes `expected_commitment`, `recomputed_commitment`, and
`matches` — the local re-derivation of `keccak256(paymentRefHash, taskIdHash, rail,
amount)`. Honest proof scope is stated on the receipt: the SP1 proof attests settlement
metadata + an output-hash commitment, **not** that the provider computed the model
correctly (see `docs/POSITIONING.md` §2).

This page is the target of the `verify_url` returned by `POST /task-request`,
`GET /task-status`, and `GET /prove-result` (and by the OpenAI gateway, SDK, and MCP
tools) — one consistent, shareable proof link for every task. Set `PUBLIC_BASE_URL`
to emit absolute links behind a proxy/CDN.

**Durability:** tasks are held in an in-memory hot map for their live lifecycle, but a
public-safe snapshot is also **persisted to disk** (write-through), so a shared
`verify_url` keeps resolving across server restarts and after a settled task is evicted
from the hot map. Snapshots are retained for `TASK_STORE_RETENTION_MS` (default 30 days),
then pruned. Set `TASK_STORE_PERSIST=false` for a purely in-memory (ephemeral) node, or
`TASK_STORE_DIR` to relocate the store (e.g. a shared volume). Single-node/file by
design — swap for Redis/Postgres when scaling horizontally.

---

### `GET /health` — Server Health

No authentication required.

```bash
curl http://localhost:3002/health
```

Returns server health, configuration, AI listener metrics, and aggregate stats.

---

## Fee Structure

| Fee Type | Rate | Collected By |
|----------|------|-------------|
| AI task fee | 0.5–1% (50–100 BPS) | `FeeCollector.wasm` |
| A2A relay fee | 0.1% (10 BPS) on escrow | `AIDePINRouter.sol` |
| Bridge fee | 0.5% (50 BPS) | Existing bridge flow |

All fees distribute via CoreRevenueSplitter: 30% BBB, 30% GET (Growth & Expansion Treasury), 25% veXF, 15% Treasury. See [`Growth-Expansion-Treasury.md`](Growth-Expansion-Treasury.md) for GET sub-breakdown.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `M2M_API_PORT` | `3002` | Server port |
| `M2M_API_KEYS` | (none) | Comma-separated API keys |
| `M2M_RELAYER_ADDRESSES` | (none) | Comma-separated relayer EVM addresses |
| `M2M_RATE_WINDOW_MS` | `60000` | Rate limit window (ms) |
| `M2M_RATE_MAX_HITS` | `120` | Max requests per window |
| `AI_TASK_FEE_BPS` | `50` | Default task fee (basis points) |
| `AI_LISTENER_ENABLED` | `true` | Required for task routing |

---

## Contract Sync Points

| Contract | Sync Point |
|----------|-----------|
| `AIDePINRouter.sol` | `MessageType` / `ChainId` / `ProofOutcome` enums, `routeInference()`, `settleTask()` |
| `TAOWrapper.sol` | `routeInference()` with `subnetId`, `ChainId.Bittensor` routing |
| `AIVerifier.wasm` | `RouteTask` / `SettleTask` execute messages |
| `FeeCollector.wasm` | CW20 `Receive` hook, `TriggerFeeBurn` |
| `sp1-prover/main.rs` | `validate_ai_task()`, `validate_a2a_message()` circuits |
| `CoreRevenueSplitter.sol` | 30/30/25/15 fee distribution |
