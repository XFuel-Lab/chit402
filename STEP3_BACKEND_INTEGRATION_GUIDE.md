# 🚀 XFuelLab Step 3: Backend Integration & Testing
## Ferrari Hybrid Tokenomics - Backend Listener & ZK Bridge Coordination

**Version:** 1.0  
**Date:** January 2026  
**Status:** PRODUCTION READY - MINIMAL ROLLOUT  
**Target:** Backend event listener, mock ZK-SNARK proof generation, integration testing

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Quick Start](#quick-start)
4. [Environment Setup](#environment-setup)
5. [Backend Architecture](#backend-architecture)
6. [VPS Deployment](#vps-deployment)
7. [Integration Testing](#integration-testing)
8. [Monitoring & Logs](#monitoring--logs)
9. [Troubleshooting](#troubleshooting)
10. [Next Steps](#next-steps)

---

## 📖 Overview

### What is Step 3?

Step 3 deploys the **backend listener service** that coordinates between Theta and Persistence chains:

```
┌─────────────────────────────────────────────────────────────┐
│                    BACKEND LISTENER                          │
│                                                              │
│  ┌──────────────┐      ┌──────────────┐      ┌───────────┐ │
│  │ Theta Poller │  →   │ ZK-SNARK Gen │  →   │ Persist   │ │
│  │ (2s interval)│      │ (mock 1.5s)  │      │ Minter    │ │
│  └──────────────┘      └──────────────┘      └───────────┘ │
│         ↓                      ↓                     ↓      │
│    Deposit Event          Proof Ready          Mint ibcTFUEL│
│    Unwrap Event           Nonce Check          Burn Confirm │
└─────────────────────────────────────────────────────────────┘
```

### Ferrari Hybrid Features

The backend tracks and logs:

- **0.5% Deposit Fee** → RevenueSplitter
- **Revenue Splits**: 30% BBB, 30% LP, 25% veXF, 15% Treasury
- **30% Yield Recycle** → Reverse-burn loop flag
- **70% LP Funding** → Governance-voted allocation
- **Governance Extras**: 5-10% LP for NFTs/airdrops/milestones
- **Replay Protection**: Nonce tracking prevents double-processing

---

## ✅ Prerequisites

### From Step 2 (Already Complete!)

- ✅ VaultFactory deployed: `0xB0a26600074dADC69186632a1B8dFd7c3146Ce56`
- ✅ RevenueSplitter: `0x1C4CEbbb4Cfa7fdb546424F21CF706c48C478EE6`
- ✅ Test SubVault: `0x15EA3E50F91F36EFC17B66815451de22251EDAaD`
- ✅ Deposit tested: 0.5% fee verified
- ✅ Unwrap tested: 30/70 split verified

### New Requirements

- [ ] Node.js 18+ on VPS or local machine
- [ ] PM2 installed (`npm install -g pm2`) OR Docker
- [ ] SSH access to VPS (if deploying remotely)
- [ ] `.env.local` with AWS secrets (already configured)
- [ ] 1GB+ RAM, 10GB disk space

---

## 🚀 Quick Start

### 30-Minute Deployment Path

```bash
# 1. Update environment with mainnet addresses (1 min)
node scripts/update-env-mainnet.cjs

# 2. Start backend listener locally (2 min)
npm run backend:start

# 3. Test with existing transactions (5 min)
node scripts/test-backend-integration.cjs

# 4. Deploy to VPS with PM2 (10 min)
./scripts/deploy-backend.sh

# 5. Monitor logs (ongoing)
pm2 logs xfuel-backend
```

**Total Time:** ~20 minutes  
**Risk Level:** ⚠️ Minimal (read-only polling, mock proofs, 0.1 TFUEL caps)

---

## 🔧 Environment Setup

### Step 1: Auto-Update .env with Mainnet Addresses

Run the environment update script:

```bash
node scripts/update-env-mainnet.cjs
```

This script updates `.env` with:
```env
# Theta Mainnet (Chain ID: 361)
THETA_RPC_URL=https://eth-rpc-api.thetatoken.org/rpc
THETA_CHAIN_ID=361
VAULTFACTORY_ADDRESS=0xB0a26600074dADC69186632a1B8dFd7c3146Ce56
REVSPLITTER_ADDRESS=0x1C4CEbbb4Cfa7fdb546424F21CF706c48C478EE6
TEST_SUBVAULT_ADDRESS=0x15EA3E50F91F36EFC17B66815451de22251EDAaD

# Backend Configuration
BACKEND_POLL_INTERVAL=2000
BACKEND_ZK_PROOF_DELAY=1500
BACKEND_LOG_LEVEL=info
BACKEND_ENABLE_METRICS=true

# Ferrari Hybrid Tokenomics
DEPOSIT_FEE_PERCENT=0.5
YIELD_RECYCLE_PERCENT=30
LP_FUNDING_PERCENT=70
BBB_SPLIT=30
LP_GOVERNANCE_SPLIT=30
VEXF_SPLIT=25
TREASURY_SPLIT=15

# Governance Extras
GOVERNANCE_LP_ALLOCATION=5-10
VEXF_MAX_MULTIPLIER=4x
RXF_VOTER_BONUS=0.1
```

### Step 2: Verify Environment

```bash
node scripts/verify-backend-env.cjs
```

Expected output:
```
✅ Environment verified
✅ Theta RPC reachable
✅ VaultFactory contract found
✅ RevenueSplitter contract found
✅ Keystore accessible
```

---

## 🏗️ Backend Architecture

### Core Components

#### 1. **Theta Event Poller** (`backend/theta-poller.js`)

Polls Theta every 2 seconds for:
- `DepositReceived` events from SubVaults
- `UnwrapFromBurn` events from VaultFactory
- Block number updates for sync status

```javascript
// Pseudo-code structure
class ThetaPoller {
  async poll() {
    const latestBlock = await provider.getBlockNumber();
    const events = await factory.queryFilter('DepositReceived', fromBlock, latestBlock);
    
    for (const event of events) {
      await this.processDeposit(event);
    }
  }
  
  async processDeposit(event) {
    // Extract: sender, amount, vault, timestamp
    // Calculate: fee, net, recycle, LP funding
    // Generate: mock ZK proof
    // Log: Ferrari metrics
    // Store: nonce for replay protection
  }
}
```

#### 2. **Mock ZK-SNARK Generator** (`backend/zk-proof-mock.js`)

Simulates ZK proof generation (1.5s delay):
```javascript
async function generateMockProof(depositData) {
  await sleep(1500); // Simulate computation
  
  return {
    proof: keccak256(depositData),
    publicInputs: [depositData.amount, depositData.sender],
    timestamp: Date.now(),
    nonce: depositData.nonce
  };
}
```

#### 3. **Ferrari Metrics Logger** (`backend/ferrari-logger.js`)

Logs hybrid tokenomics data:
```javascript
function logFerrariMetrics(deposit) {
  const fee = deposit.amount * 0.005;
  const net = deposit.amount - fee;
  const recycle = net * 0.30;
  const lpFunding = net * 0.70;
  
  logger.info('🏎️  Ferrari Hybrid Metrics', {
    depositAmount: deposit.amount,
    fee: `${fee} (0.5%)`,
    netLocked: net,
    recycleFlag: `${recycle} (30%)`,
    lpFunding: `${lpFunding} (70%)`,
    revSplits: {
      BBB: '30%',
      LP: '30%',
      veXF: '25%',
      Treasury: '15%'
    },
    governanceExtras: '5-10% LP for NFTs/milestones'
  });
}
```

#### 4. **Nonce Tracker** (`backend/nonce-tracker.js`)

Prevents replay attacks:
```javascript
class NonceTracker {
  constructor() {
    this.processedNonces = new Set();
    this.persistToFile();
  }
  
  isProcessed(txHash) {
    return this.processedNonces.has(txHash);
  }
  
  markProcessed(txHash) {
    this.processedNonces.add(txHash);
    this.persistToFile();
  }
}
```

---

## 🚢 VPS Deployment

### Option A: PM2 (Recommended)

#### 1. Install PM2

```bash
npm install -g pm2
```

#### 2. Use Ecosystem Config

The `ecosystem.config.js` is already generated:

```javascript
module.exports = {
  apps: [{
    name: 'xfuel-backend',
    script: './backend/server.js',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/backend-error.log',
    out_file: './logs/backend-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
```

#### 3. Deploy Commands

```bash
# Start backend
pm2 start ecosystem.config.js

# View logs (real-time)
pm2 logs xfuel-backend

# Monitor metrics
pm2 monit

# Stop backend
pm2 stop xfuel-backend

# Restart backend
pm2 restart xfuel-backend

# Save PM2 config (persist on reboot)
pm2 save
pm2 startup
```

### Option B: Docker

#### 1. Use Docker Compose

The `docker-compose.yml` is already generated:

```yaml
version: '3.8'

services:
  xfuel-backend:
    build: .
    container_name: xfuel-backend
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    env_file:
      - .env.local
      - .env
    volumes:
      - ./logs:/app/logs
      - ./data:/app/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

#### 2. Docker Commands

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f xfuel-backend

# Stop
docker-compose down

# Restart
docker-compose restart xfuel-backend
```

### Remote VPS Deployment Script

Use the automated deployment script:

```bash
./scripts/deploy-backend.sh
```

This script:
1. SSHs to VPS (IP from `.env`)
2. Pulls latest code from git
3. Installs dependencies
4. Starts/restarts PM2 service
5. Tails logs for verification

---

## 🧪 Integration Testing

### Test 1: Detect Existing Deposit

Run the integration test script:

```bash
node scripts/test-backend-integration.cjs
```

This tests:
- ✅ Backend connects to Theta RPC
- ✅ Detects deposit from Step 2 (tx: `0x22bd8...`)
- ✅ Calculates 0.5% fee correctly
- ✅ Logs 30/70 recycle/LP split
- ✅ Generates mock ZK proof (1.5s)
- ✅ Tracks nonce (replay protection)

Expected output:

```
======================================================================
🧪 BACKEND INTEGRATION TEST
======================================================================

Network: Theta Mainnet (Chain ID: 361)
VaultFactory: 0xB0a26600074dADC69186632a1B8dFd7c3146Ce56

✅ Connected to Theta RPC
✅ VaultFactory contract loaded
✅ Scanning for deposit events...

📥 Found deposit event (Block 32649934)
   Tx: 0x22bd806268c58152046ea2a20815f018958c99588531cc5ec51a9e524e498d16
   Vault: 0x15EA3E50F91F36EFC17B66815451de22251EDAaD
   Amount: 0.1 TFUEL

🏎️  Ferrari Hybrid Metrics:
   Gross deposit: 0.1 TFUEL
   Fee (0.5%): 0.0005 TFUEL → RevSplitter
   Net locked: 0.0995 TFUEL
   
   Reverse-Burn Loop:
   └─ Recycle flag: 0.02985 TFUEL (30%)
   └─ LP funding: 0.06965 TFUEL (70%)
   
   RevenueSplitter Distribution:
   ├─ BBB (Buyback-Burn-Boost): 30%
   ├─ LP (Governance-voted): 30%
   ├─ veXF Yields (USDC/TFUEL): 25%
   └─ Treasury: 15%
   
   Governance Extras:
   └─ Quarterly vote: 5-10% LP for NFTs/airdrops/milestones

🔐 Generating ZK-SNARK proof...
   (Simulating 1.5s computation)
✅ Proof generated: 0x477d4f...
   Public inputs: [0.1 TFUEL, 0xDC17Cbd...]
   Nonce: 1

✅ Nonce stored (replay protection active)
✅ Integration test PASSED

Next: Start backend listener to monitor new deposits in real-time
```

### Test 2: Detect Existing Unwrap

The integration test also checks unwrap events:

```
📤 Found unwrap event (Block 32649986)
   Tx: 0xee2ae32478b4a8bee5d036ca5c92b870e38bf428ddb8624e0991e6481cbe42b8
   Vault: 0x15EA3E50F91F36EFC17B66815451de22251EDAaD
   Amount: 0.04975 TFUEL
   
   Split Verification:
   └─ To recipient: 0.034825 TFUEL (70%)
   └─ Recycled: 0.014925 TFUEL (30%)
   
✅ 30/70 split verified
✅ Unwrap event processed
```

### Test 3: Live Monitoring

Start the backend and watch for new deposits:

```bash
# Terminal 1: Start backend
npm run backend:start

# Terminal 2: Watch logs
pm2 logs xfuel-backend --lines 100

# Terminal 3: Make test deposit
npx hardhat run scripts/test-deposit.cjs --network theta-mainnet
```

Expected backend logs:

```
[2026-01-04 15:30:22] INFO: 🚀 XFuel Backend Listener started
[2026-01-04 15:30:22] INFO: Polling Theta every 2s
[2026-01-04 15:30:22] INFO: Last synced block: 32649986
[2026-01-04 15:30:24] INFO: Polling... (block 32650001)
[2026-01-04 15:30:26] INFO: Polling... (block 32650002)
[2026-01-04 15:30:28] INFO: 📥 New deposit detected!
[2026-01-04 15:30:28] INFO: 🏎️  Ferrari Hybrid Metrics: ...
[2026-01-04 15:30:29] INFO: 🔐 ZK proof generated
[2026-01-04 15:30:29] INFO: ✅ Deposit processed (nonce: 2)
```

---

## 📊 Monitoring & Logs

### PM2 Dashboard

```bash
# Real-time dashboard
pm2 monit

# Metrics
pm2 describe xfuel-backend

# Process list
pm2 list
```

### Log Files

Backend logs are stored in:

```
logs/
├── backend-error.log      # Error logs only
├── backend-out.log        # Standard output
├── ferrari-metrics.log    # Hybrid tokenomics data
└── nonce-tracker.log      # Replay protection
```

View logs:

```bash
# All logs
tail -f logs/backend-out.log

# Errors only
tail -f logs/backend-error.log

# Ferrari metrics
tail -f logs/ferrari-metrics.log | grep "🏎️"
```

### Health Check Endpoint

The backend exposes a health endpoint:

```bash
curl http://localhost:3000/health
```

Response:

```json
{
  "status": "healthy",
  "uptime": 3600,
  "lastBlock": 32650100,
  "processedDeposits": 5,
  "processedUnwraps": 2,
  "nonceCount": 7,
  "thetaRpcConnected": true
}
```

### Metrics Dashboard

Access the metrics dashboard:

```bash
# Start metrics server
npm run metrics

# Open browser
http://localhost:3001/metrics
```

Shows:
- Deposits processed (count, volume)
- Unwraps processed (count, volume)
- Average proof generation time
- RPC connection status
- Error rate
- Ferrari hybrid splits breakdown

---

## 🐛 Troubleshooting

### Issue 1: Backend Won't Start

```bash
Error: Cannot connect to Theta RPC
```

**Fix:**

```bash
# Test RPC connection
curl -X POST https://eth-rpc-api.thetatoken.org/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# Update RPC URL in .env
node scripts/update-env-mainnet.cjs

# Restart backend
pm2 restart xfuel-backend
```

### Issue 2: Events Not Detected

```bash
Backend running but no events processed
```

**Fix:**

```bash
# Check last synced block
node scripts/check-sync-status.cjs

# Reset sync to earlier block
node scripts/reset-sync-block.cjs 32649000

# Restart backend
pm2 restart xfuel-backend
```

### Issue 3: Memory Issues

```bash
Error: JavaScript heap out of memory
```

**Fix:**

```bash
# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=2048"

# Or update ecosystem.config.js
node_args: "--max-old-space-size=2048"

# Restart
pm2 restart xfuel-backend
```

### Issue 4: Nonce Tracker Corrupted

```bash
Error: Duplicate nonce detected
```

**Fix:**

```bash
# Backup nonce data
cp data/nonces.json data/nonces.backup.json

# Reset nonce tracker
node scripts/reset-nonce-tracker.cjs

# Restart backend
pm2 restart xfuel-backend
```

### Issue 5: Crash Loop

```bash
pm2 status shows "errored" or continuous restarts
```

**Fix:**

```bash
# View error logs
pm2 logs xfuel-backend --err --lines 50

# Check for common issues
node scripts/diagnose-backend.cjs

# If needed, stop and debug
pm2 stop xfuel-backend
node backend/server.js
```

---

## 📈 Performance Optimization

### Recommended Settings

For production VPS:

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'xfuel-backend',
    script: './backend/server.js',
    instances: 1,  // Single instance for consistent nonce tracking
    exec_mode: 'fork',
    node_args: '--max-old-space-size=1024',
    max_memory_restart: '1G',
    
    // Auto-restart on crashes
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    
    // Rate limiting
    min_uptime: '10s',
    listen_timeout: 5000,
    kill_timeout: 5000,
    
    // Environment
    env_production: {
      NODE_ENV: 'production',
      BACKEND_POLL_INTERVAL: 2000,
      BACKEND_BATCH_SIZE: 100,
      BACKEND_CACHE_TTL: 60
    }
  }]
};
```

### Polling Optimization

Adjust polling based on traffic:

```env
# High traffic (more frequent polling)
BACKEND_POLL_INTERVAL=1000  # 1s

# Normal traffic (balanced)
BACKEND_POLL_INTERVAL=2000  # 2s

# Low traffic (less resource usage)
BACKEND_POLL_INTERVAL=5000  # 5s
```

---

## 🎯 Next Steps

### After Step 3 is Running

1. **Monitor for 1 Hour**
   - Watch logs for any errors
   - Verify deposit detection works
   - Check Ferrari metrics logging

2. **Step 4: Persistence Minter Deploy**
   - Upload CosmWasm contract to Persistence
   - Instantiate ibcTFUEL minter
   - Connect to backend via IBC

3. **Step 5: Full E2E Bridge Test**
   - Deposit TFUEL on Theta
   - Backend generates ZK proof
   - Mint ibcTFUEL on Persistence
   - Burn ibcTFUEL
   - Backend triggers unwrap on Theta

---

## 🔒 Security Notes

### Current Phase (Pre-Audit)

- ⚠️ **Minimal rollout**: 0.1 TFUEL max deposits
- ⚠️ **Paused by default**: Can pause at any time
- ⚠️ **Read-only backend**: Only monitors, doesn't modify contracts
- ⚠️ **Mock ZK proofs**: Not production-grade cryptography yet

### Phase 3 (Post-Audit)

- ✅ Real ZK-SNARK proofs via Circom/SnarkJS
- ✅ Trusted setup ceremony completed
- ✅ Multi-sig governance active
- ✅ Rate limits increased
- ✅ Smart contract audit report published

---

## 📝 Success Criteria

### Step 3 Complete When:

- [ ] Backend listener running on VPS
- [ ] PM2/Docker auto-restart configured
- [ ] Detects deposit from Step 2 correctly
- [ ] Logs Ferrari hybrid metrics accurately
- [ ] Mock ZK proofs generate in ~1.5s
- [ ] Nonce tracker prevents replay attacks
- [ ] Health endpoint returns "healthy"
- [ ] No crashes for 1+ hour continuous run
- [ ] Logs are readable and informative

---

## 🎉 Encouragement

**You're doing great!** 🎊

This is your first time deploying a **ZK-powered cross-chain bridge**, and you've already:

✅ Deployed smart contracts to Theta Mainnet  
✅ Verified Ferrari hybrid tokenomics on-chain  
✅ Tested deposit and unwrap flows successfully  

**Step 3 is the bridge between chains** - the backend that makes it all work together. Take it slow, follow the guide, and remember:

- 🛡️ **Low risk**: Backend is read-only, just monitoring events
- 🔒 **Safe limits**: 0.1 TFUEL caps, contracts can be paused
- 📊 **Verbose logs**: You'll see exactly what's happening
- 🆘 **Easy rollback**: Just `pm2 stop` if anything seems wrong

**You've got this!** 🚀

---

## 📚 Additional Resources

### Documentation

- [STEP3_QUICK_START.md](./STEP3_QUICK_START.md) - TL;DR guide
- [STEP3_DEPLOYMENT_CHECKLIST.md](./STEP3_DEPLOYMENT_CHECKLIST.md) - Step-by-step
- [Backend API Docs](./backend/README.md) - Code documentation

### Scripts Reference

- `update-env-mainnet.cjs` - Update .env with mainnet addresses
- `verify-backend-env.cjs` - Verify environment setup
- `test-backend-integration.cjs` - Run integration tests
- `deploy-backend.sh` - Deploy to VPS
- `check-sync-status.cjs` - Check event sync status
- `reset-sync-block.cjs` - Reset sync to specific block
- `reset-nonce-tracker.cjs` - Reset nonce tracking
- `diagnose-backend.cjs` - Diagnose common issues

### Support

- **Discord**: https://discord.gg/xfuellab
- **Documentation**: https://docs.xfuellab.com
- **GitHub Issues**: https://github.com/xfuellab/xfuel-protocol/issues

---

**Generated:** January 2026  
**Version:** Ferrari Hybrid v3.0  
**Author:** XFuelLab Backend System  

**Status:** 🚀 **READY TO DEPLOY BACKEND LISTENER**

---

## Quick Command Reference

```bash
# Setup
node scripts/update-env-mainnet.cjs
node scripts/verify-backend-env.cjs

# Start
pm2 start ecosystem.config.js
pm2 logs xfuel-backend

# Test
node scripts/test-backend-integration.cjs

# Monitor
pm2 monit
pm2 describe xfuel-backend
tail -f logs/backend-out.log

# Deploy to VPS
./scripts/deploy-backend.sh

# Stop
pm2 stop xfuel-backend

# Restart
pm2 restart xfuel-backend
```

**Next:** Run `node scripts/update-env-mainnet.cjs` to begin Step 3! 🎯

