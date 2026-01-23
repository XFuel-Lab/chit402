# Example Environment Variables for Theta Bridge

Copy this file to `.env` or `.env.local` and configure as needed.

## Theta Network Configuration
```bash
THETA_RPC_URL=https://eth-rpc-api.thetatoken.org/rpc
THETA_CHAIN_ID=361
```

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
