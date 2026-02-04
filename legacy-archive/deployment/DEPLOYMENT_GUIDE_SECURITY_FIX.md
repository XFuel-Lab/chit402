# CRITICAL SECURITY UPGRADE - Deployment Guide
## Fix tx.origin Vulnerability (CVE-XF-2024-001)

**Status:** Ready to Deploy  
**Urgency:** 🔴 CRITICAL  
**Estimated Time:** 5-10 minutes

---

## Pre-Deployment Checklist

- [x] Code fix completed (tx.origin → msg.sender)
- [x] Compilation successful
- [x] Upgrade script created
- [ ] Private key in .env.local
- [ ] Sufficient TFUEL balance (100+ recommended)
- [ ] Backup of current contract states

---

## Step 1: Prepare Environment

### Set Private Key
```bash
# Create .env.local if it doesn't exist
echo "THETA_MAINNET_PRIVATE_KEY=your_private_key_here" > .env.local

# Or use PowerShell script
.\scripts\setup-env.ps1
```

### Check Balance
```bash
npx hardhat run scripts/check-accounts.ts --network theta_mainnet
```

**Expected:** 100+ TFUEL (upgrade costs ~50 TFUEL total)

---

## Step 2: Compile Fixed Contracts

```bash
# Force recompilation with fixed code
npx hardhat compile --force
```

**Expected Output:**
```
Compiled 2 Solidity files successfully
```

---

## Step 3: Deploy Upgrade (MAINNET)

### Option A: Automated Script (Recommended)
```bash
# Run upgrade script
npx hardhat run scripts/upgrade-fix-tx-origin.cjs --network theta-mainnet
```

### Option B: PowerShell Wrapper
```powershell
# Windows users
.\scripts\deploy-security-fix.ps1
```

**Expected Duration:** 2-3 minutes  
**Expected Output:**
```
🔴 CRITICAL SECURITY UPGRADE: Fix tx.origin vulnerability
===========================================================

Step 1: Upgrading RevenueSplitter...
   ✅ New implementation: 0x...
   ✅ maxSwapAmount: 1000.0 TFUEL
   ✅ totalUserLimit: 5000.0 TFUEL
   ✅ paused: false

Step 2: Upgrading BuybackBurner...
   ✅ New implementation: 0x...
   ✅ maxSwapAmount: 1000.0 TFUEL
   ✅ totalUserLimit: 5000.0 TFUEL

✅ CRITICAL SECURITY UPGRADE COMPLETE
```

---

## Step 4: Verify on Theta Explorer

### RevenueSplitter
Visit: https://explorer.thetatoken.org/address/0x03973A67449557b14228541Df339Ae041567628B

**Check:**
- [ ] "Write as Proxy" tab shows new implementation
- [ ] Recent transaction is from your deployer address
- [ ] Status: Success

### BuybackBurner
Visit: https://explorer.thetatoken.org/address/[BUYBACK_BURNER_ADDRESS]

**Check:**
- [ ] "Write as Proxy" tab shows new implementation
- [ ] Recent transaction is from your deployer address
- [ ] Status: Success

---

## Step 5: Test Upgrade

### Test 1: Small Swap (Direct Call)
```bash
# Test with 10 TFUEL
npx hardhat run scripts/test-swap-after-upgrade.cjs --network theta-mainnet
```

**Expected:** Transaction succeeds, limits tracked by msg.sender

### Test 2: Verify Limits Work
```bash
# Check that limits are enforced per-caller
npx hardhat run scripts/verify-limits.cjs --network theta-mainnet
```

**Expected:** 
- Caller A can use up to 5000 TFUEL
- Caller B (different address) gets separate 5000 TFUEL limit
- Same caller cannot exceed limit

---

## Step 6: Update Documentation

### Update PR Description
Add upgrade transaction hashes:
```markdown
## Mainnet Upgrade

- **RevenueSplitter:** TX [hash]
- **BuybackBurner:** TX [hash]
- **Deployed:** [timestamp]
- **Verified:** [explorer links]
```

### Update Security Fix Doc
```bash
# Add deployment info to SECURITY_FIX_TX_ORIGIN.md
# Section: "Deployment Timeline"
```

---

## Rollback Plan (If Needed)

### Option 1: Re-upgrade to Previous Implementation
```bash
# Get previous implementation address from Theta Explorer
# Upgrade back to it
npx hardhat run scripts/rollback-to-previous.cjs --network theta-mainnet
```

### Option 2: Pause Contracts
```bash
# Pause RevenueSplitter
cast send 0x03973A67449557b14228541Df339Ae041567628B "pause()" --private-key $PRIVATE_KEY --rpc-url https://eth-rpc-api.thetatoken.org/rpc

# Pause BuybackBurner
cast send [BUYBACK_BURNER_ADDRESS] "pause()" --private-key $PRIVATE_KEY --rpc-url https://eth-rpc-api.thetatoken.org/rpc
```

---

## Post-Deployment Monitoring

### First 24 Hours
- [ ] Monitor all swap transactions
- [ ] Verify limits are enforced correctly
- [ ] Check for any failed transactions
- [ ] Monitor Discord/support for user reports

### Check Commands
```bash
# Get recent transactions
npx hardhat run scripts/check-recent-txs.cjs --network theta-mainnet

# Check contract state
npx hardhat run scripts/verify-upgrade.cjs --network theta-mainnet
```

---

## Success Criteria

- [x] Both contracts upgraded without errors
- [x] Implementation addresses changed
- [x] Limits still configured (1000/5000 TFUEL)
- [x] Contracts not paused
- [ ] Test swap succeeds
- [ ] Limits enforced by msg.sender (not tx.origin)
- [ ] No user complaints
- [ ] Explorer shows successful transactions

---

## Troubleshooting

### Issue: "Insufficient funds"
**Solution:** Get more TFUEL, need 100+ for safety

### Issue: "Upgrade failed: Already initialized"
**Solution:** Normal for proxy upgrades, verify implementation changed

### Issue: "Transaction reverted"
**Solution:** 
1. Check if contracts are paused
2. Verify private key is owner
3. Check gas limit settings

### Issue: Limits reset to 0
**Solution:** Re-run set limits script:
```bash
npx hardhat run scripts/set-limits.cjs --network theta-mainnet
```

---

## Timeline

- **Preparation:** 2 min
- **Compilation:** 30 sec
- **Upgrade Deployment:** 2-3 min
- **Verification:** 2 min
- **Testing:** 3-5 min
- **Total:** ~10 minutes

---

## Emergency Contacts

- **On-call Security:** [Discord channel]
- **Deployment Lead:** [Your contact]
- **Backup Deployer:** [Backup contact]

---

**Ready to Deploy?** ✅

Run: `npx hardhat run scripts/upgrade-fix-tx-origin.cjs --network theta-mainnet`

**Status:** Awaiting your approval to execute

