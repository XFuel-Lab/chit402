# XFuel Protocol v4.4 - Mainnet Deployment Guide

**Version:** 4.4 (Bi-Directional ZK Bridge Edition)  
**Date:** February 6, 2026  
**Status:** Phase C Complete - Ready for Governance Approval

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Deployment Values](#deployment-values)
4. [Step-by-Step Deployment](#step-by-step-deployment)
5. [Mock Testing Guide](#mock-testing-guide)
6. [Post-Governance Migration](#post-governance-migration)
7. [Monitoring & Troubleshooting](#monitoring--troubleshooting)

---

## Overview

This guide walks through deploying XFuel Protocol v4.4 to Persistence mainnet (core-1) with:

- ✅ Bi-directional bridge (forward + reverse flows)
- ✅ MOCK_MODE enabled for governance validation
- ✅ Dummy addresses for verifier/minter (pending governance)
- ✅ AWS Secrets Manager for key management
- ✅ Full mock E2E testing capability

**Deployment Phases:**
- **Phase C** (Current): Mock mode, dummy addresses, governance prep
- **Phase D** (Post-Governance): Production mode, real addresses, mainnet launch

---

## Prerequisites

### 1. System Requirements

```bash
# Install persistenced (Persistence Core binary)
wget https://github.com/persistenceOne/persistenceCore/releases/download/v11.0.0/persistenceCore-v11.0.0-linux-amd64.tar.gz
tar -xzf persistenceCore-v11.0.0-linux-amd64.tar.gz
sudo mv persistenced /usr/local/bin/
persistenced version
# Expected: v11.0.0

# Install Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup default stable

# Install Docker (for CosmWasm optimizer)
sudo apt update && sudo apt install -y docker.io
sudo systemctl start docker
sudo usermod -aG docker $USER

# Install AWS CLI
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install
aws --version

# Install jq (JSON processor)
sudo apt install -y jq
```

### 2. AWS Credentials

```bash
# Configure AWS CLI
aws configure
# AWS Access Key ID: [your_key]
# AWS Secret Access Key: [your_secret]
# Default region name: us-east-1
# Default output format: json

# Test access to secrets
export AWS_ACCOUNT_ID="YOUR_AWS_ACCOUNT_ID"
aws secretsmanager list-secrets --query "SecretList[?starts_with(Name, 'SP1') || starts_with(Name, 'PERSISTENCE')]"
```

### 3. Workspace Setup

```bash
# Clone repository
git clone https://github.com/XFuel-Lab/xfuel-protocol.git
cd xfuel-protocol

# Checkout Phase C branch
git checkout cleanup/legacy-code-removal

# Verify contract files
ls cosmwasm-contracts/persistence-minter/src/
# Expected: contract.rs, msg.rs, state.rs, tests.rs, error.rs, lib.rs
```

---

## Deployment Values

### Persistence Mainnet (core-1)

```bash
export CHAIN_ID=core-1
export RPC_URL=https://rpc.persistence.one:443
export ADMIN_ADDRESS=persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e
export GAS_PRICES=0.025uxprt
```

### Theta Mainnet

```bash
export THETA_RECIPIENT=0xD3EED5D4a61Beb3401E10D606f9957500AC9819a
```

### Dummy Addresses (Phase C - Governance Prep)

```bash
export VERIFIER_ADDRESS=persistence1000000000000000000000000000000000000
export REV_SPLITTER_ADDRESS=persistence1111111111111111111111111111111111111
export FEE_COLLECTOR_ADDRESS=persistence1feecollector0000000000000000000000000000000000
export MINTER_ADDRESS=persistence1minter0000000000000000000000000000000000
```

### AWS Secrets ARNs

```bash
export SP1_KEY_ARN=arn:aws:secretsmanager:us-east-1:${AWS_ACCOUNT_ID}:secret:SP1_PRIVATE_KEY
export PERSISTENCE_MNEMONIC_ARN=arn:aws:secretsmanager:us-east-1:${AWS_ACCOUNT_ID}:secret:PERSISTENCE_DEPLOYER
```

---

## Step-by-Step Deployment

### Step 1: Load Deployment Keys from AWS

```bash
cd deploy-tool

# Option A: Bash script (recommended)
source load_deployment_keys.sh

# Option B: Rust script
# cargo install rust-script
# rust-script load_deployment_keys.rs

# Verify keys loaded
echo "SP1 key length: ${#SP1_PRIVATE_KEY}"
echo "Mnemonic word count: $(echo $PERSISTENCE_MNEMONIC | wc -w)"
```

**Expected Output:**
```
🔐 Loading deployment keys from AWS Secrets Manager...

📥 Retrieving SP1_PRIVATE_KEY...
✅ SP1_PRIVATE_KEY loaded (0x742d35Cc6634C0...)

📥 Retrieving PERSISTENCE_DEPLOYER mnemonic...
✅ PERSISTENCE_MNEMONIC loaded (24 words)
   Preview: word1 word2 word3 ...

✅ All deployment keys loaded successfully!
```

### Step 2: Import Deployer Key to persistenced

```bash
# Add deployer key to keyring
echo "$PERSISTENCE_MNEMONIC" | persistenced keys add deployer --recover --keyring-backend test

# Verify address matches expected admin address
DEPLOYER_ADDR=$(persistenced keys show deployer --keyring-backend test --address)
echo "Deployer address: $DEPLOYER_ADDR"

if [ "$DEPLOYER_ADDR" != "$ADMIN_ADDRESS" ]; then
  echo "❌ ERROR: Deployer address mismatch!"
  echo "   Expected: $ADMIN_ADDRESS"
  echo "   Got: $DEPLOYER_ADDR"
  exit 1
fi

echo "✅ Deployer address verified!"
```

### Step 3: Build Optimized CosmWasm Contract

```bash
cd ../cosmwasm-contracts/persistence-minter

# Build with CosmWasm optimizer (produces ~400KB WASM)
docker run --rm -v "$(pwd)":/code \
  --mount type=volume,source="$(basename "$(pwd)")_cache",target=/target \
  --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
  cosmwasm/optimizer:0.15.0

# Verify artifact
ls -lh artifacts/persistence_minter.wasm
# Expected: ~400KB
```

**Alternative: Local build (development only)**
```bash
cargo wasm
ls -lh target/wasm32-unknown-unknown/release/persistence_minter.wasm
# Warning: Not optimized, ~2MB
```

### Step 4: Upload Contract to Persistence Mainnet

```bash
# Upload WASM binary
TX_HASH=$(persistenced tx wasm store artifacts/persistence_minter.wasm \
  --from deployer \
  --keyring-backend test \
  --chain-id $CHAIN_ID \
  --node $RPC_URL \
  --gas auto \
  --gas-adjustment 1.3 \
  --gas-prices $GAS_PRICES \
  --broadcast-mode sync \
  --yes \
  --output json | jq -r '.txhash')

echo "📤 Upload TX: $TX_HASH"
echo "⏳ Waiting 6 seconds for block confirmation..."
sleep 6

# Query transaction to get code ID
CODE_ID=$(persistenced query tx $TX_HASH \
  --node $RPC_URL \
  --output json | jq -r '.logs[0].events[] | select(.type=="store_code") | .attributes[] | select(.key=="code_id") | .value')

if [ -z "$CODE_ID" ]; then
  echo "❌ ERROR: Failed to get code ID from transaction"
  echo "   TX Hash: $TX_HASH"
  persistenced query tx $TX_HASH --node $RPC_URL
  exit 1
fi

echo "✅ Code uploaded successfully!"
echo "   Code ID: $CODE_ID"
echo "   TX Hash: $TX_HASH"
```

### Step 5: Instantiate ibcTFUEL Contract (Mock Mode)

```bash
# Prepare instantiation message (Phase C: mock_mode = true)
INIT_MSG=$(cat <<EOF
{
  "name": "IBC Theta Fuel",
  "symbol": "IBCTFUEL",
  "decimals": 18,
  "initial_balances": [],
  "mint_cap": null,
  "marketing": null,
  "verifier_address": "$VERIFIER_ADDRESS",
  "rev_splitter_address": "$REV_SPLITTER_ADDRESS",
  "fee_collector_address": "$FEE_COLLECTOR_ADDRESS",
  "mock_mode": true
}
EOF
)

echo "📋 Instantiation message:"
echo "$INIT_MSG" | jq '.'

# Instantiate contract
TX_HASH=$(persistenced tx wasm instantiate $CODE_ID "$INIT_MSG" \
  --from deployer \
  --keyring-backend test \
  --label "ibcTFUEL-v4.4-phase-c-mock" \
  --admin $ADMIN_ADDRESS \
  --chain-id $CHAIN_ID \
  --node $RPC_URL \
  --gas auto \
  --gas-adjustment 1.3 \
  --gas-prices $GAS_PRICES \
  --broadcast-mode sync \
  --yes \
  --output json | jq -r '.txhash')

echo "📤 Instantiate TX: $TX_HASH"
echo "⏳ Waiting 6 seconds for block confirmation..."
sleep 6

# Query contract address
CONTRACT_ADDR=$(persistenced query wasm list-contract-by-code $CODE_ID \
  --node $RPC_URL \
  --output json | jq -r '.contracts[0]')

if [ -z "$CONTRACT_ADDR" ]; then
  echo "❌ ERROR: Failed to get contract address"
  exit 1
fi

echo "✅ Contract instantiated successfully!"
echo "   Contract Address: $CONTRACT_ADDR"
echo "   Code ID: $CODE_ID"
echo "   TX Hash: $TX_HASH"

# Save contract address for later use
export CONTRACT_ADDR
echo "export CONTRACT_ADDR=$CONTRACT_ADDR" >> ~/.bashrc
```

### Step 6: Verify Mock Mode Configuration

```bash
# Query contract config
echo "🔍 Querying contract configuration..."
CONFIG=$(persistenced query wasm contract-state smart $CONTRACT_ADDR \
  '{"config":{}}' \
  --node $RPC_URL \
  --output json | jq '.')

echo "$CONFIG"

# Verify mock mode enabled
MOCK_MODE=$(echo "$CONFIG" | jq -r '.data.mock_mode')
if [ "$MOCK_MODE" != "true" ]; then
  echo "❌ ERROR: Mock mode not enabled!"
  echo "   Expected: true"
  echo "   Got: $MOCK_MODE"
  exit 1
fi

echo "✅ Mock mode verified: enabled"

# Verify dummy addresses
VERIFIER=$(echo "$CONFIG" | jq -r '.data.verifier_address')
echo "   Verifier: $VERIFIER (dummy)"
echo "   Rev Splitter: $(echo "$CONFIG" | jq -r '.data.rev_splitter_address') (dummy)"
echo "   Fee Collector: $(echo "$CONFIG" | jq -r '.data.fee_collector_address') (dummy)"
```

**Expected Output:**
```json
{
  "data": {
    "mock_mode": true,
    "verifier_address": "persistence1000000000000000000000000000000000000",
    "rev_splitter_address": "persistence1111111111111111111111111111111111111",
    "fee_collector_address": "persistence1feecollector0000000000000000000000000000000000",
    "paused": false,
    "admin": "persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e"
  }
}
```

---

## Mock Testing Guide

### Test 1: Mock Mint (Forward Flow)

```bash
echo "🧪 Test 1: Mock mint (forward flow - ZK verification skipped)"

# Execute verify_and_mint (mock mode skips proof validation)
TX_HASH=$(persistenced tx wasm execute $CONTRACT_ADDR \
  '{"verify_and_mint":{"zk_proof":{"proof_data":"mock_proof","public_inputs":[],"verification_key":"mock"},"amount":"1000000000000000000","recipient":"'$ADMIN_ADDRESS'"}}' \
  --from deployer \
  --keyring-backend test \
  --chain-id $CHAIN_ID \
  --node $RPC_URL \
  --gas auto \
  --gas-adjustment 1.3 \
  --gas-prices $GAS_PRICES \
  --yes \
  --output json | jq -r '.txhash')

echo "   TX Hash: $TX_HASH"
sleep 6

# Query transaction events
echo "   Checking events..."
TX_EVENTS=$(persistenced query tx $TX_HASH --node $RPC_URL --output json | jq -r '.logs[0].events[]')

# Verify mock mode warning present
if echo "$TX_EVENTS" | grep -q "mock_mode"; then
  echo "✅ Mock mode attribute found"
else
  echo "❌ ERROR: Mock mode attribute missing"
  exit 1
fi

# Query user balance
BALANCE=$(persistenced query wasm contract-state smart $CONTRACT_ADDR \
  '{"balance":{"address":"'$ADMIN_ADDRESS'"}}' \
  --node $RPC_URL \
  --output json | jq -r '.data.balance')

echo "   User balance: $BALANCE"
if [ "$BALANCE" == "1000000000000000000" ]; then
  echo "✅ Mint successful (1 ibcTFUEL minted)"
else
  echo "❌ ERROR: Unexpected balance: $BALANCE"
  exit 1
fi
```

### Test 2: Mock Burn for Unwrap (Reverse Flow)

```bash
echo "🧪 Test 2: Mock burn_for_unwrap (reverse flow)"

# Execute burn_for_unwrap
TX_HASH=$(persistenced tx wasm execute $CONTRACT_ADDR \
  '{"burn_for_unwrap":{"amount":"500000000000000000","theta_recipient":"'$THETA_RECIPIENT'"}}' \
  --from deployer \
  --keyring-backend test \
  --chain-id $CHAIN_ID \
  --node $RPC_URL \
  --gas auto \
  --gas-adjustment 1.3 \
  --gas-prices $GAS_PRICES \
  --yes \
  --output json | jq -r '.txhash')

echo "   TX Hash: $TX_HASH"
sleep 6

# Query transaction events
TX_EVENTS=$(persistenced query tx $TX_HASH --node $RPC_URL --output json)

# Verify SP1-readable attributes
echo "   Checking SP1 event attributes..."
ATTRS=$(echo "$TX_EVENTS" | jq -r '.logs[0].events[] | select(.type=="wasm") | .attributes[]')

# Check for critical attributes
for attr in "action" "user" "amount_burned" "fee_amount" "theta_recipient" "nonce" "for_sp1_proof" "mock_sp1_event"; do
  if echo "$ATTRS" | grep -q "$attr"; then
    echo "   ✅ $attr: found"
  else
    echo "   ❌ $attr: missing"
  fi
done

# Query state
STATE=$(persistenced query wasm contract-state smart $CONTRACT_ADDR \
  '{"state":{}}' \
  --node $RPC_URL \
  --output json | jq '.')

echo "   State:"
echo "$STATE" | jq '{total_minted, total_reverse_burned, total_reverse_fees}'

# Verify fee calculation (0.5% of 500000000000000000 = 2500000000000000)
EXPECTED_FEE="2500000000000000"
EXPECTED_BURN="497500000000000000"
ACTUAL_FEE=$(echo "$STATE" | jq -r '.data.total_reverse_fees')
ACTUAL_BURN=$(echo "$STATE" | jq -r '.data.total_reverse_burned')

if [ "$ACTUAL_FEE" == "$EXPECTED_FEE" ] && [ "$ACTUAL_BURN" == "$EXPECTED_BURN" ]; then
  echo "✅ Burn successful (0.5% fee + 99.5% burned)"
else
  echo "❌ ERROR: Unexpected fee/burn amounts"
  echo "   Expected fee: $EXPECTED_FEE, got: $ACTUAL_FEE"
  echo "   Expected burn: $EXPECTED_BURN, got: $ACTUAL_BURN"
  exit 1
fi
```

### Test 3: Admin Functions (Update Addresses)

```bash
echo "🧪 Test 3: Admin functions (SetVerifier, SetMinter)"

# Set new verifier address (still dummy)
NEW_VERIFIER="persistence1newverifier00000000000000000000000000000"

TX_HASH=$(persistenced tx wasm execute $CONTRACT_ADDR \
  '{"set_verifier":{"verifier_address":"'$NEW_VERIFIER'"}}' \
  --from deployer \
  --keyring-backend test \
  --chain-id $CHAIN_ID \
  --node $RPC_URL \
  --gas auto \
  --yes \
  --output json | jq -r '.txhash')

echo "   SetVerifier TX: $TX_HASH"
sleep 6

# Verify dummy address warning
TX_EVENTS=$(persistenced query tx $TX_HASH --node $RPC_URL --output json)
if echo "$TX_EVENTS" | grep -q "USING_DUMMY"; then
  echo "✅ Dummy address warning present"
else
  echo "⚠️  Warning: Dummy address warning not found (may be expected)"
fi

# Set minter address
TX_HASH=$(persistenced tx wasm execute $CONTRACT_ADDR \
  '{"set_minter":{"minter_address":"'$MINTER_ADDRESS'"}}' \
  --from deployer \
  --keyring-backend test \
  --chain-id $CHAIN_ID \
  --node $RPC_URL \
  --gas auto \
  --yes \
  --output json | jq -r '.txhash')

echo "   SetMinter TX: $TX_HASH"
sleep 6

echo "✅ Admin functions tested successfully"
```

### Test 4: Full E2E Flow (Deposit → Withdraw)

```bash
echo "🧪 Test 4: Full E2E flow (Deposit → Withdraw)"

# 1. Mint 100 tokens
echo "   Step 1: Minting 100 ibcTFUEL..."
persistenced tx wasm execute $CONTRACT_ADDR \
  '{"verify_and_mint":{"zk_proof":{"proof_data":"e2e_test","public_inputs":[],"verification_key":"mock"},"amount":"100000000000000000000","recipient":"'$ADMIN_ADDRESS'"}}' \
  --from deployer --keyring-backend test --chain-id $CHAIN_ID --node $RPC_URL --gas auto --yes --output json > /dev/null
sleep 6

# 2. Burn 30 tokens
echo "   Step 2: Burning 30 ibcTFUEL (0.5% fee to FeeCollector)..."
persistenced tx wasm execute $CONTRACT_ADDR \
  '{"burn_for_unwrap":{"amount":"30000000000000000000","theta_recipient":"'$THETA_RECIPIENT'"}}' \
  --from deployer --keyring-backend test --chain-id $CHAIN_ID --node $RPC_URL --gas auto --yes --output json > /dev/null
sleep 6

# 3. Query final balance
FINAL_BALANCE=$(persistenced query wasm contract-state smart $CONTRACT_ADDR \
  '{"balance":{"address":"'$ADMIN_ADDRESS'"}}' \
  --node $RPC_URL \
  --output json | jq -r '.data.balance')

EXPECTED_BALANCE="70000000000000000000" # 100 - 30 = 70
if [ "$FINAL_BALANCE" == "$EXPECTED_BALANCE" ]; then
  echo "✅ Full E2E flow successful"
  echo "   Minted: 100 ibcTFUEL"
  echo "   Burned: 30 ibcTFUEL (including 0.5% fee)"
  echo "   Final balance: 70 ibcTFUEL"
else
  echo "❌ ERROR: Unexpected final balance"
  echo "   Expected: $EXPECTED_BALANCE"
  echo "   Got: $FINAL_BALANCE"
  exit 1
fi
```

---

## Post-Governance Migration

After governance approval, migrate from mock mode to production:

### Step 1: Deploy Real Contracts

```bash
# Deploy ZKVerifier.wasm
# Deploy FeeCollector.wasm
# Get contract addresses

export REAL_ZKVERIFIER="persistence1<real_zkverifier_address>"
export REAL_FEE_COLLECTOR="persistence1<real_feecollector_address>"
```

### Step 2: Update Contract Addresses

```bash
# Update verifier address
persistenced tx wasm execute $CONTRACT_ADDR \
  '{"set_verifier":{"verifier_address":"'$REAL_ZKVERIFIER'"}}' \
  --from $ADMIN_ADDRESS \
  --keyring-backend test \
  --chain-id $CHAIN_ID \
  --node $RPC_URL \
  --gas auto \
  --yes

# Update fee collector address
persistenced tx wasm execute $CONTRACT_ADDR \
  '{"set_fee_collector":{"fee_collector_address":"'$REAL_FEE_COLLECTOR'"}}' \
  --from $ADMIN_ADDRESS \
  --keyring-backend test \
  --chain-id $CHAIN_ID \
  --node $RPC_URL \
  --gas auto \
  --yes
```

### Step 3: Disable Mock Mode (Contract Migration)

**Note:** mock_mode cannot be changed post-instantiation. Requires new instantiation with `mock_mode: false`.

```bash
# Instantiate production contract
PROD_INIT_MSG=$(cat <<EOF
{
  "name": "IBC Theta Fuel",
  "symbol": "IBCTFUEL",
  "decimals": 18,
  "initial_balances": [],
  "mint_cap": null,
  "marketing": null,
  "verifier_address": "$REAL_ZKVERIFIER",
  "rev_splitter_address": "<real_rev_splitter>",
  "fee_collector_address": "$REAL_FEE_COLLECTOR",
  "mock_mode": false
}
EOF
)

persistenced tx wasm instantiate $CODE_ID "$PROD_INIT_MSG" \
  --from deployer \
  --keyring-backend test \
  --label "ibcTFUEL-v4.4-mainnet" \
  --admin $ADMIN_ADDRESS \
  --chain-id $CHAIN_ID \
  --node $RPC_URL \
  --gas auto \
  --yes
```

---

## Monitoring & Troubleshooting

### Monitoring Commands

```bash
# Query contract state
persistenced query wasm contract-state smart $CONTRACT_ADDR '{"state":{}}' --node $RPC_URL

# Query contract config
persistenced query wasm contract-state smart $CONTRACT_ADDR '{"config":{}}' --node $RPC_URL

# Check contract balance (accumulated fees)
persistenced query bank balances $CONTRACT_ADDR --node $RPC_URL

# List recent transactions
persistenced query txs --events "execute._contract_address=$CONTRACT_ADDR" --limit 50 --node $RPC_URL

# Query specific user balance
persistenced query wasm contract-state smart $CONTRACT_ADDR \
  '{"balance":{"address":"'$ADMIN_ADDRESS'"}}' --node $RPC_URL
```

### Common Issues

#### Issue 1: AWS Secrets Not Found

```bash
# Verify ARN format
aws secretsmanager describe-secret --secret-id $SP1_KEY_ARN

# Check IAM permissions
aws iam get-user
aws iam list-attached-user-policies --user-name $(aws sts get-caller-identity --query 'Arn' --output text | cut -d'/' -f2)
```

#### Issue 2: persistenced Key Import Fails

```bash
# Check mnemonic word count
echo "$PERSISTENCE_MNEMONIC" | wc -w
# Should be 12 or 24

# Try manual import
persistenced keys add deployer --recover --keyring-backend test
# Paste mnemonic when prompted
```

#### Issue 3: Contract Instantiation Fails ("out of gas")

```bash
# Check deployer balance
persistenced query bank balances $ADMIN_ADDRESS --node $RPC_URL

# Increase gas limit
persistenced tx wasm instantiate $CODE_ID "$INIT_MSG" \
  --gas 500000 \
  --gas-prices 0.05uxprt \
  ... (rest of flags)
```

#### Issue 4: Mock Mode Not Enabled

```bash
# Verify instantiation message
echo "$INIT_MSG" | jq '.mock_mode'
# Should output: true

# Check instantiation transaction events
persistenced query tx <INSTANTIATE_TX_HASH> --node $RPC_URL | jq '.logs[0].events[] | select(.type=="wasm")'
```

---

## Security Checklist

Before mainnet launch (Phase D), verify:

- [ ] CertiK audit completed (no critical/high findings)
- [ ] Bug bounty program live ($500K on Immunefi)
- [ ] Circuit breakers tested (pause/unpause functions)
- [ ] Admin multisig configured (5-of-7 threshold)
- [ ] Dummy addresses replaced with real contract addresses
- [ ] Mock mode disabled (new instantiation with `mock_mode: false`)
- [ ] Mainnet backend services deployed (listener.js, persistence-listener.js)
- [ ] SP1 prover infrastructure operational (Theta Edge Cloud)
- [ ] Monitoring alerts configured (PagerDuty, Sentry)
- [ ] Disaster recovery plan documented

---

## Support

- **Technical issues:** dev@xfuel.app
- **Governance questions:** forum.persistence.one
- **Security reports:** security@xfuel.app (PGP: see docs/SECURITY.md)

---

**END OF DEPLOYMENT GUIDE**

Last Updated: February 6, 2026  
Version: 4.4.0 (Bi-Directional ZK Bridge Edition)
