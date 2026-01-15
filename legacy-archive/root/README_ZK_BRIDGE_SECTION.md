# README.md - ZK Bridge Section Update

Add this section after the "How It Works" section (around line 39) in README.md:

---

## 🔐 ZK Bridge Architecture

XFUEL's Zero-Knowledge bridge achieves trustless cross-chain transfers using cryptographic proofs instead of trusted intermediaries.

### Core Components

#### 1. **Theta Layer** (EVM Smart Contracts)
- **VaultFactory**: `0xB0a266...` - Manages deposit vaults
- **XFUELRouter**: Swap routing & fee collection
- **RevenueSplitter**: 4-way distribution (30% BBB, 30% LP, 25% veXF, 15% Treasury)
- **TreasuryILBackstop**: Impermanent loss insurance

#### 2. **ZK Proof Layer** (Off-Chain Backend)
- **Backend Listener**: Monitors Theta deposits every 2 seconds
- **Proof Generator**: Circom circuits with Groth16 ZK-SNARKs (~1.5s generation)
- **Relayer Network**: Submits proofs to Persistence chain

#### 3. **Persistence Layer** (CosmWasm Contracts)
- **ZKVerifier.wasm**: `persistence1...` - Verifies ZK proofs in ~50ms constant time
- **ibcTFUEL.wasm**: CW20 token minted 1:1 with locked TFUEL
- **IBC Channel-190**: Native Cosmos interoperability

### Settlement Flow (Sub-4 Seconds)

```
┌─────────────────────────────────────────────────────────────────┐
│                     XFUEL ZK BRIDGE FLOW                        │
└─────────────────────────────────────────────────────────────────┘

Step 1: DEPOSIT (2-6s)
  ↓
  User sends TFUEL to VaultFactory (0xB0a266...)
  ↓
Step 2: ZK PROOF GENERATION (1.5s)
  ↓
  Backend detects deposit → Generates Groth16 proof
  ↓
Step 3: PROOF VERIFICATION (0.5s)
  ↓
  Persistence ZKVerifier validates proof cryptographically
  ↓
Step 4: IBC TRANSFER (0.5s)
  ↓
  ibcTFUEL minted 1:1 → Transferred via IBC channel-190
  ↓
Step 5: LST SWAP + STAKE (1s)
  ↓
  Automated swap to target LST (stkTIA, stkATOM, etc.) → Auto-stake

Total: < 4 seconds from deposit to staked LST
```

### Live Contract Addresses

#### Theta Mainnet (Chain ID: 361)
```
VaultFactory:      0xB0a266...  (Main deposit contract)
XFUELRouter:       0x...        (Swap routing)
RevenueSplitter:   0x...        (Revenue distribution)
TreasuryBackstop:  0x...        (IL insurance)
```

#### Persistence Mainnet (core-1)
```
ZKVerifier:        persistence1...  (Proof verification)
ibcTFUEL:          persistence1...  (CW20 token)
IBC Channel:       channel-190      (Theta ↔ Persistence)
```

### Deployment Summaries

**CosmWasm Contracts** (`cosmwasm/`)
- `zk-verifier/` - ZK-SNARK proof verifier (Groth16)
- `ibc-tfuel-minter/` - ibcTFUEL token contract (CW20)

**Deployment Scripts** (`scripts/`)
- `build-cosmwasm-contracts.sh` - Compile Rust contracts
- `optimize-cosmwasm.sh` - WASM optimization (reduces size by ~80%)
- `deploy-zkbridge.cjs` - Deploy ZK bridge components
- `test-cosmwasm.sh` - Contract testing framework

### Pre-Audit Status

⚠️ **IMPORTANT**: This is a **minimal beta launch** for traction validation.

- Contracts are deployed for testing purposes
- Use at your own risk in beta phase
- **Full CertiK audit scheduled post-traction**
- Community testing feedback welcomed

**Security Measures in Place**:
- ZK-SNARK cryptographic proofs (no trust assumptions)
- Non-custodial architecture (users control keys)
- IBC protocol security (battle-tested Cosmos standard)
- Smart contract access controls
- Treasury backstop for IL protection

### Technical Documentation

**Whitepapers**:
- **Ferrari Hybrid Tokenomics (v3.0)**: [docs/XFUEL-Hybrid-Tokenomics-Whitepaper-v3.md](docs/XFUEL-Hybrid-Tokenomics-Whitepaper-v3.md) 🏎️
  - Complete ZK-SNARK architecture
  - Hybrid revenue splits (30/30/25/15)
  - Governance extras & veXF mechanics
  
- **ZK Bridge Technical (v2.0)**: [docs/whitepaper/XFUEL-ZK-Bridge-Whitepaper.md](docs/whitepaper/XFUEL-ZK-Bridge-Whitepaper.md)
  - Groth16 proof system details
  - IBC integration guide
  
- **Quick Reference**: [docs/XFUEL-FERRARI-QUICK-REF.md](docs/XFUEL-FERRARI-QUICK-REF.md)

**Implementation Guides**:
- [ZK_BRIDGE_DELIVERY_SUMMARY.md](ZK_BRIDGE_DELIVERY_SUMMARY.md) - Complete implementation overview
- [ZK_BRIDGE_QUICK_REFERENCE.md](ZK_BRIDGE_QUICK_REFERENCE.md) - Quick start guide
- [cosmwasm/README.md](cosmwasm/README.md) - CosmWasm contract details

---

