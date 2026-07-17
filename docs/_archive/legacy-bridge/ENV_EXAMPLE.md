> **⚠️ ARCHIVED / LEGACY (as of 2026-07-17).** This document describes the retired
> `backend/theta-bridge` stack and is kept for historical reference only. It does
> **not** reflect the current system. The gateway now lives at `services/gateway/`
> and runs live at `https://api-testnet.xfuel.app`. For the authoritative
> as-deployed state, see [`docs/RUNTIME_STATE.md`](../../RUNTIME_STATE.md) and
> [`services/gateway/README.md`](../../../services/gateway/README.md).

# Example Environment Variables for Theta Bridge

Copy this file to `.env` or `.env.local` and configure as needed.

## Theta Network Configuration
```bash
THETA_RPC_URL=https://eth-rpc-api.thetatoken.org/rpc
THETA_CHAIN_ID=361
```

## Theta GPU Node (E2E inference)

Point the backend at your Theta GPU node so `inference_request` tasks run real inference instead of mock.

```bash
THETA_EDGE_URL=https://your-theta-gpu-node.example.com
AI_INFERENCE_TIMEOUT_MS=60000
```

**Node API contract:** The backend POSTs to `{THETA_EDGE_URL}/api/v1/inference/run` with JSON body:

- `model_id` (string), `input_hash` (string), `budget` (string, wei), `requester` (address), `source_chain` (string), `source_tx` (string)

The node must respond with JSON including at least:

- `output_hash` — keccak256 of model output (used for proof and settlement)
- `inference_time_ms` — optional; backend stores full response in task result

If `THETA_EDGE_URL` is not set, inference runs in mock mode (no real GPU).

## SP1 Prover Configuration
```bash
SP1_PROVER_URL=http://3.83.140.122:8080
SP1_PROVER_TIMEOUT=120000
SP1_PROVER_RETRIES=3
SP1_PROVER_FALLBACK=false
```

## Phase 1: Batching Configuration (11.6x speedup, 90% cost reduction)
```bash
SP1_BATCHING_ENABLED=true
SP1_BATCH_SIZE=10
SP1_BATCH_TIMEOUT_MS=10000
SP1_MIN_BATCH_SIZE=5
```

## Phase 1: zkGPT Prover (optional)
When tasks request `proof_system: zkgpt`, the backend calls this service instead of SP1. If unset, requests with `proof_system: zkgpt` fall back to SP1 with a warning.
```bash
ZKGPT_PROVER_URL=http://localhost:81
ZKGPT_PROVER_TIMEOUT_MS=120000
```
See `zkgpt-prover/README.md` for the expected HTTP API. Reference: eprint.iacr.org/2025/1184; [docs/REFERENCES-AND-ATTRIBUTION.md](../../docs/REFERENCES-AND-ATTRIBUTION.md).

## Phase 1: Fair Exchange (optional)
For POST /a2a-settle-fair-exchange and A2A Fair Exchange flow. The deploy scripts (e.g. `deploy/deploy-full.cjs`, `deploy/testnet.cjs`) can set the Fair Exchange proxy on A2ACircuit when this is set at deploy time.
```bash
# Backend: A2A contract for Fair Exchange settlement
A2A_CIRCUIT_ADDRESS=0x...
# Optional: relayer key so the API submits settleBidFairExchange tx
RELAYER_PRIVATE_KEY=0x...

# Deploy scripts only: set A2ACircuit.setFairExchangeProxy(addr) after deploy
FAIR_EXCHANGE_PROXY_ADDRESS=0x...
```

## Deposit Monitoring
```bash
DEPOSIT_POLL_INTERVAL=15000
DEPOSIT_CONFIRMATIONS=12
```

## Logging
```bash
LOG_LEVEL=info
```

---

For detailed batching configuration, see `BATCHING_CONFIGURATION.md`.
