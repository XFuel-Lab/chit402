# Reverse Bridge Deployment Guide

## Overview

This guide covers the complete deployment process for the XFuel reverse bridge (ibcTFUEL → TFUEL). The reverse bridge allows users on Persistence to burn ibcTFUEL tokens and receive unwrapped TFUEL on the Theta blockchain.

## Architecture Summary

```
┌─────────────────┐
│  Persistence    │
│                 │
│  User burns     │
│  ibcTFUEL ──────┼──> 0.5% fee → FeeCollector
│                 │         │
│                 │         └──> Accumulated fees → Batch burn
│                 │
│  99.5% burned   │
│  (Event emitted)│
└────────┬────────┘
         │
         │ SP1 Prover watches events
         │ Generates ZK proof
         │
         ▼
┌─────────────────┐
│  Theta Chain    │
│                 │
│  VaultFactory   │
│  unwrapFromBurn │
│  (with proof)   │
│                 │
│  User receives  │
│  TFUEL          │
└─────────────────┘
```

## Prerequisites

- `persistenced` CLI installed and configured
- Wallet with XPRT for deployment gas
- Docker (for WASM optimization)
- `cosmwasm/rust-optimizer:0.12.13` or later
- SP1 prover infrastructure ready
- Access to Theta network for VaultFactory

---

## Phase 1: Contract Compilation

### 1.1 Build Persistence-Minter Contract

```bash
cd cosmwasm-contracts/persistence-minter
cargo wasm
```

### 1.2 Build FeeCollector Contract

```bash
cd cosmwasm-contracts/fee-collector
cargo wasm
```

### 1.3 Optimize WASM (Required for deployment)

```bash
# From cosmwasm-contracts directory
docker run --rm -v "$(pwd)":/code \
  --mount type=volume,source="$(basename "$(pwd)")_cache",target=/code/target \
  --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
  cosmwasm/rust-optimizer:0.12.13 ./persistence-minter ./fee-collector
```

This generates optimized WASM files in `artifacts/`:
- `persistence_minter.wasm`
- `fee_collector.wasm`

---

## Phase 2: Testnet Deployment

### 2.1 Upload Contracts

#### Upload Persistence-Minter

```bash
# Set your wallet
WALLET="your-persistence-wallet"

# Upload minter
TX_UPLOAD_MINTER=$(persistenced tx wasm store artifacts/persistence_minter.wasm \
  --from $WALLET \
  --gas-prices 0.025uxprt \
  --gas auto \
  --gas-adjustment 1.3 \
  --chain-id test-core-2 \
  --node https://rpc.testnet.persistence.one:443 \
  --broadcast-mode block \
  --output json \
  -y)

# Extract code ID
CODE_ID_MINTER=$(echo $TX_UPLOAD_MINTER | jq -r '.logs[0].events[] | select(.type=="store_code") | .attributes[] | select(.key=="code_id") | .value')
echo "Minter Code ID: $CODE_ID_MINTER"
```

#### Upload FeeCollector

```bash
TX_UPLOAD_FEE=$(persistenced tx wasm store artifacts/fee_collector.wasm \
  --from $WALLET \
  --gas-prices 0.025uxprt \
  --gas auto \
  --gas-adjustment 1.3 \
  --chain-id test-core-2 \
  --node https://rpc.testnet.persistence.one:443 \
  --broadcast-mode block \
  --output json \
  -y)

CODE_ID_FEE=$(echo $TX_UPLOAD_FEE | jq -r '.logs[0].events[] | select(.type=="store_code") | .attributes[] | select(.key=="code_id") | .value')
echo "FeeCollector Code ID: $CODE_ID_FEE"
```

### 2.2 Instantiate Persistence-Minter

**IMPORTANT:** Instantiate minter FIRST (without fee_collector address), then instantiate fee-collector, then update minter config.

```bash
ADMIN="persistence1your-admin-address"
VERIFIER="persistence1your-sp1-verifier-address"
REV_SPLITTER="persistence1your-rev-splitter-address"

# Temporary fee collector for initial instantiation
TEMP_FEE_COLLECTOR="persistence1temp0000000000000000000000000000000000"

INIT_MINTER=$(cat <<EOF
{
  "name": "IBC Theta Fuel",
  "symbol": "IBCTFUEL",
  "decimals": 18,
  "initial_balances": [],
  "mint_cap": "1000000000000000000000000000",
  "marketing": null,
  "verifier_address": "$VERIFIER",
  "rev_splitter_address": "$REV_SPLITTER",
  "fee_collector_address": "$TEMP_FEE_COLLECTOR"
}
EOF
)

TX_INIT_MINTER=$(persistenced tx wasm instantiate $CODE_ID_MINTER "$INIT_MINTER" \
  --from $WALLET \
  --label "XFuel Minter Testnet v1" \
  --admin $ADMIN \
  --gas-prices 0.025uxprt \
  --gas auto \
  --gas-adjustment 1.3 \
  --chain-id test-core-2 \
  --node https://rpc.testnet.persistence.one:443 \
  --broadcast-mode block \
  --output json \
  -y)

CONTRACT_MINTER=$(echo $TX_INIT_MINTER | jq -r '.logs[0].events[] | select(.type=="instantiate") | .attributes[] | select(.key=="_contract_address") | .value')
echo "Minter Contract: $CONTRACT_MINTER"
```

### 2.3 Instantiate FeeCollector

```bash
# Min burn amount: 10 ibcTFUEL (prevents dust burns)
MIN_BURN="10000000000000000000"

INIT_FEE=$(cat <<EOF
{
  "admin": "$ADMIN",
  "ibctfuel_token": "$CONTRACT_MINTER",
  "minter_contract": "$CONTRACT_MINTER",
  "min_burn_amount": "$MIN_BURN"
}
EOF
)

TX_INIT_FEE=$(persistenced tx wasm instantiate $CODE_ID_FEE "$INIT_FEE" \
  --from $WALLET \
  --label "XFuel FeeCollector Testnet v1" \
  --admin $ADMIN \
  --gas-prices 0.025uxprt \
  --gas auto \
  --gas-adjustment 1.3 \
  --chain-id test-core-2 \
  --node https://rpc.testnet.persistence.one:443 \
  --broadcast-mode block \
  --output json \
  -y)

CONTRACT_FEE=$(echo $TX_INIT_FEE | jq -r '.logs[0].events[] | select(.type=="instantiate") | .attributes[] | select(.key=="_contract_address") | .value')
echo "FeeCollector Contract: $CONTRACT_FEE"
```

### 2.4 Update Minter Config with Correct FeeCollector

```bash
SET_FEE_MSG=$(cat <<EOF
{
  "set_fee_collector": {
    "fee_collector_address": "$CONTRACT_FEE"
  }
}
EOF
)

persistenced tx wasm execute $CONTRACT_MINTER "$SET_FEE_MSG" \
  --from $WALLET \
  --gas-prices 0.025uxprt \
  --gas auto \
  --gas-adjustment 1.3 \
  --chain-id test-core-2 \
  --node https://rpc.testnet.persistence.one:443 \
  --broadcast-mode block \
  -y
```

### 2.5 Verify Configuration

```bash
# Query minter config
persistenced query wasm contract-state smart $CONTRACT_MINTER '{"config":{}}' \
  --chain-id test-core-2 \
  --node https://rpc.testnet.persistence.one:443

# Expected output should show:
# - admin: your admin address
# - verifier_address: SP1 verifier
# - fee_collector_address: $CONTRACT_FEE (correct address)
# - paused: false

# Query fee-collector config
persistenced query wasm contract-state smart $CONTRACT_FEE '{"config":{}}' \
  --chain-id test-core-2 \
  --node https://rpc.testnet.persistence.one:443

# Expected output:
# - admin: your admin address
# - ibctfuel_token: $CONTRACT_MINTER
# - minter_contract: $CONTRACT_MINTER
# - min_burn_amount: "10000000000000000000"
# - paused: false
```

---

## Phase 3: SP1 Prover Configuration

### 3.1 Build SP1 Program

```bash
cd sp1-prover/program
cargo build --release
```

### 3.2 Generate Proving Keys

```bash
# Generate proving key for reverse burns
sp1-cli prove-build --features reverse-bridge
```

### 3.3 Configure Event Monitoring

Update SP1 prover to watch for reverse bridge events:

**Events to Monitor:**

1. **BurnForUnwrap Event** (User-initiated)
   - Contract: `$CONTRACT_MINTER`
   - Event type: `wasm`
   - Filter: `for_sp1_proof == "burn_for_unwrap"`
   - Parse attributes:
     - `user`: Persistence address
     - `amount_burned`: 99.5% of original
     - `fee_amount`: 0.5% fee
     - `theta_recipient`: Destination address on Theta
     - `nonce`: Replay protection nonce
     - `block_height`, `timestamp`, `chain_id`

2. **FeeBurn Event** (Protocol-initiated)
   - Contract: `$CONTRACT_FEE`
   - Event type: `wasm`
   - Filter: `for_sp1_proof == "true"` AND `action == "fee_burn"`
   - Parse attributes:
     - `burn_amount`: Total fees burned
     - `burn_count`: Sequential counter
     - `block_height`, `timestamp`

### 3.4 Prover Configuration File

Create `sp1-prover/config.toml`:

```toml
[persistence]
rpc_endpoint = "https://rpc.testnet.persistence.one:443"
chain_id = "test-core-2"
minter_contract = "$CONTRACT_MINTER"
fee_collector_contract = "$CONTRACT_FEE"
poll_interval_seconds = 6

[theta]
rpc_endpoint = "https://eth-rpc-api-testnet.thetatoken.org/rpc"
vault_factory_address = "0xYourVaultFactoryAddress"
private_key_path = "./prover_key.json"

[sp1]
circuit_path = "./program/target/release/xfuel_sp1_program"
proof_type = "groth16"  # or "plonk"
batch_size = 5
```

### 3.5 Start Prover

```bash
cd sp1-prover
cargo run --release -- --config config.toml
```

---

## Phase 4: Frontend Configuration

### 4.1 Update Environment Variables

Create/update `.env.local`:

```bash
# Persistence Network (Testnet)
NEXT_PUBLIC_PERSISTENCE_RPC=https://rpc.testnet.persistence.one
NEXT_PUBLIC_PERSISTENCE_CHAIN_ID=test-core-2

# Contract Addresses
NEXT_PUBLIC_PERSISTENCE_MINTER_CONTRACT=$CONTRACT_MINTER
NEXT_PUBLIC_FEE_COLLECTOR_CONTRACT=$CONTRACT_FEE

# Theta Network (Testnet)
NEXT_PUBLIC_THETA_RPC=https://eth-rpc-api-testnet.thetatoken.org/rpc
NEXT_PUBLIC_VAULT_FACTORY_ADDRESS=0xYourVaultFactoryAddress

# Feature Flags
NEXT_PUBLIC_ENABLE_REVERSE_BRIDGE=true
```

### 4.2 Configure Keplr for Persistence Testnet

Add to your app:

```typescript
const persistenceTestnet = {
  chainId: "test-core-2",
  chainName: "Persistence Testnet",
  rpc: "https://rpc.testnet.persistence.one",
  rest: "https://rest.testnet.persistence.one",
  bip44: { coinType: 118 },
  bech32Config: {
    bech32PrefixAccAddr: "persistence",
    bech32PrefixAccPub: "persistencepub",
    bech32PrefixValAddr: "persistencevaloper",
    bech32PrefixValPub: "persistencevaloperpub",
    bech32PrefixConsAddr: "persistencevalcons",
    bech32PrefixConsPub: "persistencevalconspub",
  },
  currencies: [
    {
      coinDenom: "XPRT",
      coinMinimalDenom: "uxprt",
      coinDecimals: 6,
    },
  ],
  feeCurrencies: [
    {
      coinDenom: "XPRT",
      coinMinimalDenom: "uxprt",
      coinDecimals: 6,
      gasPriceStep: { low: 0.01, average: 0.025, high: 0.04 },
    },
  ],
  stakeCurrency: {
    coinDenom: "XPRT",
    coinMinimalDenom: "uxprt",
    coinDecimals: 6,
  },
};

await window.keplr.experimentalSuggestChain(persistenceTestnet);
```

### 4.3 Deploy Frontend

```bash
# Build
npm run build

# Deploy to Vercel
vercel --prod
```

---

## Phase 5: End-to-End Testing

### 5.1 Test User-Initiated Reverse Bridge

```bash
# 1. Mint ibcTFUEL to test user (using forward bridge)
# 2. Execute burn_for_unwrap

TEST_USER="persistence1testuser..."
BURN_AMOUNT="1000000000000000000"  # 1 ibcTFUEL
THETA_RECIPIENT="0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1"

BURN_MSG=$(cat <<EOF
{
  "burn_for_unwrap": {
    "amount": "$BURN_AMOUNT",
    "theta_recipient": "$THETA_RECIPIENT"
  }
}
EOF
)

persistenced tx wasm execute $CONTRACT_MINTER "$BURN_MSG" \
  --from $TEST_USER \
  --gas-prices 0.025uxprt \
  --gas auto \
  --gas-adjustment 1.3 \
  --chain-id test-core-2 \
  --node https://rpc.testnet.persistence.one:443 \
  --broadcast-mode block \
  -y
```

**Verify:**
1. Query FeeCollector state - accumulated_fees should increase by 0.5%
2. Query user balance - should decrease by full amount
3. Query total_supply - should decrease by 99.5%
4. Check SP1 prover logs - should detect event and generate proof
5. Check Theta VaultFactory - user should receive TFUEL after proof submission

### 5.2 Test Fee Burn

```bash
# After multiple burn_for_unwrap calls accumulate >10 ibcTFUEL in fees

TRIGGER_MSG='{"trigger_fee_burn":{}}'

persistenced tx wasm execute $CONTRACT_FEE "$TRIGGER_MSG" \
  --from $ADMIN \
  --gas-prices 0.025uxprt \
  --gas auto \
  --gas-adjustment 1.3 \
  --chain-id test-core-2 \
  --node https://rpc.testnet.persistence.one:443 \
  --broadcast-mode block \
  -y
```

**Verify:**
1. Query FeeCollector state - accumulated_fees should be 0
2. total_burned should increase
3. SP1 prover should detect FeeBurn event
4. Proof should be generated and submitted to Theta

---

## Phase 6: Mainnet Deployment

### 6.1 Pre-Mainnet Checklist

- [ ] All testnet tests passing
- [ ] SP1 prover running reliably for 72+ hours on testnet
- [ ] Security audit completed (if required)
- [ ] Frontend tested thoroughly on testnet
- [ ] Admin multisig setup (if using)
- [ ] Monitoring/alerting configured
- [ ] Incident response plan documented
- [ ] Minimum 3 successful end-to-end testnet transactions

### 6.2 Mainnet Configuration Differences

```bash
# Mainnet parameters
CHAIN_ID="core-1"
RPC="https://rpc.core.persistence.one"
GAS_PRICES="0.025uxprt"

# Higher minimum burn for mainnet (100 ibcTFUEL to reduce gas costs)
MIN_BURN="100000000000000000000"

# Conservative mint cap for initial launch
MINT_CAP="10000000000000000000000000"  # 10M ibcTFUEL
```

### 6.3 Mainnet Deployment Steps

Follow the same steps as testnet (Phase 2), but:
1. Use mainnet RPC endpoints
2. Use mainnet chain-id: `core-1`
3. Use higher min_burn_amount in FeeCollector
4. Consider lower initial mint_cap
5. Use mainnet admin address (preferably multisig)

---

## Phase 7: Post-Deployment Operations

### 7.1 Monitoring

**Key Metrics to Track:**

1. **Minter Contract:**
   - total_reverse_burned (cumulative)
   - total_reverse_fees (cumulative)
   - Burn transaction frequency
   - Average burn amount

2. **FeeCollector Contract:**
   - accumulated_fees (current)
   - total_burned (cumulative)
   - total_burns_count
   - Time since last burn

3. **SP1 Prover:**
   - Proof generation latency
   - Proof submission success rate
   - Event detection lag

### 7.2 Admin Operations

#### Pause Contracts (Emergency)

```bash
# Pause minter
PAUSE_MSG='{"pause":{}}'
persistenced tx wasm execute $CONTRACT_MINTER "$PAUSE_MSG" --from $ADMIN ...

# Pause fee collector
persistenced tx wasm execute $CONTRACT_FEE "$PAUSE_MSG" --from $ADMIN ...
```

#### Update Configuration

```bash
# Update min burn amount
UPDATE_MIN='{"set_min_burn_amount":{"amount":"200000000000000000000"}}'
persistenced tx wasm execute $CONTRACT_FEE "$UPDATE_MIN" --from $ADMIN ...

# Update verifier
UPDATE_VER='{"set_verifier":{"verifier_address":"persistence1newverifier..."}}'
persistenced tx wasm execute $CONTRACT_MINTER "$UPDATE_VER" --from $ADMIN ...
```

### 7.3 Upgrade Path

To upgrade contracts:
1. Upload new WASM with fixes/improvements
2. Migrate contract state (if needed)
3. Or: Deploy new contracts, pause old ones, redirect users

---

## Troubleshooting

### Issue: FeeCollector not receiving fees

**Symptoms:** accumulated_fees stays at 0 after burn_for_unwrap

**Diagnosis:**
```bash
# Check if fee_collector_address is set correctly
persistenced query wasm contract-state smart $CONTRACT_MINTER '{"config":{}}'

# Check FeeCollector config
persistenced query wasm contract-state smart $CONTRACT_FEE '{"config":{}}'
```

**Fix:**
```bash
# Update fee_collector address
persistenced tx wasm execute $CONTRACT_MINTER \
  '{"set_fee_collector":{"fee_collector_address":"correct-address"}}' \
  --from $ADMIN ...
```

### Issue: SP1 prover not detecting events

**Diagnosis:**
- Check prover logs for connection errors
- Verify RPC endpoint is reachable
- Confirm contract addresses in config.toml match deployed contracts

**Fix:**
- Update RPC endpoints
- Restart prover with correct config

### Issue: Transaction fails with "Insufficient balance"

**Cause:** User doesn't have enough XPRT for gas OR not enough ibcTFUEL

**Fix:**
- Ensure user has both XPRT (for gas) and ibcTFUEL (for burning)
- Minimum 0.001 XPRT recommended for gas

---

## Contract Addresses Reference

### Testnet (test-core-2)

```
Minter:       persistence1...
FeeCollector: persistence1...
Verifier:     persistence1...
RevSplitter:  persistence1...
```

### Mainnet (core-1)

```
Minter:       persistence1...
FeeCollector: persistence1...
Verifier:     persistence1...
RevSplitter:  persistence1...
```

---

## Security Considerations

1. **Admin Key Management:**
   - Use hardware wallet or multisig for admin
   - Never expose private keys in config files
   - Rotate admin if compromised

2. **Pause Circuit Breaker:**
   - Admin can pause contracts in emergency
   - Consider automated circuit breakers for anomalies

3. **Rate Limiting:**
   - Consider adding per-user burn limits
   - Monitor for abnormal burn patterns

4. **Proof Verification:**
   - SP1 proofs are verified on-chain by Theta VaultFactory
   - Nullifier prevents replay attacks
   - Nonces prevent double-spend

---

## Support & Resources

- **Documentation:** https://docs.xfuel.protocol
- **Discord:** https://discord.gg/xfuel
- **GitHub:** https://github.com/xfuel-protocol/xfuel-protocol
- **Status Page:** https://status.xfuel.protocol

---

## Changelog

### v1.0.0 (2026-02-04)
- Initial reverse bridge deployment guide
- Support for burn_for_unwrap and fee_burn flows
- SP1 prover integration
- FeeCollector CW20 Receive hook pattern

---

**Last Updated:** February 4, 2026  
**Maintained By:** XFuel Protocol Team
