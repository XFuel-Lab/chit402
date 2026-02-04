# Testnet Deployment Plan - XFuel Protocol

**Date**: January 2, 2026  
**Network**: Theta Testnet (Chain ID: 365)  
**Purpose**: Test deployment with new address configuration before mainnet

---

## 📋 Pre-Deployment Checklist

### ✅ Environment Setup (COMPLETED)
- [x] New deployer address configured: `0xDC17Cbd201E7347555e428690f702bbFcAF2d33c`
- [x] Relayer address configured: `0x627082bFAdffb16B979d99A8eFc8F1874c0990C4`
- [x] Treasury address configured: `0x043d5231651379970d52a13CEfB4e80733DDb989`
- [x] AWS credentials validated
- [x] `.env.local` properly configured

### 🔑 Required Environment Variables

You need to add **testnet-specific** variables to `.env.local`:

```bash
# Testnet Configuration (add these)
THETA_TESTNET_PRIVATE_KEY=0xYourTestnetPrivateKey

# OR use AWS Secrets Manager ARN
# THETA_TESTNET_PRIVATE_KEY=arn:aws:secretsmanager:...

# Optional: Testnet addresses (if different from mainnet)
# DEPLOYER_TESTNET_ADDRESS=0x...
# RELAYER_TESTNET_ADDRESS=0x...
# TREASURY_TESTNET_ADDRESS=0x...
```

---

## 🎯 Deployment Options

### Option 1: Basic Testnet Deployment (Recommended First)

**What it deploys:**
- TipPool
- XFUELPoolFactory
- TreasuryILBackstop
- XFUELRouter

**Command:**
```bash
npm run deploy:theta-testnet
```

**Script:** `scripts/deploy.cjs`

---

### Option 2: Phase 1 Deployment (Tokenomics)

**What it deploys:**
- veXF (vote-escrowed XF)
- RevenueSplitter
- CyberneticFeeSwitch
- Mock XF Token (for testing)
- Mock Revenue Token (for testing)

**Command:**
```bash
npx hardhat run scripts/phase1-deploy.cjs --network theta-testnet
```

---

### Option 3: Phase 3 Deployment (Innovation Treasury)

**What it deploys:**
- ThetaPulseProof (Edge Node multipliers)
- InnovationTreasury (3-vault governance system)

**Command:**
```bash
npx hardhat run scripts/phase3-deploy.ts --network theta-testnet
```

**Note:** Requires Phase 1 contracts to be deployed first (veXF dependency)

---

## 🚀 Recommended Testing Flow

### Step 1: Pre-Deployment Checks

```bash
# 1. Check deployer balance on testnet
npm run check-balance

# 2. Verify environment configuration
node validate-env.js
```

### Step 2: Basic Deployment Test

```bash
# Deploy basic contracts to testnet
npm run deploy:theta-testnet
```

**Expected output:**
- ✅ TipPool deployed
- ✅ XFUELPoolFactory deployed
- ✅ TreasuryILBackstop deployed
- ✅ XFUELRouter deployed
- 📄 Deployment info saved to `deployments/365.json`

### Step 3: Verify Deployment

```bash
# Check recent transactions
node scripts/check-recent-txs.cjs
```

### Step 4: Test Contract Interactions

```bash
# Interact with deployed contracts
node scripts/interact-vault-factory.cjs
```

---

## 🔧 Setup Instructions

### 1. Add Testnet Private Key

**Option A: Direct Private Key (Quick Test)**
```bash
# Add to .env.local
THETA_TESTNET_PRIVATE_KEY=0xYourPrivateKeyHere
```

**Option B: AWS Secrets Manager (Recommended)**
1. Store private key in AWS Secrets Manager
2. Add ARN to `.env.local`:
```bash
THETA_TESTNET_PRIVATE_KEY=arn:aws:secretsmanager:us-east-1:187510174358:secret:TESTNET/PRIVATE/KEY-xxxxx
```

### 2. Fund Testnet Address

Ensure your deployer address has testnet TFUEL:
- **Address**: `0xDC17Cbd201E7347555e428690f702bbFcAF2d33c`
- **Required**: Minimum 0.1 TFUEL (recommended: 1+ TFUEL for safety)
- **Faucet**: https://wallet.thetatoken.org/faucet (if available)

### 3. Check Balance

```bash
npm run check-balance
```

Expected output showing your testnet balance.

---

## 📊 What Gets Tested

### Address Configuration
- ✅ Deployer address (`0xDC17Cbd...`) is used for deployment
- ✅ Treasury address (`0x043d523...`) is configured in contracts
- ✅ Relayer address (`0x627082b...`) for future relayer operations

### Contract Deployment
- ✅ All contracts deploy successfully
- ✅ Contract initialization works correctly
- ✅ Addresses are set properly in contracts

### Transaction Flow
- ✅ Transactions are signed with testnet private key
- ✅ Gas estimation works
- ✅ Deployment transactions confirm on testnet

---

## 🎯 Success Criteria

After testnet deployment succeeds, you'll have:

1. ✅ **Verified Configuration** - All addresses work correctly
2. ✅ **Deployed Contracts** - Testnet contracts deployed and functional
3. ✅ **Confidence** - Ready to deploy to mainnet
4. 📝 **Documentation** - Deployment info saved for reference

---

## 🔄 Next Steps After Testnet Success

1. **Review testnet deployment** - Check explorer links, verify contracts
2. **Test contract interactions** - Ensure everything works as expected
3. **Prepare mainnet deployment** - Use same flow with mainnet private key
4. **Deploy to mainnet** - Execute with confidence

---

## ⚠️ Important Notes

### Testnet vs Mainnet Differences

| Item | Testnet | Mainnet |
|------|---------|---------|
| Chain ID | 365 | 361 |
| RPC URL | `https://eth-rpc-api-testnet.thetatoken.org/rpc` | `https://eth-rpc-api.thetatoken.org/rpc` |
| Explorer | https://testnet-explorer.thetatoken.org | https://explorer.thetatoken.org |
| Gas Price | Default | 4000 Gwei (minimum) |
| Private Key | `THETA_TESTNET_PRIVATE_KEY` | `THETA_MAINNET_PRIVATE_KEY` |

### Security Reminders

- ✅ Testnet uses different private key than mainnet
- ✅ All secrets stored in AWS Secrets Manager
- ✅ Never commit private keys or `.env.local`
- ✅ Test thoroughly before mainnet deployment

---

## 📞 Troubleshooting

### Issue: "No signers available"
**Solution:** Add `THETA_TESTNET_PRIVATE_KEY` to `.env.local`

### Issue: "Insufficient funds"
**Solution:** Get testnet TFUEL from faucet or transfer from funded wallet

### Issue: "Transaction failed"
**Solution:** Check gas price, increase if needed

### Issue: "Contract deployment timeout"
**Solution:** Testnet can be slow, wait and retry

---

## 🎬 Quick Start Command

```bash
# All-in-one: Check balance + Deploy
npm run check-balance && npm run deploy:theta-testnet
```

---

**Ready to proceed?** 
1. Add `THETA_TESTNET_PRIVATE_KEY` to `.env.local`
2. Run `npm run check-balance` to verify funds
3. Run `npm run deploy:theta-testnet` to deploy!

