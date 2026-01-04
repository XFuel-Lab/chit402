# XFuel Persistence Minter Contract

**CosmWasm smart contract for ZK-verified ibcTFUEL minting on Persistence blockchain**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CosmWasm](https://img.shields.io/badge/CosmWasm-1.5.0-blue)](https://cosmwasm.com/)
[![Rust](https://img.shields.io/badge/Rust-1.70+-orange)](https://www.rust-lang.org/)

## 🚀 Quick Start

```bash
# Build
cargo build

# Test
cargo test

# Optimize for production
docker run --rm -v "$(pwd)":/code \
  --mount type=volume,source="$(basename "$(pwd)")_cache",target=/code/target \
  --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
  cosmwasm/rust-optimizer:0.15.1

# Deploy (see COMPLETE_DEPLOYMENT_GUIDE.md for details)
persistenceCore tx wasm store artifacts/persistence_minter.wasm --from deployer --gas auto -y
```

## 📋 Overview

This contract implements the **XFuel Persistence Minter**, a CW20-extended token contract for **ibcTFUEL** (symbol: `IBCTFUEL`, decimals: 18) with:

- ✅ **ZK Proof Verification** - Validates ZK-SNARK proofs from Theta deposits
- ✅ **Auto Gas Funding** - Pre-funds new Keplr users with 0.001 XPRT
- ✅ **Revenue Split** - 30% to RevSplitter, 70% to LP reinvestment
- ✅ **LST Staking** - Admin delegation to validators
- ✅ **Replay Protection** - SHA-256 proof hash tracking
- ✅ **Comprehensive Tests** - Full coverage with cw-multi-test

## 📚 Documentation

| Document                                                      | Description                          |
| ------------------------------------------------------------- | ------------------------------------ |
| [COMPLETE_DEPLOYMENT_GUIDE.md](COMPLETE_DEPLOYMENT_GUIDE.md) | Full deployment & usage guide        |
| [README_ENHANCED.md](README_ENHANCED.md)                      | Detailed technical documentation     |
| [INTEGRATION_EXAMPLES.md](INTEGRATION_EXAMPLES.md)            | Backend/frontend integration code    |
| [DEPLOYMENT.md](DEPLOYMENT.md)                                | Quick deployment reference           |
| [INTEGRATION.md](INTEGRATION.md)                              | Integration overview                 |

## 🏗️ Architecture

```
Theta Deposit → ZK Proof Gen → VerifyAndMint → ibcTFUEL Minted
                                     ↓
                          Pre-fund 0.001 XPRT (new users)
                                     ↓
                          IBC Transfer → LST Swap → Auto-Stake

BurnAndUnwrap → 30% RevSplitter + 70% LP Reinvest
```

## 🔧 Key Functions

### VerifyAndMint (Backend)

```json
{
  "verify_and_mint": {
    "zk_proof": { "proof_data": "0x...", "public_inputs": [...], "verification_key": "vk_..." },
    "amount": "1000000000000000000",
    "recipient": "persistence1..."
  }
}
```

### BurnAndUnwrap (User)

```json
{
  "burn_and_unwrap": {
    "amount": "500000000000000000"
  }
}
```

### Admin Controls

```json
{ "pause": {} }
{ "unpause": {} }
{ "set_verifier": { "verifier_address": "persistence1..." } }
{ "delegate_to_validator": { "validator": "persistencevaloper1...", "amount": "1000000" } }
```

## 🧪 Testing

```bash
# Run all tests
cargo test

# Run specific test
cargo test test_verify_and_mint -- --nocapture

# Generate schema
cargo schema
```

### Test Coverage

- ✅ 15+ integration tests with cw-multi-test
- ✅ ZK proof verification logic
- ✅ Revenue split accuracy (30/70)
- ✅ Replay attack prevention
- ✅ Gas pre-funding for new users
- ✅ LST delegation
- ✅ Full lifecycle scenarios

## 🔗 Integration

### Backend (TypeScript)

```typescript
import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";

const client = await SigningCosmWasmClient.connectWithSigner(rpc, wallet);
await client.execute(address, contractAddr, {
  verify_and_mint: { zk_proof, amount, recipient }
}, "auto");
```

### Frontend (React + Keplr)

```typescript
const { address, balance, burnAndUnwrap } = usePersistenceMinter();
await burnAndUnwrap("1000000000000000000");
```

See [INTEGRATION_EXAMPLES.md](INTEGRATION_EXAMPLES.md) for complete code.

## 📊 Contract State

```rust
Config {
  admin: Addr,
  verifier_address: Addr,
  rev_splitter_address: Addr,
  paused: bool,
  mint_cap: Option<Uint128>
}

State {
  total_minted: Uint128,
  total_burned: Uint128,
  total_recycled: Uint128,    // 30% to RevSplitter
  total_lp_reinvest: Uint128  // 70% to LP
}
```

## 🔒 Security

- ✅ Replay attack prevention via proof hashing
- ✅ Pausable contract for emergencies
- ✅ Admin access control
- ✅ Input validation on all functions
- ✅ Mint cap enforcement
- ⚠️ **Mock ZK verifier** - Production requires real ZK integration

## 📦 Files

```
persistence-minter/
├── src/
│   ├── contract.rs          # Main contract logic (460 lines)
│   ├── msg.rs               # Message types
│   ├── state.rs             # Storage definitions
│   ├── error.rs             # Error handling
│   ├── zk_verifier.rs       # ZK proof verification
│   ├── tests.rs             # Integration tests (650+ lines)
│   └── lib.rs               # Module exports
├── examples/
│   └── schema.rs            # Schema generation
├── Cargo.toml               # Dependencies
├── COMPLETE_DEPLOYMENT_GUIDE.md
├── README_ENHANCED.md
├── INTEGRATION_EXAMPLES.md
└── README.md (this file)
```

## 🌐 Resources

- **XFuel App**: https://xfuel.app
- **Docs**: [../../PERSISTENCE_MINTER_INDEX.md](../../PERSISTENCE_MINTER_INDEX.md)
- **CosmWasm**: https://docs.cosmwasm.com
- **Persistence**: https://docs.persistence.one

## 📝 License

MIT License - Copyright (c) 2026 XFuelLab

---

**Built with ❤️ by XFuelLab** | *Sub-4s settlement rail for TFUEL ↔ Cosmos LST atomic swaps*
