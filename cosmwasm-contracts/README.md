# XFuel CosmWasm Contracts

This directory contains CosmWasm smart contracts for the XFuel Protocol's Cosmos ecosystem integration.

## Contracts

### 1. Persistence Minter (`persistence-minter/`)

**Purpose**: Mint and manage ibcTFUEL tokens on Persistence blockchain with ZK proof verification.

**Key Features**:
- ✅ CW20-compliant token (ibcTFUEL, 18 decimals)
- ✅ ZK proof verification for minting
- ✅ Automated revenue splitting (30% recycle, 70% LP reinvest)
- ✅ LST staking integration
- ✅ Pre-funding new users with XPRT for gas
- ✅ Admin controls (pause/unpause, set verifier)
- ✅ Comprehensive test suite with cw-multi-test

**Quick Start**:
```bash
cd cosmwasm-contracts/persistence-minter
cargo test                                    # Run tests
./build.sh                                    # Build contract
```

**Documentation**:
- [README.md](persistence-minter/README.md) - Contract overview and features
- [DEPLOYMENT.md](persistence-minter/DEPLOYMENT.md) - Step-by-step deployment guide
- [INTEGRATION.md](persistence-minter/INTEGRATION.md) - Frontend/backend integration

**Status**: ✅ Ready for testnet deployment

---

## Development Setup

### Prerequisites

1. **Rust and Cargo**
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown
```

2. **Docker** (for optimization)
```bash
# Install Docker from https://docs.docker.com/get-docker/
```

3. **Persistence Core CLI**
```bash
# Linux/Mac
wget https://github.com/persistenceOne/persistenceCore/releases/latest/download/persistenceCore-linux-amd64.tar.gz
tar -xzf persistenceCore-linux-amd64.tar.gz
sudo mv persistenceCore /usr/local/bin/
```

### Building Contracts

```bash
# Navigate to contract directory
cd cosmwasm-contracts/persistence-minter

# Build
cargo build --release --target wasm32-unknown-unknown

# Run tests
cargo test

# Optimize for deployment
docker run --rm -v "$(pwd)":/code \
  --mount type=volume,source="$(basename "$(pwd)")_cache",target=/code/target \
  --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
  cosmwasm/rust-optimizer:0.15.0
```

### Testing

Each contract includes comprehensive tests using `cw-multi-test`:

```bash
# Run all tests
cargo test

# Run with output
cargo test -- --nocapture

# Run specific test
cargo test test_verify_and_mint -- --nocapture

# Check code coverage
cargo tarpaulin --out Html
```

## Contract Architecture

```
cosmwasm-contracts/
├── persistence-minter/          # ibcTFUEL minter contract
│   ├── src/
│   │   ├── contract.rs         # Main contract logic
│   │   ├── msg.rs              # Message definitions
│   │   ├── state.rs            # State storage
│   │   ├── error.rs            # Error types
│   │   ├── zk_verifier.rs      # ZK proof verification
│   │   ├── tests.rs            # Test suite
│   │   └── lib.rs              # Library entry point
│   ├── examples/
│   │   └── schema.rs           # Schema generation
│   ├── Cargo.toml              # Dependencies
│   ├── README.md               # Contract docs
│   ├── DEPLOYMENT.md           # Deployment guide
│   └── INTEGRATION.md          # Integration guide
└── README.md                   # This file
```

## Integration with XFuel Ecosystem

### Frontend Integration
The Persistence Minter integrates with the XFuel frontend via Keplr wallet:

```typescript
import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";

// Connect Keplr
const offlineSigner = window.keplr.getOfflineSigner("core-1");
const client = await SigningCosmWasmClient.connectWithSigner(
  "https://rpc.core.persistence.one",
  offlineSigner
);

// Mint ibcTFUEL
await client.execute(
  userAddress,
  contractAddress,
  {
    verify_and_mint: {
      zk_proof: proof,
      amount: "1000000000000000000",
      recipient: userAddress
    }
  },
  "auto"
);
```

### Backend Integration
Monitor burn events for unwrap processing:

```typescript
// Listen for burn_and_unwrap events
const events = await client.searchTx([
  { key: "wasm.action", value: "burn_and_unwrap" }
]);

// Process unwrap:
// - Send 30% to RevSplitter
// - Flag 70% for LP reinvestment
```

## Deployment Status

| Contract | Testnet | Mainnet | Status |
|----------|---------|---------|--------|
| Persistence Minter | ⏳ Pending | ⏳ Pending | ✅ Ready |

## Security Considerations

1. **Audit**: Contracts should be audited before mainnet deployment
2. **Testing**: Thorough testing on testnet required
3. **Admin Keys**: Use multisig for admin operations
4. **Monitoring**: Set up alerts for unusual activity
5. **Rate Limiting**: Consider rate limits for minting operations

## Roadmap

### Phase 1: Testnet (Current)
- [x] Develop Persistence Minter contract
- [x] Write comprehensive tests
- [x] Create deployment documentation
- [ ] Deploy to Persistence testnet
- [ ] Integration testing with frontend
- [ ] Security review

### Phase 2: Mainnet
- [ ] External audit (recommended)
- [ ] Deploy to Persistence mainnet
- [ ] Set up monitoring and alerts
- [ ] Integration with production frontend

### Phase 3: Additional Contracts
- [ ] Stride Minter (similar to Persistence)
- [ ] Cross-chain bridge contracts
- [ ] Governance contracts

## Resources

### Documentation
- [CosmWasm Documentation](https://docs.cosmwasm.com/)
- [Persistence Documentation](https://docs.persistence.one/)
- [CW20 Spec](https://github.com/CosmWasm/cw-plus/blob/main/packages/cw20/README.md)

### Tools
- [CosmWasm IDE](https://ide.cosmwasm.com/)
- [Persistence Explorer](https://explorer.persistence.one/)
- [Keplr Wallet](https://www.keplr.app/)

### Community
- [XFuel Discord](https://discord.gg/xfuel)
- [Persistence Discord](https://discord.gg/persistence)
- [CosmWasm Discord](https://discord.gg/cosmwasm)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Write tests for new features
4. Ensure all tests pass: `cargo test`
5. Format code: `cargo fmt`
6. Run linter: `cargo clippy`
7. Submit a pull request

## License

MIT License - XFuelLab 2026

## Support

For questions or issues:
- GitHub Issues: https://github.com/xfuellab/xfuel-protocol
- Email: dev@xfuel.io
- Discord: [XFuel Community]




