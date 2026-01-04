# 🚀 Step 5: E2E Bridge Test - Quick Start

**Ferrari Hybrid Tokenomics v3.0 - Complete Round Trip**

---

## ⚡ 10-Minute E2E Test

### Prerequisites ✅

- Steps 1-4 complete
- Backend running (`pm2 status xfuel-backend`)
- Test wallets funded (1 TFUEL, 0.5 XPRT)
- Both explorers open in browser

### Complete Flow

```bash
# 1. Deposit on Theta (2 min)
npx hardhat run scripts/test-deposit.cjs --network theta-mainnet

# 2. Monitor backend (realtime)
pm2 logs xfuel-backend

# Expected:
# 📥 Deposit detected
# 🔐 ZK proof generated (1.5s)
# ✅ Proof ready

# 3. Check Persistence balance (1 min)
persistenceCore query wasm contract-state smart $MINTER_ADDR \
  '{"balance":{"address":"'$WALLET'"}}'

# Expected: 0.0995 ibcTFUEL minted ✅

# 4. Burn on Persistence (2 min)
persistenceCore tx wasm execute $MINTER_ADDR \
  '{"burn":{"amount":"50000000000000000","theta_recipient":"0xYOUR_ADDR"}}' \
  --from xfuel-personal --gas auto --chain-id core-1 --yes

# 5. Monitor backend (realtime)
pm2 logs xfuel-backend

# Expected:
# 🔥 Burn detected
# 🏎️ 70/30 split calculated
# ✅ Unwrap triggered

# 6. Check Theta balance (1 min)
node -e "
const ethers = require('ethers');
const provider = new ethers.JsonRpcProvider('https://eth-rpc-api.thetatoken.org/rpc');
provider.getBalance('YOUR_ADDRESS')
  .then(b => console.log('Balance:', ethers.formatEther(b), 'TFUEL'));
"

# Expected: +0.035 TFUEL received ✅
```

---

## 📊 Success Criteria

✅ Deposit detected within 2 seconds  
✅ Proof generated within 1.5 seconds  
✅ Mint completes within 60 seconds  
✅ 1:1 peg maintained  
✅ Burn detected within 5 seconds  
✅ Unwrap completes within 30 seconds  
✅ 70% to user, 30% recycled  
✅ All Ferrari metrics logged  

---

## 🎯 Quick Verification

```bash
# Run automated verification
node scripts/verify-e2e-complete.cjs

# Expected output:
# ✅ Deposit: 0.1 TFUEL
# ✅ Fee: 0.0005 TFUEL (0.5%)
# ✅ Minted: 0.0995 ibcTFUEL (1:1 peg)
# ✅ Burned: 0.05 ibcTFUEL
# ✅ Unwrapped: 0.035 TFUEL (70%)
# ✅ Recycled: 0.015 TFUEL (30%)
# ✅ Ferrari metrics: All logged
# ✅ E2E TEST: PASSED
```

---

## 🔍 Monitor Peg

```bash
# Check peg ratio
node scripts/check-peg-ratio.cjs

# Expected:
# Locked on Theta: 0.0495 TFUEL
# Minted on Persistence: 0.0495 ibcTFUEL
# Ratio: 1.0000 (perfect peg) ✅
```

---

## 🐛 Common Issues

### "Mint not completing"
```bash
# Check TX status
persistenceCore query tx {TX_HASH}

# Increase gas if needed
--gas 500000 --gas-adjustment 1.5
```

### "Unwrap not triggered"
```bash
# Check backend logs
pm2 logs xfuel-backend --err

# Manually trigger if needed
node scripts/manual-unwrap.cjs --burn-tx {TX_HASH}
```

### "Peg drift detected"
```bash
# Calculate exact peg
node scripts/calculate-peg.cjs

# If >1% off, pause bridge
./scripts/emergency-pause.sh
```

---

## 📈 Performance Metrics

Expected timings:
- Deposit detection: < 2 seconds
- Proof generation: ~1.5 seconds
- Mint transaction: < 60 seconds
- Burn detection: < 5 seconds
- Unwrap execution: < 30 seconds
- **Total round-trip: ~2-3 minutes**

---

## 🎉 Success!

When E2E test passes:

✅ You have a **working ZK bridge**!  
✅ **Ferrari tokenomics** operational!  
✅ **Cross-chain** coordination proven!  
✅ **Production ready** system!  

**Congratulations! 🎊🚀**

---

**Total Time:** 10 minutes  
**Total Cost:** ~0.1 TFUEL + ~0.01 XPRT  
**Risk:** Minimal (test amounts)  

---

See [STEP5_E2E_BRIDGE_TEST_GUIDE.md](./STEP5_E2E_BRIDGE_TEST_GUIDE.md) for full documentation.

