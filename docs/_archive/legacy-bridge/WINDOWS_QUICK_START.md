> **⚠️ ARCHIVED / LEGACY (as of 2026-07-17).** This document describes the retired
> `backend/theta-bridge` stack and is kept for historical reference only. It does
> **not** reflect the current system. The gateway now lives at `services/gateway/`
> and runs live at `https://api-testnet.xfuel.app`. For the authoritative
> as-deployed state, see [`docs/RUNTIME_STATE.md`](../../RUNTIME_STATE.md) and
> [`services/gateway/README.md`](../../../services/gateway/README.md).

# 🚀 Quick Start Guide (Windows, No Docker)

## ✅ What You Have

- ✅ Node.js installed (v24.11.1)
- ✅ Backend code ready
- ✅ Dependencies installed

## ⏳ What You Need

### 1. Install Redis (5 minutes)

**Option A: Using winget (Easiest)**
```powershell
winget install Redis.Redis.RedisInsight
```

**Option B: Download Binary**
1. Download: https://github.com/redis-windows/redis-windows/releases
2. Extract to `C:\Redis`
3. Run: `C:\Redis\redis-server.exe`

**Option C: Use Memurai (Redis for Windows)**
- Download: https://www.memurai.com/get-memurai
- Install and start service

**Test Redis:**
```powershell
redis-cli ping
# Should return: PONG
```

### 2. Deploy VaultFactory Contract (2 minutes)

```powershell
# In project root
cd C:\Users\seeha\xfuel-protocol

# Set RevenueSplitter address (from Phase 1)
$env:REV_SPLITTER_ADDRESS="0x03973A67449557b14228541Df339Ae041567628B"

# Deploy to Theta Mainnet
npx hardhat run scripts/deploy-vault-factory.cjs --network theta-mainnet
```

**Copy the deployed address** from output:
```
✅ VaultFactory deployed to: 0x...
```

### 3. Configure Backend (1 minute)

```powershell
cd C:\Users\seeha\xfuel-protocol\backend\theta-bridge

# Edit .env file
notepad .env
```

**Update these values:**
```env
# Paste your deployed VaultFactory address
VAULT_FACTORY_ADDRESS=0xYourDeployedAddress

# Add your relayer wallet private key (for refunds)
RELAYER_PRIVATE_KEY=0xYourPrivateKey

# Mainnet RPC
THETA_RPC_URLS=https://eth-rpc-api.thetatoken.org/rpc,https://theta-eth-rpc.thetatoken.org/rpc

# Redis
REDIS_URL=redis://localhost:6379
```

Save and close.

### 4. Start Everything (30 seconds)

**Terminal 1 - Redis:**
```powershell
redis-server
```

**Terminal 2 - Bridge Service:**
```powershell
cd C:\Users\seeha\xfuel-protocol\backend\theta-bridge
npm run dev
```

You should see:
```
INFO: Theta-Persistence ZK Bridge service starting
INFO: Multi-RPC provider initialized
INFO: Redis initialized successfully
INFO: Service ready to process deposits
```

### 5. Test It! (1 minute)

**Terminal 3 - Health Check:**
```powershell
curl http://localhost:3001/health
```

**Terminal 3 - E2E Test:**
```powershell
cd C:\Users\seeha\xfuel-protocol\backend\theta-bridge

# Set test variables
$env:VAULT_FACTORY_ADDRESS="0xYourDeployedAddress"
$env:THETA_RPC_URL="https://eth-rpc-api.thetatoken.org/rpc"
$env:TEST_PRIVATE_KEY="0xYourTestWalletKey"

# Run test
node test-e2e-quick.js
```

## 🎯 Alternative: Test Locally First

Don't want to deploy to mainnet yet? Test locally!

**Terminal 1 - Local Blockchain:**
```powershell
cd C:\Users\seeha\xfuel-protocol
npx hardhat node
```

**Terminal 2 - Deploy Locally:**
```powershell
$env:REV_SPLITTER_ADDRESS="0x5FbDB2315678afecb367f032d93F642f64180aa3"
npx hardhat run scripts/deploy-vault-factory.cjs --network localhost
```

**Terminal 3 - Redis:**
```powershell
redis-server
```

**Terminal 4 - Configure Backend for Local:**
```powershell
cd backend\theta-bridge
notepad .env

# Change to:
# THETA_RPC_URLS=http://localhost:8545
# VAULT_FACTORY_ADDRESS=0xLocalDeployedAddress
# RELAYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

npm run dev
```

**Terminal 5 - Test:**
```powershell
$env:VAULT_FACTORY_ADDRESS="0xLocalAddress"
$env:THETA_RPC_URL="http://localhost:8545"
node test-e2e-quick.js
```

## 🔧 Automated Setup

Run the setup script:
```powershell
cd C:\Users\seeha\xfuel-protocol\backend\theta-bridge
.\setup.bat
```

This will:
- ✅ Check Node.js
- ✅ Install dependencies
- ✅ Check for Redis
- ✅ Create/validate .env
- ✅ Guide you through setup

## ❌ If Redis Install Fails

You can run without Redis for testing (limited functionality):

```powershell
.\quick-start-no-redis.bat
```

**Note:** Without Redis:
- ❌ Cannot store vault mappings
- ❌ Cannot track deposit status
- ❌ Refunds won't work
- ✅ Can still test event detection
- ✅ Can still test ZK proof generation

## 🐛 Troubleshooting

### Redis won't start
```powershell
# Check if port 6379 is in use
netstat -ano | findstr :6379

# Kill process if needed
taskkill /PID <PID> /F

# Try again
redis-server
```

### Backend won't start
```powershell
# Check .env is configured
type .env | findstr VAULT_FACTORY

# Check Redis is running
redis-cli ping

# Check logs
npm run dev
```

### Hardhat deployment fails
```powershell
# Check you have THETA_MAINNET_PRIVATE_KEY in root .env
cd C:\Users\seeha\xfuel-protocol
type .env | findstr THETA_MAINNET

# Check wallet has TFUEL
# Add to .env if missing
```

## ✅ Success Checklist

- [ ] Redis installed and running (`redis-cli ping`)
- [ ] VaultFactory deployed (have address)
- [ ] Backend .env configured
- [ ] Backend starts without errors
- [ ] Health check returns 200 (`curl localhost:3001/health`)
- [ ] Test script runs successfully

## 🚀 You're Ready!

Once all checkboxes above are checked, your bridge is running and ready to process deposits!

**Monitor it:**
- Logs: Check Terminal 2 (npm run dev)
- Health: `curl http://localhost:3001/health`
- Redis: `redis-cli KEYS vault:*`

**Next:** See `E2E_TESTING_GUIDE.md` for comprehensive testing scenarios.

