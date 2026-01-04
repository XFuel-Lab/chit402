# XFuelLab ZK Bridge Hybrid - Mainnet Rollout Plan
## Pre-Audit Minimal Deployment (3-5 Days)

**Version:** 1.0  
**Date:** January 2026  
**Status:** PRE-AUDIT DEPLOYMENT - LIMITED CAPACITY

---

## 🎯 Deployment Overview

### Completed Phases (Ready for Mainnet)
- ✅ **Phase 1:** Theta Vaults with Reverse-Burn Mechanism
- ✅ **Phase 2:** Backend Listener with 30/70 Loop Distribution
- ✅ **Phase 3:** Persistence Minter with Mint/Burn/Pre-fund
- ✅ **Phase 4:** UI with Governance Extras
- ✅ **Phase 5:** RevSplitter with 30/30/25/15 Split Logic

### Pre-Audit Safety Constraints
```yaml
Transaction Limits:
  - Max Deposit: 0.1 TFUEL per transaction
  - Max Mint: 0.1 XPRT per transaction
  - Daily Cap: 1.0 TFUEL total (first 24h)
  
Safety Features:
  - Pause mechanism: ENABLED
  - Emergency shutdown: ENABLED
  - Admin multisig: REQUIRED for unpause
  - Timelock: 6 hours minimum for parameter changes
```

### Test Wallets Configuration
```yaml
Theta Network:
  Deployer: "0x..." # Web wallet - contract deployment
  Relayer: "0x..."  # Web wallet - backend operations
  Treasury: "0x..." # Web wallet - fee collection
  
Persistence Network:
  Personal: "persistence1..." # Keplr - general testing
  Multisig: "persistence1..." # Keplr - governance
  Signer2: "persistence1..."  # Keplr - multisig co-signer
```

---

## 🚨 CRITICAL WARNINGS & GATES

### ⛔ STOP CONDITIONS (Abort Deployment)
1. **Any contract fails verification on explorer**
2. **Gas costs exceed 2M units for any transaction**
3. **Backend fails to detect events within 30 seconds**
4. **Any wallet shows unexpected balance changes**
5. **RevSplitter ratios don't sum to 100%**
6. **Pause mechanism fails to activate**

### 🔐 Security Gates (Must Pass Before Next Phase)
- [ ] All private keys stored in encrypted vault
- [ ] Multisig requires 2/3 signatures minimum
- [ ] Backend service runs in isolated environment
- [ ] All RPC endpoints use rate limiting
- [ ] Contract source verified on explorers
- [ ] Emergency contact list distributed to team

### ⚠️ Risk Assessment Matrix

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Smart contract exploit | Low | Critical | Pause enabled, minimal funds |
| Backend listener failure | Medium | High | Manual fallback, monitoring |
| Oracle manipulation | Low | High | Use multiple price feeds |
| Front-running attacks | Medium | Medium | Private RPC, slippage limits |
| Network congestion | Medium | Low | Gas price buffers |
| User error (wrong amount) | High | Low | UI confirmations, limits |

---

## 📅 DAY 1: THETA MAINNET DEPLOYMENT

### Morning (Hours 0-4): Contract Deployment

#### Pre-Deployment Checklist
- [ ] Verify Theta mainnet RPC is responsive
- [ ] Confirm deployer wallet has 100+ TFUEL for gas
- [ ] Backup all deployment keys to secure location
- [ ] Set up monitoring alerts (PagerDuty/Telegram)
- [ ] Take snapshot of current contract state (testnet)

#### 1.1: Deploy Core Contracts (Theta Mainnet)

**VaultFactory.sol Deployment**
```bash
# Navigate to contract directory
cd contracts

# Compile with optimizations
npx hardhat compile --network theta-mainnet

# Deploy VaultFactory with safety limits
npx hardhat run scripts/deploy-vault-factory.ts --network theta-mainnet

# Expected output:
# ✓ VaultFactory deployed at: 0x...
# ✓ Max deposit limit: 0.1 TFUEL
# ✓ Pause enabled: true
# ✓ Admin: 0x...

# SAVE THIS ADDRESS → VAULT_FACTORY_ADDRESS
```

**TFuelVault.sol Deployment**
```bash
# Deploy main vault through factory
npx hardhat run scripts/deploy-tfuel-vault.ts --network theta-mainnet \
  --factory 0x<VAULT_FACTORY_ADDRESS>

# Verify deployment parameters
npx hardhat verify --network theta-mainnet \
  0x<VAULT_ADDRESS> \
  --constructor-args scripts/verify-args/vault-args.js

# SAVE THIS ADDRESS → TFUEL_VAULT_ADDRESS
```

**RevenueSplitter.sol Deployment**
```bash
# Deploy with 30/30/25/15 split configuration
npx hardhat run scripts/deploy-revenue-splitter.ts --network theta-mainnet \
  --recipients '[
    {"address":"0x<STAKERS>","percent":30},
    {"address":"0x<DAO>","percent":30},
    {"address":"0x<LIQUIDITY>","percent":25},
    {"address":"0x<TEAM>","percent":15}
  ]'

# CRITICAL CHECK: Verify percentages sum to 100
# SAVE THIS ADDRESS → REV_SPLITTER_ADDRESS
```

#### 1.2: Configure Contract Parameters

```bash
# Set revenue splitter on vault
npx hardhat set-revenue-splitter \
  --vault 0x<TFUEL_VAULT_ADDRESS> \
  --splitter 0x<REV_SPLITTER_ADDRESS> \
  --network theta-mainnet

# Set backend relayer address
npx hardhat set-relayer \
  --vault 0x<TFUEL_VAULT_ADDRESS> \
  --relayer 0x<RELAYER_ADDRESS> \
  --network theta-mainnet

# Verify configuration
npx hardhat verify-config \
  --vault 0x<TFUEL_VAULT_ADDRESS> \
  --network theta-mainnet
```

#### Gate 1.A: Contract Verification ✋
- [ ] VaultFactory verified on Theta Explorer
- [ ] TFuelVault verified on Theta Explorer
- [ ] RevenueSplitter verified on Theta Explorer
- [ ] All addresses saved to `deployment-addresses.json`
- [ ] Configuration matches specification

### Afternoon (Hours 4-8): Theta Testing

#### 1.3: Test Deposit Flow

**Small Deposit Test (Deployer Wallet)**
```bash
# Test 0.01 TFUEL deposit (10% of limit)
npx hardhat deposit-test \
  --vault 0x<TFUEL_VAULT_ADDRESS> \
  --amount 0.01 \
  --from-wallet deployer \
  --network theta-mainnet

# Expected events:
# - DepositReceived(user, amount, timestamp)
# - BurnEvent(amount * reverseBurnRate)
# - FeeCollected(amount * feeRate)

# Verify on explorer:
# - Transaction confirmed within 2 blocks
# - Event logs show correct values
# - Deployer balance reduced by 0.01 + gas
```

**Maximum Deposit Test (Deployer Wallet)**
```bash
# Test maximum allowed deposit
npx hardhat deposit-test \
  --vault 0x<TFUEL_VAULT_ADDRESS> \
  --amount 0.1 \
  --from-wallet deployer \
  --network theta-mainnet

# Should succeed and hit limit

# Test over-limit (should FAIL)
npx hardhat deposit-test \
  --vault 0x<TFUEL_VAULT_ADDRESS> \
  --amount 0.11 \
  --from-wallet deployer \
  --network theta-mainnet

# Expected: Transaction reverts with "Exceeds max deposit limit"
```

#### 1.4: Test Fee Distribution

```bash
# Trigger fee distribution to RevenueSplitter
npx hardhat distribute-fees \
  --vault 0x<TFUEL_VAULT_ADDRESS> \
  --network theta-mainnet

# Verify recipient balances increased:
npx hardhat check-balances \
  --splitter 0x<REV_SPLITTER_ADDRESS> \
  --network theta-mainnet

# Expected distribution:
# - Stakers: 30% of collected fees
# - DAO: 30% of collected fees
# - Liquidity: 25% of collected fees
# - Team: 15% of collected fees
```

#### Gate 1.B: Theta Functionality ✋
- [ ] Deposits work with correct event emissions
- [ ] Maximum limit enforced (0.1 TFUEL)
- [ ] Over-limit transactions revert
- [ ] Reverse-burn mechanism executes
- [ ] Fee collection works (30/70 split to RevSplitter/Bridge)
- [ ] RevenueSplitter distributes correctly (30/30/25/15)
- [ ] All transaction hashes recorded

### Evening (Hours 8-10): Pause Mechanism Test

#### 1.5: Emergency Controls

```bash
# Test pause function
npx hardhat pause-vault \
  --vault 0x<TFUEL_VAULT_ADDRESS> \
  --network theta-mainnet

# Attempt deposit while paused (should FAIL)
npx hardhat deposit-test \
  --vault 0x<TFUEL_VAULT_ADDRESS> \
  --amount 0.01 \
  --network theta-mainnet

# Expected: "Contract is paused"

# Test unpause (requires multisig)
npx hardhat unpause-vault \
  --vault 0x<TFUEL_VAULT_ADDRESS> \
  --multisig true \
  --network theta-mainnet

# Verify deposit works again
npx hardhat deposit-test \
  --vault 0x<TFUEL_VAULT_ADDRESS> \
  --amount 0.01 \
  --network theta-mainnet
```

#### Gate 1.C: Safety Mechanisms ✋
- [ ] Pause activates immediately
- [ ] Paused contract rejects all deposits
- [ ] Unpause requires multisig approval
- [ ] Emergency shutdown tested (DO NOT ACTIVATE LIVE)
- [ ] Relayer can still query events when paused

### Day 1 Summary Checklist
- [ ] All Theta contracts deployed and verified
- [ ] Deposit limits enforced (0.1 TFUEL max)
- [ ] Fee distribution works (30/70 then 30/30/25/15)
- [ ] Reverse-burn mechanism functional
- [ ] Pause/unpause tested successfully
- [ ] All test transactions recorded in `day1-tests.json`
- [ ] Treasury wallet has received test fees
- [ ] No unexpected errors in any transaction

---

## 📅 DAY 2: BACKEND LISTENER DEPLOYMENT

### Morning (Hours 0-4): Infrastructure Setup

#### Pre-Deployment Checklist
- [ ] Backend server provisioned (AWS/GCP/Azure)
- [ ] Firewall configured (only necessary ports open)
- [ ] Environment variables configured in `.env.production`
- [ ] Redis/Database connection tested
- [ ] Logging service configured (CloudWatch/Datadog)

#### 2.1: Configure Backend Environment

**Create Production Environment File**
```bash
# Create .env.production
cat > .env.production << EOF
# Theta Network
THETA_RPC_URL=https://eth-rpc-api.thetatoken.org/rpc
THETA_VAULT_ADDRESS=0x<TFUEL_VAULT_ADDRESS>
THETA_RELAYER_PRIVATE_KEY=<ENCRYPTED_KEY>
THETA_START_BLOCK=<DEPLOYMENT_BLOCK>

# Persistence Network
PERSISTENCE_RPC_URL=https://rpc.core-1.persistence.one
PERSISTENCE_MINTER_ADDRESS=persistence1<MINTER_ADDRESS>
PERSISTENCE_RELAYER_MNEMONIC=<ENCRYPTED_MNEMONIC>

# Bridge Configuration
LOOP_PERCENTAGE_TO_MINT=30
LOOP_PERCENTAGE_TO_BURN=70
MAX_MINT_AMOUNT=0.1
MAX_BURN_AMOUNT=0.1
EVENT_POLLING_INTERVAL=10000

# Safety Settings
ENABLE_RATE_LIMITING=true
MAX_REQUESTS_PER_MINUTE=30
DRY_RUN_MODE=false
ALERT_WEBHOOK=<SLACK_OR_TELEGRAM>

# Database
REDIS_URL=redis://localhost:6379
POSTGRES_URL=postgresql://user:pass@localhost:5432/xfuel

EOF

# Encrypt sensitive values
npx hardhat encrypt-env --file .env.production
```

#### 2.2: Deploy Backend Service

```bash
# Navigate to backend directory
cd backend

# Install dependencies
npm ci --production

# Build TypeScript
npm run build

# Run database migrations
npm run migrate:production

# Start service with PM2 (process manager)
pm2 start ecosystem.config.js --env production

# Verify service is running
pm2 status

# Expected output:
# ┌─────┬──────────────┬─────────┬─────────┬─────────┬──────────┐
# │ id  │ name         │ status  │ restart │ uptime  │ cpu      │
# ├─────┼──────────────┼─────────┼─────────┼─────────┼──────────┤
# │ 0   │ xfuel-bridge │ online  │ 0       │ 2s      │ 1%       │
# └─────┴──────────────┴─────────┴─────────┴─────────┴──────────┘

# Check logs
pm2 logs xfuel-bridge --lines 50
```

#### Gate 2.A: Backend Initialization ✋
- [ ] Service starts without errors
- [ ] RPC connections established (Theta + Persistence)
- [ ] Database migrations completed
- [ ] Event listener subscribed to Theta vault
- [ ] Health check endpoint responds (HTTP 200)
- [ ] Monitoring dashboard shows metrics

### Afternoon (Hours 4-8): Backend Testing

#### 2.3: Test Event Detection

**Trigger Deposit on Theta (From Day 1 Wallet)**
```bash
# Make a new deposit on Theta
cd contracts
npx hardhat deposit-test \
  --vault 0x<TFUEL_VAULT_ADDRESS> \
  --amount 0.05 \
  --from-wallet deployer \
  --network theta-mainnet

# Note the transaction hash: 0x<TX_HASH>
```

**Monitor Backend Logs**
```bash
# Watch backend logs for event detection
pm2 logs xfuel-bridge --raw | grep "DepositReceived"

# Expected output within 30 seconds:
# [2026-01-XX] INFO: DepositReceived event detected
# [2026-01-XX] INFO: TX: 0x<TX_HASH>
# [2026-01-XX] INFO: User: 0x<DEPLOYER>
# [2026-01-XX] INFO: Amount: 0.05 TFUEL
# [2026-01-XX] INFO: Calculating 30/70 split...
# [2026-01-XX] INFO: To Mint: 0.015 XPRT (30%)
# [2026-01-XX] INFO: To Burn: 0.035 TFUEL (70%)
# [2026-01-XX] INFO: Event stored in database

# Query database to verify
npm run db:query "SELECT * FROM bridge_events WHERE tx_hash='0x<TX_HASH>'"
```

#### 2.4: Test 30/70 Loop Calculation

**Verify Split Logic**
```bash
# Use backend API to verify calculation
curl -X POST http://localhost:3000/api/verify-split \
  -H "Content-Type: application/json" \
  -d '{
    "depositAmount": "0.05",
    "expectedMint": "0.015",
    "expectedBurn": "0.035"
  }'

# Expected response:
# {
#   "valid": true,
#   "calculated": {
#     "mint": "0.015",
#     "burn": "0.035"
#   },
#   "percentages": {
#     "mint": 30,
#     "burn": 70
#   }
# }
```

#### 2.5: Test Unwrap Flow (Backend → Persistence)

**Simulate Unwrap Request**
```bash
# Backend should prepare Persistence mint transaction
# Check pending mints queue
curl http://localhost:3000/api/pending-mints

# Expected response:
# {
#   "pending": [
#     {
#       "id": "uuid",
#       "thetaTxHash": "0x<TX_HASH>",
#       "recipient": "persistence1<USER>",
#       "amount": "0.015",
#       "status": "ready_to_mint"
#     }
#   ]
# }

# Manually trigger mint (for testing)
curl -X POST http://localhost:3000/api/trigger-mint \
  -H "Content-Type: application/json" \
  -d '{"mintId": "uuid"}'

# Backend should log Persistence transaction preparation
# (Actual minting tested on Day 3)
```

#### Gate 2.B: Backend Functionality ✋
- [ ] Events detected within 30 seconds of Theta deposit
- [ ] 30/70 split calculated correctly
- [ ] Event data stored in database
- [ ] Pending mints queue populated
- [ ] No crashes or memory leaks after 4 hours
- [ ] Error handling works (test with invalid data)
- [ ] Rate limiting prevents spam

### Evening (Hours 8-10): Backend Stress Test

#### 2.6: Multiple Deposit Test

```bash
# Create 5 rapid deposits
for i in {1..5}; do
  npx hardhat deposit-test \
    --vault 0x<TFUEL_VAULT_ADDRESS> \
    --amount 0.02 \
    --from-wallet deployer \
    --network theta-mainnet &
done
wait

# Monitor backend processing
pm2 logs xfuel-bridge --lines 100

# Verify all 5 events detected
curl http://localhost:3000/api/stats

# Expected response:
# {
#   "totalEventsProcessed": 6,  # 1 from earlier + 5 new
#   "pendingMints": 6,
#   "failedEvents": 0,
#   "averageProcessingTime": "2.3s"
# }
```

#### Gate 2.C: Backend Reliability ✋
- [ ] All events processed (zero missed)
- [ ] No duplicate event processing
- [ ] Database transactions atomic
- [ ] Service remains stable under load
- [ ] Memory usage within acceptable range (<500MB)
- [ ] Logs show no errors or warnings

### Day 2 Summary Checklist
- [ ] Backend service deployed and running
- [ ] Event detection working (30s max latency)
- [ ] 30/70 split logic verified
- [ ] Database storing all events correctly
- [ ] Pending mints queue functional
- [ ] Multiple deposits handled without issues
- [ ] Monitoring alerts configured
- [ ] All backend tests passed

---

## 📅 DAY 3: PERSISTENCE MAINNET DEPLOYMENT

### Morning (Hours 0-4): Contract Deployment

#### Pre-Deployment Checklist
- [ ] Persistence RPC responsive
- [ ] Keplr wallet connected to mainnet
- [ ] Personal wallet has 100+ XPRT for gas
- [ ] CosmWasm binary compiled and optimized
- [ ] Contract checksums verified

#### 3.1: Deploy Minter Contract (Persistence Mainnet)

**Compile and Optimize Contract**
```bash
# Navigate to Persistence contract directory
cd persistence-contracts

# Optimize contract for deployment
docker run --rm -v "$(pwd)":/code \
  --mount type=volume,source="$(basename "$(pwd)")_cache",target=/code/target \
  --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
  cosmwasm/rust-optimizer:0.15.0

# Verify checksum
sha256sum artifacts/xfuel_minter.wasm

# Expected output:
# <CHECKSUM> artifacts/xfuel_minter.wasm
# SAVE THIS CHECKSUM for verification
```

**Upload Contract to Persistence**
```bash
# Upload Wasm binary
persistencecored tx wasm store artifacts/xfuel_minter.wasm \
  --from personal \
  --chain-id core-1 \
  --gas auto \
  --gas-adjustment 1.3 \
  --gas-prices 0.025uxprt \
  --node https://rpc.core-1.persistence.one:443 \
  -y

# Get code ID from transaction
# SAVE THIS CODE_ID → MINTER_CODE_ID

# Verify checksum on-chain
persistencecored query wasm code <CODE_ID> --node https://rpc.core-1.persistence.one:443
```

**Instantiate Minter Contract**
```bash
# Create instantiate message with safety limits
cat > instantiate-msg.json << EOF
{
  "admin": "persistence1<MULTISIG_ADDRESS>",
  "max_mint_amount": "100000",  // 0.1 XPRT (6 decimals)
  "max_burn_amount": "100000",
  "pre_fund_enabled": true,
  "pause_enabled": true,
  "relayer_address": "persistence1<RELAYER_ADDRESS>",
  "bridge_theta_address": "0x<TFUEL_VAULT_ADDRESS>"
}
EOF

# Instantiate contract
persistencecored tx wasm instantiate <CODE_ID> \
  "$(cat instantiate-msg.json)" \
  --from personal \
  --label "XFuelMinter-v1-Mainnet" \
  --admin persistence1<MULTISIG_ADDRESS> \
  --chain-id core-1 \
  --gas auto \
  --gas-adjustment 1.3 \
  --gas-prices 0.025uxprt \
  --node https://rpc.core-1.persistence.one:443 \
  -y

# Get contract address from transaction
# SAVE THIS ADDRESS → MINTER_CONTRACT_ADDRESS
```

#### 3.2: Pre-Fund Minter Contract

```bash
# Transfer XPRT tokens to minter for initial liquidity
persistencecored tx bank send personal \
  persistence1<MINTER_CONTRACT_ADDRESS> \
  1000000uxprt \
  --chain-id core-1 \
  --gas auto \
  --gas-prices 0.025uxprt \
  --node https://rpc.core-1.persistence.one:443 \
  -y

# Verify balance
persistencecored query bank balances persistence1<MINTER_CONTRACT_ADDRESS> \
  --node https://rpc.core-1.persistence.one:443

# Expected output:
# balances:
# - amount: "1000000"
#   denom: uxprt
```

#### Gate 3.A: Contract Verification ✋
- [ ] Contract uploaded with correct checksum
- [ ] Contract instantiated with safety limits
- [ ] Admin set to multisig address
- [ ] Relayer address configured
- [ ] Contract pre-funded with 1 XPRT
- [ ] Contract address saved to deployment config

### Afternoon (Hours 4-8): Persistence Testing

#### 3.3: Test Mint Flow

**Execute Test Mint (Backend Relayer)**
```bash
# Update backend with Persistence contract address
# Add to .env.production:
# PERSISTENCE_MINTER_ADDRESS=persistence1<MINTER_CONTRACT_ADDRESS>

# Restart backend
pm2 restart xfuel-bridge

# Trigger mint for pending deposits from Day 2
curl -X POST http://localhost:3000/api/process-pending-mints

# Monitor backend logs
pm2 logs xfuel-bridge --lines 50

# Expected output:
# [INFO] Processing mint for event: 0x<TX_HASH>
# [INFO] Mint amount: 0.015 XPRT
# [INFO] Recipient: persistence1<USER>
# [INFO] Executing Persistence transaction...
# [INFO] Persistence TX: <PERSISTENCE_TX_HASH>
# [INFO] Mint successful!
```

**Verify Mint on Persistence**
```bash
# Query minter contract state
persistencecored query wasm contract-state smart \
  persistence1<MINTER_CONTRACT_ADDRESS> \
  '{"mint_history":{"limit":10}}' \
  --node https://rpc.core-1.persistence.one:443

# Expected response:
# data:
#   mints:
#   - amount: "15000"  # 0.015 XPRT
#     recipient: "persistence1<USER>"
#     theta_tx_hash: "0x<TX_HASH>"
#     timestamp: "2026-01-XX"

# Check recipient balance increased
persistencecored query bank balances persistence1<USER> \
  --node https://rpc.core-1.persistence.one:443
```

#### 3.4: Test Burn Flow

**Initiate Burn Transaction**
```bash
# Create burn message
cat > burn-msg.json << EOF
{
  "burn": {
    "amount": "10000",  // 0.01 XPRT
    "theta_recipient": "0x<DEPLOYER_ADDRESS>"
  }
}
EOF

# Execute burn from personal wallet
persistencecored tx wasm execute \
  persistence1<MINTER_CONTRACT_ADDRESS> \
  "$(cat burn-msg.json)" \
  --from personal \
  --amount 10000uxprt \
  --chain-id core-1 \
  --gas auto \
  --gas-prices 0.025uxprt \
  --node https://rpc.core-1.persistence.one:443 \
  -y

# Backend should detect burn event and prepare Theta unlock
# Check backend logs
pm2 logs xfuel-bridge | grep "BurnEvent"

# Expected output:
# [INFO] BurnEvent detected on Persistence
# [INFO] Amount: 0.01 XPRT
# [INFO] Theta recipient: 0x<DEPLOYER_ADDRESS>
# [INFO] Preparing unlock transaction...
```

#### 3.5: Test Maximum Limits

```bash
# Test maximum mint (0.1 XPRT)
cat > max-mint-msg.json << EOF
{
  "mint": {
    "amount": "100000",  // 0.1 XPRT (at limit)
    "recipient": "persistence1<PERSONAL>",
    "theta_tx_hash": "0x<TEST_HASH>"
  }
}
EOF

# Should succeed
persistencecored tx wasm execute \
  persistence1<MINTER_CONTRACT_ADDRESS> \
  "$(cat max-mint-msg.json)" \
  --from personal \
  --chain-id core-1 \
  --gas auto \
  --gas-prices 0.025uxprt \
  --node https://rpc.core-1.persistence.one:443 \
  -y

# Test over-limit mint (0.11 XPRT - should FAIL)
cat > over-limit-mint.json << EOF
{
  "mint": {
    "amount": "110000",  // 0.11 XPRT (exceeds limit)
    "recipient": "persistence1<PERSONAL>",
    "theta_tx_hash": "0x<TEST_HASH_2>"
  }
}
EOF

# Should fail with "Exceeds max mint amount"
persistencecored tx wasm execute \
  persistence1<MINTER_CONTRACT_ADDRESS> \
  "$(cat over-limit-mint.json)" \
  --from personal \
  --chain-id core-1 \
  --gas auto \
  --gas-prices 0.025uxprt \
  --node https://rpc.core-1.persistence.one:443 \
  -y
```

#### Gate 3.B: Persistence Functionality ✋
- [ ] Mint transactions execute successfully
- [ ] Burn transactions execute successfully
- [ ] Maximum limits enforced (0.1 XPRT)
- [ ] Over-limit transactions revert
- [ ] Contract state updates correctly
- [ ] Backend detects Persistence events
- [ ] Pre-funded balance decreasing as expected

### Evening (Hours 8-10): Multisig Testing

#### 3.6: Test Governance Controls

**Test Pause Function (Requires Multisig)**
```bash
# Create pause proposal
cat > pause-proposal.json << EOF
{
  "pause": {}
}
EOF

# Initiate multisig transaction
persistencecored tx wasm execute \
  persistence1<MINTER_CONTRACT_ADDRESS> \
  "$(cat pause-proposal.json)" \
  --from multisig \
  --chain-id core-1 \
  --generate-only > unsigned-pause-tx.json

# Sign with signer 1 (multisig wallet)
persistencecored tx sign unsigned-pause-tx.json \
  --from multisig \
  --multisig persistence1<MULTISIG_ADDRESS> \
  --chain-id core-1 \
  --node https://rpc.core-1.persistence.one:443 > signature-1.json

# Sign with signer 2
persistencecored tx sign unsigned-pause-tx.json \
  --from signer2 \
  --multisig persistence1<MULTISIG_ADDRESS> \
  --chain-id core-1 \
  --node https://rpc.core-1.persistence.one:443 > signature-2.json

# Combine signatures and broadcast
persistencecored tx multisign unsigned-pause-tx.json \
  multisig \
  signature-1.json signature-2.json \
  --chain-id core-1 > signed-pause-tx.json

persistencecored tx broadcast signed-pause-tx.json \
  --node https://rpc.core-1.persistence.one:443

# Verify contract is paused
persistencecored query wasm contract-state smart \
  persistence1<MINTER_CONTRACT_ADDRESS> \
  '{"config":{}}' \
  --node https://rpc.core-1.persistence.one:443

# Expected: "paused": true

# Test that mints fail while paused
# (Attempt mint - should revert with "Contract is paused")
```

#### Gate 3.C: Governance & Safety ✋
- [ ] Multisig transactions require 2/3 signatures
- [ ] Pause activates correctly
- [ ] Paused contract rejects mint/burn
- [ ] Unpause requires multisig approval
- [ ] Admin functions restricted to multisig
- [ ] Relayer can still query state when paused

### Day 3 Summary Checklist
- [ ] Persistence minter deployed and verified
- [ ] Contract pre-funded with initial liquidity
- [ ] Mint flow tested and working
- [ ] Burn flow tested and working
- [ ] Maximum limits enforced (0.1 XPRT)
- [ ] Multisig governance functional
- [ ] Pause mechanism tested
- [ ] Backend integrated with Persistence
- [ ] All transaction hashes recorded

---

## 📅 DAY 4: UI DEPLOYMENT & GOVERNANCE TESTING

### Morning (Hours 0-4): UI Deployment

#### Pre-Deployment Checklist
- [ ] UI build completes without errors
- [ ] Environment variables configured for mainnet
- [ ] Contract addresses updated in UI config
- [ ] Wallet connectors tested (Theta Web + Keplr)
- [ ] CDN/hosting configured (Vercel/Netlify)

#### 4.1: Configure UI for Mainnet

**Update Environment Configuration**
```bash
# Navigate to UI directory
cd ui

# Create production environment file
cat > .env.production << EOF
# Network Configuration
REACT_APP_THETA_RPC=https://eth-rpc-api.thetatoken.org/rpc
REACT_APP_PERSISTENCE_RPC=https://rpc.core-1.persistence.one
REACT_APP_THETA_CHAIN_ID=361
REACT_APP_PERSISTENCE_CHAIN_ID=core-1

# Contract Addresses
REACT_APP_TFUEL_VAULT_ADDRESS=0x<TFUEL_VAULT_ADDRESS>
REACT_APP_REV_SPLITTER_ADDRESS=0x<REV_SPLITTER_ADDRESS>
REACT_APP_MINTER_CONTRACT_ADDRESS=persistence1<MINTER_CONTRACT_ADDRESS>

# API Endpoints
REACT_APP_BACKEND_API=https://api.xfuellab.com
REACT_APP_EXPLORER_THETA=https://explorer.thetatoken.org
REACT_APP_EXPLORER_PERSISTENCE=https://www.mintscan.io/persistence

# Feature Flags
REACT_APP_ENABLE_GOVERNANCE=true
REACT_APP_ENABLE_LP_POOLS=true
REACT_APP_MAX_DEPOSIT_TFUEL=0.1
REACT_APP_MAX_MINT_XPRT=0.1
REACT_APP_SHOW_WARNING_BANNER=true

# Safety
REACT_APP_PRE_AUDIT_MODE=true
REACT_APP_WARNING_MESSAGE="PRE-AUDIT DEPLOYMENT: Limited to 0.1 TFUEL/XPRT per transaction"

EOF

# Install dependencies and build
npm ci
npm run build

# Expected output:
# ✓ Build completed
# ✓ Bundle size: <500KB gzipped
# ✓ No ESLint warnings
```

#### 4.2: Deploy to Production

**Deploy to Vercel (per user preference)**
```bash
# Install Vercel CLI
npm install -g vercel

# Deploy to production
vercel --prod

# Follow prompts:
# ? Set up and deploy: Yes
# ? Project name: xfuel-mainnet
# ? Framework: Create React App
# ? Build command: npm run build
# ? Output directory: build

# Expected output:
# ✓ Production deployment ready
# URL: https://xfuel-mainnet.vercel.app

# SAVE THIS URL → PRODUCTION_UI_URL
```

**Configure Domain (Optional)**
```bash
# Add custom domain
vercel domains add xfuel.xyz

# Verify DNS propagation
dig xfuel.xyz

# Update environment with custom domain
vercel env add REACT_APP_DOMAIN production
# Enter: https://xfuel.xyz
```

#### Gate 4.A: UI Deployment ✋
- [ ] Build completes without errors
- [ ] Production URL accessible
- [ ] Contract addresses correct in UI config
- [ ] Warning banner displays pre-audit message
- [ ] SSL certificate active (HTTPS)
- [ ] CDN caching configured

### Afternoon (Hours 4-8): UI Testing

#### 4.3: Test Wallet Connections

**Theta Web Wallet Connection**
```plaintext
Manual Testing Steps:
1. Navigate to https://xfuel-mainnet.vercel.app
2. Click "Connect Theta Wallet"
3. Approve connection in Theta Web Wallet
4. Verify deployer address displays correctly (0x<DEPLOYER>)
5. Check balance displays (should show remaining TFUEL)
6. Disconnect and reconnect - should remember approval

✓ Checklist:
[ ] Connection succeeds
[ ] Address displays correctly
[ ] Balance displays correctly
[ ] Network indicator shows "Theta Mainnet"
[ ] Disconnect/reconnect works
```

**Keplr Wallet Connection**
```plaintext
Manual Testing Steps:
1. Click "Connect Keplr Wallet"
2. Approve connection in Keplr popup
3. Verify personal address displays (persistence1<PERSONAL>)
4. Check XPRT balance displays
5. Switch accounts in Keplr - UI should update
6. Test chain switching (if applicable)

✓ Checklist:
[ ] Connection succeeds
[ ] Address displays correctly
[ ] Balance displays correctly
[ ] Network indicator shows "Persistence Core-1"
[ ] Account switching works
```

#### 4.4: Test Bridge UI Flow

**Deposit Flow (Theta → Persistence)**
```plaintext
Manual Testing Steps:
1. Connect Theta Web Wallet (deployer)
2. Navigate to "Bridge" tab
3. Enter amount: 0.05 TFUEL
4. Click "Deposit to Bridge"
5. Review transaction details in confirmation modal:
   - Amount: 0.05 TFUEL
   - Fee: ~0.5% (0.00025 TFUEL)
   - Receive (estimated): 0.015 XPRT (after 30% split)
   - Warning: "Pre-audit deployment - limited amounts"
6. Confirm transaction in Theta Web Wallet
7. Monitor transaction status in UI:
   - Status: "Pending..." (Theta confirmation)
   - Status: "Processing..." (Backend detected)
   - Status: "Minting..." (Persistence transaction)
   - Status: "Complete!" (Success)
8. Verify Persistence balance increased

✓ Checklist:
[ ] Amount input validates (max 0.1 TFUEL)
[ ] Fee calculation correct
[ ] Confirmation modal shows correct details
[ ] Transaction submits successfully
[ ] Status updates in real-time
[ ] Final balance reflects deposit
[ ] Transaction link to explorer works
```

**Unwrap Flow (Persistence → Theta)**
```plaintext
Manual Testing Steps:
1. Connect Keplr Wallet (personal)
2. Navigate to "Unwrap" tab
3. Enter amount: 0.01 XPRT
4. Enter Theta recipient address: 0x<DEPLOYER>
5. Click "Burn XPRT"
6. Review confirmation:
   - Amount: 0.01 XPRT
   - Recipient: 0x<DEPLOYER>
   - Warning: "Burn will be processed by backend"
7. Approve in Keplr
8. Monitor status:
   - Status: "Burning..." (Persistence transaction)
   - Status: "Detected" (Backend found event)
   - Status: "Unlocking..." (Theta transaction)
   - Status: "Complete!"
9. Verify Theta balance increased

✓ Checklist:
[ ] Amount input validates (max 0.1 XPRT)
[ ] Recipient address validated (0x format)
[ ] Confirmation shows correct details
[ ] Transaction submits successfully
[ ] Backend processes within 30s
[ ] Theta unlock completes
[ ] Balances update correctly
```

#### 4.5: Test Governance Features

**Voting Interface**
```plaintext
Manual Testing Steps:
1. Connect Keplr Wallet (multisig)
2. Navigate to "Governance" tab
3. View active proposals (if any)
4. Create test proposal:
   - Title: "Test Proposal - Ignore"
   - Description: "Testing governance UI"
   - Type: "Parameter Change"
   - Proposed Value: "Max limit: 0.2 XPRT"
5. Submit proposal
6. Vote on proposal with multisig
7. View voting results

✓ Checklist:
[ ] Governance tab accessible
[ ] Proposals display correctly
[ ] Proposal creation works
[ ] Voting interface functional
[ ] Multisig signature flow works
[ ] Results update in real-time
```

**Liquidity Pool Interface**
```plaintext
Manual Testing Steps:
1. Connect both wallets (Theta + Keplr)
2. Navigate to "Liquidity" tab
3. View available pools
4. Test "Add Liquidity" flow:
   - Select pool: XPRT/TFUEL
   - Enter amounts: 0.01 TFUEL + 0.01 XPRT
   - Review pool share calculation
   - (DO NOT EXECUTE - just test UI)
5. Test "Remove Liquidity" flow (UI only)

✓ Checklist:
[ ] Liquidity tab accessible
[ ] Pools display with TVL/APR
[ ] Add liquidity UI functional
[ ] Remove liquidity UI functional
[ ] Pool share calculations correct
[ ] Slippage settings work
```

#### Gate 4.B: UI Functionality ✋
- [ ] Both wallet types connect successfully
- [ ] Bridge flow works end-to-end
- [ ] Transaction statuses update correctly
- [ ] Governance features accessible
- [ ] Liquidity pool UI functional
- [ ] Error messages clear and helpful
- [ ] Mobile responsive (test on phone)
- [ ] Warning banner always visible

### Evening (Hours 8-10): Edge Case Testing

#### 4.6: Test Error Conditions

**Test Insufficient Balance**
```plaintext
1. Attempt deposit with amount > wallet balance
2. Expected: "Insufficient TFUEL balance"
3. Transaction should not submit
```

**Test Maximum Limit Exceeded**
```plaintext
1. Enter amount: 0.15 TFUEL (exceeds 0.1 max)
2. Expected: Red border, "Maximum 0.1 TFUEL per transaction"
3. Submit button should be disabled
```

**Test Network Mismatch**
```plaintext
1. Connect wallet on wrong network (testnet)
2. Expected: Warning banner "Please switch to Theta Mainnet"
3. Provide "Switch Network" button
```

**Test Paused Contract**
```plaintext
1. Pause contract from CLI (admin)
2. Attempt deposit in UI
3. Expected: "Bridge is temporarily paused"
4. Provide link to status page
```

#### Gate 4.C: Error Handling ✋
- [ ] Balance checks work
- [ ] Limit checks work
- [ ] Network checks work
- [ ] Paused state detected
- [ ] Error messages user-friendly
- [ ] No console errors in browser DevTools

### Day 4 Summary Checklist
- [ ] UI deployed to production URL
- [ ] Wallet connections tested (Theta + Keplr)
- [ ] Bridge flow tested (deposit + unwrap)
- [ ] Governance features tested
- [ ] Liquidity pool UI tested
- [ ] Error conditions handled gracefully
- [ ] Warning banner always visible
- [ ] Mobile testing completed
- [ ] All UI tests documented

---

## 📅 DAY 5: END-TO-END TESTING & LAUNCH

### Morning (Hours 0-3): Full E2E Flow

#### Pre-Launch Checklist
- [ ] All previous days' gates passed
- [ ] Team briefed on launch procedures
- [ ] Support channels staffed (Discord/Telegram)
- [ ] Emergency contacts list distributed
- [ ] Monitoring dashboards open

#### 5.1: Complete E2E User Journey

**Full Bridge Cycle (Fresh Wallet)**
```plaintext
Simulated User Flow:

Setup:
1. Create new Theta Web Wallet (fresh address)
2. Fund with 0.5 TFUEL from deployer wallet
3. Create new Keplr account
4. Record all starting balances

Step 1 - Deposit on Theta:
5. Connect Theta wallet to UI
6. Navigate to Bridge tab
7. Enter: 0.08 TFUEL
8. Review confirmation (fee, receive amount)
9. Submit transaction
10. Note TX hash: 0x<HASH1>
11. Wait for Theta confirmation (~6 seconds)

Step 2 - Backend Processing:
12. Monitor backend logs for event detection
13. Expected: Detected within 30 seconds
14. Verify 30/70 split calculated:
    - To Mint: 0.024 XPRT (30%)
    - To Burn: 0.056 TFUEL (70%)
15. Wait for backend to prepare Persistence TX

Step 3 - Mint on Persistence:
16. Backend executes mint transaction
17. Note Persistence TX hash: <HASH2>
18. Wait for Persistence confirmation (~6 seconds)
19. Connect Keplr wallet to UI
20. Verify balance increased by ~0.024 XPRT
21. Verify UI shows "Complete" status

Step 4 - Unwrap Back to Theta:
22. In UI, navigate to Unwrap tab
23. Enter: 0.02 XPRT
24. Enter recipient: <FRESH_THETA_ADDRESS>
25. Submit burn transaction
26. Note Persistence burn TX: <HASH3>
27. Wait for backend detection
28. Backend executes Theta unlock
29. Note Theta unlock TX: <HASH4>
30. Verify Theta balance increased by ~0.02 TFUEL

Step 5 - Verify Final State:
31. Check all final balances
32. Verify transaction history in UI
33. Check all TX hashes on explorers
34. Confirm fees collected in RevenueSplitter

✓ E2E Checklist:
[ ] Full cycle completes successfully
[ ] All balances reconcile correctly
[ ] Backend processed all events
[ ] No transactions stuck or failed
[ ] UI displayed all status updates
[ ] Explorer links all valid
[ ] Fees distributed correctly
[ ] Total time: < 3 minutes
```

#### 5.2: Multi-User Concurrent Test

**5 Simultaneous Users**
```plaintext
Recruit 5 test users (or simulate with 5 wallets):

User 1: Deposit 0.05 TFUEL
User 2: Deposit 0.08 TFUEL  
User 3: Deposit 0.03 TFUEL
User 4: Unwrap 0.01 XPRT
User 5: Unwrap 0.015 XPRT

Execute all within 1-minute window

Monitor:
- Backend processes all 5 without errors
- No transaction conflicts
- Correct ordering maintained
- All UI updates work
- Database consistency maintained

✓ Concurrent Test Checklist:
[ ] All 5 transactions succeeded
[ ] No duplicate processing
[ ] No missed events
[ ] Backend queue handled load
[ ] Database no conflicts
[ ] UI responsive for all users
```

#### Gate 5.A: E2E Validation ✋
- [ ] Full E2E cycle completes successfully
- [ ] Multiple concurrent users work
- [ ] All components integrated correctly
- [ ] No data inconsistencies
- [ ] Performance acceptable (<3 min full cycle)

### Afternoon (Hours 3-6): Security Verification

#### 5.3: Security Audit Simulation

**Attack Vector Testing (DO NOT execute on mainnet funds)**

```plaintext
Test 1: Replay Attack
- Attempt to replay previous deposit transaction
- Expected: Transaction reverts or has no effect
[ ] Replay protection works

Test 2: Front-Running
- Attempt to front-run pending transaction
- Expected: Private RPC prevents mempool visibility
[ ] Front-running mitigated

Test 3: Maximum Limit Bypass
- Attempt multiple 0.1 TFUEL deposits rapidly
- Expected: All succeed individually, daily cap enforced
[ ] Per-TX limits work, daily cap enforced

Test 4: Unauthorized Admin Action
- Attempt pause from non-admin wallet
- Expected: Transaction reverts
[ ] Admin access control works

Test 5: Bridge Without Pre-Fund
- Drain pre-fund balance to zero
- Attempt mint
- Expected: Transaction fails with clear error
[ ] Pre-fund requirement enforced

Test 6: Oracle Price Manipulation
- (If applicable) Test with extreme price values
- Expected: Circuit breaker triggers
[ ] Oracle protections work
```

#### 5.4: Verify Safety Mechanisms

```bash
# Final verification of all safety features

# 1. Verify pause works on all contracts
npx hardhat verify-pause-all --network theta-mainnet
npx hardhat verify-pause-all --network persistence-mainnet

# 2. Verify multisig requirements
npx hardhat check-multisig-config --network theta-mainnet

# 3. Verify transaction limits
npx hardhat check-limits --network theta-mainnet
npx hardhat check-limits --network persistence-mainnet

# 4. Verify emergency contacts
curl http://localhost:3000/api/health/emergency

# 5. Verify monitoring alerts
curl http://localhost:3000/api/health/alerts

# Expected: All systems nominal
```

#### Gate 5.B: Security Verification ✋
- [ ] All attack vectors mitigated
- [ ] Pause mechanism functional
- [ ] Multisig requirements met
- [ ] Transaction limits enforced
- [ ] Emergency procedures documented
- [ ] Monitoring alerts functional

### Evening (Hours 6-8): Launch Preparation

#### 5.5: Pre-Launch Configuration

**Set Daily Caps**
```bash
# Configure 24-hour rolling caps
npx hardhat set-daily-cap \
  --vault 0x<TFUEL_VAULT_ADDRESS> \
  --cap 1.0 \
  --network theta-mainnet

# Verify cap in contract
npx hardhat get-config \
  --vault 0x<TFUEL_VAULT_ADDRESS> \
  --network theta-mainnet

# Expected output:
# dailyCap: 1.0 TFUEL (first 24 hours)
# perTxMax: 0.1 TFUEL
# currentDailyTotal: 0.23 TFUEL (from testing)
```

**Enable Public Access**
```bash
# Update UI environment to remove test mode restrictions
# In Vercel dashboard:
# Set REACT_APP_PUBLIC_ACCESS=true
# Set REACT_APP_WARNING_MESSAGE="Pre-audit deployment. Max 0.1 TFUEL/XPRT per TX. Use at your own risk."

# Redeploy UI
vercel --prod

# Verify warning banner updated
```

**Configure Rate Limiting**
```bash
# Update backend rate limiting for public users
# In backend .env.production:
# MAX_REQUESTS_PER_IP=10  # per minute
# MAX_DEPOSITS_PER_ADDRESS=5  # per hour

# Restart backend
pm2 restart xfuel-bridge
```

#### 5.6: Prepare Communications

**Create Status Page**
```markdown
# File: status.md (deploy to status.xfuel.xyz)

# XFuelLab Bridge Status

## Current Status: 🟢 OPERATIONAL (Pre-Audit)

### Limitations
- Maximum deposit: 0.1 TFUEL per transaction
- Maximum mint: 0.1 XPRT per transaction
- Daily cap: 1.0 TFUEL (first 24 hours)

### Network Status
- Theta Network: 🟢 Connected
- Persistence Network: 🟢 Connected
- Backend Service: 🟢 Operational
- UI: 🟢 Accessible

### Recent Transactions
- Last Deposit: 2 minutes ago
- Last Mint: 3 minutes ago
- Total Volume (24h): 0.45 TFUEL

### Known Issues
- None

### Upcoming Maintenance
- Security audit: TBD
- Limit increases: Post-audit

Last Updated: 2026-01-XX HH:MM UTC
```

**Draft Launch Announcement**
```markdown
# File: LAUNCH_ANNOUNCEMENT.md

🚀 XFuelLab Bridge - Public Mainnet Launch

We're excited to announce the public mainnet launch of XFuelLab Bridge!

⚠️ PRE-AUDIT NOTICE:
This is a limited mainnet deployment before our security audit. Please note:

Limitations:
- Max 0.1 TFUEL per deposit
- Max 0.1 XPRT per mint
- 1.0 TFUEL daily cap (first 24h)
- Pause mechanism active

Supported:
✅ Bridge TFUEL → XPRT
✅ Unwrap XPRT → TFUEL
✅ Governance voting
✅ Liquidity pools (view only)

Links:
- UI: https://xfuel.xyz
- Status: https://status.xfuel.xyz
- Docs: https://docs.xfuel.xyz
- Support: https://discord.gg/xfuel

USE AT YOUR OWN RISK. Full audit coming soon!

#DeFi #CrossChain #Theta #Persistence
```

#### Gate 5.C: Launch Ready ✋
- [ ] Daily caps configured
- [ ] Public access enabled
- [ ] Rate limiting active
- [ ] Status page deployed
- [ ] Launch announcement drafted
- [ ] Support team ready
- [ ] Monitoring dashboards open
- [ ] Emergency procedures reviewed

### Launch (Hour 8): GO LIVE

#### 5.7: Execute Launch Sequence

```plaintext
Launch Checklist (Execute in order):

T-15 minutes:
[ ] All team members on call
[ ] Monitoring dashboards open
[ ] Emergency stop procedures reviewed

T-10 minutes:
[ ] Final health check all systems
[ ] Verify all wallets funded
[ ] Test one last E2E transaction

T-5 minutes:
[ ] Enable public access in UI
[ ] Unpause all contracts (if paused)
[ ] Send "systems go" message to team

T-0 (LAUNCH):
[ ] Post launch announcement on social media
[ ] Enable Discord support channels
[ ] Begin monitoring dashboard watch
[ ] Document exact launch time

T+15 minutes:
[ ] Monitor first public transactions
[ ] Verify all systems handling load
[ ] Check for any error spikes

T+1 hour:
[ ] Review transaction volume
[ ] Check error rates
[ ] Verify fee distributions
[ ] Update status page

T+4 hours:
[ ] Comprehensive system health check
[ ] Review all transactions
[ ] Address any user support issues
[ ] Plan for Day 2 monitoring
```

### Post-Launch Monitoring (Hours 8-24)

#### 5.8: Continuous Monitoring

**System Health Checks (Every Hour)**
```bash
# Automated health check script
./scripts/health-check.sh

# Manual verification:
# 1. Backend status
pm2 status
curl http://localhost:3000/api/health

# 2. Contract status
npx hardhat contract-health \
  --vault 0x<TFUEL_VAULT_ADDRESS> \
  --minter persistence1<MINTER_CONTRACT_ADDRESS>

# 3. Transaction metrics
curl http://localhost:3000/api/metrics

# Expected metrics:
# - Total deposits: X
# - Total mints: Y
# - Failed transactions: 0
# - Average processing time: <30s
# - Error rate: <1%
```

**Alert Response Procedures**
```plaintext
Alert Levels:

🟢 INFO (Log only):
- New user registration
- Normal transaction flow
- API rate limit hit (non-abusive)

🟡 WARNING (Investigate within 1 hour):
- Backend processing >60s
- Transaction failure rate >5%
- Daily cap approaching (80%)
- Unusual transaction pattern

🟠 ERROR (Investigate within 15 minutes):
- Contract interaction failure
- Backend database error
- RPC connection issues
- User funds at risk

🔴 CRITICAL (IMMEDIATE ACTION):
- Security breach detected
- Smart contract exploit attempt
- Multiple transaction failures
- System-wide outage

CRITICAL Response:
1. Activate emergency pause on all contracts
2. Alert all team members
3. Investigate root cause
4. Post status update
5. DO NOT resume until resolved
```

#### Gate 5.D: Launch Success ✋
- [ ] Launch announcement posted
- [ ] First public transactions successful
- [ ] No critical errors in first hour
- [ ] Support team handled user questions
- [ ] Monitoring dashboard stable
- [ ] Daily cap tracking correctly

### Day 5 Summary Checklist
- [ ] Full E2E testing completed
- [ ] Multi-user concurrent testing passed
- [ ] Security verification completed
- [ ] Daily caps configured
- [ ] Public access enabled
- [ ] Status page live
- [ ] Launch executed successfully
- [ ] First hour monitoring clean
- [ ] Post-launch procedures active

---

## 📊 POST-LAUNCH (Days 6-30)

### Week 1: Intensive Monitoring

**Daily Tasks**
- [ ] Review all transactions (morning & evening)
- [ ] Check error logs for anomalies
- [ ] Verify fee distributions
- [ ] Monitor daily cap usage
- [ ] Respond to user support tickets
- [ ] Update status page

**Metrics to Track**
```yaml
Transaction Metrics:
  - Total volume (TFUEL & XPRT)
  - Number of unique users
  - Average transaction size
  - Success rate (target: >99%)
  - Average processing time (target: <30s)

System Metrics:
  - Backend uptime (target: >99.9%)
  - RPC response times
  - Database performance
  - Error rates by category

User Metrics:
  - New wallet connections
  - Return user rate
  - Support ticket volume
  - User satisfaction (surveys)
```

### Week 2-4: Gradual Limits Increase

**After 7 Days (If All Systems Stable)**
```bash
# Increase daily cap to 5.0 TFUEL
npx hardhat set-daily-cap \
  --vault 0x<TFUEL_VAULT_ADDRESS> \
  --cap 5.0 \
  --network theta-mainnet

# Monitor for 48 hours

# If stable, increase per-TX limit to 0.25 TFUEL
npx hardhat set-max-deposit \
  --vault 0x<TFUEL_VAULT_ADDRESS> \
  --max 0.25 \
  --network theta-mainnet
```

**After 14 Days (If All Systems Stable)**
```bash
# Increase daily cap to 20.0 TFUEL
npx hardhat set-daily-cap \
  --vault 0x<TFUEL_VAULT_ADDRESS> \
  --cap 20.0 \
  --network theta-mainnet

# Increase per-TX limit to 1.0 TFUEL
npx hardhat set-max-deposit \
  --vault 0x<TFUEL_VAULT_ADDRESS> \
  --max 1.0 \
  --network theta-mainnet
```

**After 30 Days (Pre-Audit Complete)**
```bash
# Schedule professional security audit
# Review all 30-day metrics
# Plan for post-audit limit removal
# Prepare for full public launch
```

---

## 🚨 EMERGENCY PROCEDURES

### Emergency Stop (EXECUTE IMMEDIATELY IF CRITICAL ISSUE)

```bash
# 1. Pause all contracts
npx hardhat emergency-pause-all \
  --network theta-mainnet \
  --network persistence-mainnet

# 2. Stop backend service
pm2 stop xfuel-bridge

# 3. Enable maintenance mode on UI
vercel env add REACT_APP_MAINTENANCE_MODE true production

# 4. Post status update
# "🔴 XFuelLab Bridge is under maintenance. All transactions paused. Updates soon."

# 5. Investigate issue

# 6. DO NOT resume until:
#    - Root cause identified
#    - Fix implemented and tested
#    - Team consensus reached
#    - Users notified of resolution
```

### Emergency Contacts

```yaml
Team Leads:
  - Technical Lead: [Phone] [Telegram]
  - Security Lead: [Phone] [Telegram]
  - Operations: [Phone] [Telegram]

External:
  - Theta Support: support@thetatoken.org
  - Persistence Team: [Contact]
  - Auditor (when engaged): [Contact]

Communication Channels:
  - Team: [Private Telegram/Slack]
  - Users: [Discord/Twitter]
  - Status: status.xfuel.xyz
```

---

## 📝 RISK MITIGATION SUMMARY

### Technical Risks

| Risk | Mitigation |
|------|------------|
| Smart contract bug | Limited funds, pause enabled, pre-audit testing |
| Backend failure | Monitoring, auto-restart, manual fallback procedures |
| Network congestion | Gas buffers, transaction queuing, retry logic |
| Oracle failure | Multiple price feeds, circuit breakers |
| Database corruption | Hourly backups, transaction logs, recovery procedures |

### Operational Risks

| Risk | Mitigation |
|------|------------|
| Key compromise | Encrypted storage, multisig requirements, rotation plan |
| DDoS attack | Rate limiting, CDN protection, fallback infrastructure |
| User error | UI confirmations, limits, clear warnings, support team |
| Liquidity exhaustion | Pre-fund monitoring, automatic alerts, reserve fund |
| Regulatory issues | Legal review, compliance documentation, KYC readiness |

### Business Risks

| Risk | Mitigation |
|------|------------|
| Low adoption | Marketing plan, community engagement, incentive programs |
| Competitor launch | Unique features (governance, LP pools), early-mover advantage |
| Market conditions | Conservative approach, gradual scaling, risk warnings |
| Audit findings | Pre-audit testing, conservative limits, quick response plan |
| Team availability | Documentation, redundancy, cross-training |

---

## ✅ FINAL PRE-LAUNCH CHECKLIST

### Technical
- [ ] All contracts deployed and verified
- [ ] Backend service operational
- [ ] UI deployed with warnings
- [ ] Monitoring dashboards configured
- [ ] Database backups automated
- [ ] All transaction limits enforced
- [ ] Pause mechanisms tested
- [ ] Emergency procedures documented

### Security
- [ ] Private keys encrypted and backed up
- [ ] Multisig wallets configured (2/3)
- [ ] Rate limiting active
- [ ] Attack vectors tested
- [ ] Security alerts configured
- [ ] Emergency contact list distributed

### Operations
- [ ] Support channels staffed
- [ ] Status page live
- [ ] Launch announcement ready
- [ ] User documentation published
- [ ] Team trained on procedures
- [ ] Emergency stop tested

### Legal/Compliance
- [ ] Terms of service published
- [ ] Risk warnings displayed
- [ ] Privacy policy posted
- [ ] Regulatory review completed (if applicable)

---

## 📞 SUPPORT & DOCUMENTATION

### User Resources
- **Documentation:** https://docs.xfuel.xyz
- **Status Page:** https://status.xfuel.xyz
- **Discord Support:** https://discord.gg/xfuel
- **Twitter Updates:** @XFuelLab
- **GitHub:** https://github.com/xfuellab

### Internal Resources
- **Runbook:** INTERNAL_RUNBOOK.md
- **API Docs:** API_DOCUMENTATION.md
- **Architecture:** SYSTEM_ARCHITECTURE.md
- **Security:** SECURITY_PROCEDURES.md

---

## 📈 SUCCESS METRICS (First 30 Days)

### Targets
- [ ] Zero critical security incidents
- [ ] >99% uptime for all systems
- [ ] >99% transaction success rate
- [ ] <30s average processing time
- [ ] >100 unique users
- [ ] >1000 successful transactions
- [ ] <0.1% error rate
- [ ] Zero user fund losses

### Review Points
- **Day 1:** First 24 hours review
- **Day 7:** Week 1 comprehensive review
- **Day 14:** Mid-month review, consider limit increase
- **Day 30:** Full month review, audit preparation

---

## 🎯 CONCLUSION

This rollout plan provides a structured, safety-first approach to launching the XFuelLab bridge on mainnet. Key principles:

1. **Start Small:** 0.1 TFUEL/XPRT limits minimize risk
2. **Test Everything:** Comprehensive testing at each phase
3. **Safety First:** Pause mechanisms, multisig, monitoring
4. **Gradual Scale:** Increase limits only after proven stability
5. **Transparency:** Clear warnings, status updates, documentation

**Remember:** 
- ⚠️ This is a PRE-AUDIT deployment
- ⚠️ Use conservative limits
- ⚠️ Monitor continuously
- ⚠️ Be ready to pause immediately if issues arise
- ⚠️ Users must understand risks

**Next Steps After 30 Days:**
1. Complete professional security audit
2. Address any findings
3. Gradually remove limits
4. Full public launch
5. Ongoing monitoring and improvements

---

**Document Version:** 1.0  
**Last Updated:** January 2026  
**Status:** Ready for Execution  
**Approval Required:** ✅ Technical Lead, Security Lead, Operations

---

*Good luck with the launch! 🚀*



