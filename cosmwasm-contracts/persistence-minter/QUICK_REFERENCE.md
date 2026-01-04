# 🚀 XFuel Persistence Minter - Quick Reference

## 📍 Location
`cosmwasm-contracts/persistence-minter/`

## ⚡ Quick Commands

### Build
```bash
cd cosmwasm-contracts/persistence-minter
cargo build                    # Development
cargo test                     # Run tests
./build.sh                     # Production (Docker)
```

### Deploy
```bash
# Store code
persistenceCore tx wasm store artifacts/persistence_minter.wasm --from deployer --gas auto -y

# Instantiate
persistenceCore tx wasm instantiate $CODE_ID \
  '{"name":"IBC Theta Fuel","symbol":"IBCTFUEL","decimals":18,"initial_balances":[],"mint_cap":null,"marketing":null,"verifier_address":"persistence1...","rev_splitter_address":"persistence1..."}' \
  --from deployer --label "XFuel-Minter-v1" --admin $ADMIN --gas auto -y
```

### Query
```bash
# Balance
persistenceCore query wasm contract-state smart $CONTRACT '{"balance":{"address":"persistence1..."}}' 

# Config
persistenceCore query wasm contract-state smart $CONTRACT '{"config":{}}'

# State
persistenceCore query wasm contract-state smart $CONTRACT '{"state":{}}'
```

## 📋 Key Files

| File                                 | Lines | Purpose                              |
| ------------------------------------ | ----- | ------------------------------------ |
| `src/contract.rs`                    | 461   | Main contract logic                  |
| `src/tests.rs`                       | 650+  | Integration tests (17+)              |
| `src/zk_verifier.rs`                 | 121   | ZK proof verification                |
| `COMPLETE_DEPLOYMENT_GUIDE.md`       | 450+  | Full deployment guide                |
| `INTEGRATION_EXAMPLES.md`            | 600+  | Backend/frontend code                |
| `README_ENHANCED.md`                 | 400+  | Technical documentation              |

## 🎯 Core Features

### VerifyAndMint
```rust
// Verifies ZK proof, mints ibcTFUEL, pre-funds 0.001 XPRT for new users
execute_verify_and_mint(zk_proof, amount, recipient)
```

### BurnAndUnwrap
```rust
// Burns tokens, 30% to RevSplitter, 70% to LP reinvest
execute_burn_and_unwrap(amount)
```

### Admin Controls
```rust
execute_pause()                           // Emergency stop
execute_unpause()                         // Resume
execute_set_verifier(address)             // Update ZK verifier
execute_delegate(validator, amount)       // LST staking
```

## 🧪 Tests

```bash
cargo test                                # All tests (17+)
cargo test test_verify_and_mint           # Specific test
cargo test -- --nocapture                 # With output
```

**Test Coverage:**
- ✅ Mint with ZK proof
- ✅ Replay protection
- ✅ Burn with revenue split
- ✅ Admin controls
- ✅ LST delegation
- ✅ Gas pre-funding
- ✅ Full lifecycle

## 📊 Gas Costs

| Operation      | Gas    | Cost (@0.025uxprt) |
| -------------- | ------ | ------------------ |
| VerifyAndMint  | 180k   | 0.0045 XPRT        |
| BurnAndUnwrap  | 120k   | 0.003 XPRT         |
| Transfer       | 80k    | 0.002 XPRT         |

## 🔗 Integration

### Backend (TypeScript)
```typescript
import { PersistenceMinter } from './persistence/minter';

const minter = new PersistenceMinter();
await minter.connect();
await minter.verifyAndMint(zkProof, amount, recipient);
```

### Frontend (React + Keplr)
```typescript
const { balance, burnAndUnwrap } = usePersistenceMinter();
await burnAndUnwrap("1000000000000000000");
```

## 🔒 Security

- ✅ Replay attack prevention (proof hash tracking)
- ✅ Pausable contract
- ✅ Admin access control
- ✅ Mint cap enforcement
- ⚠️ Mock ZK verifier (needs real integration)

## 📚 Documentation

1. **COMPLETE_DEPLOYMENT_GUIDE.md** - Full deployment walkthrough
2. **INTEGRATION_EXAMPLES.md** - Complete code examples
3. **README_ENHANCED.md** - Technical deep-dive
4. **CONTRACT_SUMMARY.md** - Feature summary
5. **README.md** - Quick overview

## 🎯 Next Steps

1. ✅ Build & test locally
2. ✅ Deploy to testnet
3. ⚠️ Integrate real ZK verifier
4. ⚠️ Connect to backend
5. ⚠️ Security audit
6. ⚠️ Mainnet deployment

## 💡 Key Insights

- **Token**: ibcTFUEL (18 decimals)
- **Revenue Split**: 30% RevSplitter, 70% LP
- **Gas Funding**: 0.001 XPRT for new users
- **Replay Protection**: SHA-256 proof hashing
- **LST Integration**: Post-mint delegation
- **Tests**: 17+ passing (cw-multi-test)

## 🆘 Troubleshooting

**"Insufficient balance"**
```bash
persistenceCore tx bank send faucet $ADDRESS 10000000uxprt --chain-id test-core-1
```

**"Contract paused"**
```bash
persistenceCore tx wasm execute $CONTRACT '{"unpause":{}}' --from admin -y
```

**"Invalid proof"**
- Check proof format: `{proof_data, public_inputs, verification_key}`
- Verify public_inputs[0] = amount
- Verify public_inputs[1] = recipient_hash

## 📞 Support

- **Docs**: `cosmwasm-contracts/persistence-minter/*.md`
- **Code**: `cosmwasm-contracts/persistence-minter/src/`
- **XFuel**: https://xfuel.app

---

**Built by XFuelLab** | Sub-4s TFUEL ↔ Cosmos LST swaps



