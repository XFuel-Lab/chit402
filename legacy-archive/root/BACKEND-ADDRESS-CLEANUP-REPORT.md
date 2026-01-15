# Backend Address Cleanup Report
**Generated:** January 14, 2026  
**Purpose:** Identify all old/placeholder addresses, dummy values, and test configurations requiring cleanup  
**Status:** ⚠️ Analysis Complete - No Changes Made Yet

---

## 🎯 Executive Summary

This report catalogs all instances of placeholder addresses, test configurations, and hardcoded values found across deployment scripts, backend services, documentation, and configuration files. These require review and cleanup before production deployment.

### Key Findings:
- **12** instances of deployer address `persistence1cgzppukxwdzmhmm342mgrf00atkk8nvg4azpfy`
- **25** instances of LP treasury address `persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj`
- **38** instances of placeholder code IDs `123`/`124`
- **72+** instances of generic placeholder addresses (persistence1k4q9w..., persistence1x5q8...)
- **9** references to unknown transaction recipient `persistence1slvzs8lgpaxdxc682hemjmlqyjuj9aphhza4qt`
- **Multiple** dummy/mock addresses in backend configuration
- **Numerous** instances of placeholder ellipsis patterns (`persistence1...`, `0x...`)

---

## 📋 Category 1: Deployer Address (persistence1cgzppukxwdzmhmm342mgrf00atkk8nvg4azpfy)

### Context
This appears to be a real mainnet deployer address used in documentation and examples.

### Locations Found (12 instances):

#### Documentation Files
1. **KEPLR_SECURITY_CHECKLIST.md:24**
   ```
   Context: Transaction History Review
   1. Go to: https://www.mintscan.io/persistence/account/persistence1cgzppukxwdzmhmm342mgrf00atkk8nvg4azpfy
   ```

2. **SECURITY_AUDIT_GUIDE.md:223**
   ```
   Context: Export Transaction History
   1. Go to: https://www.mintscan.io/persistence/account/persistence1cgzppukxwdzmhmm342mgrf00atkk8nvg4azpfy
   ```

3. **DOCKER_FIX_GUIDE.md:155**
   ```
   Context: Configuration
   - **Admin**: persistence1cgzppukxwdzmhmm342mgrf00atkk8nvg4azpfy
   ```

4. **DOCKER_FIX_GUIDE.md:189**
   ```
   Context: Explorer Links
   - **Account**: https://www.mintscan.io/persistence/account/persistence1cgzppukxwdzmhmm342mgrf00atkk8nvg4azpfy
   ```

5. **DOCKER_FIX_GUIDE.md:276**
   ```
   Context: Output Example
   ✅ Wallet loaded: persistence1cgzppukxwdzmhmm342mgrf00atkk8nvg4azpfy
   ```

6. **DEPLOYMENT_STATUS.md:35**
   ```
   Context: Wallet Info
   - **Address**: `persistence1cgzppukxwdzmhmm342mgrf00atkk8nvg4azpfy`
   - **Balance**: 244.847 XPRT (sufficient ✅)
   ```

7. **DEPLOYMENT_STATUS.md:72**
   ```
   Context: Deployment Instructions
   export DEPLOYER_ADDR=persistence1cgzppukxwdzmhmm342mgrf00atkk8nvg4azpfy
   ```

8. **DEPLOYMENT_STATUS.md:150**
   ```
   Context: Current deployment targets
   - **Admin**: persistence1cgzppukxwdzmhmm342mgrf00atkk8nvg4azpfy
   ```

9. **COMPLETE_DEPLOYMENT_SOLUTION.md:135**
   ```
   Context: Instantiating ZK Verifier
   Admin: persistence1cgzppukxwdzmhmm342mgrf00atkk8nvg4azpfy
   ```

10. **COMPLETE_DEPLOYMENT_SOLUTION.md:141**
    ```
    Context: Instantiating ibcTFUEL Minter
    Admin: persistence1cgzppukxwdzmhmm342mgrf00atkk8nvg4azpfy
    ```

11. **COMPLETE_DEPLOYMENT_SOLUTION.md:155**
    ```
    Context: Deployment Summary
    Deployer: persistence1cgzppukxwdzmhmm342mgrf00atkk8nvg4azpfy
    ```

12. **COMPLETE_DEPLOYMENT_SOLUTION.md:307**
    ```
    Context: Testnet Instructions
    - Request tokens for your address: `persistence1cgzppukxwdzmhmm342mgrf00atkk8nvg4azpfy`
    ```

### ⚠️ Action Required:
- **Verify** if this is the intended production deployer address
- **Replace** with generic placeholder (`persistence1...`) in documentation
- **Keep** only in actual deployment configuration files (not committed to git)

---

## 📋 Category 2: LP Treasury Address (persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj)

### Context
This is a hardcoded LP Treasury address for Persistence chain used extensively in contracts and tests.

### Locations Found (25 instances):

#### Smart Contracts (Hardcoded)
1. **contracts/RevSplitterHybrid.sol:15**
   ```solidity
   * - LPTreasuryAddr: persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj (Persistence - LP Treasury)
   ```

2. **contracts/RevSplitterHybrid.sol:48**
   ```solidity
   string public lpTreasuryAddr;           // persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj
   ```

3. **contracts/RevSplitterHybridV2.sol:24**
   ```solidity
   * LP Treasury: persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj (Persistence/IBC)
   ```

#### Test Files
4. **test/RevSplitterHybridV2.test.cjs:16**
   ```javascript
   const LP_TREASURY_ADDR = 'persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj'
   ```

5. **test/RevSplitterHybrid.test.cjs:17**
   ```javascript
   const LP_TREASURY_ADDR = 'persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj'
   ```

6. **test/HybridFlow.Integration.test.cjs:60**
   ```javascript
   'persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj', // Mock Persistence LP treasury
   ```

7. **test/HybridFlow.Integration.test.cjs:104**
   ```javascript
   expect(await revSplitter.lpTreasuryAddr()).to.equal('persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj');
   ```

#### Deployment Scripts
8. **scripts/deploy-revsplitter-v2.cjs:15** (theta-mainnet)
   ```javascript
   lpTreasuryAddr: 'persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj',
   ```

9. **scripts/deploy-revsplitter-v2.cjs:23** (theta-testnet)
   ```javascript
   lpTreasuryAddr: 'persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj',
   ```

10. **scripts/deploy-revsplitter-v2.cjs:32** (local)
    ```javascript
    lpTreasuryAddr: 'persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj',
    ```

11. **scripts/deploy-revsplitter-hybrid.cjs:34**
    ```javascript
    const LP_TREASURY_ADDR = 'persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj'
    ```

12. **scripts/verify-revsplitter.cjs:74**
    ```javascript
    const EXPECTED_LP = 'persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj'
    ```

13. **scripts/simulate-hybrid-flow.cjs:151**
    ```javascript
    'persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj', // Mock Persistence LP treasury
    ```

14. **scripts/simulate-hybrid-flow.cjs:399**
    ```javascript
    logInfo('Destination: persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj');
    ```

#### Documentation (15 more instances)
- REVSPLITTER_V2_QUICK_REF.md:198
- REVSPLITTER_DELIVERY.md:58, 313
- REVSPLITTER_QUICK_REF.md:13
- REVSPLITTER_HYBRID_README.md:41
- REVSPLITTER_V2_SUMMARY.md:352
- docs/env-revsplitter-example.txt:48
- docs/HYBRID_FLOW_SIMULATION.md:124
- docs/RevSplitterHybrid.md:22
- contracts/RevSplitterHybridV2.README.md:167, 185

### ⚠️ Action Required:
- **Verify** if this is the correct production LP treasury address
- **Document** address ownership and control
- **Consider** making this configurable via deployment parameters instead of hardcoded

---

## 📋 Category 3: Placeholder Code IDs (123, 124)

### Context
Example code IDs used throughout documentation to represent ZK Verifier (123) and Minter (124) contracts.

### Locations Found (38 instances):

#### Documentation Examples
1. **cosmwasm-contracts/persistence-minter/DEPLOYMENT.md:83**
   ```bash
   export CODE_ID=123  # Replace with actual code ID
   ```

2. **cosmwasm-contracts/persistence-minter/DEPLOYMENT.md:275**
   ```bash
   export NEW_CODE_ID=124  # New code ID
   ```

3. **SYSTEM_OVERVIEW.md:326-327**
   ```
   ✅ ZK Verifier stored (Code ID: 123)
   ✅ Minter stored (Code ID: 124)
   ```

4-38. **Additional instances in:**
   - START_HERE_COSMWASM_OPTIMIZATION.md (lines 102-103)
   - START_HERE.md (lines 110-111, 140-141)
   - DOCKER_SETUP_COMPLETE.md (lines 297-298, 308-309)
   - DOCKER_FIX_GUIDE.md (lines 304, 309)
   - DOCKER_DEPLOYMENT_GUIDE.md (lines 144-145)
   - DEPLOYMENT_STATUS.md (line 62)
   - COSMWASM_OPTIMIZATION_WORKFLOW.md (lines 100, 105, 128-129)
   - COSMWASM_OPTIMIZATION_SUMMARY.md (lines 167-168)
   - COSMWASM_OPTIMIZATION_QUICKSTART.md (lines 190-191)
   - COSMWASM_OPTIMIZATION_QUICKREF.md (lines 67-68)
   - COMPLETE_DEPLOYMENT_SOLUTION.md (lines 119, 129, 280-281)
   - STEP4_QUICK_START.md (lines 63, 74)
   - STEP4_PERSISTENCE_DEPLOY_GUIDE.md (lines 321-322, 342)

### ⚠️ Action Required:
- **Replace** with actual deployed code IDs after deployment
- **Use** environment variables or configuration files instead of hardcoded values
- **Update** all documentation with real code IDs post-deployment

---

## 📋 Category 4: Placeholder Contract Addresses (persistence1k4q9w..., persistence1x5q8...)

### Context
Generic placeholder addresses used for Dexter Router and pStake contracts. These are FAKE and must be replaced.

### Critical Locations:

#### Backend Configuration (CRITICAL - Used in Runtime)
1. **backend/ibc/config.ts:28**
   ```typescript
   // Line 28 - FAKE PLACEHOLDER!
   dexterRouterAddress: process.env.PERSISTENCE_DEXTER_ROUTER || 'persistence1k4q9wtawxxk6v2x5v4t9q8r3j9w3j9j0j0j0j0',
   ```
   **⚠️ CRITICAL:** This is used as a fallback in the actual backend service!

2. **backend/ibc/config.ts:31**
   ```typescript
   // Line 31 - FAKE PLACEHOLDER!
   pstakeStakingAddress: process.env.PSTAKE_STAKING_CONTRACT || 'persistence1x5q8j0j0j0j0j0j0j0j0j0j0j0j0j0j0j0j0j0',
   ```
   **⚠️ CRITICAL:** This is used as a fallback in the actual backend service!

#### Environment Files
3. **env.example:22**
   ```bash
   PERSISTENCE_DEXTER_ROUTER=persistence1k4q9wtawxxk6v2x5v4t9q8r3j9w3j9j0j0j0j0
   ```

4. **env.example:26**
   ```bash
   PSTAKE_STAKING_CONTRACT=persistence1x5q8j0j0j0j0j0j0j0j0j0j0j0j0j0j0j0j0j0
   ```

#### Documentation (60+ instances)
- Found in 15+ documentation files with these placeholder addresses
- Files include: IBC_QUICK_START.md, PERSISTENCE_CONTRACTS.md, TESTING_DEPLOYMENT_PLAN.md, DEPLOYMENT_READINESS.md, docs/IBC_CHANNEL_190_IMPLEMENTATION.md, and more

### ⚠️ Action Required:
- **URGENT:** Remove fallback values from `backend/ibc/config.ts`
- **URGENT:** Require these addresses to be set in environment variables
- **Update** env.example with instructions to find real addresses
- **Update** all documentation with real addresses or clear "TODO" markers

---

## 📋 Category 5: Unknown Transaction Recipient (persistence1slvzs8lgpaxdxc682hemjmlqyjuj9aphhza4qt)

### Context
This address received 244.77 XPRT in a lost transaction. Origin unknown but referenced in security documents.

### Locations Found (9 instances):

1. **TRANSACTION_LOSS_ANALYSIS.md:72-73**
   ```
   OR - The address `persistence1slvzs8lgpaxdxc682hemjmlqyjuj9aphhza4qt` was:
     * In your .env file at the time
   ```

2. **TRANSACTION_LOSS_ANALYSIS.md:79**
   ```
   ## 🔍 Possible Origins of `persistence1slvzs8lgpaxdxc682hemjmlqyjuj9aphhza4qt`:
   ```

3-5. **TRANSACTION_LOSS_ANALYSIS.md:87-89**
   ```bash
   PERSISTENCE_DEFAULT_RECIPIENT=persistence1slvzs8lgpaxdxc682hemjmlqyjuj9aphhza4qt
   TREASURY_FALLBACK_ADDRESS=persistence1slvzs8lgpaxdxc682hemjmlqyjuj9aphhza4qt
   TEST_RECIPIENT=persistence1slvzs8lgpaxdxc682hemjmlqyjuj9aphhza4qt
   ```

6. **TRANSACTION_LOSS_ANALYSIS.md:95**
   ```bash
   git log --all -S "persistence1slvzs8lgpaxdxc682hemjmlqyjuj9aphhza4qt"
   ```

7. **TRANSACTION_LOSS_ANALYSIS.md:146**
   ```
   5. See if any address matches: `persistence1slvzs8lgpaxdxc682hemjmlqyjuj9aphhza4qt`
   ```

8. **KEPLR_SECURITY_CHECKLIST.md:20**
   ```
   3. Specifically check if `persistence1slvzs8lgpaxdxc682hemjmlqyjuj9aphhza4qt` is there
   ```

9. **SECURITY_AUDIT_GUIDE.md:400**
   ```
   - Receiving address: persistence1slvzs8lgpaxdxc682hemjmlqyjuj9aphhza4qt
   ```

### ⚠️ Action Required:
- **Investigate** origin of this address via git history
- **Check** Keplr wallet for this address
- **Verify** if this was a test address or external wallet
- **Document** findings for security audit

---

## 📋 Category 6: Mock/Dummy Values in Backend

### Context
Test and mock addresses used in backend configuration and proof generation.

### Locations Found:

#### Backend Theta Bridge - env.example
1. **backend/theta-bridge/env.example:5**
   ```bash
   VAULT_FACTORY_ADDRESS=0x1234567890123456789012345678901234567890
   ```

2. **backend/theta-bridge/env.example:30**
   ```bash
   PERSISTENCE_MINTER_CONTRACT=xpersistence1...
   ```
   **Note:** Invalid prefix (should be `persistence1`, not `xpersistence1`)

3. **backend/theta-bridge/env.example:41**
   ```bash
   REVENUE_SPLITTER_ADDRESS=0x1234567890123456789012345678901234567890
   ```

4. **backend/theta-bridge/env.example:43**
   ```bash
   SWAP_ROUTER_ADDRESS=0x1234567890123456789012345678901234567890
   ```

#### Proof Generator Mock Values
5. **core-modules/zk/proof-generator.js:162-164**
   ```javascript
   // Identity commitment (for non-malleability)
   const identitySecret = identity ? BigInt(identity.secret) : BigInt('12345');
   const identityNullifier = identity ? BigInt(identity.nullifier) : BigInt('67890');
   const identityTrapdoor = identity ? BigInt(identity.trapdoor) : BigInt('11111');
   ```

6. **core-modules/zk/proof-generator.js:222-227**
   ```javascript
   // Generate mock identity commitment
   const mockIdentity = {
     secret: '12345',
     nullifier: '67890',
     trapdoor: '11111',
     commitment: '99999'
   };
   ```

#### Mobile Mock Wallet
7. **edgefarm-mobile/src/lib/mockWalletSimple.ts:22**
   ```typescript
   const MOCK_ADDRESS = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb'
   ```

8. **edgefarm-mobile/src/lib/mockWalletSimple.ts:119**
   ```typescript
   export function getRouterAddress(): string {
     return '0xMockRouterAddress'
   }
   ```

#### Dummy Verifier Comment
9. **cosmwasm/ibc-tfuel-minter/src/contract.rs:155**
   ```rust
   // Dummy message type for ZK verifier (actual contract defines this)
   ```

### ⚠️ Action Required:
- **Replace** all `0x1234...` addresses in env.example with real addresses or clear TODOs
- **Fix** invalid `xpersistence1` prefix
- **Document** that mock proof values are for testing only
- **Ensure** mock wallet is never used in production builds

---

## 📋 Category 7: Ellipsis Placeholders (persistence1..., 0x...)

### Context
Generic placeholder patterns used throughout documentation to indicate "insert address here".

### Pattern Types Found:
1. `persistence1...` - Generic Persistence address placeholder
2. `persistence1verifier...` - ZK Verifier address placeholder
3. `persistence1revsplitter...` - RevSplitter address placeholder
4. `persistence1minter...` - Minter address placeholder
5. `persistence1zkverifier...` - Alternative ZK Verifier placeholder
6. `persistence1abc...` - Example address placeholder
7. `0x...` - Generic Ethereum address placeholder
8. `ibc/...` - IBC denomination placeholder

### High-Impact Locations (20 most critical):

1. **env.example:37**
   ```bash
   TFUEL_IBC_DENOM=ibc/...
   ```
   **⚠️ CRITICAL:** Required for IBC transfers, must be real hash

2. **REVSPLITTER_V2_QUICK_REF.md:99**
   ```javascript
   await revSplitter.setLPTreasury('persistence1newaddress...')
   ```

3-10. **CosmWasm Deployment Documentation:**
   - cosmwasm-contracts/persistence-minter/COMPLETE_DEPLOYMENT_GUIDE.md:166-167
   - cosmwasm-contracts/persistence-minter/README_ENHANCED.md:149-150
   - PERSISTENCE_MINTER_DELIVERY.md:352-353
   - PERSISTENCE_MINTER_SUMMARY.md:141-142
   - cosmwasm-contracts/persistence-minter/DEPLOYMENT.md:86-87, 119, 189

11-20. **Docker/Deployment Examples:**
   - START_HERE.md:142-143
   - DOCKER_SETUP_COMPLETE.md:310-311
   - DOCKER_QUICK_START.md:80-81
   - DOCKER_DEPLOYMENT_GUIDE.md:526-527
   - COSMWASM_OPTIMIZATION_SUMMARY.md:169-170
   - COSMWASM_OPTIMIZATION_WORKFLOW.md:130-131
   - COSMWASM_OPTIMIZATION_QUICKSTART.md:192-193
   - STEP4_PERSISTENCE_DEPLOY_GUIDE.md:396, 438, 452-453

### Total Count: 72+ instances across documentation

### ⚠️ Action Required:
- **Critical:** Replace `ibc/...` in env.example with actual IBC denom hash
- **Update** all deployment examples with real addresses after deployment
- **Add** clear comments indicating which placeholders must be replaced
- **Consider** using environment variable references in docs instead of placeholders

---

## 📋 Category 8: Test/Mock Addresses in Deployment Scripts

### Context
Test addresses and mock configurations used in deployment and testing scripts.

### Locations Found:

#### Deployment Scripts - Zero Addresses
1. **scripts/deploy-revsplitter-v2.cjs:17-18** (theta-mainnet)
   ```javascript
   bbbContract: '0x0000000000000000000000000000000000000000',  // TODO: Set BBB contract address
   veXFYieldsDistributor: '0x0000000000000000000000000000000000000000',  // TODO: Set veXF distributor
   ```

2. **scripts/deploy-revsplitter-v2.cjs:25-26** (theta-testnet)
   ```javascript
   bbbContract: '0x0000000000000000000000000000000000000000',
   veXFYieldsDistributor: '0x0000000000000000000000000000000000000000',
   ```

#### Deployment Scripts - Deployer as Placeholder
3. **scripts/deploy-revsplitter-hybrid.cjs:89-90**
   ```javascript
   // For deployment, use placeholder addresses if not provided
   const bbbAddress = BBB_CONTRACT || signer.address // Use deployer as placeholder
   const veXFDistributorAddress = VEXF_DISTRIBUTOR || signer.address // Use deployer as placeholder
   ```

#### Verification Script Warnings
4. **scripts/verify-revsplitter.cjs:102-103**
   ```javascript
   console.log('  ⚠️  WARNING: BBB is placeholder (deployer address)')
   console.log('     Update with: await revSplitter.setBBBContract("0x...")')
   ```

5. **scripts/verify-revsplitter.cjs:117-118**
   ```javascript
   console.log('  ⚠️  WARNING: Distributor is placeholder (deployer address)')
   console.log('     Update with: await revSplitter.setVeXFYieldsDistributor("0x...")')
   ```

#### Mock Signer Generation
6. **scripts/testnet-deploy-security.ts:165-168**
   ```typescript
   for (let i = 0; i < 5; i++) {
     const wallet = ethers.Wallet.createRandom().connect(ethers.provider)
     mockSigners.push(wallet.address)
     deployment.signers.push(wallet.address)
   ```

### ⚠️ Action Required:
- **Remove** zero address placeholders from mainnet configuration
- **Require** all contract addresses to be explicitly set before deployment
- **Add** validation to reject zero addresses in production
- **Replace** mock signers with real multisig addresses for mainnet

---

## 📋 Category 9: Environment Variable Dependencies

### Context
Files that reference or require environment variable configuration.

### Critical Backend Dependencies:

1. **backend/theta-bridge/src/config.js** - **40+ environment variables**
   - THETA_RPC_URLS, VAULT_FACTORY_ADDRESS
   - REDIS_URL, RELAYER_PRIVATE_KEY
   - PERSISTENCE_MINTER_CONTRACT, REVENUE_SPLITTER_ADDRESS
   - And many more...

2. **backend/ibc/config.ts** - **12+ environment variables**
   - THETA_RPC_URL, THETA_DEPOSIT_ADDRESS
   - PERSISTENCE_RPC_URL, IBC_CHANNEL
   - PERSISTENCE_DEXTER_ROUTER ⚠️ (has fake fallback)
   - PSTAKE_STAKING_CONTRACT ⚠️ (has fake fallback)
   - TFUEL_IBC_DENOM ⚠️ (required, no valid fallback)

3. **backend/ibc/index.ts** - Requires:
   - IBC_WALLET_MNEMONIC ⚠️ (CRITICAL - exits if not set)
   - IBC_PORT, DB_FILE

### Validation Logic Found:

**backend/ibc/config.ts:111-146** - `validateIbcConfig()` function:
```typescript
export function validateIbcConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!IBC_CONFIG.theta.depositAddress) {
    errors.push('THETA_DEPOSIT_ADDRESS not configured')
  }

  if (!IBC_CONFIG.persistence.dexterRouterAddress.startsWith('persistence1')) {
    errors.push('Invalid DEXTER_ROUTER_ADDRESS (must start with persistence1)')
  }

  // Bug fix: Validate tfuelIbcDenom is not empty and not a placeholder
  if (IBC_CONFIG.ibc.tfuelIbcDenom === 'ibc/...' || IBC_CONFIG.ibc.tfuelIbcDenom.includes('...')) {
    errors.push('TFUEL_IBC_DENOM contains placeholder value - must be a real IBC denom hash')
  }
  // ... more validation
}
```

### ⚠️ Action Required:
- **Run** validation before any production deployment
- **Remove** all fallback values that use fake addresses
- **Create** deployment checklist requiring all critical env vars to be set
- **Add** startup validation that exits if critical vars are missing/invalid

---

## 📋 Category 10: Docker Compose Environment References

### Context
Docker compose files that load environment configuration.

### Files Found:

1. **backend/theta-bridge/docker-compose.yml:16**
   ```yaml
   env_file:
     - .env
   ```

2. **docker-compose.yml:55**
   ```yaml
   env_file:
     - .env.docker
   ```

3. **docker-compose.yml:16-17**
   ```yaml
   env_file:
     - .env.local
     - .env
   ```

### ⚠️ Action Required:
- **Ensure** .env.docker is created for Docker deployments
- **Verify** all required variables are set in Docker environment
- **Never** commit .env, .env.local, or .env.docker files
- **Create** .env.example for each Docker service

---

## 📋 Category 11: Deployment Script Address References

### Context
Scripts that need to be updated with real deployed contract addresses.

### Scripts Requiring Updates:

1. **scripts/docker-test-mint.sh:12-13**
   ```bash
   if [ -z "$IBCTFUEL_MINTER_ADDRESS" ]; then
     echo "❌ IBCTFUEL_MINTER_ADDRESS not found in .env"
   ```

2. **scripts/deploy/docker-deploy-persistence.sh:318-319**
   ```bash
   ZK_VERIFIER_ADDRESS=$ZK_ADDR
   IBCTFUEL_MINTER_ADDRESS=$MINTER_ADDR
   ```

3. **deploy-persistence.ps1:189-190**
   ```powershell
   Write-Host "  - ZK_VERIFIER_ADDRESS" -ForegroundColor White
   Write-Host "  - IBCTFUEL_MINTER_ADDRESS" -ForegroundColor White
   ```

### ⚠️ Action Required:
- **Update** all scripts to read from .env after deployment
- **Add** validation to check addresses are set before running operations
- **Create** deployment output that writes addresses to .env automatically

---

## 🎯 Cleanup Priority Matrix

### Priority 1: CRITICAL (Must Fix Before ANY Production Use) 🔴

1. **backend/ibc/config.ts:28, 31** - Remove fake fallback addresses
   - Impact: Could cause runtime failures or send funds to invalid addresses
   - Action: Require env vars, remove fallbacks

2. **env.example:37** - TFUEL_IBC_DENOM=ibc/...
   - Impact: IBC transfers will fail without real denom hash
   - Action: Get real IBC denom hash from Persistence chain

3. **backend/ibc/index.ts:60** - IBC_WALLET_MNEMONIC validation
   - Impact: Already validated, but ensure it's never a test mnemonic
   - Action: Add pattern check to reject common test mnemonics

4. **backend/theta-bridge/env.example:30** - Fix `xpersistence1` typo
   - Impact: Invalid address format will cause failures
   - Action: Change to `persistence1...`

### Priority 2: HIGH (Required for Mainnet Deployment) 🟠

1. **Replace all `persistence1cgzppukxwdzmhmm342mgrf00atkk8nvg4azpfy`**
   - If this is NOT your production address, replace in all docs
   - If it IS, ensure private keys are secured with hardware wallet

2. **Verify `persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj`**
   - Confirm this is the correct LP treasury address
   - Verify ownership and control mechanism

3. **Update code IDs 123/124**
   - Replace with real deployed code IDs after mainnet deployment
   - Update all documentation

4. **scripts/deploy-revsplitter-v2.cjs**
   - Replace zero addresses with real contract addresses
   - Add validation to reject zero addresses in mainnet config

### Priority 3: MEDIUM (Operational Best Practices) 🟡

1. **Investigate `persistence1slvzs8lgpaxdxc682hemjmlqyjuj9aphhza4qt`**
   - Run git log to find origin
   - Check Keplr wallet
   - Document findings

2. **Replace all `persistence1...` placeholders in documentation**
   - Use real addresses after deployment
   - Or clearly mark as "TODO: INSERT_ADDRESS_HERE"

3. **Update mock/test addresses in scripts**
   - Replace mock signers with real multisig for mainnet
   - Document test vs. production configurations

### Priority 4: LOW (Documentation & Cleanup) 🟢

1. **Clean up mobile mock wallet** (never used in web app)
2. **Update proof generator comments** about mock values
3. **Standardize placeholder format** across all docs
4. **Add address validation** to deployment scripts

---

## 🔍 Search Commands Used

For reference, here are the commands used to generate this report:

```bash
# Search for specific addresses
rg "persistence1cgzppuk" -C 2
rg "persistence1q50x9h" -C 2
rg "persistence1slvzs8l" -C 2

# Search for code IDs
rg "code.*id.*12[34]" -i -C 2

# Search for placeholder patterns
rg "persistence1[a-z0-9]{38,}" -C 1
rg "persistence1[a-z0-9]{5,10}\.\.\.+" -C 2

# Search for dummy/mock/test addresses
rg "dummy.*verifier|verifier.*dummy" -i -C 2
rg "dummy.*minter|minter.*dummy" -i -C 2
rg "test.*address|placeholder.*address|mock.*address|dummy.*address" -i -C 2

# Search for environment variable usage
rg "\.env\.|env\.example|\.env$" -C 2 backend/

# Search for memo usage
rg "memo.*burn|burn.*memo" -i -C 2
```

---

## 📝 Recommended Next Steps

### Phase 1: Immediate Actions (Before ANY Production Use)
1. ✅ **Review this report** - Identify which addresses are real vs. placeholder
2. ⚠️ **Remove fake fallbacks** in backend/ibc/config.ts
3. ⚠️ **Get real IBC denom hash** for TFUEL on Persistence
4. ⚠️ **Validate all environment variables** are set correctly

### Phase 2: Pre-Deployment Checklist
1. ✅ **Create deployment environment file** with all real addresses
2. ✅ **Update env.example** with instructions for finding real addresses
3. ✅ **Run validation script** to check all required vars are set
4. ✅ **Test with small amounts** on testnet first

### Phase 3: Post-Deployment Updates
1. ✅ **Update all documentation** with real deployed addresses
2. ✅ **Replace code ID placeholders** (123/124) with real values
3. ✅ **Archive test/mock configurations** in separate directory
4. ✅ **Create production deployment guide** with real values

### Phase 4: Security Hardening
1. ✅ **Investigate unknown address** (persistence1slvzs8l...)
2. ✅ **Audit all environment files** to ensure no test values remain
3. ✅ **Enable address validation** in smart contracts
4. ✅ **Document all production addresses** in secure location

---

## 📊 Statistics Summary

| Category | Count | Priority |
|----------|-------|----------|
| Deployer Address References | 12 | HIGH 🟠 |
| LP Treasury Address References | 25 | HIGH 🟠 |
| Code ID Placeholders (123/124) | 38 | MEDIUM 🟡 |
| Generic Placeholder Addresses | 72+ | MEDIUM 🟡 |
| Unknown Transaction Recipient | 9 | MEDIUM 🟡 |
| Backend Mock/Dummy Values | 9 | HIGH 🟠 |
| Ellipsis Placeholders | 72+ | LOW 🟢 |
| Test Addresses in Scripts | 10+ | HIGH 🟠 |
| Environment Variable Dependencies | 50+ | CRITICAL 🔴 |
| Docker Environment Files | 3 | MEDIUM 🟡 |

**Total Items Requiring Review:** 300+  
**Critical Items:** 4  
**High Priority Items:** 50+

---

## ⚠️ DISCLAIMER

This report is for REVIEW purposes only. **NO CHANGES have been made to any files.**

Before making any changes:
1. ✅ Review all findings with the development team
2. ✅ Verify which addresses are legitimate vs. placeholders
3. ✅ Create a backup of current configuration
4. ✅ Test all changes on testnet first
5. ✅ Document all production addresses securely

---

**Report Generated:** January 14, 2026  
**Tool:** Cursor AI + ripgrep  
**Scope:** Full repository scan  
**Status:** ✅ Analysis Complete - Awaiting Review
