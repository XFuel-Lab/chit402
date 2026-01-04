# 🔧 Developer Quick Reference - Reverse-Burn Loop

Fast reference for developers working with the extended backend.

---

## 🚀 Quick Commands

```bash
# Development
npm run bridge:dev                  # Start backend in dev mode
npm run bridge:logs                 # View Docker logs

# Production
npm run bridge:docker               # Start with Docker
npm run bridge:pm2                  # Start with PM2
npm run bridge:stop                 # Stop Docker services

# Health Check
curl http://localhost:3001/health | jq '.components.reverseBurn'

# Redis Debugging
redis-cli KEYS "reverse-burn:*"     # List all burn events
redis-cli GET "reverse-burn:0x..."  # Get specific event
```

---

## 📋 Module Quick Reference

### `persistence-listener.js` - Burn Event Monitoring

**Purpose**: Detects ibcTFUEL burn events on Persistence chain

**Key Methods**:
- `startListening()`: Connect to WebSocket + start polling
- `handleBurnEvent(eventData)`: Parse and store burn event
- `parseBurnEvent(eventData)`: Extract burner, amount, ibcUSDCYield

**Config**:
- `PERSISTENCE_WS_URL`: WebSocket endpoint
- `PERSISTENCE_POLL_INTERVAL_MS`: Polling backup (default: 10s)

**Logs**:
```javascript
logger.info({ event: 'ReverseBurnDetected', txHash, burner, ibcUSDCYield }, 'Persistence burn event detected');
```

---

### `yield-unwrapper.js` - Yield Processing

**Purpose**: Splits yield (30% unwrap, 70% reinvest) and routes to RevenueSplitter

**Key Methods**:
- `processReverseBurn(event)`: Main processing logic
- `swapIbcUSDCToTFUEL(amount)`: Execute DEX swap
- `routeToRevenueSplitter(tfuelAmount)`: Call RevenueSplitter
- `reinvestYield(amount, beneficiary)`: LP reinvestment (placeholder)

**Config**:
- `YIELD_UNWRAP_PERCENTAGE`: 30 (default)
- `YIELD_REINVEST_PERCENTAGE`: 70 (default)
- `MIN_YIELD_AMOUNT`: 1000000 (1 USDC)
- `REVENUE_SPLITTER_ADDRESS`: Target contract
- `SWAP_ROUTER_ADDRESS`: DEX router

**Flow**:
```javascript
totalYield = 100 USDC
unwrapAmount = 30 USDC → swap to TFUEL → RevenueSplitter
reinvestAmount = 70 USDC → add to LP pools
```

---

### `redis-client.js` - Reverse-Burn Storage

**New Functions**:

```javascript
// Store burn event
await storeReverseBurnEvent({
  txHash: '0xabc...',
  burner: 'persistence1...',
  amount: '1000000000000000000',
  ibcUSDCYield: '5000000',
  blockHeight: 12345
});

// Get pending events
const events = await getReverseBurnEvents();
// Returns: [{ txHash, burner, amount, ibcUSDCYield, ... }]

// Mark as processed
await markReverseBurnProcessed('0xabc...', 'completed');
// Status: completed, failed, below_threshold

// Get statistics
const stats = await getReverseBurnStats();
// Returns: { total, pending, completed, failed, belowThreshold }
```

---

### `config.js` - Configuration

**Reverse-Burn Config Structure**:

```javascript
config.persistence = {
  rpcUrl: 'https://rpc.persistence.one',
  wsUrl: 'wss://rpc.persistence.one/websocket',
  burnEventTopic: 'burn_ibcTFUEL',
  chainId: 'core-1',
  pollInterval: 10000
};

config.yield = {
  unwrapPercentage: 30,
  reinvestPercentage: 70,
  revenueSplitterAddress: '0x...',
  swapRouterAddress: '0x...',
  minYieldAmount: '1000000'
};
```

**Validation**: Ensures unwrapPercentage + reinvestPercentage = 100

---

## 🔄 Data Flow Diagram

```
┌─────────────────────────────────────────┐
│ Persistence Chain                       │
│ - User burns ibcTFUEL                   │
│ - Emits: burn_ibcTFUEL event            │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│ persistence-listener.js                 │
│ - WebSocket: Real-time subscription    │
│ - Polling: Backup scan (10s)            │
│ - Parses: burner, ibcUSDCYield, txHash  │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│ Redis                                   │
│ Key: reverse-burn:{txHash}              │
│ Status: pending → processing → completed│
│ TTL: 7 days (completed), 30 days (audit)│
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│ yield-unwrapper.js                      │
│ - Polls Redis every 10s                 │
│ - Splits yield (30%/70%)                │
│ - Swaps ibcUSDC → TFUEL                 │
│ - Calls RevenueSplitter                 │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│ RevenueSplitter (Theta)                 │
│ - splitRevenueNative{value: TFUEL}     │
│ - Distributes: 50% veXF, 25% buyback,  │
│   15% rXF, 10% treasury                 │
└─────────────────────────────────────────┘
```

---

## 🐛 Common Issues & Fixes

### Issue: Burn events not detected

**Symptoms**: `reverseBurn.stats.total` stays at 0

**Debug**:
```bash
# Check WebSocket connection
curl http://localhost:3001/health | jq '.components.reverseBurn.persistenceListener.wsConnected'

# Check Redis
redis-cli KEYS "reverse-burn:*"

# View logs
docker-compose logs theta-bridge | grep Persistence
```

**Fix**:
```bash
# Verify PERSISTENCE_WS_URL is reachable
wscat -c wss://rpc.persistence.one/websocket

# Restart service
docker-compose restart theta-bridge
```

---

### Issue: Yield not unwrapping

**Symptoms**: Events in Redis but `stats.completed` not increasing

**Debug**:
```bash
# Check unwrapper status
curl http://localhost:3001/health | jq '.components.reverseBurn.yieldUnwrapper'

# Check logs for errors
docker-compose logs theta-bridge | grep -A 5 "Failed to process reverse-burn"
```

**Fix**:
```bash
# Verify SWAP_ROUTER_ADDRESS is valid
# Check relayer balance (needs TFUEL for gas)
curl http://localhost:3001/health | jq '.components.refundManager.relayerBalance'

# If balance low, fund relayer wallet
```

---

### Issue: RevenueSplitter transaction reverts

**Symptoms**: Logs show "RevenueSplitter transaction failed"

**Debug**:
```bash
# Check contract address
echo $REVENUE_SPLITTER_ADDRESS

# Check transaction on Theta explorer
# Look for revert reason
```

**Fix**:
```bash
# Common causes:
# 1. Contract paused → Check with owner
# 2. Amount exceeds maxSwapAmount → Adjust limits
# 3. User hit totalUserLimit → Reset via resetUserSwapTotal()
```

---

## 📊 Monitoring Checklist

**Daily**:
- [ ] Check health endpoint: `curl http://localhost:3001/health`
- [ ] Review logs: `docker-compose logs theta-bridge --tail 100`
- [ ] Verify relayer balance > 1 TFUEL
- [ ] Check reverse-burn stats: `stats.failed` should be ~0

**Weekly**:
- [ ] Review Redis memory usage: `redis-cli INFO memory`
- [ ] Check disk space: `df -h`
- [ ] Analyze success rate: `completed / total`
- [ ] Review error patterns in logs

**Monthly**:
- [ ] Rotate logs
- [ ] Backup Redis data
- [ ] Update dependencies: `npm audit fix`
- [ ] Load test with traffic spike simulation

---

## 🧪 Testing Snippets

### Mock Burn Event (for testing)

```javascript
// Manually trigger burn event processing
import { storeReverseBurnEvent } from './redis-client.js';

await storeReverseBurnEvent({
  txHash: '0xTEST123',
  burner: 'persistence1testaddr',
  amount: '1000000000000000000', // 1 ibcTFUEL
  ibcUSDCYield: '5000000', // 5 USDC
  blockHeight: 12345,
  timestamp: Date.now()
});

// Check processing
redis-cli GET "reverse-burn:0xTEST123"
```

### Manual Swap Test

```javascript
// Test swap without full flow
import { initYieldUnwrapper, getYieldUnwrapper } from './yield-unwrapper.js';

await initYieldUnwrapper();
const unwrapper = getYieldUnwrapper();

const tfuel = await unwrapper.swapIbcUSDCToTFUEL(BigInt(5000000)); // 5 USDC
console.log('Received TFUEL:', tfuel.toString());
```

---

## 🔐 Security Audit Checklist

**Code**:
- [ ] No hardcoded private keys
- [ ] Environment secrets not committed
- [ ] Input validation on all external data
- [ ] Rate limiting on public endpoints
- [ ] Admin endpoints disabled in production

**Infrastructure**:
- [ ] Firewall rules: Only 22 (SSH), 3001 (backend)
- [ ] Redis not exposed publicly
- [ ] HTTPS enabled with valid certificate
- [ ] Relayer wallet funds limited (~10 TFUEL)
- [ ] Backup relayer wallet configured

**Operations**:
- [ ] Monitoring alerts configured
- [ ] Log retention policy set
- [ ] Incident response plan documented
- [ ] Backup/restore tested
- [ ] Disaster recovery plan ready

---

## 📚 Useful Links

- **Persistence Docs**: https://docs.persistence.one/
- **Cosmos SDK Events**: https://docs.cosmos.network/main/core/events
- **Theta RPC**: https://docs.thetatoken.org/docs/theta-rpc-api
- **ethers.js v6**: https://docs.ethers.org/v6/
- **Redis Commands**: https://redis.io/commands/

---

## 💡 Pro Tips

1. **Use `jq` for JSON parsing**:
   ```bash
   curl -s http://localhost:3001/health | jq '.components.reverseBurn.stats'
   ```

2. **Monitor logs in real-time**:
   ```bash
   docker-compose logs -f theta-bridge | grep --line-buffered -E 'ReverseBurn|Yield|Revenue'
   ```

3. **Quick Redis cleanup** (testing only):
   ```bash
   redis-cli KEYS "reverse-burn:*" | xargs redis-cli DEL
   ```

4. **Check event processing rate**:
   ```bash
   # Run twice with 1-minute gap
   curl -s http://localhost:3001/health | jq '.components.reverseBurn.stats.completed'
   # Rate = (second - first) / 60 events/sec
   ```

5. **Test WebSocket manually**:
   ```bash
   wscat -c wss://rpc.persistence.one/websocket
   > {"jsonrpc":"2.0","method":"subscribe","id":"1","params":{"query":"tm.event='Tx'"}}
   ```

---

**Happy coding! 🚀** Refer to `README.md` for detailed documentation.



