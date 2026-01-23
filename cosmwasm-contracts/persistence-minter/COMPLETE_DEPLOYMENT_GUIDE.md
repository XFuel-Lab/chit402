# XFuel Persistence Minter - Complete Deployment Guide

## Overview

This CosmWasm smart contract implements a ZK-proof verified minter for **ibcTFUEL** (symbol: `IBCTFUEL`, decimals: 18) on Persistence blockchain. It extends the CW20 base standard with custom functionality for the XFuel hybrid bridge protocol.

## Features

### Core Functionality

1. **VerifyAndMint**: ZK proof verification and minting
   - Verifies ZK-SNARK proofs from Theta deposits
   - Mints 1:1 ibcTFUEL to recipient Keplr address
   - Pre-funds new users with 0.001 XPRT for gas
   - Prevents replay attacks via proof hash tracking

2. **BurnAndUnwrap**: Token burning with revenue split
   - Burns ibcTFUEL from user balance
   - Emits event for backend to process unwrap
   - 30% flagged for RevSplitter contract
   - 70% flagged for LP reinvestment

3. **Admin Controls**:
   - Pause/Unpause contract
   - Set ZK verifier address
   - Set RevSplitter contract address
   - Delegate to validators for LST staking

4. **CW20 Compatibility**: Full CW20 standard support
   - Transfer, Burn, Send
   - Allowances (Increase/Decrease)
   - TransferFrom, BurnFrom

### Security Features

- **Replay Protection**: SHA-256 proof hash tracking
- **Mint Cap**: Configurable maximum supply
- **Pausable**: Emergency stop mechanism
- **Access Control**: Admin-only functions
- **Validation**: Comprehensive input validation

## Prerequisites

### System Requirements

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup default stable
rustup target add wasm32-unknown-unknown

# Install cargo-generate (optional)
cargo install cargo-generate

# Docker (for optimized builds)
docker --version
```

### Persistence Tools

```bash
# Install persistenceCore
git clone https://github.com/persistenceOne/persistenceCore
cd persistenceCore
git checkout v10.0.0
make install

# Verify installation
persistenceCore version
```

## Building the Contract

### Development Build

```bash
cd cosmwasm-contracts/persistence-minter

# Standard build
cargo build

# Run tests
cargo test

# Generate schema
cargo schema
```

### Optimized Production Build

```bash
# Using Docker optimizer (recommended)
docker run --rm -v "$(pwd)":/code \
  --mount type=volume,source="$(basename "$(pwd)")_cache",target=/code/target \
  --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
  cosmwasm/rust-optimizer:0.15.1

# Output will be in artifacts/
ls -lh artifacts/
# persistence_minter.wasm (~200KB optimized)
```

### Windows Build

```bash
# Use the provided build script
build.bat

# Or manually
cd cosmwasm-contracts/persistence-minter
cargo wasm
cargo schema
```

## Deployment

### Step 1: Configure Wallet

```bash
# Add deployment key
persistenceCore keys add deployer

# Or restore existing key
persistenceCore keys add deployer --recover

# Fund wallet from faucet (testnet)
# Mainnet: Transfer XPRT to address

# Check balance
persistenceCore query bank balances $(persistenceCore keys show deployer -a)
```

### Step 2: Store Contract Code

```bash
# Upload wasm to chain
TX_HASH=$(persistenceCore tx wasm store artifacts/persistence_minter.wasm \
  --from deployer \
  --gas-prices 0.025uxprt \
  --gas auto \
  --gas-adjustment 1.3 \
  --chain-id core-1 \
  --node https://rpc.core.persistence.one:443 \
  --broadcast-mode block \
  --output json \
  -y | jq -r '.txhash')

# Get code ID
CODE_ID=$(persistenceCore query tx $TX_HASH --output json | jq -r '.logs[0].events[] | select(.type=="store_code") | .attributes[] | select(.key=="code_id") | .value')

echo "Code ID: $CODE_ID"
```

### Step 3: Instantiate Contract

Create `init_msg.json`:

```json
{
  "name": "IBC Theta Fuel",
  "symbol": "IBCTFUEL",
  "decimals": 18,
  "initial_balances": [],
  "mint_cap": "1000000000000000000000000000",
  "marketing": null,
  "verifier_address": "persistence1verifier...",
  "rev_splitter_address": "persistence1revsplitter..."
}
```

Deploy:

```bash
# Instantiate contract
INIT_MSG=$(cat init_msg.json | jq -c)

persistenceCore tx wasm instantiate $CODE_ID "$INIT_MSG" \
  --from deployer \
  --label "XFuel-ibcTFUEL-Minter-v1" \
  --admin $(persistenceCore keys show deployer -a) \
  --gas-prices 0.025uxprt \
  --gas auto \
  --gas-adjustment 1.3 \
  --chain-id core-1 \
  --node https://rpc.core.persistence.one:443 \
  --broadcast-mode block \
  -y

# Get contract address
CONTRACT_ADDR=$(persistenceCore query wasm list-contract-by-code $CODE_ID --output json | jq -r '.contracts[0]')
echo "Contract Address: $CONTRACT_ADDR"
```

### Step 4: Verify Deployment

```bash
# Query contract info
persistenceCore query wasm contract $CONTRACT_ADDR

# Query token info
persistenceCore query wasm contract-state smart $CONTRACT_ADDR \
  '{"token_info":{}}' \
  --output json | jq

# Query config
persistenceCore query wasm contract-state smart $CONTRACT_ADDR \
  '{"config":{}}' \
  --output json | jq

# Query state
persistenceCore query wasm contract-state smart $CONTRACT_ADDR \
  '{"state":{}}' \
  --output json | jq
```

## Usage Examples

### VerifyAndMint (Backend Call)

```bash
# Prepare mint message
cat > mint_msg.json << EOF
{
  "verify_and_mint": {
    "zk_proof": {
      "proof_data": "0x1234...",
      "public_inputs": ["1000000000000000000", "e3b0c442..."],
      "verification_key": "vk_xfuel_v1"
    },
    "amount": "1000000000000000000",
    "recipient": "persistence1user..."
  }
}
EOF

# Execute mint
persistenceCore tx wasm execute $CONTRACT_ADDR \
  "$(cat mint_msg.json)" \
  --from backend-relayer \
  --gas-prices 0.025uxprt \
  --gas auto \
  --gas-adjustment 1.3 \
  -y
```

### BurnAndUnwrap (User Call)

```bash
# Burn tokens
persistenceCore tx wasm execute $CONTRACT_ADDR \
  '{"burn_and_unwrap":{"amount":"500000000000000000"}}' \
  --from user \
  --gas-prices 0.025uxprt \
  --gas auto \
  -y
```

### Transfer (CW20 Standard)

```bash
# Transfer tokens
persistenceCore tx wasm execute $CONTRACT_ADDR \
  '{"transfer":{"recipient":"persistence1receiver...","amount":"1000000000000000000"}}' \
  --from user \
  --gas-prices 0.025uxprt \
  -y
```

### Admin Functions

```bash
# Pause contract
persistenceCore tx wasm execute $CONTRACT_ADDR \
  '{"pause":{}}' \
  --from deployer \
  -y

# Unpause contract
persistenceCore tx wasm execute $CONTRACT_ADDR \
  '{"unpause":{}}' \
  --from deployer \
  -y

# Update verifier
persistenceCore tx wasm execute $CONTRACT_ADDR \
  '{"set_verifier":{"verifier_address":"persistence1newverifier..."}}' \
  --from deployer \
  -y

# Delegate to validator (for LST staking)
persistenceCore tx wasm execute $CONTRACT_ADDR \
  '{"delegate_to_validator":{"validator":"persistencevaloper1...","amount":"1000000000000000000"}}' \
  --from deployer \
  -y
```

## Integration with XFuel Backend

### Backend Architecture

```
Theta Deposit Detection
         ↓
ZK Proof Generation (1.5s)
         ↓
Call VerifyAndMint → Persistence Contract
         ↓
ibcTFUEL Minted to Keplr
         ↓
IBC Transfer (optional)
         ↓
LST Swap & Stake
```

### Backend Integration Code (TypeScript)

```typescript
import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { GasPrice } from "@cosmjs/stargate";

const RPC_ENDPOINT = "https://rpc.core.persistence.one:443";
const CONTRACT_ADDRESS = "persistence1...";

async function mintIbcTfuel(
  zkProof: any,
  amount: string,
  recipient: string
) {
  // Load wallet
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(
    process.env.BACKEND_MNEMONIC!,
    { prefix: "persistence" }
  );

  // Connect client
  const client = await SigningCosmWasmClient.connectWithSigner(
    RPC_ENDPOINT,
    wallet,
    {
      gasPrice: GasPrice.fromString("0.025uxprt"),
    }
  );

  // Execute mint
  const [account] = await wallet.getAccounts();
  const result = await client.execute(
    account.address,
    CONTRACT_ADDRESS,
    {
      verify_and_mint: {
        zk_proof: zkProof,
        amount,
        recipient,
      },
    },
    "auto"
  );

  console.log("Mint TX:", result.transactionHash);
  return result;
}
```

## Testing

### Unit Tests

```bash
# Run all tests
cargo test

# Run specific test
cargo test test_verify_and_mint -- --nocapnel

# Run with output
cargo test -- --nocapture

# Run tests with coverage (requires tarpaulin)
cargo tarpaulin --out Html
```

### Integration Tests (cw-multi-test)

All tests use `cw-multi-test` for realistic blockchain simulation:

- ✅ `test_instantiate` - Contract initialization
- ✅ `test_verify_and_mint` - ZK proof minting
- ✅ `test_verify_and_mint_duplicate_proof` - Replay protection
- ✅ `test_burn_and_unwrap` - Token burning with splits
- ✅ `test_pause_unpause` - Emergency controls
- ✅ `test_set_verifier` - Admin configuration
- ✅ `test_cw20_transfer` - CW20 compatibility
- ✅ `test_mint_cap` - Supply limit enforcement
- ✅ `test_delegate_to_validator` - LST staking
- ✅ `test_initial_xprt_funding` - Gas pre-funding
- ✅ `test_revenue_split_accuracy` - Exact 30/70 split
- ✅ `test_full_lifecycle` - End-to-end flow

### Testnet Deployment

```bash
# Deploy to test-core-1
persistenceCore tx wasm store artifacts/persistence_minter.wasm \
  --from deployer \
  --chain-id test-core-1 \
  --node https://rpc.testnet.persistence.one:443 \
  --gas-prices 0.025uxprt \
  --gas auto \
  -y
```

## Monitoring & Operations

### Query Balance

```bash
# Check user balance
persistenceCore query wasm contract-state smart $CONTRACT_ADDR \
  "{\"balance\":{\"address\":\"$USER_ADDRESS\"}}" \
  --output json | jq -r '.data.balance'
```

### Track Statistics

```bash
# Get contract state
persistenceCore query wasm contract-state smart $CONTRACT_ADDR \
  '{"state":{}}' \
  --output json | jq

# Output:
# {
#   "total_minted": "1000000000000000000000",
#   "total_burned": "500000000000000000000",
#   "total_recycled": "150000000000000000000",
#   "total_lp_reinvest": "350000000000000000000"
# }
```

### Event Monitoring

```bash
# Subscribe to contract events
persistenceCore query txs --events "wasm._contract_address=$CONTRACT_ADDR" --limit 100
```

## Security Considerations

### Production Checklist

- [ ] ZK verifier address is set to production verifier
- [ ] RevSplitter contract is deployed and verified
- [ ] Mint cap is set appropriately (or None for unlimited)
- [ ] Admin key is secured in HSM/MPC
- [ ] Contract is paused during deployment
- [ ] All tests pass on testnet
- [ ] Code audit completed
- [ ] Emergency contacts documented

### Best Practices

1. **Key Management**: Use hardware wallet or MPC for admin keys
2. **Monitoring**: Set up alerting for large mints/burns
3. **Rate Limiting**: Implement backend rate limits on minting
4. **Upgradability**: Admin can migrate contract if needed
5. **Disaster Recovery**: Document pause/emergency procedures

## Troubleshooting

### Common Issues

**Issue**: "Insufficient funds"
```bash
# Solution: Fund deployer account
persistenceCore tx bank send faucet $(persistenceCore keys show deployer -a) \
  10000000uxprt \
  --chain-id test-core-1
```

**Issue**: "Invalid proof"
```bash
# Solution: Verify ZK proof format matches contract expectations
# - proof_data: hex string
# - public_inputs: array of strings [amount, recipient_hash]
# - verification_key: string identifier
```

**Issue**: "Mint cap exceeded"
```bash
# Solution: Check current supply vs cap
persistenceCore query wasm contract-state smart $CONTRACT_ADDR \
  '{"token_info":{}}' | jq -r '.data.total_supply'
```

**Issue**: "Contract is paused"
```bash
# Solution: Unpause contract (admin only)
persistenceCore tx wasm execute $CONTRACT_ADDR '{"unpause":{}}' --from deployer -y
```

## Support & Resources

- **Documentation**: [docs/PERSISTENCE_MINTER_INDEX.md](../../PERSISTENCE_MINTER_INDEX.md)
- **Architecture**: [docs/PERSISTENCE_MINTER_ARCHITECTURE.md](../../PERSISTENCE_MINTER_ARCHITECTURE.md)
- **Quick Start**: [QUICKSTART_PERSISTENCE_MINTER.md](../../QUICKSTART_PERSISTENCE_MINTER.md)
- **GitHub**: https://github.com/XFuelLab/xfuel-protocol
- **Discord**: https://discord.gg/xfuel

## License

MIT License - see [LICENSE](../../LICENSE)

---

**XFuel Protocol** - Sub-4s settlement rail for TFUEL ↔ Cosmos LST atomic swaps  
Live: [xfuel.app](https://xfuel.app)




