# Critical Updates Summary - Jan 14, 2026

## 🚨 SECURITY FIX (CRITICAL!)

### Issue Found
**File**: `.env.docker` lines 6-7  
**Problem**: Contained real mnemonic phrase that was committed to GitHub  
**Mnemonic**: `someone minimum token world physical asset market loyal crucial virtual stuff ketchup`

### Actions Taken
✅ **Sanitized `.env.docker`** - Replaced with placeholder  
✅ **Added security warnings** - Clear notes to never commit real mnemonics  
✅ **Wallet rotated** - You mentioned wallet is compromised but already moved to new wallets  

### What You Should Do
1. ✅ **DO NOT** use the compromised wallet for any new transactions
2. ✅ **VERIFY** all funds are moved to new wallets
3. ⚠️  **MONITOR** the old address for any suspicious activity:
   - Old wallet address derived from that mnemonic
   - Check: `persistence1...` (first address from that mnemonic)

---

## 📝 LP Treasury Address Correction

### Issue
**Old Address** (incorrect): `persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj`  
**New Address** (correct): `persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e`  

### Key Clarification
**LP Treasury = Multisig Address (same address for both!)**

This means:
- Governance decisions → `persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e`
- LP Treasury funds → `persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e`
- **They are the SAME address**

### Files Updated
✅ `COMPLETE_ADDRESS_LIST.md` - Updated LP_TREASURY  
✅ `TEST_ADDRESSES_REQUIRED.md` - Updated LP_TREASURY with clarification  
✅ `scripts/validate-addresses.cjs` - Updated hardcoded LP treasury check  
✅ `scripts/deploy-revsplitter-v2.cjs` - Updated for mainnet, testnet, localhost  

---

## 🔧 CosmWasm Contract Deployment

### Your Question
> "How do we create the persistence minter contract and verifier addresses, is there anything I need to do or are these addresses similar to vault addresses that you created?"

### Answer: **NO, they are DIFFERENT!**

| Contract Type | How Address is Created |
|--------------|------------------------|
| **Ethereum/Theta** (VaultFactory) | Automatically generated during Hardhat deployment |
| **Persistence/CosmWasm** (Minter, Verifier) | **YOU must deploy manually first!** |

### Key Differences

#### Ethereum/Theta Contracts (e.g., VaultFactory)
```javascript
// Just run deploy script - address auto-generated
npx hardhat run scripts/deploy-vault-factory.js
// Output: VaultFactory deployed to: 0x1234567890...
```
**Result**: Address appears automatically ✅

#### Persistence/CosmWasm Contracts (Minter, Verifier)
```bash
# Step 1: Build contract
cd cosmwasm-contracts/persistence-minter
cargo wasm

# Step 2: Upload to Persistence chain
persistenceCore tx wasm store artifacts/persistence_minter.wasm --from deployer

# Step 3: Instantiate contract (THIS creates the address!)
persistenceCore tx wasm instantiate <code_id> '{"admin": "..."}' --from deployer

# NOW you get: Contract address: persistence1abc123...
```
**Result**: You must manually deploy to get address ⚠️

### What You Need to Do

**Prerequisites**:
1. Install Rust & CosmWasm tools
2. Install `persistenceCore` CLI
3. Fund deployer wallet with ~5 XPRT

**Deployment Steps** (detailed in `COSMWASM_DEPLOYMENT_GUIDE.md`):
1. Build ZK Verifier contract → Upload → Instantiate → Get address
2. Build Persistence Minter contract → Upload → Instantiate → Get address
3. Add both addresses to `.env.local`:
   ```bash
   ZK_VERIFIER_ADDRESS=persistence1abc123...
   PERSISTENCE_MINTER_CONTRACT=persistence1def456...
   ```

**Cost**: ~5 XPRT total (~$1 USD)

### New Documentation Created
✅ **`COSMWASM_DEPLOYMENT_GUIDE.md`** - Complete step-by-step guide  
  - Prerequisites and setup
  - Build instructions
  - Upload and instantiation
  - Cost estimates
  - Verification commands

---

## 📊 Files Modified/Created

### Security Fix
- `.env.docker` - Sanitized compromised mnemonic

### Address Corrections
- `COMPLETE_ADDRESS_LIST.md` - Updated LP treasury
- `TEST_ADDRESSES_REQUIRED.md` - Updated LP treasury with clarification
- `scripts/validate-addresses.cjs` - Updated LP treasury validation
- `scripts/deploy-revsplitter-v2.cjs` - Updated all network configs

### New Documentation
- `COSMWASM_DEPLOYMENT_GUIDE.md` - CosmWasm deployment instructions

---

## ✅ Action Items for You

### Immediate (Security)
- [ ] Verify old wallet funds are moved to new wallets
- [ ] Monitor old wallet address for suspicious activity
- [ ] Never use the compromised mnemonic again

### Before Mainnet Deployment
- [ ] Deploy ZK Verifier contract to Persistence
- [ ] Deploy Persistence Minter contract to Persistence
- [ ] Add both addresses to `.env.local`
- [ ] Run `node scripts/validate-addresses.cjs` to verify all addresses

### Optional (Recommended)
- [ ] Test deploy on Persistence testnet first
- [ ] Save all Code IDs for future upgrades
- [ ] Transfer contract admin to multisig after testing

---

## 🔍 Verification

Run validation to check all addresses:
```bash
node scripts/validate-addresses.cjs

# Should show:
# ✅ LP Treasury: persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e
# ⚠️  ZK_VERIFIER_ADDRESS not set (expected - deploy first)
# ⚠️  PERSISTENCE_MINTER_CONTRACT not set (expected - deploy first)
```

---

## 📞 Quick Reference

**Multisig/LP Treasury**: `persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e` (same address)  
**Deployer**: `persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx`  
**Dexter Router**: `persistence132xmxm33vwjlur2pszl4hu9r32lqmqagvunnuc5hq4htps7rr3kqsf4dsk`  

**Next Steps**: Deploy CosmWasm contracts → See `COSMWASM_DEPLOYMENT_GUIDE.md`

---

**Commit**: `2081570` - Critical security and address updates  
**Date**: January 14, 2026  
**Status**: ✅ Security fixed, addresses corrected, deployment guide created
