# XFuel Persistence Minter Contract

**CosmWasm smart contract for ZK-verified ibcTFUEL minting on Persistence blockchain**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CosmWasm](https://img.shields.io/badge/CosmWasm-1.5.0-blue)](https://cosmwasm.com/)
[![Rust](https://img.shields.io/badge/Rust-1.70+-orange)](https://www.rust-lang.org/)

## Overview

This contract implements the **XFuel Persistence Minter**, a CW20-extended token contract for **ibcTFUEL** (IBC Theta Fuel) with zero-knowledge proof verification, automated gas pre-funding, and revenue splitting for the XFuel hybrid bridge protocol.

### Key Features

- ✅ **CW20 Standard**: Full compatibility with CW20 token standard
- ✅ **ZK Proof Verification**: Mock ZK-SNARK proof verification (production-ready integration points)
- ✅ **Automatic Gas Funding**: Pre-funds new Keplr users with 0.001 XPRT
- ✅ **Revenue Split**: 30% to RevSplitter, 70% to LP reinvestment on burns
- ✅ **LST Staking**: Admin delegation to validators for liquid staking
- ✅ **Replay Protection**: SHA-256 proof hash tracking
- ✅ **Admin Controls**: Pause/unpause, verifier updates
- ✅ **Comprehensive Tests**: Full test coverage with cw-multi-test

## Quick Start

### Build

```bash
# Standard build
cargo build

# Optimized production build
docker run --rm -v "$(pwd)":/code \
  --mount type=volume,source="$(basename "$(pwd)")_cache",target=/code/target \
  --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
  cosmwasm/rust-optimizer:0.15.1
```

### Test

```bash
# Run all tests
cargo test

# Run specific test
cargo test test_verify_and_mint

# Generate schema
cargo schema
```

### Deploy

See [COMPLETE_DEPLOYMENT_GUIDE.md](COMPLETE_DEPLOYMENT_GUIDE.md) for full deployment instructions.

Quick deploy:

```bash
# Store code
persistenceCore tx wasm store artifacts/persistence_minter.wasm --from deployer --gas auto -y

# Instantiate
persistenceCore tx wasm instantiate $CODE_ID \
  '{"name":"IBC Theta Fuel","symbol":"IBCTFUEL","decimals":18,"initial_balances":[],"mint_cap":null,"marketing":null,"verifier_address":"persistence1...","rev_splitter_address":"persistence1..."}' \
  --from deployer --label "XFuel-Minter-v1" --admin $(persistenceCore keys show deployer -a) --gas auto -y
```

## Architecture

### Contract Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Theta Blockchain                          │
│                   (TFUEL Deposit)                            │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
                  ┌──────────────┐
                  │ ZK Proof Gen │ (Backend)
                  └──────┬───────┘
                         │
                         ▼
┌────────────────────────────────────────────────────────────┐
│              Persistence Minter Contract                    │
│                                                             │
│  VerifyAndMint:                                            │
│  ├─ Verify ZK Proof                                        │
│  ├─ Check Replay (proof hash)                              │
│  ├─ Mint ibcTFUEL 1:1                                      │
│  ├─ Pre-fund 0.001 XPRT (if new user)                     │
│  └─ Emit mint event                                        │
│                                                             │
│  BurnAndUnwrap:                                            │
│  ├─ Burn ibcTFUEL from user                                │
│  ├─ Calculate 30/70 split                                  │
│  ├─ Emit event for backend                                 │
│  └─ Backend routes:                                        │
│      ├─ 30% → RevSplitter                                  │
│      └─ 70% → LP Reinvest                                  │
│                                                             │
│  DelegateToValidator:                                       │
│  └─ Admin stakes to LST validators                         │
└────────────────────────────────────────────────────────────┘
                         │
                         ▼
                  ┌──────────────┐
                  │  Keplr User  │
                  └──────────────┘
```

### State Management

```rust
// Config - Admin-controlled settings
pub struct Config {
    pub admin: Addr,
    pub verifier_address: Addr,
    pub rev_splitter_address: Addr,
    pub paused: bool,
    pub mint_cap: Option<Uint128>,
}

// State - Contract statistics
pub struct State {
    pub total_minted: Uint128,
    pub total_burned: Uint128,
    pub total_recycled: Uint128,    // 30% to RevSplitter
    pub total_lp_reinvest: Uint128, // 70% to LP
}

// Tracking
PROCESSED_PROOFS: Map<&str, bool>  // Replay protection
FUNDED_USERS: Map<&Addr, bool>     // Gas funding tracking
```

## Messages

### Instantiate

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

### Execute

#### VerifyAndMint (Backend)

```json
{
  "verify_and_mint": {
    "zk_proof": {
      "proof_data": "0x1234...",
      "public_inputs": ["1000000000000000000", "recipient_hash"],
      "verification_key": "vk_xfuel_v1"
    },
    "amount": "1000000000000000000",
    "recipient": "persistence1user..."
  }
}
```

#### BurnAndUnwrap (User)

```json
{
  "burn_and_unwrap": {
    "amount": "500000000000000000"
  }
}
```

#### CW20 Standard (User)

```json
// Transfer
{ "transfer": { "recipient": "persistence1...", "amount": "100" } }

// Burn
{ "burn": { "amount": "100" } }

// Increase Allowance
{ "increase_allowance": { "spender": "persistence1...", "amount": "100", "expires": null } }
```

#### Admin Functions

```json
// Pause
{ "pause": {} }

// Unpause
{ "unpause": {} }

// Set Verifier
{ "set_verifier": { "verifier_address": "persistence1..." } }

// Set RevSplitter
{ "set_rev_splitter": { "rev_splitter_address": "persistence1..." } }

// Delegate to Validator
{ "delegate_to_validator": { "validator": "persistencevaloper1...", "amount": "1000000" } }
```

### Query

```json
// Token Info
{ "token_info": {} }

// Balance
{ "balance": { "address": "persistence1..." } }

// Config
{ "config": {} }

// State
{ "state": {} }

// Allowance
{ "allowance": { "owner": "persistence1...", "spender": "persistence1..." } }
```

## Testing

### Test Coverage

- **Unit Tests**: ZK verifier logic, proof hashing
- **Integration Tests**: Full contract lifecycle with cw-multi-test
- **Edge Cases**: Replay attacks, insufficient balance, unauthorized access
- **Revenue Split**: Exact 30/70 percentage validation
- **Gas Funding**: First-time user detection

### Run Tests

```bash
# All tests
cargo test

# With output
cargo test -- --nocapture

# Specific module
cargo test zk_verifier::tests

# Coverage (requires cargo-tarpaulin)
cargo install cargo-tarpaulin
cargo tarpaulin --out Html
```

## Integration

### Backend Integration (Node.js/TypeScript)

```typescript
import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";

const CONTRACT_ADDRESS = "persistence1...";

async function mintTokens(zkProof: any, amount: string, recipient: string) {
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(
    process.env.MNEMONIC!,
    { prefix: "persistence" }
  );

  const client = await SigningCosmWasmClient.connectWithSigner(
    "https://rpc.core.persistence.one:443",
    wallet
  );

  const [account] = await wallet.getAccounts();

  return await client.execute(
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
}
```

### Frontend Integration (React)

```typescript
import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";

const CONTRACT_ADDRESS = "persistence1...";

async function burnTokens(amount: string) {
  if (!window.keplr) throw new Error("Keplr not installed");

  await window.keplr.enable("core-1");
  const offlineSigner = window.keplr.getOfflineSigner("core-1");

  const client = await SigningCosmWasmClient.connectWithSigner(
    "https://rpc.core.persistence.one:443",
    offlineSigner
  );

  const [account] = await offlineSigner.getAccounts();

  return await client.execute(
    account.address,
    CONTRACT_ADDRESS,
    {
      burn_and_unwrap: { amount },
    },
    "auto"
  );
}
```

## Security

### Audit Status

⚠️ **Not yet audited** - Use at your own risk

### Security Features

- ✅ Replay attack prevention via proof hash tracking
- ✅ Pausable contract for emergency stops
- ✅ Admin access control
- ✅ Input validation on all functions
- ✅ Mint cap enforcement
- ✅ Overflow/underflow protection (Rust/CosmWasm)

### Known Limitations

- **Mock ZK Verifier**: Production deployment requires real ZK proof system integration
- **Centralized Backend**: Minting depends on backend ZK proof generation
- **Admin Key**: Single admin key (consider multi-sig)

## Gas Costs (Estimated)

| Operation           | Gas Usage  | XPRT Cost (@0.025uxprt) |
| ------------------- | ---------- | ----------------------- |
| Instantiate         | ~150,000   | ~0.00375 XPRT           |
| VerifyAndMint       | ~180,000   | ~0.0045 XPRT            |
| BurnAndUnwrap       | ~120,000   | ~0.003 XPRT             |
| Transfer            | ~80,000    | ~0.002 XPRT             |
| Query               | ~10,000    | Free                    |
| DelegateToValidator | ~200,000   | ~0.005 XPRT             |

## Development

### Project Structure

```
persistence-minter/
├── src/
│   ├── contract.rs       # Main contract logic
│   ├── msg.rs            # Message types
│   ├── state.rs          # Storage definitions
│   ├── error.rs          # Error types
│   ├── zk_verifier.rs    # ZK proof verification
│   ├── tests.rs          # Integration tests
│   └── lib.rs            # Module exports
├── examples/
│   └── schema.rs         # Schema generation
├── Cargo.toml            # Dependencies
├── README.md             # This file
├── COMPLETE_DEPLOYMENT_GUIDE.md
├── INTEGRATION.md
└── DEPLOYMENT.md
```

### Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass: `cargo test`
5. Submit a pull request

## Resources

- **Full Deployment Guide**: [COMPLETE_DEPLOYMENT_GUIDE.md](COMPLETE_DEPLOYMENT_GUIDE.md)
- **Integration Guide**: [INTEGRATION.md](INTEGRATION.md)
- **CosmWasm Docs**: https://docs.cosmwasm.com
- **Persistence Docs**: https://docs.persistence.one
- **XFuel Protocol**: https://xfuel.app

## License

MIT License - Copyright (c) 2026 XFuelLab

## Support

- **Discord**: https://discord.gg/xfuel
- **GitHub Issues**: https://github.com/XFuelLab/xfuel-protocol/issues
- **Email**: dev@xfuel.io

---

**Built with ❤️ by XFuelLab**  
*Sub-4s settlement rail for TFUEL ↔ Cosmos LST atomic swaps*



