# XFuelLab Hybrid ZK Bridge - Backend Service

**Enhanced Node.js backend with reverse-burn loop for bidirectional TFUEL ↔ Cosmos LST flows.**

---

## 🚀 Overview

This backend service orchestrates the XFuelLab hybrid ZK bridge, enabling trustless cross-chain swaps between Theta and Persistence chains with automated yield routing.

### Core Components

#### **Forward Flow (Theta → Persistence)**
- Multi-RPC provider with automatic failover
- DepositReceived event monitoring on Theta
- SP1 zkVM proof generation (RISC-V → STARK → Groth16 wrapper)
- Redis-based vault mapping (address → Keplr)
- Automated refund handling for expired/invalid deposits

#### **Reverse-Burn Loop (Persistence → Theta)** ✨ NEW
- Persistence burn event listener via WebSocket + polling
- Yield unwrapper: 30% ibcUSDC → TFUEL routing
- 70% LP reinvestment for growth
- RevenueSplitter integration (50% veXF, 25% buyback, 15% rXF, 10% treasury)

---

## 📦 Installation

### Prerequisites
- Node.js ≥ 20.0.0
- Redis ≥ 7.0
- npm ≥ 10.0.0

### Install Dependencies

```bash
cd services/gateway
npm install
```

### Configuration

Copy the environment template and configure:

```bash
cp ENV_TEMPLATE.md .env
```

**Required Variables:**
```env
# Theta Network
VAULT_FACTORY_ADDRESS=0x...
RELAYER_PRIVATE_KEY=0x...

# Reverse-Burn Loop (Optional - disable if not set)
REVENUE_SPLITTER_ADDRESS=0x...
SWAP_ROUTER_ADDRESS=0x...
PERSISTENCE_WS_URL=wss://rpc.persistence.one/websocket
```

See `ENV_TEMPLATE.md` for full configuration reference.

---

## 🏃 Running the Service

### Development Mode

```bash
npm run dev
```

### Production with PM2

```bash
pm2 start ecosystem.config.cjs
pm2 logs theta-bridge
pm2 monit
```

### Docker Compose

```bash
docker-compose up -d
docker-compose logs -f theta-bridge
```

---

## 🔄 Architecture

### Forward Flow (Deposits)

```
┌─────────────────────────────────────────────────────┐
│ 1. User deposits TFUEL to SubVault (Theta)         │
└─────────────────┬───────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────┐
│ 2. DepositReceived event detected by listener      │
│    - Multi-RPC failover ensures reliability         │
│    - Periodic scan catches missed events            │
└─────────────────┬───────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────┐
│ 3. ZK proof generated for transaction              │
│    - Mock mode: instant placeholder proofs          │
│    - Production: SP1 zkVM proofs (~9s, batched)    │
└─────────────────┬───────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────┐
│ 4. Mapping stored in Redis (vault → Keplr addr)    │
│    - 30-minute TTL with auto-refund on expiry       │
└─────────────────┬───────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────┐
│ 5. Queued for Persistence minter (Phase 3 TODO)    │
│    - Will mint ibcTFUEL 1:1 to user's Keplr        │
└─────────────────────────────────────────────────────┘
```

### Reverse-Burn Loop (Yields) ✨ NEW

```
┌─────────────────────────────────────────────────────┐
│ 1. User burns ibcTFUEL on Persistence              │
│    - Earns ibcUSDC yield from LST staking          │
└─────────────────┬───────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────┐
│ 2. Burn event detected via WebSocket/polling       │
│    - Cosmos SDK event: burn_ibcTFUEL                │
│    - Stored in Redis: reverse-burn:{txHash}         │
└─────────────────┬───────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────┐
│ 3. Yield split calculated                          │
│    30% → Unwrap to TFUEL (route to RevSplitter)    │
│    70% → Reinvest for LP growth                     │
└─────────────────┬───────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────┐
│ 4a. Unwrap 30% ibcUSDC to TFUEL                    │
│     - Uses swap router on Theta                     │
│     - Slippage protection + retry logic             │
└─────────────────┬───────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────┐
│ 4b. Route TFUEL to RevenueSplitter                 │
│     - Calls splitRevenueNative() with TFUEL         │
│     - Automatic distribution:                       │
│       • 50% → veXF holders (yield)                  │
│       • 25% → buyback/burn XF                       │
│       • 15% → rXF mint (redeemable XF)              │
│       • 10% → Treasury                              │
└─────────────────┬───────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────┐
│ 5. Reinvest 70% for LP growth (Phase 3 TODO)       │
│    - Add liquidity to pools                         │
│    - Mint LP tokens to original burner              │
└─────────────────────────────────────────────────────┘
```

---

## 📊 Monitoring

### Health Check

```bash
curl http://localhost:3001/health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-01-01T12:00:00.000Z",
  "components": {
    "rpc": {
      "status": "connected",
      "currentBlock": 12345678,
      "endpoints": [...]
    },
    "redis": { "status": "connected" },
    "listener": {
      "isListening": true,
      "lastProcessedBlock": 12345670,
      "processedEventCount": 42
    },
    "reverseBurn": {
      "enabled": true,
      "persistenceListener": {
        "isListening": true,
        "wsConnected": true,
        "lastBlockHeight": 9876543
      },
      "yieldUnwrapper": {
        "isProcessing": true,
        "queueSize": 0
      },
      "stats": {
        "total": 150,
        "pending": 2,
        "completed": 145,
        "failed": 1,
        "belowThreshold": 2
      }
    }
  },
  "stats": {
    "pendingVaults": 5
  }
}
```

### Other Endpoints

```bash
# Service status
curl http://localhost:3001/status

# Pending vaults
curl http://localhost:3001/api/vaults/pending

# RPC health
curl http://localhost:3001/api/rpc/health

# Manual refund (admin)
curl -X POST http://localhost:3001/api/refund/0x...
```

---

## 🔧 Module Reference

### `src/index.js`
Main service orchestrator. Initializes all components and manages lifecycle.

### `src/config.js`
Configuration loader with validation. Parses `.env` and sets defaults.

### `src/provider.js`
Multi-RPC provider with automatic failover. Retries failed calls across endpoints.

### `src/listener.js`
Theta DepositReceived event listener. Monitors SubVault deposits via WebSocket + periodic scans.

### `src/prover.js`
ZK proof generator. Uses SP1 zkVM in production (~9s proving, ~100ms verification). Phase B batching achieves 11.6x speedup.

### `src/refund-manager.js`
Automated refund handler for expired/invalid vault mappings.

### `src/redis-client.js`
Redis operations for vault mappings and reverse-burn event tracking.

### `src/persistence-listener.js` ✨ NEW
Persistence burn event listener. Monitors Cosmos SDK events via WebSocket + polling.

### `src/yield-unwrapper.js` ✨ NEW
Yield processing engine. Splits ibcUSDC yields (30% unwrap, 70% reinvest) and routes to RevenueSplitter.

### `src/logger.js`
Pino-based structured logging with contextual tags.

---

## 🛠️ Configuration Reference

### Reverse-Burn Loop Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `PERSISTENCE_WS_URL` | `wss://rpc.persistence.one/websocket` | Persistence WebSocket for real-time burn events |
| `PERSISTENCE_RPC_URL` | `https://rpc.persistence.one` | Persistence RPC for polling fallback |
| `PERSISTENCE_BURN_EVENT_TOPIC` | `burn_ibcTFUEL` | Cosmos SDK event topic to monitor |
| `PERSISTENCE_POLL_INTERVAL_MS` | `10000` | Polling interval (backup to WebSocket) |
| `YIELD_UNWRAP_PERCENTAGE` | `30` | % of yield to unwrap to TFUEL |
| `YIELD_REINVEST_PERCENTAGE` | `70` | % of yield to reinvest for LP growth |
| `REVENUE_SPLITTER_ADDRESS` | - | RevenueSplitter contract on Theta (required for reverse-burn) |
| `SWAP_ROUTER_ADDRESS` | - | DEX router for ibcUSDC → TFUEL swaps |
| `MIN_YIELD_AMOUNT` | `1000000` | Minimum yield to process (1 USDC = 10^6 units) |

---

## 🔐 Security

### Best Practices

1. **Relayer Key Security**
   - Use hardware wallet or secrets manager (AWS Secrets, HashiCorp Vault)
   - Limit relayer wallet to minimal funds (~10 TFUEL for gas)
   - Rotate keys regularly

2. **Access Control**
   - Disable `/api/refund/:vaultAddress` in production (require admin auth)
   - Rate-limit public endpoints
   - Use HTTPS + API keys for external access

3. **Monitoring**
   - Set up alerts for:
     - Low relayer balance
     - Failed refunds
     - RPC endpoint failures
     - Reverse-burn processing errors
   - Review logs daily for anomalies

4. **Environment Isolation**
   - Never commit `.env` files
   - Use separate configs for dev/staging/production
   - Validate all environment variables on startup

---

## 🐛 Troubleshooting

### Issue: Deposits not detected

**Check:**
- RPC endpoint health: `curl http://localhost:3001/api/rpc/health`
- Listener status: Check `listener.isListening` in `/health`
- Logs: `pm2 logs theta-bridge --lines 100`

**Fix:**
- Switch to backup RPC if primary is down
- Restart listener: `pm2 restart theta-bridge`

### Issue: Reverse-burn events not processing

**Check:**
- Persistence WebSocket connection: `reverseBurn.persistenceListener.wsConnected` in `/health`
- Yield unwrapper status: `reverseBurn.yieldUnwrapper.isProcessing`
- Redis keys: `redis-cli KEYS "reverse-burn:*"`

**Fix:**
- Verify `PERSISTENCE_WS_URL` is reachable
- Check relayer balance for swap gas
- Manually trigger processing: restart service

### Issue: Redis connection lost

**Check:**
- Redis service: `redis-cli ping`
- Docker logs: `docker-compose logs redis`

**Fix:**
- Restart Redis: `docker-compose restart redis`
- Check `REDIS_URL` in `.env`

---

## 📝 Development

### Adding New Features

1. Create module in `src/`
2. Initialize in `src/index.js` → `BridgeService.init()`
3. Add exports: `export { initModule, getModule }`
4. Update health check to include new module status
5. Document in this README

### Logging Standards

Use structured logging with contextual tags:

```javascript
logger.info({
  vault: '0x123...',
  amount: '100',
  txHash: '0xabc...'
}, 'Deposit processed successfully');
```

### Testing

```bash
# Unit tests (TODO)
npm test

# Integration tests with testnet
npm run test:integration

# Manual E2E test
npm run test:e2e
```

---

## 📦 Deployment

### Docker Production

```bash
# Build image
docker-compose build

# Start services
docker-compose up -d

# Check logs
docker-compose logs -f theta-bridge

# Stop services
docker-compose down
```

### PM2 Production

```bash
# Start
pm2 start ecosystem.config.cjs --env production

# Monitor
pm2 monit

# Restart
pm2 restart theta-bridge

# Stop
pm2 stop theta-bridge

# View logs
pm2 logs theta-bridge --lines 200
```

### Kubernetes (Optional)

See `k8s/` directory for Helm charts and manifests.

---

## 🤝 Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/reverse-burn-enhancements`
3. Commit changes: `git commit -m 'Add yield reinvestment tracking'`
4. Push to branch: `git push origin feature/reverse-burn-enhancements`
5. Open pull request

---

## 📄 License

MIT License - see LICENSE file for details.

---

## 🔗 Links

- **Frontend**: `../../src/App.tsx`
- **Contracts**: `../../contracts/`
- **Whitepaper**: `../../docs/whitepaper/XFUEL-ZK-Bridge-Whitepaper.md`
- **Live Demo**: [xfuel.app](https://xfuel.app)

---

## 🆘 Support

- **Issues**: GitHub Issues
- **Discord**: [XFuelLab Discord](#)
- **Email**: support@xfuel.app

---

**Built with ❤️ by XFuelLab** | Powering the next generation of cross-chain DeFi
