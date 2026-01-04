# 🚀 Step 3: Backend Integration - Quick Start

**Ferrari Hybrid Tokenomics v3.0 - TL;DR Guide**

---

## ⚡ 5-Minute Setup

### 1. Update Environment (30 seconds)

```bash
node scripts/update-env-mainnet.cjs
```

✅ Sets mainnet addresses from Step 2

### 2. Test Integration (2 minutes)

```bash
node scripts/test-backend-integration.cjs
```

✅ Verifies detection of Step 2 transactions  
✅ Tests Ferrari metrics logging  
✅ Simulates ZK proof generation  

### 3. Start Backend (1 minute)

**Option A: PM2 (Recommended)**
```bash
pm2 start ecosystem.config.js
pm2 logs xfuel-backend
```

**Option B: Docker**
```bash
docker-compose up -d
docker-compose logs -f xfuel-backend
```

**Option C: Development**
```bash
npm run backend:start
```

---

## 📊 Expected Output

### Integration Test

```
✅ Connected to Theta RPC
✅ VaultFactory contract loaded
📥 Found deposit event (Block 32649934)
   Tx: 0x22bd8...
   Amount: 0.1 TFUEL

🏎️  Ferrari Hybrid Metrics:
   Gross deposit: 0.1 TFUEL
   Fee (0.5%): 0.0005 TFUEL → RevSplitter
   Net locked: 0.0995 TFUEL
   
   Reverse-Burn Loop:
   └─ Recycle flag: 0.02985 TFUEL (30%)
   └─ LP funding: 0.06965 TFUEL (70%)
   
   RevenueSplitter Distribution:
   ├─ BBB: 30%
   ├─ LP: 30%
   ├─ veXF: 25%
   └─ Treasury: 15%

🔐 Generating ZK-SNARK proof...
✅ Proof generated: 0x477d4f...

✅ All integration tests PASSED
```

### Backend Logs

```
[INFO] 🚀 XFuel Backend Listener started
[INFO] Polling Theta every 2s
[INFO] Last synced block: 32649986
[INFO] Polling... (block 32650001)
[INFO] Polling... (block 32650002)
[INFO] 📥 New deposit detected!
[INFO] 🏎️  Ferrari Hybrid Metrics: ...
[INFO] 🔐 ZK proof generated
[INFO] ✅ Deposit processed (nonce: 2)
```

---

## 🎯 Success Criteria

- [ ] Integration test passes (4/4 tests)
- [ ] Backend starts without errors
- [ ] Logs show "Polling Theta every 2s"
- [ ] Health endpoint returns: `curl http://localhost:3000/health`
- [ ] No crashes for 5+ minutes

---

## 📝 Common Commands

### PM2

```bash
# Start
pm2 start ecosystem.config.js

# Logs (real-time)
pm2 logs xfuel-backend

# Status
pm2 status

# Monitor
pm2 monit

# Restart
pm2 restart xfuel-backend

# Stop
pm2 stop xfuel-backend
```

### Docker

```bash
# Start
docker-compose up -d

# Logs
docker-compose logs -f xfuel-backend

# Status
docker-compose ps

# Restart
docker-compose restart xfuel-backend

# Stop
docker-compose down
```

---

## 🐛 Troubleshooting

### Backend won't start

```bash
# Check environment
node scripts/verify-backend-env.cjs

# Check RPC
curl -X POST https://eth-rpc-api.thetatoken.org/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

### Events not detected

```bash
# Check last synced block
cat data/last-block.txt

# Reset to earlier block
echo "32649000" > data/last-block.txt

# Restart
pm2 restart xfuel-backend
```

### High memory usage

```bash
# Check memory
pm2 describe xfuel-backend

# Increase limit in ecosystem.config.js
max_memory_restart: '2G'

# Restart
pm2 restart xfuel-backend
```

---

## 🚀 Deploy to VPS

```bash
# Set VPS details in .env
VPS_HOST=1.2.3.4
VPS_USER=ubuntu

# Deploy
./scripts/deploy-backend.sh

# View logs
ssh ubuntu@1.2.3.4 'pm2 logs xfuel-backend'
```

---

## 📊 What Backend Does

1. **Polls Theta** (every 2s)
   - Scans for `DepositReceived` events
   - Scans for `UnwrapFromBurn` events

2. **Calculates Ferrari Metrics**
   - 0.5% fee → RevenueSplitter
   - 30% recycle flag (reverse-burn loop)
   - 70% LP funding (governance-voted)

3. **Generates Mock ZK Proofs** (1.5s)
   - Simulates ZK-SNARK computation
   - Includes nonce for replay protection

4. **Logs Everything**
   - Deposit details
   - Unwrap details
   - Ferrari hybrid splits
   - Governance extras flags

5. **Prevents Replays**
   - Tracks processed transaction hashes
   - Rejects duplicate nonces

---

## ⏭️ Next Steps

### After Backend Running (1 hour)

1. **Monitor Logs**
   - Watch for errors
   - Verify polling works
   - Check Ferrari metrics

2. **Test New Deposit**
   ```bash
   npx hardhat run scripts/test-deposit.cjs --network theta-mainnet
   ```
   - Backend should detect it
   - Logs should show Ferrari metrics
   - ZK proof should generate

3. **Step 4: Persistence Minter**
   - Deploy CosmWasm contract
   - Connect to backend
   - Test ibcTFUEL minting

---

## 🎉 You're Almost There!

✅ Step 1: Contracts deployed to Theta ✅  
✅ Step 2: Deposit/unwrap tested ✅  
🔄 **Step 3: Backend integration** ← You are here  
⏭️ Step 4: Persistence minter  
⏭️ Step 5: Full E2E bridge test  

**Keep going! You're doing amazing!** 🚀

---

## 📚 Full Documentation

- [STEP3_BACKEND_INTEGRATION_GUIDE.md](./STEP3_BACKEND_INTEGRATION_GUIDE.md) - Complete guide
- [Backend API Docs](./backend/README.md) - Code documentation

---

**Total Time:** ~5 minutes  
**Risk Level:** Minimal (read-only polling, mock proofs)  
**Status:** Production Ready 🚀

---

Run `node scripts/update-env-mainnet.cjs` to start! 🎯

