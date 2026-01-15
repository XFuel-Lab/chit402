# Test Safeguards Summary

## ✅ What Was Implemented

### 1. ZK Address Validation
- **Added to**: `scripts/validate-addresses.cjs`
- **Validates**: 
  - `ZK_VERIFIER_ADDRESS` (Persistence address format)
  - `PERSISTENCE_MINTER_CONTRACT` (moved to ZK section)
- **Error if**: Missing, invalid format, or placeholder

### 2. Test Amount Limits (Mainnet)
- **Module**: `scripts/test-amount-guard.cjs`
- **Limits**:
  - TFUEL deposits: **0.1 TFUEL max**
  - XPRT operations: **1 XPRT max** (for reverse-burn)
  - USDC yield: **1 USDC max**

### 3. Test Mode Flag
- **Enable with**: `export TEST_MODE=true`
- **Enforces**: Amount limits only when on mainnet
- **Auto-detects**: Mainnet via `NETWORK`, `NODE_ENV`, `HARDHAT_NETWORK`

---

## 🚨 Your Concerns Addressed

### ✅ "Validate ZK addresses"
**Status**: DONE

```bash
# Validates ZK verifier and minter addresses
node scripts/validate-addresses.cjs

# Output includes:
# ✅ ZK_VERIFIER_ADDRESS: persistence1...
# ✅ PERSISTENCE_MINTER_CONTRACT: persistence1...
```

### ✅ "Ensure deployment tests don't exceed 0.1 TFUEL"
**Status**: DONE

```javascript
// In any test/deployment script:
const { validateTestAmount } = require('./scripts/test-amount-guard.cjs');

const depositAmount = ethers.parseEther('0.05');  // 0.05 TFUEL
await validateTestAmount('tfuel', depositAmount);  // ✅ Passes

const largeAmount = ethers.parseEther('0.2');     // 0.2 TFUEL
await validateTestAmount('tfuel', largeAmount);   // ❌ Throws error!
```

**Error message**:
```
🚨 MAINNET TEST LIMIT EXCEEDED!
   Token: TFUEL
   Requested: 0.2
   Maximum: 0.1
```

### ✅ "Limit reverse-burn tests to 1 XPRT"
**Status**: DONE

```javascript
// Specific function for reverse-burn testing
const { validateReverseBurnAmount } = require('./scripts/test-amount-guard.cjs');

const xprtAmount = '500000';  // 0.5 XPRT (uxprt)
await validateReverseBurnAmount(xprtAmount);  // ✅ Passes

const largeXprt = '2000000';  // 2 XPRT
await validateReverseBurnAmount(largeXprt);   // ❌ Throws error!
```

**Error message**:
```
🚨 REVERSE-BURN TEST LIMIT EXCEEDED!
   Requested: 2.000000 XPRT
   Maximum: 1.000000 XPRT
   
   Reverse-burn testing on mainnet is limited to 1 XPRT.
```

---

## 📋 Current Reverse-Burn Configuration

From `backend/theta-bridge/src/yield-unwrapper.js`:

```javascript
// Line 147-155: Minimum threshold check
const totalYield = BigInt(event.ibcUSDCYield);

if (totalYield < BigInt(config.yield.minYieldAmount)) {
  logger.info('Yield amount below minimum threshold, skipping');
  return;
}

// Default: MIN_YIELD_AMOUNT=1000000 (1 USDC)
```

**Current settings**:
- `MIN_YIELD_AMOUNT=1000000` (1 USDC)
- `YIELD_UNWRAP_PERCENTAGE=30` (30% to reverse-burn)
- `YIELD_REINVEST_PERCENTAGE=70` (70% to LP)

**Example reverse-burn test**:
- User burns 0.5 XPRT worth of ibcTFUEL
- Yield earned: 1 USDC
- Unwrap to TFUEL: 0.3 USDC (30%)
- Reinvest for LP: 0.7 USDC (70%)
- **Total XPRT used: < 1 XPRT** ✅

---

## 🧪 How to Use in Tests

### Step 1: Enable Test Mode
```bash
# In your .env.local or shell:
export TEST_MODE=true
export NETWORK=mainnet
```

### Step 2: Validate Before Running
```bash
# Check all addresses and see test limits:
node scripts/validate-addresses.cjs

# Expected output includes:
# 🚨 MAINNET/PRODUCTION MODE DETECTED
# ✅ TFUEL Test Limit: 0.1 TFUEL max
# ✅ XPRT Test Limit: 1.0 XPRT max
# ✅ MIN_YIELD_AMOUNT: 1 USDC (safe for testing)
```

### Step 3: Use in Scripts
```javascript
// Example: test-deposit.cjs
const { ethers } = require('ethers');
const { validateTestAmount, printTestLimits } = require('./test-amount-guard.cjs');

async function testDeposit() {
  // Show limits
  printTestLimits();
  
  // Safe amount
  const depositAmount = ethers.parseEther('0.05');
  
  // Validate (throws if exceeds 0.1 TFUEL)
  await validateTestAmount('tfuel', depositAmount);
  
  // Proceed with test
  await user.sendTransaction({
    to: vaultAddress,
    value: depositAmount
  });
  
  console.log('✅ Test deposit successful');
}
```

### Step 4: Example Reverse-Burn Test
```javascript
// Example: test-reverse-burn.cjs
const { validateReverseBurnAmount } = require('./test-amount-guard.cjs');

async function testReverseBurn() {
  // 0.5 XPRT in uxprt (6 decimals)
  const xprtAmount = '500000';
  
  // Validate (throws if > 1 XPRT)
  await validateReverseBurnAmount(xprtAmount);
  
  // Simulate burn event
  await redis.set('reverse-burn:test', JSON.stringify({
    burner: "persistence1test",
    amount: "500000000000000000",  // 0.5 ibcTFUEL
    ibcUSDCYield: xprtAmount,
    txHash: "test123"
  }));
  
  console.log('✅ Reverse-burn test triggered');
}
```

---

## 📊 Files Created/Modified

### Created Files
1. **scripts/test-amount-guard.cjs** (166 lines)
   - `validateTestAmount()` - Validate any test amount
   - `validateReverseBurnAmount()` - Specific for XPRT
   - `printTestLimits()` - Display current limits
   - `isMainnetMode()` - Detect production

2. **TEST_ADDRESSES_REQUIRED.md** (242 lines)
   - Complete list of required addresses
   - Test amount limits documentation
   - Example usage patterns
   - Troubleshooting guide

### Modified Files
3. **scripts/validate-addresses.cjs** (+57 lines)
   - Added ZK address validation section
   - Added test amount safeguards section
   - Moved minter validation to ZK section
   - Added mainnet mode detection

---

## 🔒 Safety Features

### Auto-Detection
- Detects mainnet via: `NETWORK`, `THETA_NETWORK`, `NODE_ENV`, `HARDHAT_NETWORK`
- Only enforces limits when mainnet + `TEST_MODE=true`
- Skips validation on testnet/dev automatically

### Error Handling
- **Throws error** if limit exceeded (prevents transaction)
- **Clear messages** showing requested vs maximum
- **Formatted amounts** (e.g., "0.5 TFUEL" not "500000000000000000")

### Bypass Option
```bash
# To disable limits (not recommended):
export TEST_MODE=false

# Or don't set it at all (defaults to false)
```

---

## ✅ Verification Checklist

Before running mainnet tests:

- [ ] `TEST_MODE=true` is set
- [ ] Run `node scripts/validate-addresses.cjs` - all pass
- [ ] ZK_VERIFIER_ADDRESS is set and valid
- [ ] PERSISTENCE_MINTER_CONTRACT is set and valid
- [ ] Test amounts ≤ 0.1 TFUEL
- [ ] Reverse-burn amounts ≤ 1 XPRT
- [ ] MIN_YIELD_AMOUNT = 1000000 (1 USDC)
- [ ] Using test wallet (not production funds)

---

## 📞 Quick Reference

```bash
# Validate everything
node scripts/validate-addresses.cjs

# In JavaScript
const { 
  validateTestAmount,           // General validation
  validateReverseBurnAmount,    // XPRT-specific
  printTestLimits,              // Show limits
  isMainnetMode                 // Check mode
} = require('./scripts/test-amount-guard.cjs');

# Limits
TFUEL: 0.1 max
XPRT:  1.0 max
USDC:  1.0 max
```

---

**Status**: ✅ All safeguards implemented and tested  
**Commit**: d614a3d - feat: Add test amount safeguards and ZK address validation  
**Date**: January 14, 2026
