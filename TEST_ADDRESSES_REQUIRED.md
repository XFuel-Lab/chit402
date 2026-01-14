# Test Amount Requirements

This document lists all required addresses and test amount limits for running tests safely on mainnet.

## 📋 Required Addresses for Testing

### Ethereum/Theta Addresses
```bash
# Deployment & Testing
VAULT_FACTORY_ADDRESS=0x...           # Required
REVENUE_SPLITTER_ADDRESS=0x...        # Required
SWAP_ROUTER_ADDRESS=0x...             # Optional (reverse-burn)
BBB_CONTRACT_ADDRESS=0x...            # Optional (RevSplitter)
VEXF_DISTRIBUTOR_ADDRESS=0x...        # Optional (RevSplitter)

# Private Keys (NEVER commit!)
RELAYER_PRIVATE_KEY=0x...             # Required for backend
THETA_TESTNET_PRIVATE_KEY=0x...       # For testnet
THETA_MAINNET_PRIVATE_KEY=0x...       # For mainnet (use with extreme caution)
```

### Persistence/Cosmos Addresses
```bash
# Contract Addresses
PERSISTENCE_MINTER_CONTRACT=persistence1...      # Required - ibcTFUEL minter
ZK_VERIFIER_ADDRESS=persistence1...              # Required - ZK proof verifier
PERSISTENCE_DEXTER_ROUTER=persistence132x...     # Required - Real mainnet address

# IBC Configuration
TFUEL_IBC_DENOM=ibc/27394FB092D2ECCD...         # Required - Real IBC denom hash
IBC_CHANNEL=channel-190                           # Required
PSTAKE_STAKING_CONTRACT=                         # Optional (deprecated)

# Wallet (NEVER commit!)
IBC_WALLET_MNEMONIC="your twelve words..."       # Required for IBC operations
```

### Multisig & Governance
```bash
# Production Addresses
DEPLOYER_ADDRESS=persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx
MULTISIG_ADDRESS=persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e
LP_TREASURY=persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj  # Hardcoded in contracts
```

---

## 🚨 Test Amount Limits (Mainnet)

### CRITICAL: Enable Test Mode
Always set `TEST_MODE=true` when running tests on mainnet:
```bash
export TEST_MODE=true
export NETWORK=mainnet
```

### Maximum Test Amounts

| Asset | Limit | Purpose | Rationale |
|-------|-------|---------|-----------|
| **TFUEL** | 0.1 TFUEL | Deposit testing | ~$0.01 at current prices |
| **XPRT** | 1 XPRT | Reverse-burn testing | ~$0.20 at current prices |
| **USDC** | 1 USDC | Yield processing | Minimal loss if failed |

### Configuration
```bash
# Backend Theta Bridge
MIN_YIELD_AMOUNT=1000000              # 1 USDC (6 decimals)
YIELD_UNWRAP_PERCENTAGE=30            # 30% to reverse-burn
YIELD_REINVEST_PERCENTAGE=70          # 70% to LP reinvestment

# Test Mode
TEST_MODE=true                        # Enable test amount limits
NETWORK=mainnet                       # Network identifier
```

---

## 🧪 Test Scenarios & Amounts

### 1. Deposit Test (Theta → Persistence)
```javascript
// Max: 0.1 TFUEL
const { validateTestAmount } = require('./scripts/test-amount-guard.cjs');

const depositAmount = ethers.parseEther('0.05');  // 0.05 TFUEL
await validateTestAmount('tfuel', depositAmount);  // Throws if > 0.1

await user.sendTransaction({
  to: vaultAddress,
  value: depositAmount
});
```

### 2. Reverse-Burn Test (Persistence → Theta)
```javascript
// Max: 1 XPRT
const { validateReverseBurnAmount } = require('./scripts/test-amount-guard.cjs');

const xprtAmount = '500000';  // 0.5 XPRT (uxprt has 6 decimals)
await validateReverseBurnAmount(xprtAmount);  // Throws if > 1 XPRT

// Simulate burn event
await redis.set(`reverse-burn:test`, JSON.stringify({
  burner: "persistence1test",
  amount: "500000000000000000",  // 0.5 ibcTFUEL
  ibcUSDCYield: xprtAmount,
  txHash: "test123"
}));
```

### 3. Yield Processing Test
```javascript
// Max: 1 USDC yield
const yieldAmount = '1000000';  // 1 USDC (6 decimals)

// This gets split: 30% unwrap (0.3 USDC), 70% reinvest (0.7 USDC)
// Total TFUEL routed to RevSplitter: ~0.3 USDC worth
```

---

## ✅ Validation Script Usage

### Run Validation
```bash
# Check all addresses and test limits
node scripts/validate-addresses.cjs

# Expected output:
# ✅ PERSISTENCE_DEXTER_ROUTER: persistence132xmxm...
# ✅ ZK_VERIFIER_ADDRESS: persistence1...
# ✅ PERSISTENCE_MINTER_CONTRACT: persistence1...
# 🚨 MAINNET/PRODUCTION MODE DETECTED
# ✅ TFUEL Test Limit: 0.1 TFUEL max
# ✅ XPRT Test Limit: 1.0 XPRT max
```

### Import Guards in Scripts
```javascript
// At top of deployment/test script:
const { validateTestAmount, printTestLimits } = require('./scripts/test-amount-guard.cjs');

// Before any mainnet operation:
printTestLimits();

// Before each test deposit:
await validateTestAmount('tfuel', depositAmount);  // Throws if exceeds 0.1 TFUEL
```

---

## 🔒 Security Checklist

### Before Running Mainnet Tests

- [ ] `TEST_MODE=true` is set
- [ ] All addresses validated via `node scripts/validate-addresses.cjs`
- [ ] Test amounts verified (≤ 0.1 TFUEL, ≤ 1 XPRT)
- [ ] Using test wallet (not production funds)
- [ ] Backend monitoring active
- [ ] Able to cancel/refund if needed

### Environment File Check
```bash
# Verify .env.local has correct addresses
grep -E "PERSISTENCE|ZK_VERIFIER|MINTER" .env.local

# Should show real addresses, not placeholders
# ❌ BAD: persistence1k4q9wtawxxk6v2x5v4t9q8r3j9w3j9j0j0j0j0
# ✅ GOOD: persistence132xmxm33vwjlur2pszl4hu9r32lqmqagvunnuc5hq4htps7rr3kqsf4dsk
```

---

## 📝 Example Test Run

```bash
# 1. Set environment
export TEST_MODE=true
export NETWORK=mainnet

# 2. Validate addresses
node scripts/validate-addresses.cjs

# 3. Run test with amount validation
node scripts/test-deposit.cjs --amount 0.05  # Safe (< 0.1)
# ❌ node scripts/test-deposit.cjs --amount 0.2  # Would fail validation

# 4. Check reverse-burn with XPRT limit
node scripts/test-reverse-burn.cjs --xprt 0.5  # Safe (< 1)
# ❌ node scripts/test-reverse-burn.cjs --xprt 2  # Would fail validation
```

---

## 🚨 What Happens if Limits Exceeded?

If you try to exceed test limits with `TEST_MODE=true`:

```
🚨 MAINNET TEST LIMIT EXCEEDED!
   Token: TFUEL
   Requested: 0.5
   Maximum: 0.1
   
   For mainnet testing, please use amounts below the limit.
   To disable this check, set TEST_MODE=false

Error: Test amount exceeds mainnet limit
    at validateTestAmount (scripts/test-amount-guard.cjs:78:13)
```

**The transaction will NOT execute.**

---

## 📞 Troubleshooting

### Issue: "ZK_VERIFIER_ADDRESS not set"
**Solution:** Add to `.env.local`:
```bash
ZK_VERIFIER_ADDRESS=persistence1<your_deployed_verifier_address>
```

### Issue: "PERSISTENCE_MINTER_CONTRACT not set"
**Solution:** Deploy CosmWasm contracts first, then add address to `.env.local`

### Issue: "Test amount exceeds limit"
**Solution:** Reduce amount to ≤ 0.1 TFUEL or ≤ 1 XPRT, or disable with `TEST_MODE=false` (not recommended)

### Issue: "Invalid IBC denom format"
**Solution:** Get real IBC denom hash from Persistence chain:
```bash
# Query IBC denom for TFUEL
persistenceCore query ibc-transfer denom-trace <hash>
```

---

**Last Updated:** January 14, 2026  
**Status:** ✅ Production-ready with safeguards
