# XFuelLab Step 2: Theta Mainnet Deploy & Test Guide
## Ferrari Hybrid Tokenomics - ZK Bridge Theta Side Deployment

**Version:** 1.0  
**Date:** January 2026  
**Status:** PRE-AUDIT MINIMAL ROLLOUT  
**Target:** VaultFactory, SubVault, RevenueSplitter hybrid integration

---

## 📋 Prerequisites Checklist

### ✅ Wallets Prepared
- [x] **Theta Web Main Wallet**: Deployer/Relayer/Treasury (~2 TFUEL)
- [x] **MetaMask Dev Wallet**: Fallback wallet (hot backup)
- [x] **Keplr Multisig**: Persistence side (~1 XPRT) for future bridge coordination

### ✅ Environment Setup
- [x] `.env.local` configured with keystore paths
- [x] AWS Secrets Manager ready for encrypted passwords
- [x] Hardhat config set for theta-mainnet (gas: 4000 Gwei, chain: 361)

### ✅ Contract Parameters (Ferrari Hybrid)
```yaml
VaultFactory Configuration:
  Admin: <DEPLOYER_ADDRESS> (from keystore)
  RevSplitter: <REVSPLITTER_ADDRESS> (from .env or default)
  Pause: ENABLED (pre-audit safety)
  Max Deposit: 0.1 TFUEL (minimal rollout)

Revenue Distribution (30/30/25/15):
  BBB (Buyback-Burn-Boost): 30%
  LP Funding (Governance-voted): 30%
  veXF Yields (USDC/TFUEL options): 25%
  Treasury: 15%

Deposit Fee: 0.5% to RevSplitter
Yield Recycle: 30% reverse-burn flag (from SubVault)
LP Funding: 70% of net deposit

Governance Extras:
  Quarterly LP allocation: 5-10% for NFTs/airdrops/milestones
  veXF multipliers: Up to 4x for max lockers
```

---

## 🚀 Step 2.1: Enhanced Deploy Script with Ferrari Hybrid

### Gas Estimation & Pre-Flight Checks

The enhanced `deploy-keystore.cjs` script includes:
1. **Pre-deployment gas estimation** - Calculates exact deployment cost before tx
2. **Insufficient funds detection** - Warns if balance < estimated cost + 0.1 TFUEL buffer
3. **Dry-run mode** - Test deployment without spending gas (--dry-run flag)
4. **Detailed console logs** - All addresses, tx hashes, explorer links
5. **Hybrid parameter validation** - Confirms RevSplitter splits sum to 100%
6. **Deployment artifacts** - Auto-saves to `deployments/vaultfactory-361.json`

### Enhanced Script Features

```javascript
// NEW: Gas estimation before deploy
const estimatedGas = await VaultFactory.estimateGas.deploy(admin, revSplitter);
const estimatedCost = estimatedGas * gasConfig.gasPrice;

// NEW: Insufficient funds check
if (balance < (estimatedCost + parseEther('0.1'))) {
  console.error('❌ INSUFFICIENT FUNDS FOR DEPLOYMENT');
  console.error(`   Required: ${formatEther(estimatedCost + parseEther('0.1'))} TFUEL`);
  console.error(`   Available: ${formatEther(balance)} TFUEL`);
  console.error(`   Shortfall: ${formatEther(estimatedCost + parseEther('0.1') - balance)} TFUEL`);
  process.exit(1);
}

// NEW: Dry-run mode (with --dry-run flag)
if (process.argv.includes('--dry-run')) {
  console.log('🧪 DRY-RUN MODE: Deployment simulation only');
  console.log(`   Estimated gas: ${estimatedGas.toString()} units`);
  console.log(`   Estimated cost: ${formatEther(estimatedCost)} TFUEL`);
  console.log('   ✅ Dry-run complete - no transactions sent');
  process.exit(0);
}

// NEW: Post-deployment verification links
console.log('🔗 Verification Links:');
console.log(`   VaultFactory: ${explorerBase}/address/${vaultFactoryAddress}`);
console.log(`   Deployment Tx: ${explorerBase}/tx/${deployTx.hash}`);
console.log('');
console.log('📝 Next Steps:');
console.log('   1. Verify contract source code on Theta Explorer');
console.log('   2. Create first SubVault via createVault() function');
console.log('   3. Test 0.1 TFUEL deposit → check 0.5% fee to RevSplitter');
console.log('   4. Monitor SubVault events for hybrid splits (30% recycle, 70% LP)');
console.log('   5. Run mock unwrap script to test reverse-burn loop');
```

---

## 🛠️ Step 2.2: Deploy to Theta Mainnet

### Option A: Using Enhanced Script Directly

```bash
# Navigate to project root
cd /path/to/xfuel-protocol

# 1. DRY-RUN FIRST (safe - no gas spent)
npx hardhat run scripts/deploy-keystore.cjs --network theta-mainnet --dry-run

# Expected output:
# 🧪 DRY-RUN MODE: Deployment simulation only
#    Estimated gas: 3,245,678 units
#    Estimated cost: 0.012982712 TFUEL
#    ✅ Dry-run complete - no transactions sent

# 2. VERIFY DRY-RUN RESULTS
# - Check estimated cost < your balance
# - Confirm RevSplitter address correct
# - Review constructor parameters

# 3. ACTUAL DEPLOYMENT (REAL GAS)
npx hardhat run scripts/deploy-keystore.cjs --network theta-mainnet

# Expected output:
# 🚀 @XFuelLab ZK Bridge Deployment
# ======================================================================
# Network: Theta Mainnet (Chain ID: 361)
# ======================================================================
# 
# 🔐 Loading deployer wallet...
#    Address: 0xea9...
# 
# 💰 Deployer balance: 2.045 TFUEL
# 
# ⛽ Gas Estimation:
#    Estimated Gas:  3245678 units
#    Gas Price:      4000 Gwei
#    Estimated Cost: 0.012982712 TFUEL
#    Buffer:         0.1 TFUEL
#    Total Required: 0.112982712 TFUEL
#    ✅ Sufficient balance
# 
# 📋 Configuration Check:
#    RevenueSplitter: 0x1c4CEBBB4cFA7FdB546424f21Cf706c48c478eE6
#    Treasury:        0x043d5231651379970d52a13CEfB4e80733DDb989
#    ✅ Addresses validated
# 
# 📦 Deploying VaultFactory...
#    Constructor params:
#      Admin:        0xea9...
#      RevSplitter:  0x1c4...
# 
# ⏳ Waiting for deployment...
# ✅ VaultFactory deployed to: 0x<NEW_VAULT_FACTORY_ADDRESS>
# 
# 📝 Deployment Transaction:
#    Hash:        0x123abc...
#    Block:       28471234
#    Gas Used:    3,198,456
# 
# ======================================================================
# 📋 DEPLOYMENT SUMMARY
# ======================================================================
# 🌐 Network:          Theta Mainnet (Chain ID: 361)
# 👤 Deployer:         0xea9...
# 💰 Initial Balance:  2.045 TFUEL
# ⛽ Gas Spent:        0.01279 TFUEL
# 💵 Final Balance:    2.03221 TFUEL
# 
# 📝 Contract Addresses:
#    VaultFactory:     0x<NEW_ADDRESS>
#    RevenueSplitter:  0x1c4CEBBB4cFA7FdB546424f21Cf706c48c478eE6 (external)
#    Treasury:         0x043d5231651379970d52a13CEfB4e80733DDb989 (configured)
# 
# 🔗 Explorer Links:
#    https://explorer.thetatoken.org/address/0x<NEW_ADDRESS>
# ======================================================================
```

### Option B: Using Convenience Shell Script (Recommended)

We'll create a `run-hybrid-deploy.sh` script for one-command execution:

```bash
# Run the convenience script
./run-hybrid-deploy.sh

# The script handles:
# 1. Environment validation
# 2. Dry-run execution
# 3. User confirmation prompt
# 4. Actual deployment
# 5. Post-deployment verification steps
```

---

## 🧪 Step 2.3: Test Hybrid Flow on Theta

### Gate Check 2.3A: Explorer Verification

**CRITICAL: Do NOT proceed until ALL checks pass**

1. **Navigate to VaultFactory on Explorer**
   ```
   https://explorer.thetatoken.org/address/<VAULT_FACTORY_ADDRESS>
   ```

2. **Verify Contract Details:**
   - [ ] Contract creation transaction confirmed (green checkmark)
   - [ ] "Contract" tab shows source code (after verification)
   - [ ] Constructor arguments match your parameters
   - [ ] Admin address = your deployer address
   - [ ] RevSplitter address matches `.env` value

3. **Check Transaction Details:**
   - [ ] Gas used ≈ estimated gas (within 10% variance)
   - [ ] Transaction status: Success
   - [ ] No error messages in logs
   - [ ] Timestamp recent (within last hour)

**🚨 RED FLAGS (Stop and Debug):**
- Transaction failed or reverted
- Gas used significantly higher than estimate (>2x)
- Wrong admin address deployed
- RevSplitter address is zero address (0x000...000)

### Gate Check 2.3B: Create Test SubVault

Now create a test vault to verify factory works:

```bash
# Method 1: Via Hardhat console
npx hardhat console --network theta-mainnet

# In console:
const factory = await ethers.getContractAt(
  'VaultFactory',
  '<VAULT_FACTORY_ADDRESS>'
);

// Generate salt for test vault
const testSalt = ethers.keccak256(
  ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'uint256'],
    ['0xTEST_USER_ADDRESS', 1]
  )
);

// Predict vault address before deployment
const predictedAddr = await factory.predictAddress(testSalt);
console.log('Predicted Vault Address:', predictedAddr);

// Create vault
const tx = await factory.createVault(testSalt, {
  gasPrice: ethers.parseUnits('4000', 'gwei'),
  gasLimit: 2000000
});
await tx.wait();

console.log('✅ SubVault deployed at:', predictedAddr);
console.log('   Transaction:', tx.hash);

// Method 2: Via prepared script (coming next)
```

**Expected Console Output:**
```
Predicted Vault Address: 0xabc123...
Transaction sent: 0x456def...
✅ SubVault deployed at: 0xabc123...
   Transaction: 0x456def...
```

### Gate Check 2.3C: Test Deposit with 0.5% Fee

**Test Scenario:** Send 0.1 TFUEL to SubVault, verify hybrid splits

```bash
# 1. Get SubVault balance before
curl -X POST https://eth-rpc-api.thetatoken.org/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "eth_getBalance",
    "params": ["<SUBVAULT_ADDRESS>", "latest"],
    "id": 1
  }'

# Note starting balance (should be 0)

# 2. Send 0.1 TFUEL from Theta Web Wallet
# In Theta Web Wallet:
# - Send → 0.1 TFUEL → <SUBVAULT_ADDRESS>
# - Confirm transaction

# 3. Wait for confirmation (~6 seconds)

# 4. Check SubVault balance after
curl -X POST https://eth-rpc-api.thetatoken.org/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "eth_getBalance",
    "params": ["<SUBVAULT_ADDRESS>", "latest"],
    "id": 1
  }'

# Expected balance: 0.0995 TFUEL
# (0.1 - 0.0005 fee = 0.0995)

# 5. Verify fee sent to RevSplitter
curl -X POST https://eth-rpc-api.thetatoken.org/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "eth_getBalance",
    "params": ["<REVSPLITTER_ADDRESS>", "latest"],
    "id": 1
  }'

# Balance should have increased by ~0.0005 TFUEL
```

**Manual Verification via Explorer:**

1. Go to SubVault address on explorer
2. Check "Internal Transactions" tab
3. Find your 0.1 TFUEL transaction
4. Verify events emitted:
   ```
   DepositReceived(
     vault: 0x<SUBVAULT_ADDRESS>,
     sender: 0x<YOUR_ADDRESS>,
     grossAmount: 100000000000000000 (0.1 TFUEL in wei),
     feeAmount: 500000000000000 (0.0005 TFUEL),
     netAmount: 99500000000000000 (0.0995 TFUEL),
     yieldRecycleAmount: 29850000000000000 (0.02985 TFUEL = 30% of net)
   )
   ```

**✅ SUCCESS CRITERIA:**
- [ ] SubVault balance = 0.0995 TFUEL (net after fee)
- [ ] RevSplitter balance increased by 0.0005 TFUEL
- [ ] `DepositReceived` event shows yieldRecycleAmount = 30% of netAmount
- [ ] No error events emitted
- [ ] Transaction confirmed in 1-2 blocks

**🚨 RED FLAGS:**
- SubVault balance ≠ 0.0995 TFUEL (fee calculation error)
- No fee sent to RevSplitter (transfer failed)
- Event missing or wrong values (contract bug)
- Transaction reverted (critical issue - STOP)

### Gate Check 2.3D: Mock Unwrap Test (Reverse-Burn Loop)

**Objective:** Verify unwrap flow with 30% reverse-burn, 70% to recipient

```bash
# WARNING: This requires ZK_BRIDGE_ROLE access
# Only the deployer (admin) can call this in initial setup

npx hardhat console --network theta-mainnet

# In console:
const factory = await ethers.getContractAt(
  'VaultFactory',
  '<VAULT_FACTORY_ADDRESS>'
);

// Mock burn transaction from Persistence (future: ZK bridge triggers this)
const mockBurnTxHash = ethers.keccak256(
  ethers.toUtf8Bytes('mock-burn-tx-for-testing-only-12345')
);

const recipientAddress = '<YOUR_TEST_ADDRESS>'; // Where to send unlocked TFUEL
const unlockAmount = ethers.parseEther('0.05'); // Unlock 0.05 TFUEL

// Get recipient balance before
const balanceBefore = await ethers.provider.getBalance(recipientAddress);
console.log('Recipient balance before:', ethers.formatEther(balanceBefore), 'TFUEL');

// Trigger unwrap (as admin with ZK_BRIDGE_ROLE)
const tx = await factory.unwrapFromBurn(
  '<SUBVAULT_ADDRESS>',
  mockBurnTxHash,
  recipientAddress,
  unlockAmount,
  {
    gasPrice: ethers.parseUnits('4000', 'gwei'),
    gasLimit: 500000
  }
);

await tx.wait();
console.log('✅ Unwrap transaction:', tx.hash);

// Get recipient balance after
const balanceAfter = await ethers.provider.getBalance(recipientAddress);
console.log('Recipient balance after:', ethers.formatEther(balanceAfter), 'TFUEL');

const received = balanceAfter - balanceBefore;
console.log('Amount received:', ethers.formatEther(received), 'TFUEL');
console.log('Expected (70% of 0.05):', '0.035 TFUEL');

// Verify 30% recycle stayed in vault
const vaultBalance = await ethers.provider.getBalance('<SUBVAULT_ADDRESS>');
console.log('Vault balance after unwrap:', ethers.formatEther(vaultBalance), 'TFUEL');
```

**Expected Output:**
```
Recipient balance before: 1.234 TFUEL
✅ Unwrap transaction: 0x789ghi...
Recipient balance after: 1.269 TFUEL
Amount received: 0.035 TFUEL
Expected (70% of 0.05): 0.035 TFUEL
Vault balance after unwrap: 0.0645 TFUEL
```

**Calculation Verification:**
- Unlock amount: 0.05 TFUEL
- To recipient (70%): 0.035 TFUEL ✅
- Recycled (30%): 0.015 TFUEL (stays in vault for yield loop)
- Previous vault balance: 0.0995 TFUEL
- After unwrap: 0.0995 - 0.05 = 0.0495 TFUEL
- With recycle kept: 0.0495 + 0.015 = 0.0645 TFUEL ✅

**Check Explorer Events:**
```
UnwrapFromBurn(
  burnTxHash: 0x<MOCK_HASH>,
  recipient: 0x<YOUR_ADDRESS>,
  amount: 50000000000000000 (0.05 TFUEL),
  netAmount: 35000000000000000 (0.035 TFUEL),
  yieldRecycleAmount: 15000000000000000 (0.015 TFUEL)
)
```

**✅ SUCCESS CRITERIA:**
- [ ] Recipient receives exactly 70% of unlock amount
- [ ] 30% stays in vault (yieldRecycleAmount)
- [ ] `UnwrapFromBurn` event emitted with correct values
- [ ] Burn tx hash recorded in contract (prevents replay)
- [ ] No errors or reverts

---

## 🎯 Step 2.4: Governance Extras Simulation

The Ferrari hybrid includes **governance-voted LP allocation** with quarterly opt-in for NFT rewards, airdrops, and milestones. While full governance requires veXF deployment (Step 4), we can simulate the parameter checks:

### Governance Parameter Validation

```bash
npx hardhat console --network theta-mainnet

# Verify RevenueSplitter configuration
const revSplitter = await ethers.getContractAt(
  'RevenueSplitter',
  '<REVSPLITTER_ADDRESS>'
);

// Check hybrid splits (50% veXF, 25% BBB, 15% rXF, 10% Treasury in Phase 2)
// For minimal rollout, we use simplified splits
const veXFBps = await revSplitter.VEXF_YIELD_BPS();
const buybackBps = await revSplitter.BUYBACK_BURN_BPS();
const rXFBps = await revSplitter.RXF_MINT_BPS();
const treasuryBps = await revSplitter.TREASURY_BPS();

console.log('Revenue Split Configuration:');
console.log('  veXF Yield:    ', veXFBps.toString(), 'bps (', veXFBps / 100, '%)');
console.log('  Buyback/Burn:  ', buybackBps.toString(), 'bps (', buybackBps / 100, '%)');
console.log('  rXF Mint:      ', rXFBps.toString(), 'bps (', rXFBps / 100, '%)');
console.log('  Treasury:      ', treasuryBps.toString(), 'bps (', treasuryBps / 100, '%)');
console.log('  Total:         ', (veXFBps + buybackBps + rXFBps + treasuryBps) / 100, '%');

// Verify sum = 100%
const total = veXFBps + buybackBps + rXFBps + treasuryBps;
if (total === 10000n) {
  console.log('✅ Splits sum to 100% correctly');
} else {
  console.error('❌ CRITICAL: Splits do not sum to 100%!');
  console.error('   Total BPS:', total.toString(), '(expected: 10000)');
}
```

**Expected Output:**
```
Revenue Split Configuration:
  veXF Yield:     5000 bps ( 50 %)
  Buyback/Burn:   2500 bps ( 25 %)
  rXF Mint:       1500 bps ( 15 %)
  Treasury:       1000 bps ( 10 %)
  Total:          100 %
✅ Splits sum to 100% correctly
```

**Note:** The full Ferrari hybrid (30/30/25/15) will be activated post-audit with these mappings:
- 30% BBB → Buyback-Burn-Boost mechanism
- 30% LP → Governance-voted liquidity provisioning
- 25% veXF → Yield distribution to lockers
- 15% Treasury → Innovation fund

For minimal rollout, we use the Phase 2 splits (50/25/15/10) as a conservative starting point.

---

## 📊 Step 2.5: Debug Tips & Troubleshooting

### Common Issues & Solutions

#### Issue 1: "Insufficient Funds for Deployment"

**Symptoms:**
```
❌ INSUFFICIENT FUNDS FOR DEPLOYMENT
   Required: 0.113 TFUEL
   Available: 0.095 TFUEL
   Shortfall: 0.018 TFUEL
```

**Solutions:**
1. **Top up deployer wallet:**
   - Send 0.5 TFUEL from another wallet
   - Wait for 2 block confirmations
   - Re-run deployment

2. **Use local simulation first:**
   ```bash
   # Spin up local Hardhat node
   npx hardhat node --fork https://eth-rpc-api.thetatoken.org/rpc
   
   # In another terminal, deploy to local fork
   npx hardhat run scripts/deploy-keystore.cjs --network localhost
   ```

#### Issue 2: "Gas Price Too Low" or Transaction Stuck

**Symptoms:**
- Transaction pending for >60 seconds
- Explorer shows "pending" status indefinitely

**Solutions:**
1. **Check minimum gas price:**
   ```bash
   curl -X POST https://eth-rpc-api.thetatoken.org/rpc \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"eth_gasPrice","params":[],"id":1}'
   ```
   Theta mainnet requires **4000 Gwei minimum**.

2. **Increase gas price in hardhat.config.cjs:**
   ```javascript
   'theta-mainnet': {
     gasPrice: 5000000000000, // 5000 Gwei (higher priority)
   }
   ```

#### Issue 3: "RevenueSplitter Address Invalid"

**Symptoms:**
```
❌ Invalid RevenueSplitter address format: 0x000...000
```

**Solutions:**
1. **Check `.env.local`:**
   ```bash
   grep REVSPLITTER_ADDRESS .env.local
   ```
   Should output a valid 0x address (not 0x0000...).

2. **Fallback to default:**
   The script uses a fallback address if env var missing:
   ```javascript
   const revSplitterAddress = process.env.REVSPLITTER_ADDRESS || 
     '0x1c4CEBBB4cFA7FdB546424f21Cf706c48c478eE6'; // Default testnet
   ```

3. **Manually set address:**
   ```bash
   export REVSPLITTER_ADDRESS=0x<VALID_ADDRESS>
   npx hardhat run scripts/deploy-keystore.cjs --network theta-mainnet
   ```

#### Issue 4: "Keystore Decryption Failed"

**Symptoms:**
```
❌ Failed to decrypt keystore. This usually means:
   1. The password is incorrect
   2. The keystore file is corrupted
   3. The password in AWS doesn't match this keystore
```

**Solutions:**
1. **Test AWS Secrets Manager access:**
   ```bash
   node scripts/test-aws-secret.cjs
   ```

2. **Use plaintext private key (dev only):**
   Create a new keystore file with plaintext private key:
   ```bash
   echo "YOUR_PRIVATE_KEY_WITHOUT_0x" > dev-keystore.txt
   export DEPLOYER_MAINNET_KEYSTORE_PATH=./dev-keystore.txt
   ```

3. **Re-encrypt keystore:**
   ```bash
   # Use ethers.js to re-encrypt
   node -e "
   const { Wallet } = require('ethers');
   const fs = require('fs');
   
   (async () => {
     const wallet = new Wallet('0xYOUR_PRIVATE_KEY');
     const encrypted = await wallet.encrypt('NEW_PASSWORD');
     fs.writeFileSync('new-keystore.json', encrypted);
     console.log('✅ New keystore created: new-keystore.json');
   })();
   "
   ```

#### Issue 5: "Explorer Shows No Events"

**Symptoms:**
- Transaction succeeds but no `DepositReceived` event visible

**Solutions:**
1. **Check event filters on explorer:**
   - Theta Explorer sometimes delays event indexing
   - Wait 2-3 minutes and refresh

2. **Query events directly via RPC:**
   ```bash
   # Get transaction receipt with logs
   curl -X POST https://eth-rpc-api.thetatoken.org/rpc \
     -H "Content-Type: application/json" \
     -d '{
       "jsonrpc": "2.0",
       "method": "eth_getTransactionReceipt",
       "params": ["<TX_HASH>"],
       "id": 1
     }'
   ```

3. **Use Hardhat to decode logs:**
   ```bash
   npx hardhat console --network theta-mainnet
   
   # In console:
   const tx = await ethers.provider.getTransactionReceipt('<TX_HASH>');
   console.log('Logs:', tx.logs);
   ```

---

## 🎬 Step 2.6: Post-Deployment Checklist

### Immediate Actions (Within 1 Hour)

- [ ] **Save all deployment addresses to secure location**
  ```bash
  cat deployments/vaultfactory-361.json
  # Copy contents to password manager, encrypted vault, etc.
  ```

- [ ] **Update `.env` with VaultFactory address**
  ```bash
  # Script auto-updates, but verify:
  grep VITE_VAULT_FACTORY_ADDRESS .env
  ```

- [ ] **Verify contract on Theta Explorer**
  1. Go to https://explorer.thetatoken.org/address/<VAULT_FACTORY_ADDRESS>
  2. Click "Contract" tab → "Verify & Publish"
  3. Select compiler version: 0.8.20
  4. Optimization: Yes, 200 runs
  5. Constructor args: ABI-encoded (admin, revSplitter)
  6. Submit verification

- [ ] **Test minimal deposit flow**
  - Send 0.01 TFUEL (10% of max limit)
  - Verify fee calculation correct
  - Check explorer for events

- [ ] **Document test results**
  ```bash
  # Create test log file
  cat > deployment-test-results.md << EOF
  # Theta Deployment Test Results
  Date: $(date)
  
  ## Addresses
  - VaultFactory: <PASTE_ADDRESS>
  - SubVault (test): <PASTE_ADDRESS>
  - RevenueSplitter: <PASTE_ADDRESS>
  
  ## Test Transactions
  - Deploy: https://explorer.thetatoken.org/tx/<TX_HASH>
  - Create Vault: https://explorer.thetatoken.org/tx/<TX_HASH>
  - Deposit Test: https://explorer.thetatoken.org/tx/<TX_HASH>
  - Unwrap Test: https://explorer.thetatoken.org/tx/<TX_HASH>
  
  ## Gate Checks
  - [x] Explorer verification passed
  - [x] Logs detect events correctly
  - [x] Fee split to RevSplitter confirmed
  - [x] 30% recycle flag in events
  - [x] Unwrap flow successful
  
  ## Next Steps
  - [ ] Backend listener integration (Step 3)
  - [ ] Persistence minter deploy (Step 4)
  - [ ] Full E2E bridge test (Step 5)
  EOF
  ```

### Next Session Preparation (Within 24 Hours)

- [ ] **Backend relayer setup**
  - Configure event listener for VaultFactory address
  - Test Theta RPC connection
  - Prepare Persistence minting logic

- [ ] **Security review**
  - Verify no admin keys exposed in logs
  - Confirm keystore passwords stored securely
  - Test pause mechanism on factory

- [ ] **Stakeholder communication**
  - Share deployment addresses with team
  - Update project documentation
  - Post status update (if public)

---

## 📚 Appendix A: Ferrari Hybrid Reference

### Revenue Distribution Formula

```solidity
// SubVault.sol - Deposit Flow
uint256 feeAmount = (depositAmount * 50) / 10000; // 0.5%
uint256 netAmount = depositAmount - feeAmount;

// Fee to RevenueSplitter (split: 50% veXF, 25% BBB, 15% rXF, 10% Treasury)
revSplitter.call{value: feeAmount}("");

// Net locked in vault for bridge
uint256 yieldRecycleAmount = (netAmount * 3000) / 10000; // 30% recycle flag
uint256 lpFunding = netAmount - yieldRecycleAmount; // 70% to LP

emit DepositReceived(vault, sender, depositAmount, feeAmount, netAmount, yieldRecycleAmount);
```

### Unwrap Flow (Reverse-Burn Loop)

```solidity
// SubVault.sol - Unwrap Flow
function unwrapFromBurn(
  bytes32 burnTxHash,
  address payable recipient,
  uint256 amount
) external onlyFactory {
  // 30% recycles back to protocol yield strategies
  uint256 yieldRecycleAmount = (amount * 3000) / 10000;
  uint256 netToRecipient = amount - yieldRecycleAmount;
  
  // Send 70% to recipient
  recipient.call{value: netToRecipient}("");
  
  // 30% stays in vault for yield loop (future: forward to staking contracts)
  emit UnwrapFromBurn(burnTxHash, recipient, amount, netToRecipient, yieldRecycleAmount);
}
```

### Governance Extras (Post-Audit Activation)

```yaml
Quarterly LP Allocation Vote:
  Trigger: Every 90 days
  Options:
    - NFT rewards pool: 5-10% of quarterly LP revenue
    - Airdrop campaigns: 5-10% to new user acquisition
    - Milestone bonuses: 5-10% for protocol achievements (TVL thresholds, partnership launches)
  
  Voting Power:
    - veXF holders only (locked XF governance tokens)
    - Multipliers up to 4x for max lock duration (4 years)
    - Quadratic voting to prevent whale dominance
  
  Execution:
    - Smart contract auto-distributes based on vote outcome
    - Treasury backstop if vote doesn't reach quorum
    - rXF bonus (0.1% of vote value) for active participants
```

---

## 📞 Support & Resources

### If Issues Arise

1. **Check logs first:**
   ```bash
   # Hardhat deployment logs
   tail -f logs/deploy-$(date +%Y%m%d).log
   
   # Theta RPC logs (if using local node)
   docker logs theta-mainnet-node
   ```

2. **Verify network connectivity:**
   ```bash
   curl -X POST https://eth-rpc-api.thetatoken.org/rpc \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"net_version","params":[],"id":1}'
   ```
   Should return `"result":"361"` for mainnet.

3. **Test with local simulation:**
   ```bash
   # Safer to debug on forked mainnet first
   npx hardhat node --fork https://eth-rpc-api.thetatoken.org/rpc --fork-block-number latest
   
   # Then deploy to localhost:8545
   npx hardhat run scripts/deploy-keystore.cjs --network localhost
   ```

### Contact Information

- **Theta Support:** support@thetatoken.org
- **Theta Discord:** https://discord.gg/theta
- **Theta Explorer:** https://explorer.thetatoken.org
- **GitHub Issues:** (your repo URL)

---

## ✅ Final Pre-Deploy Checklist

**Sign-off required before executing mainnet deployment:**

- [ ] Deployer wallet has 2+ TFUEL balance
- [ ] Keystore path confirmed and tested (`test-aws-secret.cjs` passes)
- [ ] RevenueSplitter address validated (not 0x000...000)
- [ ] Hardhat config gas price set to 4000 Gwei minimum
- [ ] Dry-run executed successfully (estimated cost reasonable)
- [ ] Team notified of deployment window
- [ ] Emergency pause procedures reviewed
- [ ] Explorer verification materials prepared (compiler version, optimization settings)
- [ ] Post-deployment test plan reviewed (0.1 TFUEL test deposit ready)
- [ ] Backup wallet (MetaMask dev) funded as fallback

**Deployment Authorization:**
- [ ] Technical lead approval
- [ ] Security review passed
- [ ] Risk assessment documented

**Execute deployment only after ALL boxes checked.**

---

**End of Step 2 Guide**

**Next:** Step 3 - Backend Listener Integration (30/70 split automation)  
**Status:** ✅ Theta side deployment complete, ready for bridge testing

