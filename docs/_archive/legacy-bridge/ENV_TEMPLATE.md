> **⚠️ ARCHIVED / LEGACY (as of 2026-07-17).** This document describes the retired
> `backend/theta-bridge` stack and is kept for historical reference only. It does
> **not** reflect the current system. The gateway now lives at `services/gateway/`
> and runs live at `https://api-testnet.xfuel.app`. For the authoritative
> as-deployed state, see [`docs/RUNTIME_STATE.md`](../../RUNTIME_STATE.md) and
> [`services/gateway/README.md`](../../../services/gateway/README.md).

# ===================================================================
# XFuelLab Hybrid ZK Bridge - Backend Configuration
# ===================================================================

# ===================================================================
# THETA NETWORK CONFIGURATION
# ===================================================================

# Theta RPC endpoints (comma-separated for multi-RPC failover)
THETA_RPC_URLS=https://eth-rpc-api.thetatoken.org/rpc,https://theta-eth-rpc.thetatoken.org/rpc,https://theta-bridge-rpc.thetatoken.org/rpc

# RPC timeout in milliseconds
RPC_TIMEOUT_MS=30000

# Required confirmations for Theta transactions
REQUIRED_CONFIRMATIONS=3

# Block polling interval in milliseconds
BLOCK_POLL_INTERVAL_MS=5000

# ===================================================================
# CONTRACT CONFIGURATION
# ===================================================================

# VaultFactory contract address (deployed on Theta)
VAULT_FACTORY_ADDRESS=0x...

# SubVault ABI path (relative to backend root)
SUBVAULT_ABI_PATH=./abis/SubVault.json

# VaultFactory ABI path (relative to backend root)
VAULT_FACTORY_ABI_PATH=./abis/VaultFactory.json

# ===================================================================
# REDIS CONFIGURATION
# ===================================================================

# Redis connection URL
REDIS_URL=redis://localhost:6379

# Redis password (if required)
REDIS_PASSWORD=

# Redis database number
REDIS_DB=0

# ===================================================================
# RELAYER CONFIGURATION
# ===================================================================

# Relayer private key (DO NOT COMMIT THIS - USE SECRETS MANAGER)
RELAYER_PRIVATE_KEY=0x...

# Gas limit for relayer transactions
RELAYER_GAS_LIMIT=100000

# Max fee per gas (in wei)
RELAYER_MAX_FEE_PER_GAS=100000000000

# ===================================================================
# EXPIRY CONFIGURATION
# ===================================================================

# Vault mapping expiry time in minutes
EXPIRY_MINUTES=30

# ===================================================================
# ZK PROOF CONFIGURATION
# ===================================================================

# ZK circuit WASM file path
# ZK_CIRCUIT_WASM=./circuits/circuit.wasm  # Legacy Groth16 (Phase 0, archived)

# ZK circuit ZKEY file path
ZK_CIRCUIT_ZKEY=./circuits/circuit_final.zkey

# ZK verification key path
ZK_VERIFICATION_KEY=./circuits/verification_key.json

# ===================================================================
# PERSISTENCE CHAIN CONFIGURATION (Forward Flow)
# ===================================================================

# Persistence RPC URL
PERSISTENCE_RPC_URL=https://rpc.persistence.one

# Persistence minter contract address
PERSISTENCE_MINTER_CONTRACT=persistence1...

# Persistence chain ID
PERSISTENCE_CHAIN_ID=core-1

# ===================================================================
# REVERSE-BURN LOOP CONFIGURATION (Persistence -> Theta)
# ===================================================================

# Persistence WebSocket URL for real-time burn events
PERSISTENCE_WS_URL=wss://rpc.persistence.one/websocket

# Burn event topic to monitor
PERSISTENCE_BURN_EVENT_TOPIC=burn_ibcTFUEL

# Polling interval for burn events (milliseconds) - backup to WebSocket
PERSISTENCE_POLL_INTERVAL_MS=10000

# ===================================================================
# YIELD UNWRAPPING CONFIGURATION
# ===================================================================

# Percentage of ibcUSDC yield to unwrap to TFUEL (30%)
YIELD_UNWRAP_PERCENTAGE=30

# Percentage of ibcUSDC yield to reinvest for LP growth (70%)
YIELD_REINVEST_PERCENTAGE=70

# RevenueSplitter contract address (on Theta)
# If not set, reverse-burn loop will be disabled
REVENUE_SPLITTER_ADDRESS=0x...

# Swap router address for ibcUSDC -> TFUEL conversion
SWAP_ROUTER_ADDRESS=0x...

# Minimum yield amount to process (in ibcUSDC units, 6 decimals)
# Default: 1000000 = 1 USDC
MIN_YIELD_AMOUNT=1000000

# ===================================================================
# SERVICE CONFIGURATION
# ===================================================================

# HTTP server port
PORT=3001

# Log level (debug, info, warn, error)
LOG_LEVEL=info

# Node environment (development, production)
NODE_ENV=production

# ===================================================================
# RETRY CONFIGURATION
# ===================================================================

# Maximum number of retries for failed operations
MAX_RETRIES=3

# Delay between retries in milliseconds
RETRY_DELAY_MS=5000

# ===================================================================
# NOTES
# ===================================================================
# 
# FORWARD FLOW (Theta -> Persistence):
# 1. User deposits TFUEL to SubVault on Theta
# 2. DepositReceived event is detected by listener
# 3. ZK proof is generated for the deposit
# 4. Proof is submitted to Persistence minter contract
# 5. ibcTFUEL is minted 1:1 to user's Keplr address
# 6. User earns ibcUSDC yield on Persistence
#
# REVERSE-BURN LOOP (Persistence -> Theta):
# 1. User burns ibcTFUEL on Persistence (claims yield)
# 2. Burn event is detected by persistence-listener
# 3. ibcUSDC yield is split:
#    - 30% unwrapped to TFUEL and routed to RevenueSplitter
#    - 70% reinvested for LP growth
# 4. RevenueSplitter distributes TFUEL according to tokenomics:
#    - 50% to veXF holders (yield)
#    - 25% to buyback/burn
#    - 15% to rXF mint
#    - 10% to Treasury
#
# SECURITY NOTES:
# - Keep RELAYER_PRIVATE_KEY secure (use environment secrets)
# - Use separate relayer wallet with limited funds
# - Monitor relayer balance via /health endpoint
# - Set appropriate gas limits based on network conditions
# - Review logs regularly for anomalies
#
# MONITORING:
# - Health endpoint: http://localhost:3001/health
# - Status endpoint: http://localhost:3001/status
# - Pending vaults: http://localhost:3001/api/vaults/pending
# - RPC health: http://localhost:3001/api/rpc/health
#
# DEPLOYMENT:
# Docker: docker-compose up -d
# PM2: pm2 start ecosystem.config.cjs
#
# ===================================================================




