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
| `subnet_id` | number | Cond. | Required for `bittensor` routing |
| `theta_recipient` | string | No | Theta EVM settlement address |
| `max_gpu_hours` | string | No | Akash GPU lease duration |

**Example:**

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
    "input_hash": "0xabcdef..."
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
  "fee_info": {
    "description": "0.5% protocol fee → CoreRevenueSplitter (30% BBB / 30% GET / 25% veXF / 15% Treasury)",
    "collector": "FeeCollector.wasm → CW20 Send → RevenueSplitter"
  },
  "_links": {
    "status": "/task-status?task_id=m2m-task-1-1739299200000",
    "proof": "/prove-result?task_id=m2m-task-1-1739299200000"
  }
}
```

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

### `GET /task-status` — Query Status

| Param | Description |
|-------|-------------|
| `task_id` | Query an AI task |
| `message_id` | Query an A2A message |

```bash
curl "http://localhost:3002/task-status?task_id=m2m-task-1-..." -H "X-API-Key: ..."
```

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
