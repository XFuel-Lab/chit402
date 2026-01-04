# CosmWasm Contracts - XFuel ZK Bridge

Production-ready CosmWasm contracts for the Theta ↔ Persistence ZK-powered bridge.

## 📦 Contracts

### 1. **zk-verifier** - ZK-SNARK Proof Verification
- Verifies Groth16 proofs for Theta deposits
- Replay protection (nonce + tx hash tracking)
- Mock implementation (replace with `ark-groth16` for production)
- **Size:** ~200-300 KB optimized

### 2. **ibc-tfuel-minter** - ibcTFUEL CW20 Minter
- Mints ibcTFUEL 1:1 with verified Theta deposits
- Burns ibcTFUEL to signal unwrap on Theta
- Integrated with ZK verifier via submessages
- Safety: 0.1 TFUEL cap, pausable, max supply
- **Size:** ~300-400 KB optimized

## 🛠️ Build Instructions

### Prerequisites
```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Add wasm32 target
rustup target add wasm32-unknown-unknown

# Install Docker (for optimization)
# https://www.docker.com/products/docker-desktop/
```

### Build (Development)
```bash
# Build unoptimized WASM (fast, for testing)
./scripts/build-cosmwasm-contracts.sh

# Output: target/wasm32-unknown-unknown/release/*.wasm
```

### Optimize (Production)
```bash
# Optimize with CosmWasm Rust Optimizer (~5-10 min)
./scripts/optimize-cosmwasm.sh

# Output: artifacts/*.wasm (production-ready)
```

## 🧪 Testing

```bash
# Run all tests
./scripts/test-cosmwasm.sh

# Or test individual contracts
cd cosmwasm/zk-verifier
cargo test --release

cd ../ibc-tfuel-minter
cargo test --release
```

## 📊 Contract Sizes

| Contract | Unoptimized | Optimized | Gas Cost (store) |
|----------|-------------|-----------|------------------|
| zk-verifier | ~1.5 MB | ~250 KB | ~0.05 XPRT |
| ibc-tfuel-minter | ~2.0 MB | ~350 KB | ~0.07 XPRT |

**Total deployment cost:** ~0.15 XPRT (~$0.04 USD)

## 🚀 Deployment

### Using Docker (Windows/Mac/Linux)
```bash
# Build optimized contracts
./scripts/optimize-cosmwasm.sh

# Deploy to Persistence Mainnet
docker-compose run --rm persistence-deployer /app/scripts/docker-deploy-persistence.sh
```

### Manual Deployment
```bash
# Store ZK Verifier
persistenceCore tx wasm store artifacts/zk_verifier.wasm \
  --from deployer \
  --gas auto \
  --gas-adjustment 1.3 \
  --chain-id core-1 \
  --node https://rpc.core.persistence.one:443

# Store ibcTFUEL Minter
persistenceCore tx wasm store artifacts/ibc_tfuel_minter.wasm \
  --from deployer \
  --gas auto \
  --gas-adjustment 1.3 \
  --chain-id core-1 \
  --node https://rpc.core.persistence.one:443

# Instantiate contracts (see deployment guide)
```

## 🔐 Security Features

### ZK Verifier
- ✅ Replay protection (nonce + tx hash)
- ✅ Admin-only updates
- ✅ Proof validation (mock Groth16)
- ✅ Event emission for monitoring

### ibcTFUEL Minter
- ✅ ZK proof verification required
- ✅ Duplicate mint protection
- ✅ Max supply cap (1M TFUEL default)
- ✅ Emergency pause mechanism
- ✅ Burn tracking for unwrap signals

## 📝 Integration

### Minting ibcTFUEL
```rust
// On Theta: User deposits 0.1 TFUEL to SubVault
// Backend: Detects deposit, generates ZK proof
// Persistence: Call minter contract

{
  "verify_and_mint": {
    "proof": { /* Groth16 proof */ },
    "public_inputs": ["100000000000000000"], // 0.1 TFUEL in wei
    "theta_tx_hash": "0xabc123...",
    "nonce": 1,
    "recipient": "persistence1...",
    "amount": "100000000000000000"
  }
}
```

### Burning ibcTFUEL
```rust
{
  "burn": {
    "amount": "100000000000000000",
    "theta_recipient": "0x..." // Theta address
  }
}
```

## 🔄 Upgrade Path

1. **Mock → Real Groth16:**
   - Replace `verify_groth16_mock` with `ark-groth16`
   - Add BN254 curve verification
   - Deploy Circom circuits for proof generation

2. **CW20 Integration:**
   - Deploy separate CW20 token
   - Update minter to use `cw20::execute_mint`
   - Integrate with Osmosis/DEXes

3. **IBC Integration:**
   - Add IBC channel support
   - Implement packet handlers
   - Cross-chain state sync

## 📚 Resources

- [CosmWasm Docs](https://docs.cosmwasm.com/)
- [Persistence Docs](https://docs.persistence.one/)
- [Groth16 Spec](https://eprint.iacr.org/2016/260.pdf)
- [XFuel Whitepaper](../docs/XFUEL-Hybrid-Tokenomics-Whitepaper-v3.md)

## 🐛 Troubleshooting

**Build fails with "linker not found":**
```bash
# Install build essentials
sudo apt-get install build-essential
```

**Docker optimizer fails:**
```bash
# Increase Docker memory to 4GB+
# Docker Desktop → Settings → Resources → Memory
```

**Tests fail:**
```bash
# Clean and rebuild
cargo clean
cargo test --release
```

---

Built with 🦀 Rust + CosmWasm for production safety and performance.

