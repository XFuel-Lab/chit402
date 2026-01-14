# CosmWasm Contract Deployment Guide

## Overview

The **Persistence Minter** and **ZK Verifier** contracts are CosmWasm smart contracts that need to be deployed to the Persistence chain. Unlike Ethereum contracts (like VaultFactory), these are NOT automatically generated addresses - you must deploy them manually first.

---

## 🔑 Key Difference: Ethereum vs CosmWasm Addresses

### Ethereum/Theta (VaultFactory, etc.)
```javascript
// Deploy via Hardhat - generates address automatically
const VaultFactory = await ethers.deployContract("VaultFactory");
await VaultFactory.waitForDeployment();
console.log("VaultFactory deployed to:", await VaultFactory.getAddress());
// Output: 0x1234567890123456789012345678901234567890
```
**Result**: Address is auto-generated during deployment

### Persistence/CosmWasm (Minter, Verifier)
```bash
# 1. Build contract (creates .wasm file)
cd cosmwasm-contracts/persistence-minter
cargo wasm

# 2. Upload to chain (gets code ID)
persistenceCore tx wasm store artifacts/persistence_minter.wasm \
  --from deployer \
  --gas auto \
  --gas-adjustment 1.3

# Output: Code ID: 42

# 3. Instantiate contract (THIS creates the address)
persistenceCore tx wasm instantiate 42 \
  '{"admin": "persistence1hpnpvg...", ...}' \
  --from deployer \
  --label "xfuel-minter-v1"

# Output: Contract address: persistence1abc123xyz456...
```
**Result**: Address is created when you instantiate the uploaded code

---

## 📋 Step-by-Step Deployment

### Prerequisites
```bash
# 1. Install Rust & CosmWasm tools
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup default stable
rustup target add wasm32-unknown-unknown

# 2. Install cargo-generate
cargo install cargo-generate --features vendored-openssl

# 3. Install persistenceCore CLI
# Download from: https://github.com/persistenceOne/persistenceCore/releases
# Or use Docker: docker pull persistenceone/persistencecore:latest

# 4. Setup wallet
persistenceCore keys add deployer
# Save mnemonic securely! This is your deployer wallet
```

---

### Step 1: Build ZK Verifier Contract

```bash
cd cosmwasm-contracts/zk-verifier

# Build optimized WASM
docker run --rm -v "$(pwd)":/code \
  --mount type=volume,source="$(basename "$(pwd)")_cache",target=/code/target \
  --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
  cosmwasm/rust-optimizer:0.12.13

# This creates: artifacts/zk_verifier.wasm
```

**Output**: `artifacts/zk_verifier.wasm` (optimized contract)

---

### Step 2: Upload ZK Verifier to Persistence

```bash
# Upload contract code
persistenceCore tx wasm store artifacts/zk_verifier.wasm \
  --from deployer \
  --chain-id core-1 \
  --gas auto \
  --gas-adjustment 1.3 \
  --gas-prices 0.025uxprt \
  --node https://rpc.core.persistence.one:443

# Query transaction to get code ID
persistenceCore query tx <TX_HASH> --node https://rpc.core.persistence.one:443

# Look for: code_id: 123 (example)
```

**Save this Code ID!** You'll need it for instantiation.

---

### Step 3: Instantiate ZK Verifier

```bash
# Create instantiate message
cat > zk-verifier-init.json <<EOF
{
  "admin": "persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx",
  "verification_key": {
    "alpha": [...],
    "beta": [...],
    "gamma": [...],
    "delta": [...]
  }
}
EOF

# Instantiate contract
persistenceCore tx wasm instantiate <CODE_ID> \
  "$(cat zk-verifier-init.json)" \
  --from deployer \
  --label "xfuel-zk-verifier-v1" \
  --admin persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx \
  --chain-id core-1 \
  --gas auto \
  --gas-adjustment 1.3 \
  --gas-prices 0.025uxprt \
  --node https://rpc.core.persistence.one:443

# Query transaction for contract address
persistenceCore query tx <TX_HASH> --node https://rpc.core.persistence.one:443

# Look for: _contract_address: persistence1abc123xyz...
```

**This is your ZK_VERIFIER_ADDRESS!** Add to `.env.local`:
```bash
ZK_VERIFIER_ADDRESS=persistence1abc123xyz456def789ghi012...
```

---

### Step 4: Build Persistence Minter Contract

```bash
cd cosmwasm-contracts/persistence-minter

# Build optimized WASM
docker run --rm -v "$(pwd)":/code \
  --mount type=volume,source="$(basename "$(pwd)")_cache",target=/code/target \
  --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
  cosmwasm/rust-optimizer:0.12.13

# This creates: artifacts/persistence_minter.wasm
```

---

### Step 5: Upload & Instantiate Minter

```bash
# Upload
persistenceCore tx wasm store artifacts/persistence_minter.wasm \
  --from deployer \
  --chain-id core-1 \
  --gas auto \
  --gas-adjustment 1.3 \
  --gas-prices 0.025uxprt

# Get code ID from transaction

# Create init message (use real addresses!)
cat > minter-init.json <<EOF
{
  "admin": "persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx",
  "verifier_address": "persistence1abc123xyz456...",
  "denom": "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
  "dexter_router": "persistence132xmxm33vwjlur2pszl4hu9r32lqmqagvunnuc5hq4htps7rr3kqsf4dsk",
  "lp_treasury": "persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e"
}
EOF

# Instantiate
persistenceCore tx wasm instantiate <CODE_ID> \
  "$(cat minter-init.json)" \
  --from deployer \
  --label "xfuel-minter-v1" \
  --admin persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx \
  --chain-id core-1 \
  --gas auto \
  --gas-adjustment 1.3 \
  --gas-prices 0.025uxprt

# Get contract address from transaction
```

**This is your PERSISTENCE_MINTER_CONTRACT!** Add to `.env.local`:
```bash
PERSISTENCE_MINTER_CONTRACT=persistence1def789ghi012jkl345mno678...
```

---

## ✅ Verification

After deployment, verify contracts are working:

```bash
# Query ZK Verifier
persistenceCore query wasm contract-state smart <ZK_VERIFIER_ADDRESS> \
  '{"get_config":{}}' \
  --node https://rpc.core.persistence.one:443

# Query Minter
persistenceCore query wasm contract-state smart <MINTER_ADDRESS> \
  '{"config":{}}' \
  --node https://rpc.core.persistence.one:443
```

---

## 📝 Update Configuration Files

### 1. Update `.env.local`
```bash
# Add the deployed addresses
ZK_VERIFIER_ADDRESS=persistence1abc123xyz456def789ghi012...
PERSISTENCE_MINTER_CONTRACT=persistence1def789ghi012jkl345mno678...
```

### 2. Run Validation
```bash
node scripts/validate-addresses.cjs

# Should show:
# ✅ ZK_VERIFIER_ADDRESS: persistence1abc123...
# ✅ PERSISTENCE_MINTER_CONTRACT: persistence1def789...
```

---

## 🆚 Summary: Key Differences

| Aspect | Ethereum/Theta | Persistence/CosmWasm |
|--------|----------------|----------------------|
| **Language** | Solidity | Rust |
| **Deployment** | Hardhat deploy script | Manual upload + instantiate |
| **Address** | Auto-generated | Created at instantiation |
| **Gas** | ETH/TFUEL | XPRT (uxprt) |
| **Verification** | Etherscan | Mintscan/PingPub |
| **Upgradeable** | Via proxy pattern | Built-in migrate function |

---

## 🚨 Important Notes

1. **Do the ZK Verifier first** - Minter needs its address during instantiation
2. **Save all Code IDs** - You'll need them for upgrades
3. **Fund deployer wallet** - You need XPRT for gas (estimate ~5 XPRT total)
4. **Test on testnet first** - Deploy to testnet before mainnet
5. **Admin address** - Use your deployer address initially, transfer to multisig later

---

## 📞 Cost Estimate

- **Upload ZK Verifier**: ~2 XPRT gas
- **Instantiate Verifier**: ~0.5 XPRT gas
- **Upload Minter**: ~2 XPRT gas
- **Instantiate Minter**: ~0.5 XPRT gas

**Total**: ~5 XPRT (~$1 USD at current prices)

---

## 🔗 Resources

- [CosmWasm Docs](https://docs.cosmwasm.com/)
- [Persistence Docs](https://docs.persistence.one/)
- [persistenceCore CLI](https://github.com/persistenceOne/persistenceCore)
- [CosmWasm Plus](https://github.com/CosmWasm/cw-plus)

---

**Next Steps**: After deploying these contracts, you can run `node scripts/validate-addresses.cjs` to verify all addresses are correctly configured!
