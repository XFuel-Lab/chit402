# XFuel Reverse Bridge - Mainnet Deployment Quick Reference

## 📦 Artifact Verification

```bash
cd C:\Users\seeha\xfuel-protocol\cosmwasm-contracts\artifacts

# Verify checksums before upload
sha256sum persistence_minter.wasm
# Expected: 516db0e88509afb90e3055b320691de68387ace97a9a34a72e5621ad3778b748

sha256sum fee_collector.wasm
# Expected: 7a370b84ea0ed94df29b2acd2804d73bc27fa1d5a325e2bdd76b3861438f5acd
```

## 🔑 Required Variables

```bash
# Fill these in before deployment
export CHAIN_ID="core-1"                                    # Persistence mainnet
export RPC_URL="https://rpc.persistence.one:443"
export KEY_NAME="your-key-name"
export ADMIN_ADDRESS="persistence1..."

# Test parameters
export TEST_AMOUNT="50000000000000000"                      # 0.05 TFUEL
export THETA_RECIPIENT="0x..."                              # Your Theta address
```

## ⚡ Quick Deploy Commands

```bash
# 1. Upload persistence-minter
persistenced tx wasm store persistence_minter.wasm \
  --from $KEY_NAME --chain-id $CHAIN_ID --node $RPC_URL \
  --gas auto --gas-adjustment 1.5 --gas-prices 0.025uxprt -y

# 2. Upload fee-collector
persistenced tx wasm store fee_collector.wasm \
  --from $KEY_NAME --chain-id $CHAIN_ID --node $RPC_URL \
  --gas auto --gas-adjustment 1.5 --gas-prices 0.025uxprt -y

# 3. Instantiate minter (get CODE_ID from step 1)
persistenced tx wasm instantiate $MINTER_CODE_ID \
  '{"name":"iBridge TFUEL","symbol":"ibcTFUEL","decimals":18,"initial_balances":[],"mint_cap":null,"marketing":null,"verifier_address":"PLACEHOLDER","rev_splitter_address":"PLACEHOLDER","fee_collector_address":"PLACEHOLDER"}' \
  --from $KEY_NAME --chain-id $CHAIN_ID --node $RPC_URL \
  --label "xfuel-minter-v1" --admin $ADMIN_ADDRESS \
  --gas auto --gas-adjustment 1.5 --gas-prices 0.025uxprt -y

# 4. IMMEDIATELY PAUSE
persistenced tx wasm execute $MINTER_CONTRACT '{"pause":{}}' \
  --from $KEY_NAME --chain-id $CHAIN_ID --node $RPC_URL \
  --gas auto --gas-prices 0.025uxprt -y

# 5. Instantiate fee-collector (get CODE_ID from step 2)
persistenced tx wasm instantiate $FEE_COLLECTOR_CODE_ID \
  "{\"admin\":\"$ADMIN_ADDRESS\",\"ibctfuel_token\":\"$MINTER_CONTRACT\",\"minter_contract\":\"$MINTER_CONTRACT\",\"min_burn_amount\":\"10000000000000000\"}" \
  --from $KEY_NAME --chain-id $CHAIN_ID --node $RPC_URL \
  --label "xfuel-fee-collector-v1" --admin $ADMIN_ADDRESS \
  --gas auto --gas-adjustment 1.5 --gas-prices 0.025uxprt -y

# 6. Update fee collector address
persistenced tx wasm execute $MINTER_CONTRACT \
  "{\"set_fee_collector\":{\"fee_collector_address\":\"$FEE_COLLECTOR_CONTRACT\"}}" \
  --from $KEY_NAME --chain-id $CHAIN_ID --node $RPC_URL \
  --gas auto --gas-prices 0.025uxprt -y
```

## ✅ Verification Commands

```bash
# Check minter is paused
persistenced query wasm contract-state smart $MINTER_CONTRACT \
  '{"config":{}}' --node $RPC_URL | jq .data.paused

# Check fee collector address is set
persistenced query wasm contract-state smart $MINTER_CONTRACT \
  '{"config":{}}' --node $RPC_URL | jq .data.fee_collector_address

# Check initial state (should be all zeros)
persistenced query wasm contract-state smart $MINTER_CONTRACT \
  '{"state":{}}' --node $RPC_URL
```

## 🧪 First Test Transaction

```bash
# Unpause (ONLY WHEN READY TO TEST)
persistenced tx wasm execute $MINTER_CONTRACT '{"unpause":{}}' \
  --from $KEY_NAME --chain-id $CHAIN_ID --node $RPC_URL -y

# Execute burn_for_unwrap with 0.05 TFUEL
persistenced tx wasm execute $MINTER_CONTRACT \
  "{\"burn_for_unwrap\":{\"amount\":\"$TEST_AMOUNT\",\"theta_recipient\":\"$THETA_RECIPIENT\"}}" \
  --from $KEY_NAME --chain-id $CHAIN_ID --node $RPC_URL \
  --gas auto --gas-adjustment 1.5 --broadcast-mode block -y

# Verify fee (should be 250000000000000 = 0.00025 TFUEL)
persistenced query wasm contract-state smart $FEE_COLLECTOR_CONTRACT \
  '{"state":{}}' --node $RPC_URL | jq .data.accumulated_fees

# PAUSE AGAIN AFTER TEST
persistenced tx wasm execute $MINTER_CONTRACT '{"pause":{}}' \
  --from $KEY_NAME --chain-id $CHAIN_ID --node $RPC_URL -y
```

## 🚨 Emergency Pause

```bash
persistenced tx wasm execute $MINTER_CONTRACT '{"pause":{}}' \
  --from $KEY_NAME --chain-id $CHAIN_ID --node $RPC_URL \
  --gas 200000 --gas-prices 0.05uxprt -y
```

## 📊 Expected Test Results

For 0.05 TFUEL test burn:
- **Total Amount:** 50000000000000000 (0.05 TFUEL)
- **Fee (0.5%):** 250000000000000 (0.00025 TFUEL) → goes to FeeCollector
- **Burned (99.5%):** 49750000000000000 (0.04975 TFUEL) → burned
- **Nonce:** 0 → 1 (for first burn from user)

## 📋 Contract Addresses (Fill After Deployment)

```bash
MINTER_CODE_ID=___
FEE_COLLECTOR_CODE_ID=___
MINTER_CONTRACT=persistence1___
FEE_COLLECTOR_CONTRACT=persistence1___
```

## 🔒 Safety Rules

1. ✅ Always start PAUSED
2. ✅ Verify checksums before upload
3. ✅ Use extremely small amounts for first tests (0.01-0.1 TFUEL)
4. ✅ Verify fee calculation after EVERY test
5. ✅ Pause immediately if anything unexpected
6. ✅ Monitor SP1 prover for event detection
7. ✅ Keep admin keys secure
8. ✅ Document every transaction hash
