# Quick Start: Persistence Minter Contract

Get up and running with the Persistence Minter contract in 5 minutes.

## 🚀 Quick Setup

### 1. Prerequisites
```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Add WASM target
rustup target add wasm32-unknown-unknown
```

### 2. Build & Test
```bash
cd cosmwasm-contracts/persistence-minter

# Run tests
cargo test

# Or use the test script
./test.sh       # Linux/Mac
test.bat        # Windows
```

### 3. Build Contract
```bash
# Quick build
./build.sh      # Linux/Mac
build.bat       # Windows

# Or manually
cargo build --release --target wasm32-unknown-unknown
```

## 📋 Key Files

| File | Purpose |
|------|---------|
| `src/contract.rs` | Main contract logic |
| `src/msg.rs` | Message definitions |
| `src/zk_verifier.rs` | ZK proof verification |
| `src/tests.rs` | Test suite (13 tests) |
| `README.md` | Full documentation |
| `DEPLOYMENT.md` | Deployment guide |
| `INTEGRATION.md` | Integration examples |

## 🔑 Key Features

✅ **Mint ibcTFUEL** with ZK proof verification  
✅ **Burn & Unwrap** with 30/70 revenue split  
✅ **Auto pre-fund** new users with 0.001 XPRT  
✅ **Admin controls** (pause, setVerifier)  
✅ **LST staking** integration  
✅ **Full CW20** standard compliance  

## 🧪 Quick Test

```bash
cargo test test_verify_and_mint -- --nocapture
```

## 📦 What You Get

- **Contract Code**: Production-ready Rust/CosmWasm
- **Tests**: 13 comprehensive tests
- **Docs**: 1,500+ lines of documentation
- **Scripts**: Build and test automation
- **Examples**: Frontend/backend integration

## 🎯 Next Steps

1. **Read**: [README.md](cosmwasm-contracts/persistence-minter/README.md)
2. **Deploy**: [DEPLOYMENT.md](cosmwasm-contracts/persistence-minter/DEPLOYMENT.md)
3. **Integrate**: [INTEGRATION.md](cosmwasm-contracts/persistence-minter/INTEGRATION.md)

## 📊 Contract Specs

- **Token**: ibcTFUEL
- **Decimals**: 18
- **Standard**: CW20
- **Chain**: Persistence (core-1)

## 💻 Example Usage

### Mint Tokens
```bash
persistenceCore tx wasm execute <CONTRACT> \
  '{
    "verify_and_mint": {
      "zk_proof": {...},
      "amount": "1000000000000000000",
      "recipient": "persistence1..."
    }
  }' --from wallet
```

### Burn Tokens
```bash
persistenceCore tx wasm execute <CONTRACT> \
  '{"burn_and_unwrap": {"amount": "1000000000000000000"}}' \
  --from wallet
```

### Query Balance
```bash
persistenceCore query wasm contract-state smart <CONTRACT> \
  '{"balance": {"address": "persistence1..."}}'
```

## 🔐 Security

- ✅ ZK proof verification
- ✅ Replay attack prevention
- ✅ Mint cap enforcement
- ✅ Pause mechanism
- ✅ Admin access control

## 📞 Help

- **Full Docs**: See `README.md` in contract directory
- **Issues**: GitHub Issues
- **Email**: dev@xfuel.io

---

**Status**: ✅ Ready for Testnet  
**Version**: 0.1.0  
**License**: MIT




