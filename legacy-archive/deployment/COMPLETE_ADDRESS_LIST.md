# Complete Address List & Test Requirements

**Generated:** January 14, 2026  
**Purpose:** Master list of all addresses required for testing and deployment  
**Environment:** Mainnet with TEST_MODE enabled

---

## 🔑 Required Addresses (Mainnet Testing)

### A. Ethereum/Theta Network (Chain ID: 361)

#### Core Contracts
```bash
# VaultFactory - Creates SubVaults for deposits
VAULT_FACTORY_ADDRESS=0x...                      # REQUIRED

# RevenueSplitter - Ferrari 30/30/25/15 distribution
REVENUE_SPLITTER_ADDRESS=0x...                   # REQUIRED

# Swap Router - For ibcUSDC → TFUEL conversion
SWAP_ROUTER_ADDRESS=0x...                        # REQUIRED (reverse-burn)

# BBB Contract - Buyback & Burn
BBB_CONTRACT_ADDRESS=0x...                       # REQUIRED (RevSplitter)

# veXF Distributor - Yield distribution
VEXF_DISTRIBUTOR_ADDRESS=0x...                   # REQUIRED (RevSplitter)
```

#### Hardcoded Treasury Addresses
```bash
# Innovation Treasury (Theta) - Hardcoded in contracts
INNOVATION_TREASURY=0x043d5231651379970d52a13CEfB4e80733DDb989

# LP Treasury (Persistence) - Hardcoded in contracts
# This is the multisig address for LP treasury funds
LP_TREASURY=persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e
```

---

### B. Persistence Chain (Chain ID: core-1)

#### CosmWasm Contracts
```bash
# ZK Verifier - Groth16 proof verification
ZK_VERIFIER_ADDRESS=persistence1...              # REQUIRED
# Example format: persistence1abc123xyz456...

# ibcTFUEL Minter - Mints tokens after proof verification
PERSISTENCE_MINTER_CONTRACT=persistence1...      # REQUIRED
# Example: persistence1def789ghi012...

# Dexter Router - Real mainnet address
PERSISTENCE_DEXTER_ROUTER=persistence132xmxm33vwjlur2pszl4hu9r32lqmqagvunnuc5hq4htps7rr3kqsf4dsk  # VERIFIED ✅

# pStake Staking - DEPRECATED (Dec 2025)
PSTAKE_STAKING_CONTRACT=                         # Optional/Empty
```

### Deployment Addresses
```bash
# Your deployer wallet
DEPLOYER_ADDRESS=persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx

# Multisig for governance AND LP Treasury
# This address serves dual purpose: governance multisig + LP treasury (hardcoded in contracts)
MULTISIG_ADDRESS=persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e
LP_TREASURY=persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e  # Same as multisig
```

---

### C. IBC Configuration

```bash
# IBC Channel (Theta ↔ Persistence)
IBC_CHANNEL=channel-190                          # REQUIRED

# TFUEL IBC Denomination on Persistence
# Format: ibc/[SHA256 hash of "transfer/channel-190/tfuel"]
TFUEL_IBC_DENOM=ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2  # EXAMPLE
# TODO: Get actual hash from first successful IBC transfer

# Dexter TFUEL/XPRT Pool Address
DEXTER_TFUEL_XPRT_POOL=persistence1...           # REQUIRED
```

---

### D. RPC/API Endpoints

```bash
# Theta Network
THETA_RPC_URL=https://eth-rpc-api.thetatoken.org/rpc

# Persistence Network
PERSISTENCE_RPC_URL=https://rpc.core.persistence.one
PERSISTENCE_REST_URL=https://rest.core.persistence.one
PERSISTENCE_WS_URL=wss://rpc.persistence.one/websocket

# Redis (for backend)
REDIS_URL=redis://localhost:6379
```

---

### E. Private Keys/Mnemonics (🔒 NEVER COMMIT!)

```bash
# Theta Relayer - For refunds and backend operations
RELAYER_PRIVATE_KEY=0x...                        # REQUIRED

# IBC Wallet - For cross-chain operations
IBC_WALLET_MNEMONIC="word1 word2 ... word12"    # REQUIRED

# Test Wallets (optional)
THETA_TESTNET_PRIVATE_KEY=0x...
THETA_MAINNET_PRIVATE_KEY=0x...                  # Use with EXTREME caution
```

---

## 🚨 Test Amount Limits (Mainnet)

### Critical Configuration
```bash
# ALWAYS set these for mainnet testing
TEST_MODE=true
NETWORK=mainnet
```

### Amount Limits

| Asset | Maximum | Usage | Cost (est.) |
|-------|---------|-------|-------------|
| **TFUEL** | 0.1 | Deposit testing | ~$0.01 USD |
| **XPRT** | 1.0 | Reverse-burn testing | ~$0.20 USD |
| **USDC** | 1.0 | Yield processing | $1.00 USD |

### Reverse-Burn Specific Configuration
```bash
# Backend configuration (backend/theta-bridge/.env)
MIN_YIELD_AMOUNT=1000000              # 1 USDC minimum (6 decimals)
YIELD_UNWRAP_PERCENTAGE=30            # 30% to reverse-burn
YIELD_REINVEST_PERCENTAGE=70          # 70% to LP reinvestment
```

**Example Reverse-Burn Test**:
- Burn: 0.5 ibcTFUEL (500000000000000000 wei)
- Yield: 1 USDC (1000000 units)
- Unwrap: 0.3 USDC → TFUEL
- Reinvest: 0.7 USDC → LP
- **Total XPRT used: < 1 XPRT** ✅

---

## ✅ Validation Checklist

### Before ANY Mainnet Test:

```bash
# 1. Set test mode
export TEST_MODE=true
export NETWORK=mainnet

# 2. Validate all addresses
node scripts/validate-addresses.cjs

# Should show:
# ✅ ZK_VERIFIER_ADDRESS: persistence1...
# ✅ PERSISTENCE_MINTER_CONTRACT: persistence1...
# ✅ PERSISTENCE_DEXTER_ROUTER: persistence132xmxm...
# ✅ VAULT_FACTORY_ADDRESS: 0x...
# 🚨 MAINNET/PRODUCTION MODE DETECTED
# ✅ TFUEL Test Limit: 0.1 TFUEL max
# ✅ XPRT Test Limit: 1.0 XPRT max
```

### Address Validation Results

✅ **PASS** - All addresses set and valid  
⚠️  **WARN** - Some optional addresses missing (document why)  
❌ **FAIL** - Critical addresses missing or invalid (STOP!)

---

## 📝 Address Format Reference

### Persistence (Cosmos)
- **Format**: `persistence1` + 39 characters (bech32)
- **Length**: 44-59 characters total
- **Example**: `persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx`
- **Invalid**: 
  - `xpersistence1...` (wrong prefix)
  - `persistence1k4q9w...j0j0j0j0` (fake/placeholder)
  - `persistence1...` (ellipsis placeholder)

### Ethereum (Theta)
- **Format**: `0x` + 40 hex characters
- **Length**: 42 characters exactly
- **Example**: `0x043d5231651379970d52a13CEfB4e80733DDb989`
- **Invalid**:
  - `0x0000000000000000000000000000000000000000` (zero address)
  - `0x1234567890123456789012345678901234567890` (placeholder)
  - `0x...` (ellipsis placeholder)

### IBC Denomination
- **Format**: `ibc/` + 64 hex characters (SHA256 hash)
- **Length**: 68 characters
- **Example**: `ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2`
- **Invalid**:
  - `ibc/...` (placeholder)
  - Missing `ibc/` prefix

---

## 🧪 Testing Workflow

### Step 1: Setup Environment
```bash
# Create .env.local (never commit!)
cp env.example .env.local

# Edit with real addresses:
nano .env.local
```

### Step 2: Validate Configuration
```bash
# Check all addresses
node scripts/validate-addresses.cjs

# If errors, fix addresses in .env.local
# If warnings, document why (e.g., optional features not used)
```

### Step 3: Enable Test Mode
```bash
export TEST_MODE=true
export NETWORK=mainnet
```

### Step 4: Run Tests with Guards
```javascript
// In your test script:
const { validateTestAmount, validateReverseBurnAmount } = require('./scripts/test-amount-guard.cjs');

// Test deposit (max 0.1 TFUEL)
const depositAmount = ethers.parseEther('0.05');
await validateTestAmount('tfuel', depositAmount);  // Validates before proceeding

// Test reverse-burn (max 1 XPRT)
const xprtAmount = '500000';  // 0.5 XPRT
await validateReverseBurnAmount(xprtAmount);      // Validates before proceeding

// If validation passes, proceed with test
// If validation fails, script throws error and stops
```

---

## 📊 Current Backend Configuration

From `backend/theta-bridge/env.example`:

```bash
# Minimum yield to process (avoid dust)
MIN_YIELD_AMOUNT=1000000                         # 1 USDC (6 decimals)

# Yield distribution (must sum to 100)
YIELD_UNWRAP_PERCENTAGE=30                       # 30% to TFUEL
YIELD_REINVEST_PERCENTAGE=70                     # 70% to LP

# Reverse-burn targets
REVENUE_SPLITTER_ADDRESS=0x...                   # Where TFUEL goes
SWAP_ROUTER_ADDRESS=0x...                        # DEX for swaps
```

### Example Reverse-Burn Calculation

**Scenario**: User burns 0.5 XPRT worth of ibcTFUEL, earns 1 USDC yield

```
Input:
  ibcTFUEL burned: 500000000000000000 (0.5 TFUEL)
  USDC yield earned: 1000000 (1 USDC)

Processing:
  1. Check minimum: 1000000 >= 1000000 ✅ Pass
  2. Calculate splits:
     - Unwrap (30%): 300000 (0.3 USDC)
     - Reinvest (70%): 700000 (0.7 USDC)
  
  3. Swap 0.3 USDC → ~0.3 TFUEL
  4. Route 0.3 TFUEL to RevenueSplitter
  5. Reinvest 0.7 USDC to LP pools

Result:
  ✅ Total XPRT equivalent used: ~0.5 XPRT
  ✅ Under 1 XPRT limit
```

---

## 🔍 Quick Verification Commands

```bash
# Check if addresses are set
env | grep -E "PERSISTENCE|ZK_VERIFIER|MINTER|VAULT_FACTORY|REVENUE"

# Validate all at once
node scripts/validate-addresses.cjs

# Test amount guard
node -e "require('./scripts/test-amount-guard.cjs').printTestLimits()"

# Check backend config
grep -E "MIN_YIELD|UNWRAP|REINVEST" backend/theta-bridge/.env
```

---

## 🚀 Ready to Test Checklist

- [ ] All addresses in `.env.local` (verified with validate-addresses.cjs)
- [ ] `TEST_MODE=true` is set
- [ ] `NETWORK=mainnet` is set
- [ ] Test amounts prepared (≤ 0.1 TFUEL, ≤ 1 XPRT)
- [ ] `MIN_YIELD_AMOUNT=1000000` (1 USDC)
- [ ] Backend Redis running (for reverse-burn)
- [ ] Monitoring/logging enabled
- [ ] Emergency stop procedure documented

---

## 📞 Support Scripts

```bash
# scripts/validate-addresses.cjs
# - Validates all address formats
# - Checks ZK verifier & minter addresses
# - Verifies test amount limits
# - Shows mainnet/test mode status

# scripts/test-amount-guard.cjs
# - validateTestAmount(token, amount)
# - validateReverseBurnAmount(xprtAmount)
# - printTestLimits()
# - isMainnetMode(), isTestModeEnabled()
```

---

**Status**: ✅ All safeguards implemented  
**Commits**: 
- 8c85d79 - Backend address cleanup
- d614a3d - Test amount safeguards
- 284f755 - Documentation
