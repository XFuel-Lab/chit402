# Reverse-Burn Loop - XFuelLab Hybrid ZK Bridge

## Overview

The reverse-burn loop is a critical feature of the XFuelLab hybrid ZK bridge that enables bidirectional value flow between Theta and Persistence chains. When users burn ibcTFUEL on Persistence, the system unwraps earned yields and routes revenue back to the protocol.

## Architecture

```
Persistence Chain                    Backend Service                    Theta Chain
─────────────────                    ───────────────                    ───────────
                                                                        
ibcTFUEL Burn Event ──────────────>  Persistence Listener
     ↓                                      ↓
  [WebSocket/RPC]                     Store in Redis
                                            ↓
                                     Yield Unwrapper
                                      ↓           ↓
                           30% ibcUSDC  →  70% ibcUSDC
                                ↓               ↓
                         Swap to TFUEL    Reinvest LP
                                ↓               ↓
                         RevenueSplitter   LP Growth
                                ↓
                         [Distribution]
```

## Components

### 1. Persistence Listener (`persistence-listener.js`)

Monitors Persistence chain for ibcTFUEL burn events using:
- **WebSocket Connection**: Real-time event streaming via Tendermint WebSocket
- **RPC Polling**: Backup polling mechanism for reliability
- **Event Processing**: Parses Cosmos SDK events and extracts yield data

**Key Features:**
- Automatic WebSocket reconnection with exponential backoff
- Duplicate event detection using transaction hash tracking
- Graceful fallback to polling if WebSocket fails

**Configuration:**
```bash
PERSISTENCE_RPC_URL=https://rpc.persistence.one
PERSISTENCE_WS_URL=wss://rpc.persistence.one/websocket
PERSISTENCE_CHAIN_ID=core-1
PERSISTENCE_BURN_EVENT_TOPIC=burn_ibcTFUEL
PERSISTENCE_POLL_INTERVAL_MS=10000
```

### 2. Yield Unwrapper (`yield-unwrapper.js`)

Processes burn events and manages yield distribution:

**Yield Split:**
- **30%** - Unwrapped to TFUEL → Routed to RevenueSplitter
- **70%** - Reinvested for LP growth

**Processing Steps:**
1. Fetch pending burn events from Redis
2. Validate yield amounts (minimum threshold check)
3. Calculate 30/70 split
4. Swap 30% ibcUSDC to TFUEL via DEX router
5. Route TFUEL to RevenueSplitter contract
6. Reinvest 70% ibcUSDC into liquidity pools
7. Mark event as processed

**Configuration:**
```bash
YIELD_UNWRAP_PERCENTAGE=30
YIELD_REINVEST_PERCENTAGE=70
REVENUE_SPLITTER_ADDRESS=0x...
SWAP_ROUTER_ADDRESS=0x...
MIN_YIELD_AMOUNT=1000000  # 1 USDC (6 decimals)
```

### 3. Redis Storage

Tracks reverse-burn events with schema:
```javascript
{
  "reverse-burn:{txHash}": {
    burner: "persistence1...",
    amount: "1000000000000000000",  // ibcTFUEL burned
    ibcUSDCYield: "5000000",         // USDC yield (6 decimals)
    txHash: "0xABC123...",
    blockHeight: 12345678,
    timestamp: 1704067200000,
    status: "pending",               // pending|completed|failed|below_threshold
    processedAt: null
  }
}
```

**TTL Policy:**
- Pending events: 7 days
- Processed events: 30 days (audit trail)

## Environment Variables

### Required Variables

```bash
# Persistence Chain Connection
PERSISTENCE_RPC_URL=https://rpc.persistence.one
PERSISTENCE_WS_URL=wss://rpc.persistence.one/websocket

# Revenue Routing
REVENUE_SPLITTER_ADDRESS=0x1234567890123456789012345678901234567890
SWAP_ROUTER_ADDRESS=0xABCDEF1234567890123456789012345678901234

# Relayer Wallet (for executing swaps and transactions)
RELAYER_PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE
```

### Optional Variables

```bash
# Yield Distribution (must sum to 100)
YIELD_UNWRAP_PERCENTAGE=30
YIELD_REINVEST_PERCENTAGE=70

# Thresholds
MIN_YIELD_AMOUNT=1000000  # Minimum USDC to process

# Polling Configuration
PERSISTENCE_POLL_INTERVAL_MS=10000
PERSISTENCE_BURN_EVENT_TOPIC=burn_ibcTFUEL

# Chain Configuration
PERSISTENCE_CHAIN_ID=core-1
```

## Deployment

### Docker Deployment

The Docker setup automatically includes reverse-burn components:

```bash
# Build and start
cd backend/theta-bridge
docker-compose up -d

# Check logs
docker-compose logs -f theta-bridge

# Verify reverse-burn status
curl http://localhost:3001/health | jq .components.reverseBurn
```

**docker-compose.yml** already configured with:
- Redis for event storage
- Reverse-burn environment variables
- Health checks for all components

### PM2 Deployment

```bash
# Install PM2 globally
npm install -g pm2

# Start service
cd backend/theta-bridge
pm2 start ecosystem.config.cjs

# Monitor
pm2 monit

# Check logs
pm2 logs theta-bridge

# Check reverse-burn status
curl http://localhost:3001/health
```

**ecosystem.config.cjs** includes:
- Automatic restart on failure
- Graceful shutdown (10s timeout for pending operations)
- Environment-specific configs
- Log rotation

### Manual Deployment

```bash
# Install dependencies
npm install

# Set environment variables
cp env.example .env
# Edit .env with your values

# Start Redis (if not using Docker)
redis-server --port 6379

# Run service
NODE_ENV=production node src/index.js
```

## Monitoring & Health Checks

### Health Endpoint

```bash
curl http://localhost:3001/health
```

**Response includes reverse-burn status:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "components": {
    "rpc": { "status": "connected", "currentBlock": 123456 },
    "redis": { "status": "connected" },
    "listener": { "isListening": true },
    "reverseBurn": {
      "enabled": true,
      "persistenceListener": {
        "isListening": true,
        "wsConnected": true,
        "lastBlockHeight": 12345678,
        "processedEventCount": 42
      },
      "yieldUnwrapper": {
        "isProcessing": true,
        "queueSize": 3,
        "config": {
          "unwrapPercentage": 30,
          "reinvestPercentage": 70,
          "minYieldAmount": "1000000"
        }
      },
      "stats": {
        "total": 42,
        "pending": 3,
        "completed": 38,
        "failed": 1,
        "belowThreshold": 0
      }
    }
  }
}
```

### Logging

All reverse-burn operations are logged with structured logging:

```bash
# View all logs
tail -f logs/combined.log

# Filter reverse-burn events
grep "ReverseBurnDetected\|YieldUnwrapped\|RevenueRouted" logs/combined.log

# Check for errors
grep "ERROR" logs/error.log
```

**Key Log Events:**
- `ReverseBurnDetected` - Burn event captured
- `YieldUnwrapped` - Yield split and processed
- `RevenueRouted` - TFUEL sent to RevenueSplitter
- `RpcFailover` - Provider switch (if any)

## Testing

### Unit Tests

```bash
# Run all tests
npm test

# Test persistence listener
npm test -- persistence-listener.test.js

# Test yield unwrapper
npm test -- yield-unwrapper.test.js
```

### Integration Tests

```bash
# Quick E2E test
node test-e2e-quick.js

# Full E2E test suite
npm run test:e2e
```

### Manual Testing

1. **Test Persistence Connection:**
```bash
# Check WebSocket connection
curl http://localhost:3001/health | jq .components.reverseBurn.persistenceListener
```

2. **Simulate Burn Event (Dev Only):**
```javascript
// Use Redis CLI to insert test event
redis-cli SET "reverse-burn:test123" '{"burner":"persistence1test","amount":"1000000000000000000","ibcUSDCYield":"5000000","txHash":"test123","blockHeight":12345,"timestamp":1704067200000,"status":"pending"}'
```

3. **Monitor Processing:**
```bash
# Watch logs for processing
docker-compose logs -f theta-bridge | grep -i reverse
```

## Production Considerations

### 1. Placeholder Implementation

**Current Status:**
- ✅ Full architecture and data flow implemented
- ✅ Redis storage and event tracking
- ✅ Logging and monitoring
- ⚠️ **Persistence WebSocket connection** - Uses placeholder Cosmos SDK format
- ⚠️ **ibcUSDC → TFUEL swap** - Mock implementation (returns simulated values)
- ⚠️ **LP reinvestment** - Placeholder logging only

**Before Production:**
1. Integrate real Persistence RPC client (CosmJS/cosmwasm-stargate)
2. Connect to actual DEX router for swaps
3. Implement LP pool interactions
4. Load proper contract ABIs (RevenueSplitter, SwapRouter, LP pools)

### 2. Security

**Key Security Measures:**
- Relayer private key stored in `.env` (use secrets manager in production)
- Minimum threshold prevents dust attacks
- Duplicate event detection prevents replay attacks
- Graceful error handling with automatic retry

**Production Checklist:**
- [ ] Use AWS Secrets Manager / HashiCorp Vault for private keys
- [ ] Enable rate limiting on API endpoints
- [ ] Set up alert monitoring for failed transactions
- [ ] Implement transaction simulation before execution
- [ ] Add slippage protection for swaps (currently 1% in comments)

### 3. Performance

**Current Optimizations:**
- Multi-RPC failover for reliability
- Redis for fast event storage and retrieval
- Batch processing of pending events
- Exponential backoff for reconnections

**Scaling Considerations:**
- Single instance handles ~100 events/hour comfortably
- Redis can be clustered for higher throughput
- Consider horizontal scaling with queue-based architecture for >1000 events/hour

### 4. Monitoring & Alerts

**Recommended Alerts:**
- RevenueSplitter balance < threshold
- Failed yield unwrap > 5% of total
- WebSocket disconnected > 5 minutes
- Redis connection lost
- Relayer wallet balance < minimum

**Metrics to Track:**
- Average yield processing time
- Success/failure rates
- TFUEL routed to RevenueSplitter (cumulative)
- LP reinvestment amounts

## Troubleshooting

### Reverse-Burn Not Enabled

**Symptom:**
```json
{"reverseBurn": {"enabled": false}}
```

**Solution:**
Set `REVENUE_SPLITTER_ADDRESS` in `.env`:
```bash
REVENUE_SPLITTER_ADDRESS=0x1234567890123456789012345678901234567890
```

### WebSocket Connection Failed

**Symptom:**
```
Persistence WebSocket error: connect ECONNREFUSED
```

**Solution:**
1. Check Persistence RPC URL is correct
2. Verify WebSocket endpoint is accessible
3. System falls back to polling automatically

### Events Not Processing

**Symptom:**
Burn events stuck in "pending" status

**Solution:**
1. Check relayer wallet has sufficient balance for gas
2. Verify swap router and revenue splitter addresses
3. Check logs for specific error messages:
```bash
docker-compose logs theta-bridge | grep ERROR
```

### Yield Below Threshold

**Symptom:**
Events marked as "below_threshold"

**Solution:**
Adjust `MIN_YIELD_AMOUNT` if needed (current: 1 USDC):
```bash
MIN_YIELD_AMOUNT=500000  # 0.5 USDC
```

## API Endpoints

### GET /health
Returns full system health including reverse-burn components.

### GET /status
Returns simplified status for quick checks.

### GET /api/vaults/pending
Returns pending vault deposits (forward flow).

### GET /api/rpc/health
Returns health status of all RPC endpoints.

### POST /api/refund/:vaultAddress
Admin endpoint to trigger manual refund.

## Development Workflow

### Local Development

```bash
# Start Redis
docker run -d -p 6379:6379 redis:7-alpine

# Run in development mode
npm run dev

# Or use the batch script (Windows)
run-dev.bat

# Or use the shell script (Linux/Mac)
./run-dev.sh
```

### Adding New Features

1. **New Yield Strategy:**
   - Modify `yield-unwrapper.js`
   - Update percentage split in config
   - Add logging for new strategy

2. **Additional Chains:**
   - Create new listener in `src/`
   - Add chain config to `config.js`
   - Update `index.js` to initialize new listener

3. **Enhanced Monitoring:**
   - Add metrics to health endpoint
   - Update logger with new events
   - Create dashboard queries

## References

- [Main Architecture](./ARCHITECTURE.md)
- [Deployment Guide](./DEPLOYMENT.md)
- [Module Structure](./MODULE_STRUCTURE.md)
- [E2E Testing](./E2E_TESTING_GUIDE.md)
- [Quick Reference](./QUICK_REFERENCE.md)

## Support

For issues or questions:
1. Check logs: `docker-compose logs -f theta-bridge`
2. Verify health: `curl http://localhost:3001/health`
3. Review configuration in `.env`
4. Consult documentation in this directory

---

**Status:** ✅ Fully implemented with placeholder integrations for production APIs
**Version:** 2.0.0
**Last Updated:** 2024-01-01




