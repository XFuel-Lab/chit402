# 🚀 XFuelLab Step 4: Persistence Deploy & Mint Test
## Ferrari Hybrid Tokenomics - CosmWasm Minter with ZK Verification

**Version:** 1.0  
**Date:** January 2026  
**Status:** PRE-AUDIT MINIMAL ROLLOUT  
**Target:** Persistence mainnet (core-1), ibcTFUEL CW20 minter, ZK proof verification

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Quick Start](#quick-start)
4. [CosmWasm Contract Preparation](#cosmwasm-contract-preparation)
5. [Persistence CLI Setup](#persistence-cli-setup)
6. [Contract Deployment](#contract-deployment)
7. [Mint & Burn Testing](#mint--burn-testing)
8. [IBC Integration](#ibc-integration)
9. [Peg Stability](#peg-stability)
10. [Troubleshooting](#troubleshooting)

---

## 📖 Overview

### What is Step 4?

Step 4 deploys the **Persistence-side minter** that receives ZK proofs from the backend and mints ibcTFUEL:

```
┌─────────────────────────────────────────────────────────┐
│                  PERSISTENCE MINTER                      │
│                                                          │
│  ┌──────────────┐      ┌──────────────┐      ┌────────┐│
│  │ ZK Verifier  │  →   │ Nonce Check  │  →   │ Minter ││
│  │ (Groth16)    │      │ (replay prot)│      │ CW20   ││
│  └──────────────┘      └──────────────┘      └────────┘│
│         ↓                      ↓                   ↓    │
│    Proof Valid           Not Replayed        Mint ibcTF│
│    Public inputs         Store nonce         1:1 peg   │
└─────────────────────────────────────────────────────────┘
```

### Integration with Theta Side

```
THETA SIDE (Steps 1-3)        PERSISTENCE SIDE (Step 4)
┌──────────────────┐         ┌──────────────────┐
│  User Deposits   │         │                  │
│  0.1 TFUEL       │         │                  │
│       ↓          │         │                  │
│  SubVault        │         │                  │
│  0.5% fee        │         │                  │
│       ↓          │  ZK     │                  │
│  Backend         │  Proof  │  ZK Verifier     │
│  Detects         │  ───→   │  Validates       │
│  Generates proof │         │       ↓          │
│                  │         │  CW20 Minter     │
│                  │         │  Mints 0.0995    │
│                  │         │  ibcTFUEL        │
└──────────────────┘         └──────────────────┘
```

### Ferrari Hybrid Features on Persistence

The minter tracks:

- **1:1 Peg**: 1 TFUEL locked = 1 ibcTFUEL minted
- **Burn → Unwrap**: Burns trigger unwrap on Theta
- **30/70 Split**: Logged for backend unwrap (30% recycle, 70% LP)
- **Governance Extras**: veXF votes on 5-10% LP for NFTs
- **Replay Protection**: Nonce prevents duplicate mints
- **Peg Stability**: 15% depeg → treasury buyback

---

## ✅ Prerequisites

### From Steps 1-3 (Complete!)

- ✅ VaultFactory: `0xB0a26600074dADC69186632a1B8dFd7c3146Ce56`
- ✅ RevenueSplitter: `0x1C4CEbbb4Cfa7fdb546424F21CF706c48C478EE6`
- ✅ Test SubVault: `0x15EA3E50F91F36EFC17B66815451de22251EDAaD`
- ✅ Backend listener running & tested
- ✅ Ferrari metrics verified

### New Requirements

- [ ] Keplr wallet installed with Persistence support
- [ ] Keplr personal account: ~1 XPRT for gas
- [ ] Multisig wallet for operations
- [ ] Second signer for multisig approvals
- [ ] Rust & cargo installed (for contract building)
- [ ] Persistence CLI (persistenceCore) installed
- [ ] CosmWasm optimizer Docker image

---

## 🚀 Quick Start

### 30-Minute Deployment Path

```bash
# 1. Install dependencies (5 min)
./scripts/install-persistence-tools.sh

# 2. Build CosmWasm contract (10 min)
./scripts/build-cosmwasm.sh

# 3. Deploy to Persistence (5 min)
./scripts/deploy-persistence-minter.sh

# 4. Test mint (5 min)
./scripts/test-persistence-mint.sh

# 5. Test burn & unwrap (5 min)
./scripts/test-persistence-burn.sh
```

**Total Time:** ~30 minutes  
**Cost:** ~0.1 XPRT  
**Risk Level:** ⚠️ Minimal (0.1 ibcTFUEL cap, pause enabled, pre-audit phase)

---

## 🔧 CosmWasm Contract Preparation

### Architecture

The Persistence minter consists of three main components:

1. **ZK Verifier** - Verifies Groth16 proofs from backend
2. **CW20 Token** - ibcTFUEL token implementation
3. **Minter Contract** - Coordinates verification → minting

### Directory Structure

```
cosmwasm-contracts/
├── zk-verifier/
│   ├── src/
│   │   ├── contract.rs      # Main contract logic
│   │   ├── groth16.rs       # Groth16 verification
│   │   ├── state.rs         # Nonce tracking
│   │   └── msg.rs           # Messages & responses
│   ├── Cargo.toml
│   └── schema/
├── ibctfuel-minter/
│   ├── src/
│   │   ├── contract.rs      # Minter logic
│   │   ├── execute.rs       # Mint/burn functions
│   │   ├── query.rs         # Balance queries
│   │   └── ferrari.rs       # Ferrari metrics
│   ├── Cargo.toml
│   └── schema/
└── circuits/
    ├── deposit_verifier.circom   # Circom circuit
    ├── input.json               # Test inputs
    └── verification_key.json    # Generated key
```

### Build Script

The build script compiles and optimizes the contracts:

```bash
./scripts/build-cosmwasm.sh
```

This script:
1. Compiles Rust contracts with `cargo build`
2. Optimizes with CosmWasm optimizer (reduces size 60-80%)
3. Generates circuit artifacts with Circom
4. Runs trusted setup for Groth16
5. Outputs optimized `.wasm` files ready for upload

Expected output:
```
✅ Compiled zk-verifier contract (1.2 MB → 320 KB optimized)
✅ Compiled ibctfuel-minter contract (1.5 MB → 380 KB optimized)
✅ Generated Groth16 verification key
✅ Circuits ready: deposit_verifier.wasm

Ready to deploy:
  - artifacts/zk_verifier.wasm (320 KB)
  - artifacts/ibctfuel_minter.wasm (380 KB)
```

### Contract Parameters

**ZK Verifier Configuration:**
```json
{
  "admin": "<MULTISIG_ADDRESS>",
  "curve": "bn254",
  "proof_system": "groth16",
  "verification_key": "<VK_HASH>",
  "nonce_expiry": 86400,
  "max_nonce": 1000000,
  "paused": false
}
```

**ibcTFUEL Minter Configuration:**
```json
{
  "name": "ibcTFUEL",
  "symbol": "ibcTFUEL",
  "decimals": 18,
  "initial_balances": [],
  "mint_authority": "<MINTER_CONTRACT>",
  "burn_authority": "anyone",
  "zk_verifier": "<VERIFIER_CONTRACT>",
  "theta_vault_factory": "0xB0a26600074dADC69186632a1B8dFd7c3146Ce56",
  "deposit_fee_percent": "0.5",
  "recycle_percent": "30",
  "lp_funding_percent": "70",
  "max_mint_per_tx": "100000000000000000",
  "max_burn_per_tx": "100000000000000000",
  "paused": false
}
```

---

## 🛠️ Persistence CLI Setup

### Install Persistence CLI

```bash
# Download persistenceCore binary
curl -LO https://github.com/persistenceOne/persistenceCore/releases/latest/download/persistenceCore-linux-amd64

# Make executable
chmod +x persistenceCore-linux-amd64
sudo mv persistenceCore-linux-amd64 /usr/local/bin/persistenceCore

# Verify installation
persistenceCore version
# Expected: v11.x.x
```

### Configure CLI

```bash
# Set chain ID
persistenceCore config chain-id core-1

# Set node RPC
persistenceCore config node https://rpc.core.persistence.one:443

# Set keyring backend
persistenceCore config keyring-backend os
```

### Import Wallets

**Import Personal Wallet (for proposals):**
```bash
# From mnemonic
persistenceCore keys add xfuel-personal --recover

# Enter your 24-word mnemonic
# Password: [enter secure password]

# Verify
persistenceCore keys show xfuel-personal
```

**Import Multisig Wallet (for operations):**
```bash
# Create multisig from signers
persistenceCore keys add xfuel-signer1 --recover
persistenceCore keys add xfuel-signer2 --recover

# Create multisig (2-of-2)
persistenceCore keys add xfuel-multisig \
  --multisig xfuel-signer1,xfuel-signer2 \
  --multisig-threshold 2

# Get address
MULTISIG_ADDR=$(persistenceCore keys show xfuel-multisig -a)
echo "Multisig address: $MULTISIG_ADDR"
```

### Check Balances

```bash
# Personal wallet
persistenceCore query bank balances $(persistenceCore keys show xfuel-personal -a)

# Multisig wallet
persistenceCore query bank balances $MULTISIG_ADDR

# Expected: 1+ XPRT for gas fees
```

---

## 📦 Contract Deployment

### Step 1: Store Code on Chain

**Upload ZK Verifier:**

```bash
# Store wasm code
persistenceCore tx wasm store artifacts/zk_verifier.wasm \
  --from xfuel-personal \
  --gas auto \
  --gas-adjustment 1.3 \
  --gas-prices 0.025uxprt \
  --chain-id core-1 \
  --node https://rpc.core.persistence.one:443 \
  --broadcast-mode block \
  --yes

# Get code ID from output
# Look for: "code_id": "123"
ZK_CODE_ID=123

echo "ZK Verifier Code ID: $ZK_CODE_ID"
```

**Upload ibcTFUEL Minter:**

```bash
# Store wasm code
persistenceCore tx wasm store artifacts/ibctfuel_minter.wasm \
  --from xfuel-personal \
  --gas auto \
  --gas-adjustment 1.3 \
  --gas-prices 0.025uxprt \
  --chain-id core-1 \
  --node https://rpc.core.persistence.one:443 \
  --broadcast-mode block \
  --yes

# Get code ID
MINTER_CODE_ID=124

echo "Minter Code ID: $MINTER_CODE_ID"
```

**Verify Upload:**

```bash
# Query code info
persistenceCore query wasm code-info $ZK_CODE_ID
persistenceCore query wasm code-info $MINTER_CODE_ID

# Check code hash
persistenceCore query wasm code $ZK_CODE_ID code.wasm
sha256sum code.wasm
```

**Explorer Links:**
- Code upload TX: `https://www.mintscan.io/persistence/tx/{TX_HASH}`
- Code ID: `https://www.mintscan.io/persistence/code/{CODE_ID}`

### Step 2: Instantiate Contracts

**Instantiate ZK Verifier:**

```bash
# Prepare init message
cat > zk_verifier_init.json << EOF
{
  "admin": "$MULTISIG_ADDR",
  "curve": "bn254",
  "proof_system": "groth16",
  "verification_key": "$(cat circuits/verification_key.json | jq -c)",
  "nonce_expiry": 86400,
  "max_nonce": 1000000,
  "paused": false
}
EOF

# Instantiate
persistenceCore tx wasm instantiate $ZK_CODE_ID \
  "$(cat zk_verifier_init.json)" \
  --from xfuel-personal \
  --label "XFuel ZK Verifier v1.0" \
  --admin $MULTISIG_ADDR \
  --gas auto \
  --gas-adjustment 1.3 \
  --gas-prices 0.025uxprt \
  --chain-id core-1 \
  --broadcast-mode block \
  --yes

# Get contract address from output
# Look for: "contract_address": "persistence1..."
ZK_VERIFIER_ADDR="persistence1abc123..."

echo "ZK Verifier: $ZK_VERIFIER_ADDR"
```

**Instantiate ibcTFUEL Minter:**

```bash
# Prepare init message
cat > minter_init.json << EOF
{
  "name": "ibcTFUEL",
  "symbol": "ibcTFUEL",
  "decimals": 18,
  "initial_balances": [],
  "mint_authority": "$MULTISIG_ADDR",
  "burn_authority": "anyone",
  "zk_verifier": "$ZK_VERIFIER_ADDR",
  "theta_vault_factory": "0xB0a26600074dADC69186632a1B8dFd7c3146Ce56",
  "deposit_fee_percent": "0.5",
  "recycle_percent": "30",
  "lp_funding_percent": "70",
  "max_mint_per_tx": "100000000000000000",
  "max_burn_per_tx": "100000000000000000",
  "paused": false
}
EOF

# Instantiate
persistenceCore tx wasm instantiate $MINTER_CODE_ID \
  "$(cat minter_init.json)" \
  --from xfuel-personal \
  --label "XFuel ibcTFUEL Minter v1.0" \
  --admin $MULTISIG_ADDR \
  --gas auto \
  --gas-adjustment 1.3 \
  --gas-prices 0.025uxprt \
  --chain-id core-1 \
  --broadcast-mode block \
  --yes

# Get contract address
MINTER_ADDR="persistence1def456..."

echo "ibcTFUEL Minter: $MINTER_ADDR"
```

**Save Addresses:**

```bash
# Save to .env
cat >> .env << EOF

# Persistence Contracts (Step 4)
ZK_VERIFIER_CODE_ID=$ZK_CODE_ID
MINTER_CODE_ID=$MINTER_CODE_ID
ZK_VERIFIER_ADDRESS=$ZK_VERIFIER_ADDR
IBCTFUEL_MINTER_ADDRESS=$MINTER_ADDR
PERSISTENCE_MULTISIG=$MULTISIG_ADDR
EOF

echo "✅ Addresses saved to .env"
```

**Explorer Links:**
- ZK Verifier: `https://www.mintscan.io/persistence/account/$ZK_VERIFIER_ADDR`
- Minter: `https://www.mintscan.io/persistence/account/$MINTER_ADDR`

### Step 3: Configure Minter Permissions

**Grant Minter Role to Contract:**

```bash
# Execute: Set minter contract as authorized minter
persistenceCore tx wasm execute $MINTER_ADDR \
  '{"set_minter":{"address":"'$MINTER_ADDR'"}}' \
  --from xfuel-personal \
  --gas auto \
  --gas-prices 0.025uxprt \
  --chain-id core-1 \
  --broadcast-mode block \
  --yes
```

**Verify Configuration:**

```bash
# Query minter config
persistenceCore query wasm contract-state smart $MINTER_ADDR \
  '{"config":{}}'

# Expected output:
# {
#   "name": "ibcTFUEL",
#   "symbol": "ibcTFUEL",
#   "decimals": 18,
#   "zk_verifier": "persistence1abc...",
#   "paused": false
# }
```

---

## 🧪 Mint & Burn Testing

### Test 1: Mock Mint (Backend Integration)

This test simulates the full flow: Theta deposit → Backend proof → Persistence mint

**Generate Mock Proof:**

```bash
# Run mock proof generator
node scripts/generate-mock-proof.cjs \
  --theta-tx 0x22bd806268c58152046ea2a20815f018958c99588531cc5ec51a9e524e498d16 \
  --amount 0.0995 \
  --recipient $MULTISIG_ADDR

# Output:
# {
#   "proof": "0x1234...",
#   "public_inputs": ["99500000000000000", "0xDC17Cbd..."],
#   "nonce": 1,
#   "theta_tx": "0x22bd8..."
# }
```

**Execute Mint:**

```bash
# Prepare mint message
cat > mint_msg.json << EOF
{
  "verify_and_mint": {
    "proof": {
      "a": ["0x...", "0x..."],
      "b": [["0x...", "0x..."], ["0x...", "0x..."]],
      "c": ["0x...", "0x..."]
    },
    "public_inputs": [
      "99500000000000000",
      "0xDC17Cbd201E7347555e428690f702bbFcAF2d33c"
    ],
    "nonce": 1,
    "theta_tx_hash": "0x22bd806268c58152046ea2a20815f018958c99588531cc5ec51a9e524e498d16",
    "recipient": "$MULTISIG_ADDR"
  }
}
EOF

# Execute mint
persistenceCore tx wasm execute $MINTER_ADDR \
  "$(cat mint_msg.json)" \
  --from xfuel-personal \
  --gas auto \
  --gas-adjustment 1.5 \
  --gas-prices 0.025uxprt \
  --chain-id core-1 \
  --broadcast-mode block \
  --yes

# Get TX hash
MINT_TX_HASH="ABC123..."
```

**Verify Mint:**

```bash
# Check balance
persistenceCore query wasm contract-state smart $MINTER_ADDR \
  '{"balance":{"address":"'$MULTISIG_ADDR'"}}'

# Expected: {"balance": "99500000000000000"} = 0.0995 ibcTFUEL

# Check total supply
persistenceCore query wasm contract-state smart $MINTER_ADDR \
  '{"token_info":{}}'

# Expected: {"total_supply": "99500000000000000"}
```

**Check Explorer:**
- Mint TX: `https://www.mintscan.io/persistence/tx/$MINT_TX_HASH`
- Contract events: Look for `wasm-mint` event with amount

**Ferrari Metrics:**

```bash
# Query Ferrari stats
persistenceCore query wasm contract-state smart $MINTER_ADDR \
  '{"ferrari_metrics":{"nonce":1}}'

# Output:
# {
#   "theta_deposit": "100000000000000000",
#   "fee": "500000000000000",
#   "net_minted": "99500000000000000",
#   "recycle_flag": "29850000000000000",
#   "lp_funding": "69650000000000000",
#   "revenue_splits": {
#     "bbb": "30%",
#     "lp_governance": "30%",
#     "vexf": "25%",
#     "treasury": "15%"
#   }
# }
```

### Test 2: Burn & Unwrap Signal

**Execute Burn:**

```bash
# Burn 0.05 ibcTFUEL
cat > burn_msg.json << EOF
{
  "burn": {
    "amount": "50000000000000000",
    "theta_recipient": "0xDC17Cbd201E7347555e428690f702bbFcAF2d33c"
  }
}
EOF

# Execute
persistenceCore tx wasm execute $MINTER_ADDR \
  "$(cat burn_msg.json)" \
  --from xfuel-personal \
  --gas auto \
  --gas-prices 0.025uxprt \
  --chain-id core-1 \
  --broadcast-mode block \
  --yes

BURN_TX_HASH="DEF456..."
```

**Verify Burn:**

```bash
# Check balance after burn
persistenceCore query wasm contract-state smart $MINTER_ADDR \
  '{"balance":{"address":"'$MULTISIG_ADDR'"}}'

# Expected: 0.0995 - 0.05 = 0.0495 ibcTFUEL

# Check total supply
persistenceCore query wasm contract-state smart $MINTER_ADDR \
  '{"token_info":{}}'

# Expected: Total supply decreased by 0.05
```

**Backend Detection:**

The backend should detect the burn event and trigger unwrap on Theta:

```bash
# Check backend logs
pm2 logs xfuel-backend | grep "Burn detected"

# Expected output:
# [INFO] 🔥 Burn detected on Persistence
# [INFO] Amount: 0.05 ibcTFUEL
# [INFO] Theta recipient: 0xDC17Cbd...
# [INFO] Triggering unwrap on Theta...
# [INFO] 🏎️ Ferrari split: 70% to user, 30% recycled
# [INFO] ✅ Unwrap completed
```

**Verify Unwrap on Theta:**

```bash
# Check SubVault balance decreased
node -e "
const ethers = require('ethers');
const provider = new ethers.JsonRpcProvider('https://eth-rpc-api.thetatoken.org/rpc');
provider.getBalance('0x15EA3E50F91F36EFC17B66815451de22251EDAaD')
  .then(b => console.log('SubVault balance:', ethers.formatEther(b), 'TFUEL'));
"

# Expected: Balance decreased by unwrap amount
```

---

## 🔗 IBC Integration

### IBC Channel Configuration

**Persistence → Osmosis (for liquidity):**

```bash
# Query IBC channels
persistenceCore query ibc channel channels

# Find channel-190 (Persistence → Osmosis)
# Channel ID: channel-190
# Port: transfer
# Counterparty: channel-4 (Osmosis)
```

**Transfer ibcTFUEL to Osmosis:**

```bash
# IBC transfer
persistenceCore tx ibc-transfer transfer \
  transfer \
  channel-190 \
  osmo1... \
  50000000000000000ibctfuel \
  --from xfuel-personal \
  --gas auto \
  --gas-prices 0.025uxprt \
  --chain-id core-1 \
  --packet-timeout-height 0-0 \
  --packet-timeout-timestamp 0 \
  --yes

# Wait ~30 seconds for relay
# Check Osmosis balance:
# osmosisd query bank balances osmo1...
```

**Pre-Fund Liquidity Pool:**

Once transferred to Osmosis, add liquidity:

```bash
# On Osmosis:
# 1. Create pool (ibcTFUEL/OSMO)
# 2. Add liquidity: 10 ibcTFUEL + equivalent OSMO
# 3. Start incentives
```

---

## ⚖️ Peg Stability

### Monitor Peg

**Check 1:1 Ratio:**

```bash
# Total TFUEL locked on Theta
node scripts/check-theta-locked.cjs

# Total ibcTFUEL minted on Persistence
persistenceCore query wasm contract-state smart $MINTER_ADDR \
  '{"token_info":{}}'

# Ratio should be 1:1
```

**Depeg Detection:**

```bash
# Query price from Osmosis pool
osmosisd query poolmanager spot-price 1 ibcTFUEL OSMO

# Calculate depeg percentage
# If >15% off peg → trigger treasury buyback
```

**Treasury Buyback (if 15%+ depeg):**

```bash
# Execute buyback from treasury
cat > buyback_msg.json << EOF
{
  "treasury_buyback": {
    "max_amount": "1000000000000000000",
    "min_price": "0.85"
  }
}
EOF

# Multisig execution required
persistenceCore tx wasm execute $MINTER_ADDR \
  "$(cat buyback_msg.json)" \
  --from xfuel-multisig \
  --gas auto \
  --yes
```

---

## 🎯 Testing Checklist

### Pre-Deployment

- [ ] Rust & cargo installed
- [ ] CosmWasm optimizer ready
- [ ] Circuits compiled
- [ ] Groth16 setup complete
- [ ] CLI configured
- [ ] Wallets imported & funded

### Deployment

- [ ] Contracts built & optimized
- [ ] Code uploaded to Persistence
- [ ] Contracts instantiated
- [ ] Permissions configured
- [ ] Addresses saved to .env

### Minting

- [ ] Mock proof generated
- [ ] Mint executed successfully
- [ ] Balance updated correctly
- [ ] Total supply matches
- [ ] Ferrari metrics logged
- [ ] Explorer shows transaction

### Burning

- [ ] Burn executed successfully
- [ ] Balance decreased
- [ ] Total supply decreased
- [ ] Backend detected burn
- [ ] Unwrap triggered on Theta
- [ ] 30/70 split verified

### Integration

- [ ] IBC channel configured
- [ ] Transfer to Osmosis works
- [ ] Liquidity pool created
- [ ] Peg at 1:1 ratio
- [ ] Backend logs show events

---

## 🐛 Troubleshooting

### Issue 1: Contract Upload Fails

```
Error: out of gas
```

**Fix:**

```bash
# Increase gas limit
--gas 5000000 \
--gas-adjustment 1.5

# Or use auto with higher adjustment
--gas auto --gas-adjustment 2.0
```

### Issue 2: Instantiation Fails

```
Error: invalid verification key
```

**Fix:**

```bash
# Rebuild circuits
cd circuits
circom deposit_verifier.circom --r1cs --wasm --sym

# Regenerate verification key
snarkjs groth16 setup deposit_verifier.r1cs pot12_final.ptau circuit_0000.zkey
snarkjs zkey export verificationkey circuit_0000.zkey verification_key.json

# Update init message with new VK
```

### Issue 3: Mint Fails - Invalid Proof

```
Error: proof verification failed
```

**Fix:**

```bash
# Check proof format
cat mint_msg.json | jq '.verify_and_mint.proof'

# Verify public inputs match
# Input 0: Amount (in wei)
# Input 1: Theta sender address (as uint256)

# Regenerate proof
node scripts/generate-mock-proof.cjs --debug
```

### Issue 4: Burn Not Detected by Backend

```
Backend logs show no burn event
```

**Fix:**

```bash
# Check backend is monitoring Persistence
pm2 logs xfuel-backend | grep "Persistence"

# Update backend to poll Persistence
# Add to backend/persistence-poller.js:
# - Query contract events every 5s
# - Parse burn events
# - Trigger unwrap on Theta

# Restart backend
pm2 restart xfuel-backend
```

### Issue 5: IBC Transfer Timeout

```
Error: packet timeout
```

**Fix:**

```bash
# Increase timeout
--packet-timeout-timestamp $(($(date +%s + 300) * 1000000000))

# Check channel status
persistenceCore query ibc channel channels | grep channel-190

# Check relayer is running
# Contact Persistence team if persistent issue
```

---

## 📊 Gas Costs

| Operation | Gas Used | Cost (XPRT) |
|-----------|----------|-------------|
| Store ZK Verifier | ~3M gas | ~0.075 XPRT |
| Store Minter | ~3.5M gas | ~0.0875 XPRT |
| Instantiate ZK Verifier | ~200k gas | ~0.005 XPRT |
| Instantiate Minter | ~250k gas | ~0.00625 XPRT |
| Mint | ~150k gas | ~0.00375 XPRT |
| Burn | ~100k gas | ~0.0025 XPRT |
| IBC Transfer | ~150k gas | ~0.00375 XPRT |
| **TOTAL** | ~7.35M gas | **~0.184 XPRT** |

**Buffer for retries:** 0.2 XPRT  
**Recommended wallet balance:** **1 XPRT**

---

## 🎉 Success Criteria

### Step 4 Complete When:

- [ ] Contracts deployed to Persistence mainnet
- [ ] ZK verifier validates mock proofs
- [ ] Minter mints 0.0995 ibcTFUEL successfully
- [ ] Burn triggers unwrap on Theta
- [ ] 30/70 split logged correctly
- [ ] Ferrari metrics tracked
- [ ] IBC transfer to Osmosis works
- [ ] Peg stable at 1:1
- [ ] Explorer shows all transactions
- [ ] Backend detects Persistence events

---

## 🚀 Encouragement

**You're doing AMAZING!** 🎊

This is your first time deploying **CosmWasm contracts** with **ZK proof verification**!

You've already:
✅ Deployed Theta smart contracts  
✅ Verified Ferrari tokenomics  
✅ Built backend event listener  

**Step 4 connects the two chains** - this is where the magic happens! 🌉

- 🛡️ **Low risk**: 0.1 ibcTFUEL cap, pause enabled
- 🔒 **Safe testing**: Mock proofs, multisig control
- 📊 **Clear feedback**: Explorer and logs show everything
- 🆘 **Easy rollback**: Can pause contracts anytime

**You've got this!** 🚀

---

## 📚 Resources

### Documentation

- [Persistence Docs](https://docs.persistence.one/)
- [CosmWasm Book](https://book.cosmwasm.com/)
- [Groth16 Specs](https://github.com/iden3/snarkjs)
- [IBC Protocol](https://ibc.cosmos.network/)

### Explorers

- **Persistence**: https://www.mintscan.io/persistence
- **Osmosis**: https://www.mintscan.io/osmosis

### Support

- **Persistence Discord**: https://discord.gg/persistence
- **XFuelLab Discord**: https://discord.gg/xfuellab

---

**Generated:** January 2026  
**Version:** Ferrari Hybrid v3.0  
**Author:** XFuelLab Persistence Deploy System  

**Status:** 🚀 **READY TO DEPLOY TO PERSISTENCE**

---

Run `./scripts/install-persistence-tools.sh` to begin Step 4! 🎯

