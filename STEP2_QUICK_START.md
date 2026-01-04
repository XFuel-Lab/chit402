# XFuelLab Step 2: Quick Start Guide
## Theta Mainnet Deploy & Test - Ferrari Hybrid Tokenomics

**Date:** January 2026  
**Status:** Ready for Execution  
**Estimated Time:** 30-45 minutes

---

## 🚀 Quick Deployment (TL;DR)

### For Bash/Linux/Mac Users:
```bash
# Run complete deployment with one command
./run-hybrid-deploy.sh

# Or dry-run first (safe - no gas spent)
./run-hybrid-deploy.sh --dry-run
```

### For Windows Users:
```cmd
REM Run complete deployment
run-hybrid-deploy.bat

REM Or dry-run first
run-hybrid-deploy.bat --dry-run
```

### Manual Deployment:
```bash
# Dry-run gas estimation
npx hardhat run scripts/deploy-keystore.cjs --network theta-mainnet --dry-run

# Actual deployment
npx hardhat run scripts/deploy-keystore.cjs --network theta-mainnet
```

---

## 📋 What This Does

The enhanced deployment system automatically:

1. ✅ **Validates Environment**
   - Checks keystore file exists
   - Verifies RevenueSplitter address
   - Confirms Hardhat configuration

2. ✅ **Estimates Gas Costs**
   - Calculates exact deployment cost
   - Checks if wallet has sufficient funds
   - Adds 0.1 TFUEL buffer for safety

3. ✅ **Deploys VaultFactory**
   - Sets admin to deployer address
   - Connects to RevenueSplitter
   - Configures hybrid tokenomics (30/30/25/15)

4. ✅ **Saves Deployment Info**
   - Creates `deployments/vaultfactory-361.json`
   - Updates `.env` with new address
   - Generates deployment log file

5. ✅ **Provides Next Steps**
   - Explorer verification links
   - Test vault creation commands
   - Deposit/unwrap testing instructions

---

## 🔧 Ferrari Hybrid Parameters

The deployment configures these Ferrari tokenomics parameters:

```yaml
Deposit Fee: 0.5%
  └─> Sent to RevenueSplitter for 4-way split:
      ├─ 30% BBB (Buyback-Burn-Boost)
      ├─ 30% LP Funding (Governance-voted)
      ├─ 25% veXF Yields (USDC/TFUEL options)
      └─ 15% Treasury

Yield Recycle Loop:
  ├─ 30% reverse-burn flag (tracked in events)
  └─ 70% LP funding (net locked in vault)

Governance Extras (Post-Audit):
  ├─ Quarterly LP allocation vote (5-10%)
  ├─ NFT rewards, airdrops, milestones
  └─ rXF bonus for active voters
```

---

## 📊 Enhanced Features vs Original Script

| Feature | Original | Enhanced |
|---------|----------|----------|
| Gas Estimation | ❌ | ✅ Pre-deployment calculation |
| Insufficient Funds Check | ⚠️ Basic | ✅ Detailed with solutions |
| Dry-Run Mode | ❌ | ✅ Test without spending gas |
| Error Handling | ⚠️ Basic | ✅ Contextual error messages |
| Console Logs | ✅ | ✅ Enhanced with Ferrari details |
| Explorer Links | ✅ | ✅ Plus transaction links |
| Next Steps | ✅ Generic | ✅ Ferrari hybrid-specific |
| Gate Checks | ❌ | ✅ Interactive checklist |
| Deployment Log | ❌ | ✅ Timestamped log file |

---

## 🧪 Testing Workflow After Deployment

### 1. Verify on Explorer (5 min)
```
URL: https://explorer.thetatoken.org/address/<VAULT_FACTORY_ADDRESS>

Checks:
 [ ] Contract creation tx succeeded
 [ ] Admin address correct
 [ ] RevSplitter address correct
 [ ] Source code verified
```

### 2. Create Test SubVault (10 min)
```bash
npx hardhat console --network theta-mainnet

> factory = await ethers.getContractAt('VaultFactory', '<ADDRESS>')
> salt = ethers.keccak256(ethers.toUtf8Bytes('test-vault-1'))
> tx = await factory.createVault(salt, {gasPrice: ethers.parseUnits('4000', 'gwei')})
> await tx.wait()
> vaultAddr = await factory.predictAddress(salt)
> console.log('SubVault:', vaultAddr)
```

### 3. Test Deposit (10 min)
```
From Theta Web Wallet:
1. Send 0.1 TFUEL to <SUBVAULT_ADDRESS>
2. Wait for confirmation (~6 seconds)
3. Check explorer for DepositReceived event:
   - grossAmount: 0.1 TFUEL
   - feeAmount: 0.0005 TFUEL (0.5%)
   - netAmount: 0.0995 TFUEL
   - yieldRecycleAmount: 0.02985 TFUEL (30% of net)
```

### 4. Test Unwrap (10 min)
```bash
npx hardhat console --network theta-mainnet

> factory = await ethers.getContractAt('VaultFactory', '<ADDRESS>')
> mockBurnTx = ethers.keccak256(ethers.toUtf8Bytes('test-burn-1'))
> tx = await factory.unwrapFromBurn(
    '<SUBVAULT_ADDRESS>',
    mockBurnTx,
    '<RECIPIENT_ADDRESS>',
    ethers.parseEther('0.05'),
    {gasPrice: ethers.parseUnits('4000', 'gwei')}
  )
> await tx.wait()

Check explorer for UnwrapFromBurn event:
 - amount: 0.05 TFUEL
 - netAmount: 0.035 TFUEL (70% to recipient)
 - yieldRecycleAmount: 0.015 TFUEL (30% kept in vault)
```

---

## 🚨 Common Issues & Quick Fixes

### Issue: "Insufficient Funds for Deployment"
**Fix:** Top up deployer wallet with 0.5+ TFUEL
```bash
# Check current balance
curl -X POST https://eth-rpc-api.thetatoken.org/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["<YOUR_ADDRESS>","latest"],"id":1}'
```

### Issue: "Keystore Decryption Failed"
**Fix 1:** Test AWS Secrets Manager access
```bash
node scripts/test-aws-secret.cjs
```

**Fix 2:** Use plaintext private key (dev only)
```bash
echo "YOUR_PRIVATE_KEY_WITHOUT_0x" > dev-keystore.txt
export DEPLOYER_MAINNET_KEYSTORE_PATH=./dev-keystore.txt
```

### Issue: "Transaction Stuck Pending"
**Fix:** Increase gas price in `hardhat.config.cjs`
```javascript
'theta-mainnet': {
  gasPrice: 5000000000000, // 5000 Gwei (higher priority)
}
```

### Issue: "RevenueSplitter Address Invalid"
**Fix:** Set correct address in `.env.local`
```bash
REVSPLITTER_ADDRESS=0x1c4CEBBB4cFA7FdB546424f21Cf706c48c478eE6
```

---

## 📁 Output Files

After successful deployment:

```
xfuel-protocol/
├── deployments/
│   └── vaultfactory-361.json       # Deployment details
├── deployment-log-YYYYMMDD-HHMMSS.txt  # Timestamped log
└── .env                             # Updated with VITE_VAULT_FACTORY_ADDRESS
```

### Sample vaultfactory-361.json:
```json
{
  "network": "Theta Mainnet",
  "chainId": "361",
  "deployer": "0xea9...",
  "timestamp": "2026-01-XX...",
  "contracts": {
    "vaultFactory": "0x<NEW_ADDRESS>",
    "revenueSplitter": "0x1c4..."
  },
  "transaction": {
    "hash": "0x123abc...",
    "blockNumber": "28471234"
  },
  "explorerLink": "https://explorer.thetatoken.org/address/0x..."
}
```

---

## 🎯 Success Criteria Checklist

### Deployment Phase
- [ ] Dry-run completes without errors
- [ ] Gas estimation shows sufficient balance
- [ ] VaultFactory deploys successfully
- [ ] Transaction confirmed in 1-2 blocks
- [ ] Deployment info saved correctly

### Testing Phase
- [ ] SubVault created successfully
- [ ] 0.1 TFUEL deposit works
- [ ] 0.5% fee sent to RevSplitter
- [ ] DepositReceived event shows 30% recycle
- [ ] Unwrap sends 70% to recipient
- [ ] UnwrapFromBurn event correct

### Verification Phase
- [ ] Contract verified on explorer
- [ ] All events visible on explorer
- [ ] No error events emitted
- [ ] Balances reconcile correctly
- [ ] Explorer links work

---

## 📞 Need Help?

### Documentation
- **Full Guide:** `STEP2_THETA_DEPLOY_GUIDE.md`
- **Mainnet Rollout Plan:** `MAINNET_ROLLOUT_PLAN.md`
- **Ferrari Whitepaper:** `docs/XFUEL-Hybrid-Tokenomics-Whitepaper-v3.md`

### Debug Resources
```bash
# Check Theta RPC status
curl -X POST https://eth-rpc-api.thetatoken.org/rpc \
  -d '{"jsonrpc":"2.0","method":"net_version","params":[],"id":1}'

# Test local fork (safe testing)
npx hardhat node --fork https://eth-rpc-api.thetatoken.org/rpc
npx hardhat run scripts/deploy-keystore.cjs --network localhost

# View Hardhat logs
npx hardhat console --network theta-mainnet
```

### External Support
- Theta Support: support@thetatoken.org
- Theta Discord: https://discord.gg/theta
- Theta Explorer: https://explorer.thetatoken.org

---

## ✅ Pre-Flight Checklist

Before running deployment, verify:

- [ ] Deployer wallet has 2+ TFUEL
- [ ] `.env.local` exists with `DEPLOYER_MAINNET_KEYSTORE_PATH`
- [ ] Keystore file exists and accessible
- [ ] RevenueSplitter address configured (or using default)
- [ ] Hardhat config has theta-mainnet network
- [ ] Node.js and npm installed
- [ ] `node_modules` dependencies installed
- [ ] Team notified of deployment window
- [ ] Emergency pause procedures reviewed

---

## 🎬 Execute Deployment

**Choose your preferred method:**

### Method 1: Convenience Script (Recommended)
```bash
# Linux/Mac
./run-hybrid-deploy.sh

# Windows
run-hybrid-deploy.bat
```

### Method 2: Direct Hardhat
```bash
# Dry-run first
npx hardhat run scripts/deploy-keystore.cjs --network theta-mainnet --dry-run

# Then deploy
npx hardhat run scripts/deploy-keystore.cjs --network theta-mainnet
```

### Method 3: Auto Mode (CI/CD)
```bash
./run-hybrid-deploy.sh --auto  # Skips confirmations
```

---

## 🚀 After Deployment

1. **Save the VaultFactory address** - You'll need it for backend integration
2. **Verify on explorer** - Compiler 0.8.20, optimization 200 runs
3. **Run test transactions** - Follow testing workflow above
4. **Document results** - Use provided checklist
5. **Proceed to Step 3** - Backend listener integration

---

**Status:** ✅ Ready to Deploy  
**Next Step:** Backend Listener (30/70 split automation)  
**Estimated Gas:** ~0.013 TFUEL + 0.1 buffer = 0.113 TFUEL total

---

*Generated by XFuelLab Deploy System - Ferrari Hybrid Edition*

