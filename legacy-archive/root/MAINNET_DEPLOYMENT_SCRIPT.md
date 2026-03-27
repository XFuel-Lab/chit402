# 🚨 XFUEL REVERSE BRIDGE - PERSISTENCE MAINNET DEPLOYMENT 🚨
## LIVE MAINNET DEPLOYMENT - EXTREME CAUTION REQUIRED

**Date:** February 4, 2026  
**Network:** Persistence Mainnet (core-1)  
**Status:** READY FOR EXECUTION

---

## ⚠️ CRITICAL SAFETY WARNINGS

🔴 **THIS IS A MAINNET DEPLOYMENT - REAL FUNDS AT RISK**

- All commands are pre-filled with MAINNET values
- Contracts will handle REAL TFUEL tokens
- First test uses 0.05 TFUEL (extremely conservative)
- ALL contracts start PAUSED for safety
- **Admin is a 2-of-2 MULTISIG** - Some operations require both signers
- Deployer (PERSISTENCE_DEPLOYER): `persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx`
- Multisig Admin: `persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e`
- NO TESTNET AVAILABLE - This is the only test environment

### Multisig Operations

**Single-Signer Operations (PERSISTENCE_DEPLOYER can execute alone):**
- ✅ Upload WASM files
- ✅ Instantiate contracts (sets multisig as admin)
- ✅ Execute pause/unpause (if PERSISTENCE_DEPLOYER is in multisig)
- ✅ Execute burn_for_unwrap (user operation)
- ✅ Query operations

**Multi-Signer Operations (Requires 2-of-2 multisig signatures):**
- 🔐 Update contract addresses (SetVerifier, SetRevSplitter, SetFeeCollector)
- 🔐 Migrate contracts
- 🔐 Update admin
- 🔐 Critical configuration changes

**Note:** If PERSISTENCE_DEPLOYER is part of the multisig, some operations may require coordination with the second signer.

---

## 📋 PRE-DEPLOYMENT SAFETY CHECKLIST

**STOP! Complete this checklist before proceeding:**

- [ ] **Team coordinated** - All multisig signers ready and available
- [ ] **Mnemonic secured** - PERSISTENCE_DEPLOYER mnemonic in AWS Secrets Manager
- [ ] **Key imported** - PERSISTENCE_DEPLOYER key added to persistenced keyring
- [ ] **Address verified** - Derived address matches persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx
- [ ] **Wallet funded** - At least 10 XPRT for gas fees
- [ ] **WASM checksums verified** - Match expected SHA256 hashes
- [ ] **Monitoring ready** - Dashboard and alerts configured
- [ ] **SP1 prover running** - Ready to detect BurnForUnwrap events
- [ ] **Theta wallet ready** - 0xD3EED5D4a61Beb3401E10D606f9957500AC9819a accessible
- [ ] **Emergency contacts** - Team on standby for issues
- [ ] **Rollback plan understood** - Know how to pause and revert
- [ ] **Test TFUEL available** - Small amount ready for 0.05 TFUEL test
- [ ] **THIS DOCUMENT READ COMPLETELY** - Understand every step

**DO NOT PROCEED UNTIL ALL BOXES ARE CHECKED ✅**

---

## 🔑 DEPLOYMENT CONFIGURATION

### Network Settings
```bash
export CHAIN_ID="core-1"
export RPC_URL="https://rpc.persistence.one:443"
export KEY_NAME="PERSISTENCE_DEPLOYER"
export DEPLOYER_ADDRESS="persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx"
export ADMIN_ADDRESS="persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e"
```

### Multisig Configuration
```bash
# Admin is a 2-of-2 multisig
# Signer 1: PERSISTENCE_DEPLOYER (persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx)
# Signer 2: <Second multisig signer>
# Both signatures required for admin operations
```

### Dummy Addresses (Temporary - Update Via Governance)
```bash
export DUMMY_VERIFIER="persistence1000000000000000000000000000000000000000"
export DUMMY_SPLITTER="persistence1000000000000000000000000000000000000000"
```

### Test Parameters
```bash
export TEST_AMOUNT="50000000000000000"  # 0.05 TFUEL (extremely conservative)
export THETA_RECIPIENT="0xD3EED5D4a61Beb3401E10D606f9957500AC9819a"
export MIN_BURN_AMOUNT="1000000000000000000"  # 1 TFUEL minimum for production
```

### Token Configuration
```bash
export TOKEN_NAME="iBridge TFUEL"
export TOKEN_SYMBOL="ibcTFUEL"
export TOKEN_DECIMALS="18"
```

---

## 🔐 STEP 0: LOAD MNEMONIC FROM AWS SECRETS MANAGER AND ADD KEY

⚠️ **NEVER HARDCODE MNEMONICS - USE AWS SECRETS MANAGER**

**Mnemonic is stored in AWS Secrets Manager:**
- Secret Name: `PERSISTENCE_DEPLOYER`
- ARN: (Available in `.env.local`)
- Key Name: `PERSISTENCE_DEPLOYER`
- Derived Address: `persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx`

### Option A: Load and Import Using AWS CLI (Recommended)

```bash
# Check if key already exists
persistenced keys show PERSISTENCE_DEPLOYER -a 2>/dev/null

# If key doesn't exist, import from AWS Secrets Manager
if [ $? -ne 0 ]; then
    echo "Key not found. Importing from AWS Secrets Manager..."
    
    # Retrieve mnemonic from AWS Secrets Manager
    # The secret contains the mnemonic as plaintext or in JSON format
    MNEMONIC=$(aws secretsmanager get-secret-value \
        --secret-id "PERSISTENCE_DEPLOYER" \
        --query SecretString \
        --output text)
    
    # If mnemonic is stored as JSON, extract it
    # MNEMONIC=$(echo "$MNEMONIC" | jq -r .mnemonic)
    
    # Import to persistenced keyring using echo (secure pipe, no file)
    echo "$MNEMONIC" | persistenced keys add PERSISTENCE_DEPLOYER \
        --recover \
        --keyring-backend file
    
    # Immediately unset the variable
    unset MNEMONIC
    
    echo "Key imported successfully"
else
    echo "Key PERSISTENCE_DEPLOYER already exists in keyring"
fi

# Verify the key and address
DERIVED_ADDRESS=$(persistenced keys show PERSISTENCE_DEPLOYER -a --keyring-backend file)
echo "Derived address: $DERIVED_ADDRESS"

# CRITICAL: Verify address matches expected
if [ "$DERIVED_ADDRESS" != "persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx" ]; then
    echo "❌ ERROR: Derived address does not match expected address!"
    echo "Expected: persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx"
    echo "Got: $DERIVED_ADDRESS"
    exit 1
fi

echo "✅ Address verified successfully"
```

### Option B: Automated Script with Error Handling

```bash
#!/bin/bash
# secure-key-import.sh

set -e  # Exit on error

KEY_NAME="PERSISTENCE_DEPLOYER"
EXPECTED_ADDRESS="persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx"
SECRET_NAME="PERSISTENCE_DEPLOYER"

echo "🔐 Secure Key Import Script"
echo "=============================="

# Check if key exists
if persistenced keys show $KEY_NAME -a --keyring-backend file >/dev/null 2>&1; then
    EXISTING_ADDRESS=$(persistenced keys show $KEY_NAME -a --keyring-backend file)
    
    if [ "$EXISTING_ADDRESS" == "$EXPECTED_ADDRESS" ]; then
        echo "✅ Key $KEY_NAME already exists with correct address"
        echo "   Address: $EXISTING_ADDRESS"
        exit 0
    else
        echo "❌ ERROR: Key $KEY_NAME exists but address mismatch!"
        echo "   Expected: $EXPECTED_ADDRESS"
        echo "   Found: $EXISTING_ADDRESS"
        exit 1
    fi
fi

# Key doesn't exist, import from AWS Secrets Manager
echo "📥 Retrieving mnemonic from AWS Secrets Manager..."

# Check AWS CLI is available
if ! command -v aws &> /dev/null; then
    echo "❌ ERROR: AWS CLI not found. Please install it first."
    exit 1
fi

# Retrieve mnemonic
MNEMONIC=$(aws secretsmanager get-secret-value \
    --secret-id "$SECRET_NAME" \
    --query SecretString \
    --output text 2>&1)

if [ $? -ne 0 ]; then
    echo "❌ ERROR: Failed to retrieve secret from AWS Secrets Manager"
    echo "$MNEMONIC"
    exit 1
fi

# If the secret is JSON, extract the mnemonic field
# Uncomment the line below if your secret is in JSON format:
# MNEMONIC=$(echo "$MNEMONIC" | jq -r .mnemonic)

echo "📝 Importing key to persistenced keyring..."

# Import key using stdin (no temporary files)
echo "$MNEMONIC" | persistenced keys add $KEY_NAME \
    --recover \
    --keyring-backend file

# Clear the mnemonic from memory
MNEMONIC=""
unset MNEMONIC

echo "✅ Key imported successfully"

# Verify the derived address
DERIVED_ADDRESS=$(persistenced keys show $KEY_NAME -a --keyring-backend file)
echo "🔍 Verifying derived address..."
echo "   Derived: $DERIVED_ADDRESS"
echo "   Expected: $EXPECTED_ADDRESS"

if [ "$DERIVED_ADDRESS" != "$EXPECTED_ADDRESS" ]; then
    echo "❌ ERROR: Address verification failed!"
    echo "   The imported mnemonic derives to a different address."
    echo "   This could mean:"
    echo "   1. Wrong mnemonic in AWS Secrets Manager"
    echo "   2. Wrong derivation path"
    echo "   3. Wrong secret name"
    exit 1
fi

echo "✅ Address verified successfully!"
echo "🎉 Key $KEY_NAME is ready for deployment"
```

**To use the automated script:**
```bash
chmod +x secure-key-import.sh
./secure-key-import.sh
```

**Security Notes:**
- ✅ Mnemonic never written to disk
- ✅ Passed via stdin pipe only
- ✅ Variable cleared immediately after use
- ✅ Uses `--keyring-backend file` (not test)
- ✅ Address verification before proceeding
- ✅ IAM permissions required for AWS Secrets Manager
- ✅ No echo/print of sensitive data

**After importing, verify:**
```bash
# List all keys
persistenced keys list --keyring-backend file

# Show specific key details
persistenced keys show PERSISTENCE_DEPLOYER --keyring-backend file

# Should output:
# - name: PERSISTENCE_DEPLOYER
#   type: local
#   address: persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx
#   pubkey: '{"@type":"/cosmos.crypto.secp256k1.PubKey","key":"..."}'
```

---

## 📦 STEP 1: VERIFY WASM ARTIFACTS

**Navigate to artifacts directory:**
```bash
cd C:\Users\seeha\xfuel-protocol\cosmwasm-contracts\artifacts
```

**Verify checksums (CRITICAL - DO NOT SKIP):**
```bash
# Check persistence_minter.wasm
sha256sum persistence_minter.wasm
# Expected: 516db0e88509afb90e3055b320691de68387ace97a9a34a72e5621ad3778b748

# Check fee_collector.wasm
sha256sum fee_collector.wasm
# Expected: 7a370b84ea0ed94df29b2acd2804d73bc27fa1d5a325e2bdd76b3861438f5acd
```

**If checksums DON'T match - STOP DEPLOYMENT IMMEDIATELY**

**Verify wallet has funds:**
```bash
persistenced query bank balances persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx \
  --node https://rpc.persistence.one:443 \
  --output json | jq '.balances[] | select(.denom=="uxprt")'

# Should show at least 10,000,000 uxprt (10 XPRT)
```

---

## 🚀 STEP 2: UPLOAD persistence-minter WASM

**Estimated Gas:** ~3,000,000 units (~0.075 XPRT)

```bash
persistenced tx wasm store persistence_minter.wasm \
  --from PERSISTENCE_DEPLOYER \
  --keyring-backend file \
  --chain-id core-1 \
  --node https://rpc.persistence.one:443 \
  --gas 3500000 \
  --gas-prices 0.025uxprt \
  --broadcast-mode sync \
  -y

# WAIT FOR TRANSACTION TO BE INCLUDED IN BLOCK
# Save the transaction hash from output
```

**Expected Output:**
```
code: 0
txhash: <TX_HASH>
...
```

**Get Code ID from transaction:**
```bash
# Replace <TX_HASH> with actual hash from above
export MINTER_TX_HASH="<TX_HASH_FROM_UPLOAD>"

persistenced query tx $MINTER_TX_HASH \
  --node $RPC_URL \
  --output json | jq -r '.logs[0].events[] | select(.type=="store_code") | .attributes[] | select(.key=="code_id") | .value'

# Save this as MINTER_CODE_ID
export MINTER_CODE_ID="<CODE_ID_FROM_QUERY>"
```

**Verify upload:**
```bash
persistenced query wasm code $MINTER_CODE_ID \
  --node $RPC_URL \
  --output json | jq -r '.data_hash'

# Should match: 516db0e88509afb90e3055b320691de68387ace97a9a34a72e5621ad3778b748
```

---

## 🚀 STEP 3: UPLOAD fee-collector WASM

**Estimated Gas:** ~2,000,000 units (~0.05 XPRT)

```bash
persistenced tx wasm store fee_collector.wasm \
  --from PERSISTENCE_DEPLOYER \
  --keyring-backend file \
  --chain-id core-1 \
  --node https://rpc.persistence.one:443 \
  --gas 2500000 \
  --gas-prices 0.025uxprt \
  --broadcast-mode sync \
  -y

# Save the transaction hash
export FEE_COLLECTOR_TX_HASH="<TX_HASH_FROM_UPLOAD>"
```

**Get Code ID:**
```bash
persistenced query tx $FEE_COLLECTOR_TX_HASH \
  --node $RPC_URL \
  --output json | jq -r '.logs[0].events[] | select(.type=="store_code") | .attributes[] | select(.key=="code_id") | .value'

# Save this
export FEE_COLLECTOR_CODE_ID="<CODE_ID_FROM_QUERY>"
```

**Verify upload:**
```bash
persistenced query wasm code $FEE_COLLECTOR_CODE_ID \
  --node $RPC_URL \
  --output json | jq -r '.data_hash'

# Should match: 7a370b84ea0ed94df29b2acd2804d73bc27fa1d5a325e2bdd76b3861438f5acd
```

---

## 🏗️ STEP 4: INSTANTIATE persistence-minter (STARTS UNPAUSED - WILL PAUSE IMMEDIATELY)

⚠️ **CRITICAL: Contract instantiates UNPAUSED by default - we PAUSE immediately after**

**Prepare instantiation message:**
```bash
INSTANTIATE_MSG_MINTER=$(cat <<'EOF'
{
  "name": "iBridge TFUEL",
  "symbol": "ibcTFUEL",
  "decimals": 18,
  "initial_balances": [],
  "mint_cap": null,
  "marketing": null,
  "verifier_address": "persistence1000000000000000000000000000000000000000",
  "rev_splitter_address": "persistence1000000000000000000000000000000000000000",
  "fee_collector_address": "persistence1000000000000000000000000000000000000000"
}
EOF
)
```

**Instantiate contract:**
```bash
persistenced tx wasm instantiate $MINTER_CODE_ID \
  "$INSTANTIATE_MSG_MINTER" \
  --from PERSISTENCE_DEPLOYER \
  --keyring-backend file \
  --chain-id core-1 \
  --node https://rpc.persistence.one:443 \
  --label "xfuel-ibcTFUEL-minter-v1.0.0-mainnet" \
  --admin persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e \
  --gas 600000 \
  --gas-prices 0.025uxprt \
  --broadcast-mode sync \
  -y

# Save transaction hash
export MINTER_INSTANTIATE_TX_HASH="<TX_HASH_FROM_INSTANTIATE>"
```

**Get contract address:**
```bash
persistenced query tx $MINTER_INSTANTIATE_TX_HASH \
  --node $RPC_URL \
  --output json | jq -r '.logs[0].events[] | select(.type=="instantiate") | .attributes[] | select(.key=="_contract_address") | .value'

# Save this - CRITICAL!
export MINTER_CONTRACT="<CONTRACT_ADDRESS_FROM_QUERY>"

# Example: persistence1abcdef...
echo "MINTER_CONTRACT=$MINTER_CONTRACT"
```

**🚨 IMMEDIATELY PAUSE THE CONTRACT (DO THIS NOW!):**
```bash
persistenced tx wasm execute $MINTER_CONTRACT \
  '{"pause":{}}' \
  --from PERSISTENCE_DEPLOYER \
  --keyring-backend file \
  --chain-id core-1 \
  --node https://rpc.persistence.one:443 \
  --gas 200000 \
  --gas-prices 0.025uxprt \
  --broadcast-mode block \
  -y
```

**Verify PAUSED state:**
```bash
persistenced query wasm contract-state smart $MINTER_CONTRACT \
  '{"config":{}}' \
  --node $RPC_URL \
  --output json | jq .data.paused

# MUST return: true
# If false - STOP AND INVESTIGATE
```

---

## 🏗️ STEP 5: INSTANTIATE fee-collector

**Prepare instantiation message:**
```bash
INSTANTIATE_MSG_FEE_COLLECTOR=$(cat <<EOF
{
  "admin": "$ADMIN_ADDRESS",
  "ibctfuel_token": "$MINTER_CONTRACT",
  "minter_contract": "$MINTER_CONTRACT",
  "min_burn_amount": "1000000000000000000"
}
EOF
)
```

**Instantiate fee-collector:**
```bash
persistenced tx wasm instantiate $FEE_COLLECTOR_CODE_ID \
  "$INSTANTIATE_MSG_FEE_COLLECTOR" \
  --from PERSISTENCE_DEPLOYER \
  --keyring-backend file \
  --chain-id core-1 \
  --node https://rpc.persistence.one:443 \
  --label "xfuel-fee-collector-v1.0.0-mainnet" \
  --admin persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e \
  --gas 400000 \
  --gas-prices 0.025uxprt \
  --broadcast-mode sync \
  -y

# Save transaction hash
export FEE_COLLECTOR_INSTANTIATE_TX_HASH="<TX_HASH_FROM_INSTANTIATE>"
```

**Get contract address:**
```bash
persistenced query tx $FEE_COLLECTOR_INSTANTIATE_TX_HASH \
  --node $RPC_URL \
  --output json | jq -r '.logs[0].events[] | select(.type=="instantiate") | .attributes[] | select(.key=="_contract_address") | .value'

# Save this - CRITICAL!
export FEE_COLLECTOR_CONTRACT="<CONTRACT_ADDRESS_FROM_QUERY>"

# Example: persistence1xyz123...
echo "FEE_COLLECTOR_CONTRACT=$FEE_COLLECTOR_CONTRACT"
```

**Verify fee-collector config:**
```bash
persistenced query wasm contract-state smart $FEE_COLLECTOR_CONTRACT \
  '{"config":{}}' \
  --node $RPC_URL \
  --output json | jq .
```

**Expected Output:**
```json
{
  "data": {
    "admin": "persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e",
    "ibctfuel_token": "<MINTER_CONTRACT_ADDRESS>",
    "minter_contract": "<MINTER_CONTRACT_ADDRESS>",
    "min_burn_amount": "1000000000000000000",
    "paused": false
  }
}
```

---

## 🔧 STEP 6: UPDATE MINTER WITH FEE_COLLECTOR ADDRESS

**Contract is still PAUSED during this update (safe)**

```bash
persistenced tx wasm execute $MINTER_CONTRACT \
  "{\"set_fee_collector\":{\"fee_collector_address\":\"$FEE_COLLECTOR_CONTRACT\"}}" \
  --from PERSISTENCE_DEPLOYER \
  --keyring-backend file \
  --chain-id core-1 \
  --node https://rpc.persistence.one:443 \
  --gas 200000 \
  --gas-prices 0.025uxprt \
  --broadcast-mode block \
  -y
```

**Verify update:**
```bash
persistenced query wasm contract-state smart $MINTER_CONTRACT \
  '{"config":{}}' \
  --node $RPC_URL \
  --output json | jq -r .data.fee_collector_address

# Should output: $FEE_COLLECTOR_CONTRACT address
```

---

## ✅ STEP 7: PRE-TEST VERIFICATION (ALL CRITICAL CHECKS)

**DO NOT PROCEED TO TESTING UNTIL ALL THESE CHECKS PASS**

### Check 1: Minter is PAUSED
```bash
persistenced query wasm contract-state smart $MINTER_CONTRACT \
  '{"config":{}}' \
  --node $RPC_URL \
  --output json | jq .data.paused

# MUST return: true
```

### Check 2: Admin address is correct (multisig)
```bash
persistenced query wasm contract-state smart $MINTER_CONTRACT \
  '{"config":{}}' \
  --node $RPC_URL \
  --output json | jq -r .data.admin

# MUST return: persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e
```

### Check 3: Fee collector address is set
```bash
persistenced query wasm contract-state smart $MINTER_CONTRACT \
  '{"config":{}}' \
  --node $RPC_URL \
  --output json | jq -r .data.fee_collector_address

# MUST return: $FEE_COLLECTOR_CONTRACT address (not dummy address)
```

### Check 4: Dummy addresses are in place (temporary)
```bash
persistenced query wasm contract-state smart $MINTER_CONTRACT \
  '{"config":{}}' \
  --node $RPC_URL \
  --output json | jq -r '.data | {verifier: .verifier_address, splitter: .rev_splitter_address}'

# Should show dummy addresses (both persistence1000000...0000)
```

### Check 5: Initial state is all zeros
```bash
persistenced query wasm contract-state smart $MINTER_CONTRACT \
  '{"state":{}}' \
  --node $RPC_URL \
  --output json | jq .data

# All values should be "0"
```

### Check 6: Fee collector config correct
```bash
persistenced query wasm contract-state smart $FEE_COLLECTOR_CONTRACT \
  '{"config":{}}' \
  --node $RPC_URL \
  --output json | jq .data

# Verify:
# - ibctfuel_token matches MINTER_CONTRACT
# - minter_contract matches MINTER_CONTRACT  
# - min_burn_amount is "1000000000000000000"
# - admin is persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e
```

### Check 7: Fee collector initial state is zero
```bash
persistenced query wasm contract-state smart $FEE_COLLECTOR_CONTRACT \
  '{"state":{}}' \
  --node $RPC_URL \
  --output json | jq .data

# accumulated_fees should be "0"
# total_burned should be "0"
```

**🛑 STOP HERE IF ANY CHECK FAILS - DO NOT PROCEED TO TESTING**

---

## 🧪 STEP 8: FIRST TEST TRANSACTION (0.05 TFUEL)

⚠️ **EXTREME CAUTION: LIVE MAINNET TEST WITH REAL TOKENS**

### Pre-Test Checklist
- [ ] All Step 7 verification checks passed
- [ ] SP1 prover is running and monitoring events
- [ ] Team is monitoring the deployment
- [ ] Ready to pause immediately if needed
- [ ] Test wallet has at least 0.05 TFUEL (ibcTFUEL tokens)

### 8A: Unpause Contract (FOR TEST ONLY)

```bash
persistenced tx wasm execute $MINTER_CONTRACT \
  '{"unpause":{}}' \
  --from PERSISTENCE_DEPLOYER \
  --keyring-backend file \
  --chain-id core-1 \
  --node https://rpc.persistence.one:443 \
  --gas 200000 \
  --gas-prices 0.025uxprt \
  --broadcast-mode block \
  -y
```

**Verify unpaused:**
```bash
persistenced query wasm contract-state smart $MINTER_CONTRACT \
  '{"config":{}}' \
  --node $RPC_URL \
  --output json | jq .data.paused

# Should return: false
```

### 8B: Execute burn_for_unwrap (0.05 TFUEL)

**⚠️ THIS BURNS REAL TOKENS ON MAINNET**

```bash
persistenced tx wasm execute $MINTER_CONTRACT \
  "{\"burn_for_unwrap\":{\"amount\":\"50000000000000000\",\"theta_recipient\":\"0xD3EED5D4a61Beb3401E10D606f9957500AC9819a\"}}" \
  --from PERSISTENCE_DEPLOYER \
  --keyring-backend file \
  --chain-id core-1 \
  --node https://rpc.persistence.one:443 \
  --gas 500000 \
  --gas-prices 0.025uxprt \
  --broadcast-mode block \
  -y

# SAVE THE TX HASH - CRITICAL FOR VERIFICATION
export TEST_TX_HASH="<TX_HASH_FROM_BURN>"
```

**Expected Output:**
```
code: 0
txhash: <TX_HASH>
logs:
  - events:
    - type: wasm-BurnForUnwrap
      attributes:
        - key: burner
          value: <YOUR_ADDRESS>
        - key: theta_recipient
          value: 0xD3EED5D4a61Beb3401E10D606f9957500AC9819a
        - key: burn_amount
          value: "49750000000000000"
        - key: fee_amount
          value: "250000000000000"
        - key: nonce
          value: "0"
```

### 8C: IMMEDIATELY PAUSE AFTER TEST

```bash
persistenced tx wasm execute $MINTER_CONTRACT \
  '{"pause":{}}' \
  --from PERSISTENCE_DEPLOYER \
  --keyring-backend file \
  --chain-id core-1 \
  --node https://rpc.persistence.one:443 \
  --gas 200000 \
  --gas-prices 0.025uxprt \
  --broadcast-mode block \
  -y
```

**Verify paused again:**
```bash
persistenced query wasm contract-state smart $MINTER_CONTRACT \
  '{"config":{}}' \
  --node $RPC_URL \
  --output json | jq .data.paused

# MUST return: true
```

---

## ✅ STEP 9: POST-TEST VERIFICATION

### 9A: Check Transaction Events

```bash
persistenced query tx $TEST_TX_HASH \
  --node $RPC_URL \
  --output json | jq '.logs[0].events[] | select(.type | startswith("wasm"))'
```

**Expected Events:**
1. **wasm-BurnForUnwrap** - Main burn event
2. **wasm-FeeBurn** - Fee transfer to FeeCollector

**Critical Attributes to Verify:**
- `burner`: Your wallet address
- `theta_recipient`: `0xD3EED5D4a61Beb3401E10D606f9957500AC9819a`
- `burn_amount`: `49750000000000000` (99.5% of 0.05 TFUEL)
- `fee_amount`: `250000000000000` (0.5% of 0.05 TFUEL)
- `nonce`: `0` (first burn from this user)

### 9B: Verify Fee Calculation (CRITICAL)

```bash
# Expected for 0.05 TFUEL (50000000000000000):
# Fee (0.5%):     250000000000000 (0.00025 TFUEL)
# Burned (99.5%): 49750000000000000 (0.04975 TFUEL)

# Check fee collector received exactly 0.5%
persistenced query wasm contract-state smart $FEE_COLLECTOR_CONTRACT \
  '{"state":{}}' \
  --node $RPC_URL \
  --output json | jq .data.accumulated_fees

# MUST show: "250000000000000"
```

**Calculation Verification:**
```bash
# In Python or calculator:
# Total: 50000000000000000
# Fee = Total * 0.005 = 250000000000000 ✓
# Burned = Total - Fee = 49750000000000000 ✓
```

### 9C: Verify Minter State Updates

```bash
persistenced query wasm contract-state smart $MINTER_CONTRACT \
  '{"state":{}}' \
  --node $RPC_URL \
  --output json | jq .data
```

**Expected State:**
```json
{
  "total_minted": "0",
  "total_burned": "0",
  "total_recycled": "0",
  "total_lp_reinvest": "0",
  "total_reverse_burned": "49750000000000000",
  "total_reverse_fees": "250000000000000"
}
```

### 9D: Verify Nonce Increment

```bash
# Check user's nonce (should be 1 after first burn)
TEST_WALLET="persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx"

persistenced query wasm contract-state smart $MINTER_CONTRACT \
  "{\"reverse_burn_nonce\":{\"address\":\"$TEST_WALLET\"}}" \
  --node https://rpc.persistence.one:443 \
  --output json | jq .data

# Should return: {"nonce": 1}
```

### 9E: Verify Fee Collector Balance

```bash
# Check ibcTFUEL balance in fee-collector contract
persistenced query wasm contract-state smart $MINTER_CONTRACT \
  "{\"balance\":{\"address\":\"$FEE_COLLECTOR_CONTRACT\"}}" \
  --node $RPC_URL \
  --output json | jq .data.balance

# Should show: "250000000000000" (0.00025 TFUEL)
```

### 9F: Verify SP1 Prover Detected Event

```bash
# Check your SP1 prover logs for:
# - Event type: BurnForUnwrap
# - Burner: $TEST_WALLET
# - Theta recipient: 0xD3EED5D4a61Beb3401E10D606f9957500AC9819a
# - Burn amount: 49750000000000000
# - Fee amount: 250000000000000
# - Nonce: 0

# Query SP1 prover status endpoint (if available)
# curl https://your-sp1-prover.com/api/status
```

---

## ✅ STEP 10: DEPLOYMENT SUCCESS CRITERIA

**Deployment is SUCCESSFUL when ALL of the following are true:**

- [x] Both WASMs uploaded with correct checksums
- [x] persistence-minter instantiated with multisig admin
- [x] Contract is PAUSED
- [x] fee-collector instantiated correctly
- [x] FeeCollector address updated in minter
- [x] First test burn executed successfully
- [x] Fee calculation is EXACTLY 0.5% (250000000000000)
- [x] Burn amount is EXACTLY 99.5% (49750000000000000)
- [x] Nonce incremented from 0 to 1
- [x] SP1 prover detected BurnForUnwrap event
- [x] Fee collector balance matches expected
- [x] Minter state updated correctly
- [x] Contract PAUSED again after test
- [x] No errors in any transaction logs

**If ALL criteria met: DEPLOYMENT SUCCESSFUL ✅**

---

## 📊 STEP 11: RECORD DEPLOYMENT DETAILS

**Save these values for production use:**

```bash
# Network
CHAIN_ID="core-1"
RPC_URL="https://rpc.persistence.one:443"

# Deployed Contracts
MINTER_CODE_ID="<RECORD_FROM_STEP_2>"
FEE_COLLECTOR_CODE_ID="<RECORD_FROM_STEP_3>"
MINTER_CONTRACT="<RECORD_FROM_STEP_4>"
FEE_COLLECTOR_CONTRACT="<RECORD_FROM_STEP_5>"

# Admin
ADMIN_ADDRESS="persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e"

# Transaction Hashes (for audit trail)
MINTER_UPLOAD_TX="<FROM_STEP_2>"
FEE_COLLECTOR_UPLOAD_TX="<FROM_STEP_3>"
MINTER_INSTANTIATE_TX="<FROM_STEP_4>"
FEE_COLLECTOR_INSTANTIATE_TX="<FROM_STEP_5>"
FIRST_TEST_TX="<FROM_STEP_8>"

# Deployment Date
DEPLOYMENT_DATE="2026-02-04"
```

**Update documentation:**
1. Add contract addresses to `.env.production`
2. Update `README.md` with mainnet addresses
3. Notify team of successful deployment
4. Update monitoring dashboard with contract addresses

---

## 🚨 EMERGENCY PROCEDURES

### If Anything Goes Wrong During Deployment

**IMMEDIATE ACTION - PAUSE CONTRACT:**

```bash
persistenced tx wasm execute $MINTER_CONTRACT \
  '{"pause":{}}' \
  --from PERSISTENCE_DEPLOYER \
  --keyring-backend file \
  --chain-id core-1 \
  --node https://rpc.persistence.one:443 \
  --gas 200000 \
  --gas-prices 0.05uxprt \
  --broadcast-mode block \
  -y
```

### Emergency Contacts

- **Multisig Signers:** [Coordinate for admin actions]
- **SP1 Prover Team:** [Monitor event detection]
- **Incident Response:** [Escalation path]

### Common Issues and Fixes

**Issue 1: Fee calculation is wrong**
```bash
# PAUSE immediately
# Query state to assess damage
# Review transaction logs
# Contact team for assessment
# DO NOT unpause until issue understood
```

**Issue 2: SP1 prover not detecting events**
```bash
# Check prover logs
# Verify event format matches expected
# Confirm RPC endpoint accessible to prover
# Contract can remain paused while investigating
```

**Issue 3: Wrong address configured**
```bash
# Update via admin (requires multisig):
persistenced tx wasm execute $MINTER_CONTRACT \
  "{\"set_verifier\":{\"verifier_address\":\"<CORRECT_ADDRESS>\"}}" \
  --from PERSISTENCE_DEPLOYER ...

# Similar for rev_splitter and fee_collector
```

**Issue 4: Need to migrate contract**
```bash
# Upload new code
# Migrate (requires multisig admin)
persistenced tx wasm migrate $MINTER_CONTRACT $NEW_CODE_ID \
  '{}' \
  --from PERSISTENCE_DEPLOYER ...
```

---

## 📈 POST-DEPLOYMENT MONITORING

### Real-Time Monitoring Commands

**Monitor minter state (every 60 seconds):**
```bash
watch -n 60 "persistenced query wasm contract-state smart $MINTER_CONTRACT '{\"state\":{}}' --node $RPC_URL --output json | jq .data"
```

**Monitor fee collector accumulation:**
```bash
watch -n 60 "persistenced query wasm contract-state smart $FEE_COLLECTOR_CONTRACT '{\"state\":{}}' --node $RPC_URL --output json | jq .data"
```

**Monitor recent transactions:**
```bash
persistenced query txs \
  --events "wasm._contract_address=$MINTER_CONTRACT" \
  --node $RPC_URL \
  --limit 10 \
  --output json | jq .
```

### Critical Metrics to Track

1. **total_reverse_burned** - Should increase by 99.5% per burn
2. **total_reverse_fees** - Should increase by 0.5% per burn
3. **accumulated_fees** - Should match total_reverse_fees
4. **Nonces** - Should increment sequentially per user
5. **Paused state** - Should remain true until production ready

---

## 🎯 NEXT STEPS AFTER SUCCESSFUL DEPLOYMENT

1. **Keep Contract PAUSED** - Do not unpause until production ready
2. **Update Real Addresses** - Replace dummy verifier/splitter via multisig governance
3. **Configure SP1 Prover** - Ensure continuous monitoring of BurnForUnwrap events
4. **Test End-to-End Flow** - Verify TFUEL arrives on Theta after SP1 proof
5. **Gradual Rollout** - When ready, unpause and test with small amounts first
6. **Monitor Continuously** - Track all burns, fees, and state changes
7. **Document Learnings** - Update deployment guide with any issues encountered

---

## 📝 FINAL SAFETY REMINDERS

🔴 **CRITICAL REMINDERS:**

1. ✅ **Contract is PAUSED** after deployment and test
2. ✅ **Dummy addresses in use** - Update via governance before production
3. ✅ **Multisig admin** - Coordinate with team for any admin actions
4. ✅ **Extremely small test** - 0.05 TFUEL is 50x smaller than 1 TFUEL limit
5. ✅ **Emergency pause ready** - Can pause at any time
6. ✅ **SP1 prover monitoring** - Verify events are detected
7. ✅ **All transactions logged** - Keep audit trail
8. ✅ **Private key secured** - In AWS Secrets Manager, not hardcoded

---

## 📚 ADDITIONAL RESOURCES

- **Full Deployment Guide:** `REVERSE_BRIDGE_DEPLOYMENT_GUIDE.md`
- **Build Report:** `WASM_BUILD_REPORT.md`
- **Quick Reference:** `MAINNET_QUICKREF.md`
- **Test Coverage:** `cosmwasm-contracts/persistence-minter/src/tests.rs`

---

**Generated:** February 4, 2026  
**Network:** Persistence Mainnet (core-1)  
**Status:** READY FOR EXECUTION  
**Admin:** persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e (Multisig)

---

## 🚀 YOU ARE READY TO DEPLOY

**Follow these steps in order:**
1. Complete pre-deployment safety checklist
2. Load SP1_PRIVATE_KEY from AWS Secrets Manager
3. Verify WASM checksums
4. Execute Steps 2-6 (upload and instantiate)
5. Run all Step 7 verification checks
6. Execute Step 8 test transaction (0.05 TFUEL)
7. Verify all Step 9 post-test checks
8. Record deployment details from Step 11

**Good luck with your mainnet deployment! 🚀**
