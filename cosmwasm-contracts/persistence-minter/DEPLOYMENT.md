# Persistence Minter Deployment Guide

## Prerequisites

1. **Install Persistence Core**
```bash
# Linux/Mac
wget https://github.com/persistenceOne/persistenceCore/releases/download/v11.0.0/persistenceCore-v11.0.0-linux-amd64.tar.gz
tar -xzf persistenceCore-v11.0.0-linux-amd64.tar.gz
sudo mv persistenceCore /usr/local/bin/
```

2. **Create Wallet**
```bash
# Create new wallet
persistenceCore keys add my-wallet

# Or import existing wallet
persistenceCore keys add my-wallet --recover
```

3. **Fund Wallet**
- Testnet: Use faucet at https://faucet.testnet.persistence.one
- Mainnet: Transfer XPRT to your wallet address

## Step 1: Build and Optimize Contract

### Build
```bash
cd cosmwasm-contracts/persistence-minter
cargo build --release --target wasm32-unknown-unknown
```

### Optimize (Required for deployment)
```bash
# Using Docker (Recommended)
docker run --rm -v "$(pwd)":/code \
  --mount type=volume,source="$(basename "$(pwd)")_cache",target=/code/target \
  --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
  cosmwasm/rust-optimizer:0.15.0

# This creates: artifacts/persistence_minter.wasm (optimized)
```

### Verify Size
```bash
ls -lh artifacts/persistence_minter.wasm
# Should be < 800KB for reasonable gas costs
```

## Step 2: Deploy to Testnet

### Set Environment Variables
```bash
export CHAIN_ID="test-core-1"
export RPC="https://rpc.testnet.persistence.one:443"
export WALLET="my-wallet"
```

### Store Code
```bash
persistenceCore tx wasm store artifacts/persistence_minter.wasm \
  --from $WALLET \
  --gas-prices 0.025uxprt \
  --gas auto \
  --gas-adjustment 1.3 \
  --chain-id $CHAIN_ID \
  --node $RPC \
  --broadcast-mode sync \
  -y

# Wait for transaction to be included in a block (30 seconds)
sleep 30

# Get code ID from transaction
# Look for "store_code" event with "code_id" attribute
persistenceCore query tx <TX_HASH> --node $RPC
```

### Instantiate Contract
```bash
# Set your code ID
export CODE_ID=123  # Replace with actual code ID

# Set contract parameters
export VERIFIER_ADDR="persistence1verifier..."  # Your verifier address
export REV_SPLITTER_ADDR="persistence1revsplitter..."  # RevSplitter contract
export ADMIN_ADDR=$(persistenceCore keys show $WALLET -a)

# Instantiate
persistenceCore tx wasm instantiate $CODE_ID \
  "{
    \"name\": \"IBC Theta Fuel\",
    \"symbol\": \"IBCTFUEL\",
    \"decimals\": 18,
    \"initial_balances\": [],
    \"mint_cap\": \"1000000000000000000000000\",
    \"marketing\": null,
    \"verifier_address\": \"$VERIFIER_ADDR\",
    \"rev_splitter_address\": \"$REV_SPLITTER_ADDR\"
  }" \
  --from $WALLET \
  --label "XFuel Minter Testnet v1" \
  --gas-prices 0.025uxprt \
  --gas auto \
  --gas-adjustment 1.3 \
  --admin $ADMIN_ADDR \
  --chain-id $CHAIN_ID \
  --node $RPC \
  --broadcast-mode sync \
  -y

# Get contract address from transaction
# Look for "instantiate" event with "_contract_address" attribute
```

### Query Contract Info
```bash
export CONTRACT_ADDR="persistence1contract..."  # Your contract address

# Get contract info
persistenceCore query wasm contract $CONTRACT_ADDR --node $RPC

# Query config
persistenceCore query wasm contract-state smart $CONTRACT_ADDR \
  '{"config":{}}' \
  --node $RPC

# Query token info
persistenceCore query wasm contract-state smart $CONTRACT_ADDR \
  '{"token_info":{}}' \
  --node $RPC
```

## Step 3: Test Contract Functions

### Test Mint
```bash
persistenceCore tx wasm execute $CONTRACT_ADDR \
  "{
    \"verify_and_mint\": {
      \"zk_proof\": {
        \"proof_data\": \"test_proof_$(date +%s)\",
        \"public_inputs\": [\"1000000000000000000\", \"abc123\"],
        \"verification_key\": \"vk_test\"
      },
      \"amount\": \"1000000000000000000\",
      \"recipient\": \"$ADMIN_ADDR\"
    }
  }" \
  --from $WALLET \
  --gas-prices 0.025uxprt \
  --gas auto \
  --gas-adjustment 1.3 \
  --chain-id $CHAIN_ID \
  --node $RPC \
  -y

# Check balance
persistenceCore query wasm contract-state smart $CONTRACT_ADDR \
  "{\"balance\":{\"address\":\"$ADMIN_ADDR\"}}" \
  --node $RPC
```

### Test Burn
```bash
persistenceCore tx wasm execute $CONTRACT_ADDR \
  "{
    \"burn_and_unwrap\": {
      \"amount\": \"500000000000000000\"
    }
  }" \
  --from $WALLET \
  --gas-prices 0.025uxprt \
  --gas auto \
  --gas-adjustment 1.3 \
  --chain-id $CHAIN_ID \
  --node $RPC \
  -y

# Check state
persistenceCore query wasm contract-state smart $CONTRACT_ADDR \
  '{"state":{}}' \
  --node $RPC
```

### Test Transfer
```bash
export RECIPIENT="persistence1recipient..."

persistenceCore tx wasm execute $CONTRACT_ADDR \
  "{
    \"transfer\": {
      \"recipient\": \"$RECIPIENT\",
      \"amount\": \"100000000000000000\"
    }
  }" \
  --from $WALLET \
  --gas-prices 0.025uxprt \
  --gas auto \
  --gas-adjustment 1.3 \
  --chain-id $CHAIN_ID \
  --node $RPC \
  -y
```

## Step 4: Deploy to Mainnet

### Set Mainnet Environment
```bash
export CHAIN_ID="core-1"
export RPC="https://rpc.core.persistence.one:443"
```

### Pre-deployment Checklist
- [ ] Contract tested thoroughly on testnet
- [ ] Security audit completed (if applicable)
- [ ] Verifier contract deployed and tested
- [ ] RevSplitter contract deployed and tested
- [ ] Admin multisig configured (recommended)
- [ ] Monitoring and alerting set up
- [ ] Backup and recovery procedures documented

### Deploy to Mainnet
```bash
# Store code (same as testnet)
persistenceCore tx wasm store artifacts/persistence_minter.wasm \
  --from $WALLET \
  --gas-prices 0.025uxprt \
  --gas auto \
  --gas-adjustment 1.3 \
  --chain-id $CHAIN_ID \
  --node $RPC \
  -y

# Instantiate with mainnet addresses
persistenceCore tx wasm instantiate $CODE_ID \
  "{
    \"name\": \"IBC Theta Fuel\",
    \"symbol\": \"IBCTFUEL\",
    \"decimals\": 18,
    \"initial_balances\": [],
    \"mint_cap\": \"1000000000000000000000000\",
    \"marketing\": null,
    \"verifier_address\": \"$VERIFIER_ADDR\",
    \"rev_splitter_address\": \"$REV_SPLITTER_ADDR\"
  }" \
  --from $WALLET \
  --label "XFuel Minter v1" \
  --gas-prices 0.025uxprt \
  --gas auto \
  --gas-adjustment 1.3 \
  --admin $ADMIN_ADDR \
  --chain-id $CHAIN_ID \
  --node $RPC \
  -y
```

## Step 5: Contract Migration (Future Updates)

### Store New Code Version
```bash
persistenceCore tx wasm store artifacts/persistence_minter_v2.wasm \
  --from $WALLET \
  --gas-prices 0.025uxprt \
  --gas auto \
  --gas-adjustment 1.3 \
  --chain-id $CHAIN_ID \
  --node $RPC \
  -y
```

### Migrate Contract
```bash
export NEW_CODE_ID=124  # New code ID

persistenceCore tx wasm migrate $CONTRACT_ADDR $NEW_CODE_ID \
  '{}' \
  --from $WALLET \
  --gas-prices 0.025uxprt \
  --gas auto \
  --gas-adjustment 1.3 \
  --chain-id $CHAIN_ID \
  --node $RPC \
  -y
```

## Admin Operations

### Pause Contract
```bash
persistenceCore tx wasm execute $CONTRACT_ADDR \
  '{"pause":{}}' \
  --from $WALLET \
  --gas-prices 0.025uxprt \
  --gas auto \
  --gas-adjustment 1.3 \
  --chain-id $CHAIN_ID \
  --node $RPC \
  -y
```

### Unpause Contract
```bash
persistenceCore tx wasm execute $CONTRACT_ADDR \
  '{"unpause":{}}' \
  --from $WALLET \
  --gas-prices 0.025uxprt \
  --gas auto \
  --gas-adjustment 1.3 \
  --chain-id $CHAIN_ID \
  --node $RPC \
  -y
```

### Update Verifier
```bash
export NEW_VERIFIER="persistence1newverifier..."

persistenceCore tx wasm execute $CONTRACT_ADDR \
  "{\"set_verifier\":{\"verifier_address\":\"$NEW_VERIFIER\"}}" \
  --from $WALLET \
  --gas-prices 0.025uxprt \
  --gas auto \
  --gas-adjustment 1.3 \
  --chain-id $CHAIN_ID \
  --node $RPC \
  -y
```

### Delegate to Validator
```bash
export VALIDATOR="persistencevaloper1..."
export DELEGATE_AMOUNT="1000000000000000000"  # 1 XPRT

persistenceCore tx wasm execute $CONTRACT_ADDR \
  "{
    \"delegate_to_validator\": {
      \"validator\": \"$VALIDATOR\",
      \"amount\": \"$DELEGATE_AMOUNT\"
    }
  }" \
  --from $WALLET \
  --gas-prices 0.025uxprt \
  --gas auto \
  --gas-adjustment 1.3 \
  --chain-id $CHAIN_ID \
  --node $RPC \
  -y
```

## Monitoring

### Query Contract State
```bash
# Get total minted, burned, recycled
persistenceCore query wasm contract-state smart $CONTRACT_ADDR \
  '{"state":{}}' \
  --node $RPC

# Get config
persistenceCore query wasm contract-state smart $CONTRACT_ADDR \
  '{"config":{}}' \
  --node $RPC
```

### Monitor Events
```bash
# Get recent transactions
persistenceCore query txs \
  --events "wasm._contract_address='$CONTRACT_ADDR'" \
  --limit 10 \
  --node $RPC
```

## Troubleshooting

### Contract Execution Failed
- Check gas limits (use `--gas auto` with `--gas-adjustment 1.3`)
- Verify contract is not paused
- Ensure wallet has sufficient XPRT for gas
- Check if amount is within mint cap

### Query Failed
- Verify contract address is correct
- Check RPC endpoint is accessible
- Ensure query format matches schema

### Insufficient Gas
- Increase gas adjustment: `--gas-adjustment 1.5`
- Or specify explicit gas: `--gas 500000`

## Security Best Practices

1. **Use Multisig for Admin**: Create multisig wallet for admin operations
2. **Test on Testnet First**: Always test new features on testnet
3. **Monitor Contract Activity**: Set up alerts for unusual transactions
4. **Regular Audits**: Periodically review contract state and transactions
5. **Backup Keys Securely**: Use hardware wallets for mainnet admin keys
6. **Document All Operations**: Keep detailed logs of all admin actions

## Support

- Documentation: See README.md and INTEGRATION.md
- Issues: https://github.com/xfuellab/xfuel-protocol
- Email: dev@xfuel.io



