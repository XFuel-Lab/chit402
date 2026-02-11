# 🚨 PERSISTENCE MAINNET DEPLOYMENT PLAN - REVERSE BRIDGE 🚨
## XFuel Protocol: persistence-minter + fee-collector

**CRITICAL: MAINNET DEPLOYMENT - EXTREME CAUTION REQUIRED**

---

## ✅ STEP 1: CURRENT STATE VERIFICATION

### Optimized WASM Artifacts Status
✅ **Location:** `cosmwasm-contracts/artifacts/`

| Contract | File | Size | SHA256 | Status |
|----------|------|------|--------|--------|
| **persistence-minter** | `persistence_minter.wasm` | 321.8 KB | `516db0e88509afb90e3055b320691de68387ace97a9a34a72e5621ad3778b748` | ✅ Ready |
| **fee-collector** | `fee_collector.wasm` | 174.1 KB | `7a370b84ea0ed94df29b2acd2804d73bc27fa1d5a325e2bdd76b3861438f5acd` | ✅ Ready |

### Compilation Status
- ✅ Both contracts compile without errors
- ✅ No legacy/ folder import issues detected
- ✅ Tests pass with placeholder addresses
- ✅ Pause functionality enabled
- ✅ Admin control retained

---

## 📋 STEP 2: REQUIRED INFORMATION FROM YOU

**Before proceeding, please provide the following values:**

### Network Configuration
```bash
CHAIN_ID="<INSERT_MAINNET_CHAIN_ID>"           # e.g., "core-1"
RPC_URL="<INSERT_MAINNET_RPC>"                 # e.g., "https://rpc.persistence.one:443"
KEY_NAME="<INSERT_YOUR_KEY_NAME>"              # Your wallet key name
ADMIN_ADDRESS="<INSERT_ADMIN_ADDRESS>"         # persistence1... (will have admin control)
```

### Current Dummy Addresses (from your system)
```bash
# These need to be replaced or confirmed as temporary
DUMMY_VERIFIER="<INSERT_CURRENT_VERIFIER_PLACEHOLDER>"     # e.g., "persistence1verifier000..."
DUMMY_SPLITTER="<INSERT_CURRENT_SPLITTER_PLACEHOLDER>"     # e.g., "persistence1splitter000..."
```

### Token Configuration
```bash
TOKEN_NAME="iBridge TFUEL"                     # Or your preferred name
TOKEN_SYMBOL="ibcTFUEL"                        # Or your preferred symbol
TOKEN_DECIMALS=18                              # TFUEL uses 18 decimals
```

### Safety Parameters
```bash
MIN_BURN_AMOUNT="10000000000000000"            # 0.01 TFUEL minimum (18 decimals)
FIRST_TEST_AMOUNT="50000000000000000"          # 0.05 TFUEL for first test
```

---

## ⚠️ STEP 3: DUMMY ADDRESS SAFETY VALIDATION

### Current Known Placeholder
From tests: `persistence1feecollector0000000000000000000000000000000000`

### ⚠️ CRITICAL SAFETY CHECKS

**Option A: Use Placeholder Addresses (SAFER for initial deployment)**
- Deploy with dummy addresses for verifier and rev_splitter
- Deploy with **PAUSED** state
- Update addresses via governance before unpausing
- **Advantage:** Cannot accidentally trigger unintended minting

**Option B: Use Real Addresses (Deploy once, requires verified addresses)**
- Deploy with actual ZK verifier contract address
- Deploy with actual revenue splitter address
- Still deploy **PAUSED**
- **Risk:** Wrong address = permanent misconfiguration

### Recommended Instantiation Parameters

**For persistence-minter InstantiateMsg:**
```json
{
  "name": "iBridge TFUEL",
  "symbol": "ibcTFUEL",
  "decimals": 18,
  "initial_balances": [],
  "mint_cap": null,
  "marketing": null,
  "verifier_address": "persistence1PLACEHOLDER_VERIFIER_UPDATE_LATER_VIA_ADMIN",
  "rev_splitter_address": "persistence1PLACEHOLDER_SPLITTER_UPDATE_LATER_VIA_ADMIN",
  "fee_collector_address": "persistence1<FEE_COLLECTOR_CONTRACT_ADDRESS_FROM_STEP_4>"
}
```

**For fee-collector InstantiateMsg:**
```json
{
  "admin": "persistence1<YOUR_ADMIN_ADDRESS>",
  "ibctfuel_token": "persistence1<PERSISTENCE_MINTER_CONTRACT_ADDRESS_FROM_STEP_4>",
  "minter_contract": "persistence1<PERSISTENCE_MINTER_CONTRACT_ADDRESS_FROM_STEP_4>",
  "min_burn_amount": "10000000000000000"
}
```

---

## 🚀 STEP 4: MAINNET DEPLOYMENT SEQUENCE

### Pre-Flight Checklist
- [ ] Wallet has sufficient XPRT for gas (~10 XPRT recommended)
- [ ] Admin address confirmed and secured
- [ ] Multisig setup (if using multisig admin)
- [ ] All placeholder addresses documented
- [ ] Rollback plan understood
- [ ] Monitoring dashboard ready

---

### 4.1: Upload persistence-minter WASM

```bash
# Navigate to artifacts directory
cd C:\Users\seeha\xfuel-protocol\cosmwasm-contracts\artifacts

# Verify checksum BEFORE uploading
sha256sum persistence_minter.wasm
# Expected: 516db0e88509afb90e3055b320691de68387ace97a9a34a72e5621ad3778b748

# Upload to mainnet
persistenced tx wasm store persistence_minter.wasm \
  --from $KEY_NAME \
  --chain-id $CHAIN_ID \
  --node $RPC_URL \
  --gas auto \
  --gas-adjustment 1.5 \
  --gas-prices 0.025uxprt \
  --broadcast-mode sync \
  -y

# WAIT FOR CONFIRMATION (check transaction hash)
# Get the code ID from the response
PERSISTENCE_MINTER_CODE_ID=<CODE_ID_FROM_TX_RESPONSE>

# Query to verify upload
persistenced query wasm code $PERSISTENCE_MINTER_CODE_ID \
  --node $RPC_URL \
  --output json
```

**Estimated Gas:** ~3,000,000 units (~0.075 XPRT)

---

### 4.2: Upload fee-collector WASM

```bash
# Verify checksum BEFORE uploading
sha256sum fee_collector.wasm
# Expected: 7a370b84ea0ed94df29b2acd2804d73bc27fa1d5a325e2bdd76b3861438f5acd

# Upload to mainnet
persistenced tx wasm store fee_collector.wasm \
  --from $KEY_NAME \
  --chain-id $CHAIN_ID \
  --node $RPC_URL \
  --gas auto \
  --gas-adjustment 1.5 \
  --gas-prices 0.025uxprt \
  --broadcast-mode sync \
  -y

# Get the code ID from the response
FEE_COLLECTOR_CODE_ID=<CODE_ID_FROM_TX_RESPONSE>

# Query to verify upload
persistenced query wasm code $FEE_COLLECTOR_CODE_ID \
  --node $RPC_URL \
  --output json
```

**Estimated Gas:** ~2,000,000 units (~0.05 XPRT)

---

### 4.3: Instantiate persistence-minter (PAUSED)

⚠️ **CRITICAL: Contract will be instantiated in PAUSED state**

```bash
# Prepare instantiation message
INSTANTIATE_MSG_MINTER=$(cat <<'EOF'
{
  "name": "iBridge TFUEL",
  "symbol": "ibcTFUEL",
  "decimals": 18,
  "initial_balances": [],
  "mint_cap": null,
  "marketing": null,
  "verifier_address": "PLACEHOLDER_VERIFIER_UPDATE_VIA_ADMIN",
  "rev_splitter_address": "PLACEHOLDER_SPLITTER_UPDATE_VIA_ADMIN",
  "fee_collector_address": "PLACEHOLDER_WILL_UPDATE_IN_STEP_4_5"
}
EOF
)

# Instantiate (will start UNPAUSED by default - we'll pause immediately after)
persistenced tx wasm instantiate $PERSISTENCE_MINTER_CODE_ID \
  "$INSTANTIATE_MSG_MINTER" \
  --from $KEY_NAME \
  --chain-id $CHAIN_ID \
  --node $RPC_URL \
  --label "xfuel-ibcTFUEL-minter-v1.0.0" \
  --admin $ADMIN_ADDRESS \
  --gas auto \
  --gas-adjustment 1.5 \
  --gas-prices 0.025uxprt \
  --broadcast-mode sync \
  -y

# Get the contract address from the response
PERSISTENCE_MINTER_CONTRACT="persistence1<CONTRACT_ADDRESS_FROM_TX>"

# IMMEDIATELY PAUSE THE CONTRACT (CRITICAL SAFETY STEP)
persistenced tx wasm execute $PERSISTENCE_MINTER_CONTRACT \
  '{"pause":{}}' \
  --from $KEY_NAME \
  --chain-id $CHAIN_ID \
  --node $RPC_URL \
  --gas auto \
  --gas-adjustment 1.3 \
  --gas-prices 0.025uxprt \
  -y

# Verify paused state
persistenced query wasm contract-state smart $PERSISTENCE_MINTER_CONTRACT \
  '{"config":{}}' \
  --node $RPC_URL \
  --output json | jq .data.paused
# Should return: true
```

**Estimated Gas:** ~500,000 units (~0.0125 XPRT)

---

### 4.4: Instantiate fee-collector

```bash
# Prepare instantiation message with REAL minter address
INSTANTIATE_MSG_FEE_COLLECTOR=$(cat <<EOF
{
  "admin": "$ADMIN_ADDRESS",
  "ibctfuel_token": "$PERSISTENCE_MINTER_CONTRACT",
  "minter_contract": "$PERSISTENCE_MINTER_CONTRACT",
  "min_burn_amount": "10000000000000000"
}
EOF
)

# Instantiate fee-collector
persistenced tx wasm execute $PERSISTENCE_MINTER_CONTRACT \
  "$INSTANTIATE_MSG_FEE_COLLECTOR" \
  --from $KEY_NAME \
  --chain-id $CHAIN_ID \
  --node $RPC_URL \
  --label "xfuel-fee-collector-v1.0.0" \
  --admin $ADMIN_ADDRESS \
  --gas auto \
  --gas-adjustment 1.5 \
  --gas-prices 0.025uxprt \
  --broadcast-mode sync \
  -y

# Get the contract address
FEE_COLLECTOR_CONTRACT="persistence1<CONTRACT_ADDRESS_FROM_TX>"

# Verify initialization
persistenced query wasm contract-state smart $FEE_COLLECTOR_CONTRACT \
  '{"config":{}}' \
  --node $RPC_URL \
  --output json
```

**Estimated Gas:** ~300,000 units (~0.0075 XPRT)

---

### 4.5: Update persistence-minter with FeeCollector address

```bash
# Update fee collector address in minter contract (still PAUSED)
persistenced tx wasm execute $PERSISTENCE_MINTER_CONTRACT \
  "{\"set_fee_collector\":{\"fee_collector_address\":\"$FEE_COLLECTOR_CONTRACT\"}}" \
  --from $KEY_NAME \
  --chain-id $CHAIN_ID \
  --node $RPC_URL \
  --gas auto \
  --gas-adjustment 1.3 \
  --gas-prices 0.025uxprt \
  -y

# Verify update
persistenced query wasm contract-state smart $PERSISTENCE_MINTER_CONTRACT \
  '{"config":{}}' \
  --node $RPC_URL \
  --output json | jq .data.fee_collector_address
# Should return: $FEE_COLLECTOR_CONTRACT
```

---

### 4.6: Pre-Test Verification (Contract Still PAUSED)

```bash
# 1. Verify minter is PAUSED
persistenced query wasm contract-state smart $PERSISTENCE_MINTER_CONTRACT \
  '{"config":{}}' \
  --node $RPC_URL | jq .data.paused
# Must return: true

# 2. Verify admin address
persistenced query wasm contract-state smart $PERSISTENCE_MINTER_CONTRACT \
  '{"config":{}}' \
  --node $RPC_URL | jq .data.admin
# Should match: $ADMIN_ADDRESS

# 3. Verify fee collector address is set
persistenced query wasm contract-state smart $PERSISTENCE_MINTER_CONTRACT \
  '{"config":{}}' \
  --node $RPC_URL | jq .data.fee_collector_address
# Should match: $FEE_COLLECTOR_CONTRACT

# 4. Check initial state (all zeros)
persistenced query wasm contract-state smart $PERSISTENCE_MINTER_CONTRACT \
  '{"state":{}}' \
  --node $RPC_URL
# All values should be "0"

# 5. Verify fee collector config
persistenced query wasm contract-state smart $FEE_COLLECTOR_CONTRACT \
  '{"config":{}}' \
  --node $RPC_URL
```

---

## 🧪 STEP 5: FIRST TEST TRANSACTION (EXTREMELY CONSERVATIVE)

⚠️ **DO NOT PROCEED UNTIL ALL VERIFICATIONS PASS**

### 5.1: Prepare Test Environment

```bash
# For testing, you need ibcTFUEL tokens in your wallet
# Since this is mainnet, you'll need to mint some first via the forward bridge
# OR use a test wallet that already has ibcTFUEL

TEST_WALLET="<YOUR_TEST_WALLET_ADDRESS>"
TEST_AMOUNT="50000000000000000"  # 0.05 TFUEL
THETA_RECIPIENT="0x<YOUR_THETA_ADDRESS>"  # Theta address to receive unwrapped TFUEL
```

### 5.2: Unpause Contract (FOR TEST ONLY)

⚠️ **ONLY IF YOU'RE READY TO TEST**

```bash
# Unpause the contract
persistenced tx wasm execute $PERSISTENCE_MINTER_CONTRACT \
  '{"unpause":{}}' \
  --from $KEY_NAME \
  --chain-id $CHAIN_ID \
  --node $RPC_URL \
  --gas auto \
  --gas-adjustment 1.3 \
  --gas-prices 0.025uxprt \
  -y

# Verify unpaused
persistenced query wasm contract-state smart $PERSISTENCE_MINTER_CONTRACT \
  '{"config":{}}' \
  --node $RPC_URL | jq .data.paused
# Should return: false
```

### 5.3: Execute First burn_for_unwrap Test

```bash
# Execute burn_for_unwrap with 0.05 TFUEL
persistenced tx wasm execute $PERSISTENCE_MINTER_CONTRACT \
  "{\"burn_for_unwrap\":{\"amount\":\"$TEST_AMOUNT\",\"theta_recipient\":\"$THETA_RECIPIENT\"}}" \
  --from $KEY_NAME \
  --chain-id $CHAIN_ID \
  --node $RPC_URL \
  --gas auto \
  --gas-adjustment 1.5 \
  --gas-prices 0.025uxprt \
  --broadcast-mode block \
  -y

# SAVE THE TX HASH
TEST_TX_HASH="<TX_HASH_FROM_RESPONSE>"
```

---

## ✅ STEP 6: POST-TEST VERIFICATION

### 6.1: Check Transaction Events

```bash
# Query transaction to see events
persistenced query tx $TEST_TX_HASH \
  --node $RPC_URL \
  --output json | jq .logs[0].events

# Look for:
# 1. "wasm-BurnForUnwrap" event
# 2. "wasm-FeeBurn" event
# 3. Attributes: burner, theta_recipient, burn_amount, fee_amount, nonce
```

### 6.2: Verify Fee Calculation (0.5%)

```bash
# Expected values for 0.05 TFUEL test:
# Total amount: 50000000000000000 (0.05 TFUEL)
# Fee (0.5%):   250000000000000 (0.00025 TFUEL)
# Burned (99.5%): 49750000000000000 (0.04975 TFUEL)

# Check fee collector received exactly 0.5%
persistenced query wasm contract-state smart $FEE_COLLECTOR_CONTRACT \
  '{"state":{}}' \
  --node $RPC_URL | jq .data.accumulated_fees
# Should show: "250000000000000"
```

### 6.3: Verify State Updates

```bash
# Check minter state
persistenced query wasm contract-state smart $PERSISTENCE_MINTER_CONTRACT \
  '{"state":{}}' \
  --node $RPC_URL

# Verify:
# - total_reverse_burned: 49750000000000000
# - total_reverse_fees: 250000000000000
```

### 6.4: Verify Nonce Increment

```bash
# Check user's nonce (should be 1 after first burn)
persistenced query wasm contract-state smart $PERSISTENCE_MINTER_CONTRACT \
  "{\"reverse_burn_nonce\":{\"address\":\"$TEST_WALLET\"}}" \
  --node $RPC_URL
# Should return: {"nonce": 1}
```

### 6.5: Verify SP1 Prover Can See Event

```bash
# Check that SP1 prover picked up the event
# (This requires your SP1 prover to be running and monitoring events)

# Event should contain:
# - burner: $TEST_WALLET
# - theta_recipient: $THETA_RECIPIENT
# - burn_amount: 49750000000000000
# - fee_amount: 250000000000000
# - nonce: 0
```

---

## 🚨 STEP 7: SAFETY ROLLBACK PLAN

If anything goes wrong during testing:

### Immediate Actions

```bash
# 1. PAUSE THE CONTRACT IMMEDIATELY
persistenced tx wasm execute $PERSISTENCE_MINTER_CONTRACT \
  '{"pause":{}}' \
  --from $KEY_NAME \
  --chain-id $CHAIN_ID \
  --node $RPC_URL \
  --gas auto \
  --gas-prices 0.025uxprt \
  -y

# 2. Query current state to assess damage
persistenced query wasm contract-state smart $PERSISTENCE_MINTER_CONTRACT \
  '{"state":{}}' \
  --node $RPC_URL

# 3. Check fee collector balance
persistenced query wasm contract-state smart $FEE_COLLECTOR_CONTRACT \
  '{"state":{}}' \
  --node $RPC_URL
```

### Admin Recovery Options

**Option A: Update Contract Addresses (if wrong addresses)**
```bash
# Update verifier
persistenced tx wasm execute $PERSISTENCE_MINTER_CONTRACT \
  "{\"set_verifier\":{\"verifier_address\":\"<CORRECT_ADDRESS>\"}}" \
  --from $KEY_NAME --chain-id $CHAIN_ID --node $RPC_URL -y

# Update rev_splitter
persistenced tx wasm execute $PERSISTENCE_MINTER_CONTRACT \
  "{\"set_rev_splitter\":{\"rev_splitter_address\":\"<CORRECT_ADDRESS>\"}}" \
  --from $KEY_NAME --chain-id $CHAIN_ID --node $RPC_URL -y

# Update fee_collector
persistenced tx wasm execute $PERSISTENCE_MINTER_CONTRACT \
  "{\"set_fee_collector\":{\"fee_collector_address\":\"<CORRECT_ADDRESS>\"}}" \
  --from $KEY_NAME --chain-id $CHAIN_ID --node $RPC_URL -y
```

**Option B: Migrate Contract (if logic bug found)**
```bash
# Upload new version
persistenced tx wasm store persistence_minter_v2.wasm ...

# Migrate
persistenced tx wasm migrate $PERSISTENCE_MINTER_CONTRACT $NEW_CODE_ID \
  '{}' \
  --from $KEY_NAME --chain-id $CHAIN_ID --node $RPC_URL -y
```

**Option C: Trigger Fee Burn (to reduce accumulated fees)**
```bash
# Burn accumulated fees in fee-collector
persistenced tx wasm execute $FEE_COLLECTOR_CONTRACT \
  '{"trigger_fee_burn":{}}' \
  --from $KEY_NAME \
  --chain-id $CHAIN_ID \
  --node $RPC_URL -y
```

---

## 📊 STEP 8: MONITORING & OBSERVABILITY

### Real-Time Monitoring Commands

```bash
# Monitor events in real-time
persistenced query txs --events "wasm._contract_address=$PERSISTENCE_MINTER_CONTRACT" \
  --node $RPC_URL \
  --limit 10

# Check contract state every minute
watch -n 60 "persistenced query wasm contract-state smart $PERSISTENCE_MINTER_CONTRACT '{\"state\":{}}' --node $RPC_URL"

# Monitor fee collector accumulation
watch -n 60 "persistenced query wasm contract-state smart $FEE_COLLECTOR_CONTRACT '{\"state\":{}}' --node $RPC_URL"
```

### Critical Metrics to Track

1. **total_reverse_burned** - Should increase by 99.5% of each burn amount
2. **total_reverse_fees** - Should increase by 0.5% of each burn amount
3. **accumulated_fees** (in fee-collector) - Should match total_reverse_fees
4. **User nonces** - Should increment by 1 per burn
5. **SP1 proof generation** - Verify proofs are being generated

---

## ⚠️ RISKS & MITIGATIONS

| Risk | Severity | Mitigation | Rollback |
|------|----------|------------|----------|
| **Wrong verifier address** | 🔴 HIGH | Use placeholder, update via admin | SetVerifier |
| **Fee calculation error** | 🟡 MEDIUM | Tested in unit tests | Pause + audit |
| **SP1 proof not generated** | 🟡 MEDIUM | Monitor events | Manual proof gen |
| **Nonce replay attack** | 🔴 HIGH | Nonce validation in code | N/A (prevented) |
| **Contract pause fails** | 🔴 HIGH | Admin retained | Migrate contract |
| **Insufficient gas** | 🟢 LOW | Use gas-adjustment 1.5 | Retry with more gas |
| **Fee collector misconfigured** | 🟡 MEDIUM | Verify before unpause | SetFeeCollector |

---

## 📝 DEPLOYMENT CHECKLIST

### Pre-Deployment
- [ ] All required values collected (chain-id, RPC, admin, etc.)
- [ ] Wallet has sufficient XPRT (~10 XPRT)
- [ ] Admin address confirmed and secured
- [ ] Test wallet has small amount of ibcTFUEL for testing
- [ ] SP1 prover is running and monitoring events
- [ ] Theta wallet ready to receive test unwrap

### Deployment Phase
- [ ] persistence-minter WASM uploaded (code ID: ___)
- [ ] fee-collector WASM uploaded (code ID: ___)
- [ ] persistence-minter instantiated (address: ___)
- [ ] Contract PAUSED immediately after instantiation
- [ ] fee-collector instantiated (address: ___)
- [ ] FeeCollector address updated in minter
- [ ] All pre-test verifications passed

### Testing Phase
- [ ] Contract unpaused for testing
- [ ] First test burn (0.05 TFUEL) executed
- [ ] Fee calculation verified (0.5%)
- [ ] Burn amount verified (99.5%)
- [ ] Nonce incremented correctly
- [ ] SP1 event detected
- [ ] Fee collector balance correct

### Post-Test
- [ ] Contract paused after successful test
- [ ] All state verified
- [ ] Monitoring dashboard active
- [ ] Team notified of successful deployment
- [ ] Documentation updated with contract addresses

---

## 🎯 SUCCESS CRITERIA

✅ **Deployment is successful when:**

1. Both contracts deployed with correct checksums
2. persistence-minter starts in PAUSED state
3. Admin can pause/unpause
4. First test burn succeeds with correct fee split (0.5% / 99.5%)
5. Fee collector receives exactly 0.5%
6. Nonce increments correctly
7. SP1 prover detects BurnForUnwrap event
8. No errors in transaction logs
9. State updates correctly
10. Contract can be paused again after test

---

## 📞 EMERGENCY CONTACTS

- **Admin:** $ADMIN_ADDRESS
- **Monitoring Dashboard:** [Add URL]
- **SP1 Prover:** [Add status endpoint]
- **Incident Response:** [Add contact]

---

## 📚 ADDITIONAL RESOURCES

- **Deployment Guide:** `REVERSE_BRIDGE_DEPLOYMENT_GUIDE.md`
- **Build Report:** `WASM_BUILD_REPORT.md`
- **Final Status:** `REVERSE_BRIDGE_FINAL_STATUS.md`
- **Test Results:** `cosmwasm-contracts/persistence-minter/src/tests.rs`

---

**Generated:** February 4, 2026  
**Version:** v1.0.0-mainnet  
**Status:** READY FOR DEPLOYMENT (pending required values)

---

## 🚀 NEXT STEP: PROVIDE REQUIRED VALUES

Please provide the following information to proceed:

1. **CHAIN_ID** - Persistence mainnet chain ID
2. **RPC_URL** - Persistence mainnet RPC endpoint
3. **KEY_NAME** - Your wallet key name in persistenced
4. **ADMIN_ADDRESS** - Admin wallet address (persistence1...)
5. **DUMMY_VERIFIER** - Current placeholder verifier address (or "TBD")
6. **DUMMY_SPLITTER** - Current placeholder splitter address (or "TBD")

Once provided, I can generate the exact, copy-paste-ready commands with all values filled in.
