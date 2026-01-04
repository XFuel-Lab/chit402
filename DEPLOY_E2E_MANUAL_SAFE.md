# 🚀 E2E Testing Deployment - Manual (Safe Wallet + MetaMask)

## 🔑 Your Wallet Setup

### Deployer Wallet (Safe via MetaMask)
- **Address:** `0xEb4f292E2f1E5Ff1d3B1aEe6E02794b5fc40e698`
- **Type:** Safe (Gnosis Safe) wallet
- **Signing:** Via MetaMask (no private keys in config)
- **Used for:** Deploying VaultFactory contract

### Relayer Wallet (Theta Native)
- **Address:** `0xDC17Cbd201E7347555e428690f702bbFcAF2d33c`
- **Private Key:** In root `.env` as `RELAYER_PRIVATE_KEY`
- **Used for:** Backend refund transactions

---

## 📁 .env File Locations

### Root `.env` (c:\Users\seeha\xfuel-protocol\.env)
```env
# Relayer wallet private key (already configured)
RELAYER_PRIVATE_KEY=0xYourRelayerKeyHere

# No deployer private key needed - using Safe + MetaMask
```

### Backend `.env` (c:\Users\seeha\xfuel-protocol\backend\theta-bridge\.env)
```env
# Will configure after deployment
VAULT_FACTORY_ADDRESS=0x...ToBeFilled
RELAYER_PRIVATE_KEY=0x...CopyFromRootEnv
THETA_RPC_URLS=https://eth-rpc-api.thetatoken.org/rpc
REDIS_URL=redis://localhost:6379
```

---

## 🚀 Manual Deployment Steps

### Step 1: Install Redis

Choose one option:

**Option A: winget (easiest)**
```powershell
winget install Redis.Redis.RedisInsight
```

**Option B: Manual download**
1. Download: https://github.com/redis-windows/redis-windows/releases
2. Extract to `C:\Redis`
3. Run `C:\Redis\redis-server.exe`

**Option C: Memurai**
- Download: https://www.memurai.com/get-memurai

**Test Redis:**
```powershell
redis-cli ping
# Should return: PONG
```

---

### Step 2: Deploy VaultFactory via Safe + MetaMask

Since you're using a Safe wallet, deployment requires manual steps:

#### 2.1: Prepare MetaMask

1. **Open MetaMask**
2. **Switch to Theta Mainnet**
   - Network Name: Theta Mainnet
   - RPC URL: https://eth-rpc-api.thetatoken.org/rpc
   - Chain ID: 361
   - Currency Symbol: TFUEL

3. **Connect to your Safe wallet**
   - Address: `0xEb4f292E2f1E5Ff1d3B1aEe6E02794b5fc40e698`

#### 2.2: Deploy Contract

**Method 1: Using Remix (Recommended for Safe)**

1. **Open Remix:** https://remix.ethereum.org

2. **Upload VaultFactory contract:**
   - File: `contracts/VaultFactory.sol`
   - Also upload `contracts/SubVault.sol` (dependency)

3. **Compile:**
   - Compiler: 0.8.22
   - Optimization: 200 runs

4. **Deploy:**
   - Environment: "Injected Provider - MetaMask"
   - Account: `0xEb4f...e698` (should show your Safe)
   - Contract: `VaultFactory`
   - Constructor args:
     - `_adminAddress`: `0xEb4f292E2f1E5Ff1d3B1aEe6E02794b5fc40e698` (your Safe)
     - `_revSplitter`: `0x03973A67449557b14228541Df339Ae041567628B`
   - Click "Deploy"
   - **Approve in MetaMask** (will create Safe transaction)
   - **Confirm in Safe UI** (https://app.safe.global)

5. **Copy deployed address**
   - Example: `0x1234567890abcdef1234567890abcdef12345678`

**Method 2: Using Hardhat with Manual Signing**

Unfortunately, Hardhat doesn't natively support Safe wallets. You'll need to:
- Deploy from a regular wallet first
- Then transfer ownership to Safe
- Or use Remix (Method 1 above)

---

### Step 3: Configure Backend

#### 3.1: Copy Relayer Key from Root .env

```powershell
# View root .env (don't commit this file!)
notepad .env

# Copy the RELAYER_PRIVATE_KEY value
```

#### 3.2: Create Backend .env

```powershell
cd backend\theta-bridge

# Copy example if .env doesn't exist
if (!(Test-Path .env)) { Copy-Item env.example .env }

# Edit .env
notepad .env
```

#### 3.3: Update Backend .env

Replace these values:

```env
# === REQUIRED ===

# VaultFactory address from Step 2
VAULT_FACTORY_ADDRESS=0xYourDeployedVaultFactoryAddress

# Relayer wallet private key (copy from root .env)
RELAYER_PRIVATE_KEY=0xYourRelayerPrivateKeyHere

# Theta Mainnet RPC
THETA_RPC_URLS=https://eth-rpc-api.thetatoken.org/rpc,https://theta-eth-rpc.thetatoken.org/rpc

# Redis
REDIS_URL=redis://localhost:6379

# === OPTIONAL (defaults are fine) ===
PORT=3001
LOG_LEVEL=info
NODE_ENV=production
EXPIRY_MINUTES=30
REQUIRED_CONFIRMATIONS=3
```

Save and close.

---

### Step 4: Install Backend Dependencies

```powershell
cd backend\theta-bridge
npm install
```

---

### Step 5: Start Services

#### Terminal 1: Redis
```powershell
redis-server
```

Should show:
```
[PID] Server initialized
[PID] Ready to accept connections
```

#### Terminal 2: Backend Service
```powershell
cd backend\theta-bridge
npm run dev
```

Should show:
```
INFO: Theta-Persistence ZK Bridge service starting
INFO: Multi-RPC provider initialized with 2 endpoints
INFO: Redis initialized successfully
INFO: Listening for deposits on contract: 0x...
INFO: Service ready to process deposits on port 3001
```

#### Terminal 3: Frontend (for testing)
```powershell
# In project root
npm run dev
```

Should show:
```
VITE v5.x.x ready in xxx ms
➜  Local:   http://localhost:3000/
```

---

### Step 6: Health Checks

```powershell
# Check Redis
redis-cli ping
# Expected: PONG

# Check Backend
curl http://localhost:3001/health
# Expected: {"status":"ok","service":"theta-persistence-bridge",...}

# Check Frontend
curl http://localhost:3000
# Expected: HTML response
```

---

### Step 7: Run E2E Tests

#### Option 1: Interactive Cypress
```powershell
# In project root
npm run cypress:open
```

Select test file: `zk-bridge-e2e.cy.ts`

#### Option 2: Headless Tests
```powershell
.\run-e2e-tests.ps1 -Headless
```

#### Option 3: Backend Unit Test
```powershell
cd backend\theta-bridge

# Set environment variables
$env:VAULT_FACTORY_ADDRESS = "0xYourDeployedAddress"
$env:THETA_RPC_URL = "https://eth-rpc-api.thetatoken.org/rpc"
$env:TEST_PRIVATE_KEY = (Get-Content ..\..\..\.env | Select-String "RELAYER_PRIVATE_KEY" | ForEach-Object { $_.ToString().Split('=')[1] })

# Run test
node test-e2e-quick.js
```

---

## ✅ Verification Checklist

After deployment, verify everything:

### Services Running
- [ ] Redis: `redis-cli ping` → PONG
- [ ] Backend: `curl localhost:3001/health` → 200 OK
- [ ] Frontend: `curl localhost:3000` → 200 OK

### Configuration
- [ ] VaultFactory deployed and address saved
- [ ] Backend `.env` has correct VaultFactory address
- [ ] Backend `.env` has relayer private key
- [ ] Backend connecting to mainnet RPC

### Tests
- [ ] Backend health endpoint responding
- [ ] Cypress tests can connect to backend
- [ ] No errors in backend logs

---

## 📊 Expected Deployment Summary

After successful deployment, you should have:

```
═══════════════════════════════════════════════════════════════════
✅ DEPLOYMENT COMPLETE
═══════════════════════════════════════════════════════════════════

Network:        Theta Mainnet (361)
Deployer:       0xEb4f292E2f1E5Ff1d3B1aEe6E02794b5fc40e698 (Safe)
Relayer:        0xDC17Cbd201E7347555e428690f702bbFcAF2d33c

Contracts:
  VaultFactory:     0x...YourDeployedAddress
  RevenueSplitter:  0x03973A67449557b14228541Df339Ae041567628B

Services:
  Backend:   http://localhost:3001  ✅
  Frontend:  http://localhost:3000  ✅
  Redis:     localhost:6379         ✅

═══════════════════════════════════════════════════════════════════
```

---

## 🧪 Testing Workflow

### 1. Backend Unit Tests
```powershell
cd backend\theta-bridge
node test-e2e-quick.js
```

### 2. Frontend E2E Tests
```powershell
# Interactive
.\run-e2e-tests.ps1

# Specific suite
.\run-e2e-tests.ps1 -Suite backend

# Headless
.\run-e2e-tests.ps1 -Headless
```

### 3. Visual Testing with Memarai
```powershell
# Capture baseline
.\run-e2e-tests.ps1 -Suite visual -Headless

# Upload to Memarai
memarai upload cypress/screenshots
```

---

## 🔧 Troubleshooting

### MetaMask Not Connecting to Safe

1. Go to https://app.safe.global
2. Connect your Safe wallet
3. In Safe UI, go to Apps → WalletConnect
4. Or use Remix with injected provider

### Deployment Failed - Out of Gas

Safe wallets require more gas. In Remix:
- Increase gas limit to 3,000,000
- Gas price: 4000 Gwei (Theta requirement)

### Backend Can't Connect to Contract

Check backend `.env`:
```env
# Must be mainnet RPC
THETA_RPC_URLS=https://eth-rpc-api.thetatoken.org/rpc

# Must be deployed VaultFactory address
VAULT_FACTORY_ADDRESS=0x...
```

Restart backend:
```powershell
# In backend terminal, press Ctrl+C
npm run dev
```

### Redis Connection Failed

```powershell
# Check if running
redis-cli ping

# If not, start it
redis-server

# Check port not in use
netstat -ano | findstr :6379
```

---

## 🔒 Security Notes

### Safe Wallet (Deployer)
- ✅ No private keys exposed
- ✅ All transactions require Safe UI confirmation
- ✅ Multi-sig ready (when you add more signers)
- ✅ Can pause/unpause VaultFactory as admin

### Relayer Wallet
- ⚠️ Private key in `.env` (git-ignored)
- ⚠️ Keep this wallet funded (~50 TFUEL)
- ⚠️ Used only for automated refunds
- ✅ Limited permissions (can't pause/admin functions)

### Best Practices
- Never commit `.env` files
- Keep relayer wallet separate from main funds
- Monitor relayer balance
- Use Safe UI for all admin functions

---

## 📚 Next Steps

1. **Deploy VaultFactory via Remix + Safe**
2. **Configure backend with deployed address**
3. **Start all services**
4. **Run E2E tests**
5. **Monitor logs and test results**
6. **Set up Memarai for visual testing**

---

## 🆘 Need Help?

- **Safe Wallet UI:** https://app.safe.global
- **Remix IDE:** https://remix.ethereum.org
- **Theta Network:** https://docs.thetatoken.org
- **Backend Logs:** Check Terminal 2
- **Full Guide:** `E2E_TESTING_DEPLOYMENT_GUIDE.md`

---

**Ready?** Start with Step 1 (Install Redis) and follow each step! 🚀

**Deployer:** `0xEb4f292E2f1E5Ff1d3B1aEe6E02794b5fc40e698` (Safe)  
**Relayer:** `0xDC17Cbd201E7347555e428690f702bbFcAF2d33c` (Backend)

