# XFUEL Protocol

**Zero-Knowledge Bi-Directional Bridge for trustless TFUEL ↔ Cosmos LST swaps with automated yield optimization.**

Live: **[xfuel.app](https://xfuel.app)** (Theta Mainnet Beta)

[![Audit Status](https://img.shields.io/badge/audit-pending-yellow.svg)](docs/ZK_BRIDGE_IMPLEMENTATION.md)
[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)](https://github.com/XFuel-Lab/xfuel-protocol)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-v4.4-red.svg)](WHITEPAPER_v4.4.md)
[![ZK Bridge](https://img.shields.io/badge/ZK--VM-SP1-purple.svg)](sp1-prover/README.md)

---

## 📄 Whitepaper v4.4 — Bi-Directional ZK Bridge Edition

**XFuel Protocol: SP1 zkVM Bridge for TFUEL-Persistence LSTfi**

Read the complete technical whitepaper: **[WHITEPAPER_v4.4.md](WHITEPAPER_v4.4.md)**

**What's New in v4.4:**
- **Bi-directional bridge flow**: Secure withdrawals with 0.5% reverse fee
- **Reverse bridge implementation**: `burn_for_unwrap` + SP1 event proofs + `unwrapFromBurn`
- **FeeCollector.wasm**: Accumulates reverse bridge fees for protocol revenue
- **Nonce-based replay protection**: Per-user nonce tracking prevents double-spend attacks
- **Mock testing framework**: MOCK_MODE for governance validation without live ZK proving

**Whitepaper Highlights:**
- SP1 zkVM zero-knowledge bridge architecture (RISC-V → STARK → Groth16 wrapper)
- VaultFactory deposit system (Create2 deterministic vaults, 0.5% bridge fee both directions)
- CosmWasm contracts on Persistence (ZKVerifier, ibcTFUEL minter, FeeCollector)
- Phase B benchmarks (8.997s avg proving, 52.89 tx/min throughput, 11.6x batching speedup)
- IBC Channel-190 integration for post-mint Cosmos-internal routing
- XFuel Tokenomics (30/30/25/15 revenue split: BBB/LP/veXF/Treasury)
- Complete technical specifications & deployment roadmap

---

## 🚀 What is XFUEL?

XFUEL is a **zero-knowledge bi-directional bridge protocol** that enables trustless cross-chain TFUEL ↔ Cosmos LST swaps with automated yield optimization.

By leveraging SP1 zkVM proofs for cryptographic transaction validation and CosmWasm contracts on Persistence, XFUEL achieves secure cross-chain bridging (both deposits and withdrawals) while maintaining non-custodial security guarantees.

### Core Features

**Forward Bridge (Theta → Persistence):**
- 🔐 **Zero-Knowledge Deposits**: SP1 zkVM proofs validate deposits without trusting centralized relayers
- ⚡ **~11-12s Settlement**: ZK proof generation + verification + minting in ~11-12 seconds
- 📱 **Manual Send Flow**: Send TFUEL via QR code or copy/paste address — no browser extensions needed
- 💰 **Auto-Yield Optimization**: Automated routing to highest-yielding LSTs (planned Phase D)

**Reverse Bridge (Persistence → Theta):**
- 🔄 **Secure Withdrawals**: Burn ibcTFUEL with ZK proof-verified unwrap on Theta
- 🛡️ **Nonce Protection**: Per-user nonce tracking prevents replay attacks
- 💸 **0.5% Reverse Fee**: Sustainable revenue model, discourages spam attacks
- 📊 **FeeCollector Integration**: Accumulates fees for protocol revenue distribution (30/30/25/15 split)

**Universal:**
- 🔒 **Non-Custodial**: Users retain full control; smart contracts enforce security
- 🌐 **1:1 Cryptographic Peg**: ibcTFUEL ↔ TFUEL backed by locked collateral

---

## 📱 How It Works (ZK Bridge Flow)

### Forward Flow (Deposit TFUEL, Earn 30-50% APY)

1. **Select Your LST**: Choose your target Liquid Staking Token (stkTIA, stkATOM, etc.)
2. **Get Deposit Address**: Click "Show Deposit Address" to see QR code + vault address
3. **Send TFUEL**: Open your Theta Wallet, scan QR or paste address, send TFUEL to vault
4. **ZK Proof Generation**: Backend detects deposit, generates SP1 zkVM proof (~9s)
5. **Proof Verification**: Persistence ZKVerifier.wasm verifies proof (~100ms)
6. **ibcTFUEL Mint**: CW20 token minted 1:1 with locked TFUEL (awaiting governance whitelist)
7. **IBC Transfer**: ibcTFUEL routed via IBC channel-190 (post-mint Cosmos-internal, planned)
8. **Auto-Swap & Stake**: Automated swap to target LST + staking (planned Phase D)

### Reverse Flow (Withdraw TFUEL)

1. **Burn ibcTFUEL**: Call `burn_for_unwrap(amount, theta_recipient)` on Persistence
2. **Fee Deduction**: 0.5% fee sent to FeeCollector, remaining 99.5% burned
3. **Event Emission**: Contract emits burn event with SP1-readable attributes (nonce, amount, recipient)
4. **Backend Detection**: Persistence listener detects burn event (~2s)
5. **ZK Proof Generation**: SP1 Event Prover generates ZK proof of burn (~9s)
6. **Unwrap Execution**: Backend calls `unwrapFromBurn(recipient, amount, sp1Proof)` on VaultFactory
7. **TFUEL Release**: VaultFactory validates proof, releases TFUEL to recipient wallet (~12-15s total)

**Current Status:** Phase C Complete — Bi-directional ready, awaiting governance whitelist  
**Total time (when live):** ~11-12 seconds (forward), ~12-15 seconds (reverse)  
**No wallet connect, no extensions, no browser dependencies** — just send and receive.

### Technical Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                    XFUEL BI-DIRECTIONAL BRIDGE v4.4                     │
└────────────────────────────────────────────────────────────────────────┘

FORWARD FLOW (Theta → Persistence):
  Theta VaultFactory → SP1 zkVM Proof → CosmWasm Verify → ibcTFUEL Mint
     (Create2 vault)       (~9s)            (~100ms)        (1:1 peg)

REVERSE FLOW (Persistence → Theta):
  ibcTFUEL Burn → FeeCollector (0.5%) → SP1 Event Proof → VaultFactory Unwrap
   (burn_for_unwrap)   (fee routing)        (~9s)            (TFUEL release)
```

---

## 🔐 ZK Bridge Architecture

XFUEL's Zero-Knowledge bridge achieves trustless cross-chain transfers using SP1 zkVM cryptographic proofs instead of trusted intermediaries.

### Core Components

#### 1. **Theta Layer** (EVM Smart Contracts)
- **VaultFactory**: `0xB0a266...` - Create2 deterministic vaults for deposits (0.5% bridge fee)
- **VaultFactory.unwrapFromBurn()**: Validates SP1 proof of Persistence burn, releases TFUEL
- **RevenueSplitterHybridV2**: Revenue distribution (30/30/25/15 split to BBB/LP/veXF/Treasury)

#### 2. **ZK Proof Layer** (Off-Chain Backend)
- **Forward Listener**: Monitors Theta deposits every 2 seconds (`backend/theta-bridge/src/listener.js`)
- **Reverse Listener**: Monitors Persistence burns for `burn_for_unwrap` events (`backend/theta-bridge/src/persistence-listener.js`)
- **SP1 zkVM Prover**: Generates RISC-V-based ZK proofs (~9s, Phase B: 8.997s avg)
- **Relayer Service**: Submits proofs to Persistence chain + triggers Theta unwraps
- **Production Stack**: Rust RISC-V program → STARK → Groth16 wrapper (transparent setup)

#### 3. **Persistence Layer** (CosmWasm Contracts)
- **ZKVerifier.wasm**: `persistence1...` - Verifies SP1 proofs in ~100ms constant time
- **ibcTFUEL.wasm**: CW20 token minted 1:1 with locked TFUEL (awaiting governance whitelist)
  - Forward: Mints on ZK proof verification
  - Reverse: `burn_for_unwrap(amount, theta_recipient)` with 0.5% fee + nonce protection
- **FeeCollector.wasm**: Accumulates 0.5% reverse bridge fees for protocol revenue
- **IBC Channel-190**: Post-mint Cosmos-internal routing (planned Phase D)

### Settlement Flow

```
┌─────────────────────────────────────────────────────────────────┐
│              XFUEL BI-DIRECTIONAL ZK BRIDGE FLOW                │
└─────────────────────────────────────────────────────────────────┘

FORWARD FLOW:
  Step 1: DEPOSIT
    ↓ User sends TFUEL to VaultFactory vault (Create2 deterministic address)
  Step 2: SP1 zkVM PROOF GENERATION (~9s)
    ↓ Backend detects deposit → Generates SP1 proof (RISC-V → STARK → Groth16)
  Step 3: PROOF VERIFICATION (~100ms)
    ↓ Persistence ZKVerifier.wasm validates proof cryptographically
  Step 4: MINT (awaiting governance whitelist)
    ↓ ibcTFUEL minted 1:1 on Persistence
  Step 5: POST-MINT ROUTING (planned Phase D)
    ↓ IBC channel-190 → Automated swap to target LST → Auto-stake

REVERSE FLOW:
  Step 1: BURN FOR UNWRAP
    ↓ User calls burn_for_unwrap(amount, theta_recipient) on ibcTFUEL.wasm
  Step 2: FEE COLLECTION (0.5%)
    ↓ Fee sent to FeeCollector.wasm, 99.5% burned from user balance
  Step 3: EVENT EMISSION
    ↓ Contract emits burn event with SP1 attributes (nonce, amount, recipient)
  Step 4: SP1 EVENT PROOF GENERATION (~9s)
    ↓ Backend detects event → Generates ZK proof of burn
  Step 5: UNWRAP EXECUTION (~100ms verify)
    ↓ VaultFactory validates SP1 proof + nonce, releases TFUEL to recipient

Total: ~11-12 seconds (forward), ~12-15 seconds (reverse) when fully deployed
```

### Deployment Status

**Current Phase:** 🟢 **Phase C Complete - Bi-Directional Ready for Mainnet**

| Component | Status | Notes |
|-----------|--------|-------|
| Theta Contracts | ✅ Deployed | VaultFactory, RevenueSplitter live |
| SP1 zkVM Prover | ✅ Operational | ~9s proving (Phase B: 8.997s avg) |
| Backend Services | ✅ Running | SP1 batching enabled (11.6x speedup) |
| Forward Flow | ✅ Tested | Phase B: 52.89 tx/min throughput |
| Reverse Flow | ✅ Implemented | burn_for_unwrap + unwrapFromBurn ready |
| FeeCollector | ✅ Built | Accumulates 0.5% reverse fees |
| CosmWasm Contracts | ⏳ Pending | Awaiting governance approval |
| Full E2E Flow | ⏳ Phase D | Mainnet launch Q2 2026 |

**Latest Deployment Transaction:**  
[TX: 1640372708F6E57D9FEB1006368B106BF7C18BDB056A471F5A98CB6878A6E1D9](https://explorer.thetatoken.org/tx/0x1640372708F6E57D9FEB1006368B106BF7C18BDB056A471F5A98CB6878A6E1D9)

### Live Contract Addresses

#### Theta Mainnet (Chain ID: 361)
```
VaultFactory:       0xB0a26600074dADC69186632a1B8dFd7c3146Ce56  (Main deposit + unwrap contract)
RevenueSplitter:    0x1C4CEbbb4Cfa7fdb546424F21CF706c48C478EE6  (30/30/25/15 splits)
```

#### Persistence Mainnet (core-1)
```
ZKVerifier:         persistence1...  (Proof verification - awaiting whitelist)
ibcTFUEL:           persistence1...  (CW20 token - awaiting whitelist)
FeeCollector:       persistence1...  (0.5% reverse fee accumulator - awaiting whitelist)
IBC Channel:        channel-190      (Post-mint Cosmos-internal routing)
```

**Note:** IBC Channel-190 is for post-mint transfers within the Cosmos ecosystem. Theta blockchain does not have native IBC support; the bridge uses VaultFactory + ZK proofs + CosmWasm minter.

---

## 🗺️ Roadmap

### Phase C: Governance Prep ✅ Complete (Feb 6, 2026)

**Status:** Bi-directional bridge implementation complete, ready for governance vote

- ✅ Reverse bridge implementation (burn_for_unwrap + unwrapFromBurn)
- ✅ FeeCollector.wasm deployment
- ✅ SP1 event attribute integration
- ✅ Nonce-based replay protection
- ✅ Backend persistence-listener implementation
- ✅ Mock testing framework (MOCK_MODE for governance demo)
- ✅ Whitepaper v4.4 (Bi-Directional ZK Bridge Edition)

### Phase D: Mainnet Launch 🎯 Q2 2026

**Prerequisites:**
- Persistence governance whitelist approval ([Proposal Template](docs/governance/PERSISTENCE_WHITELIST_PROPOSAL.md))
- CertiK audit completion (ZKVerifier, ibcTFUEL, FeeCollector, VaultFactory)
- Bug bounty program launch ($500K via Immunefi)

**Milestones:**
- Deploy mainnet contracts (both Theta and Persistence)
- Initialize with conservative caps (1 TFUEL forward, 0.1 TFUEL reverse)
- 2-week monitoring period (all transactions manual-reviewed)
- Gradual cap increase (1 → 10 → 100 → 1000 TFUEL)
- Full bi-directional flow enabled (no caps)

### Phase E: Ecosystem Growth 🚀 Q3-Q4 2026

**Goals:**
- $5M TVL milestone (unlocks 50% ecosystem incentives)
- Dexter UI integration (one-click TFUEL → stkXPRT)
- Multi-chain expansion (Osmosis, Cosmos Hub) if Persistence LP depth >$1M
- XF token liquidity mining (100M XF over 2 years)
- veXF governance activation (first vote: LP allocation strategy)

---

## 📋 Governance

XFuel Protocol is designed for progressive decentralization with community-driven governance:

**Current Governance Requirements:**
- Persistence governance whitelist approval for CosmWasm contracts (ZKVerifier, ibcTFUEL, FeeCollector)
- Detailed proposal template: **[docs/governance/PERSISTENCE_WHITELIST_PROPOSAL.md](docs/governance/PERSISTENCE_WHITELIST_PROPOSAL.md)**

**Future Governance (veXF):**
- Vote on LP allocation (which Dexter pools to deepen)
- Vote on fee structure (0.5% reverse fee adjustment)
- Vote on treasury expenditures (>$50K requires quorum)
- Emergency circuit breaker activation (requires 67% supermajority)

**veXF Multipliers:**
| Lock Duration | veXF Multiplier | Yield Boost | Voting Power |
|---------------|-----------------|-------------|--------------|
| 1 year        | 1x              | 1x          | 1x           |
| 2 years       | 2x              | 1.5x        | 2x           |
| 3 years       | 3x              | 2x          | 3x           |

---

## 🔐 Security & Risks

### Security Measures in Place

**Cryptographic Security:**
- ✅ SP1 zkVM cryptographic proofs (no trust assumptions)
- ✅ Transparent setup (no trusted ceremony risk)
- ✅ Nonce-based replay protection for reverse bridge
- ✅ Phase B E2E testing complete (8.997s avg proving, 52.89 tx/min)

**Contract Security:**
- ✅ Non-custodial architecture (users control keys)
- ✅ Smart contract access controls
- ✅ Circuit breakers (pause reverse bridge if >5% tx revert rate)
- ⏳ CertiK audit scheduled (Q2 2026, $150K budget)
- ⏳ $500K bug bounty program (Immunefi, launching Phase D)

**Operational Security:**
- ✅ Automated circuit breakers for emergency protection
- ✅ 1:1 cryptographic peg maintenance (ibcTFUEL ↔ TFUEL)
- ✅ Kubernetes deployment (auto-restart on failure)
- ✅ Redis persistence (event queue survives restarts)
- ✅ 50-80% lower TFUEL costs via Theta Edge Cloud

### Risk Mitigations

**Reverse Bridge Risks:**
- **Nonce desync**: Backend queries on-chain nonce before each unwrap + retry logic
- **Backend downtime**: Event replay from checkpoint (24h coverage) + PagerDuty monitoring
- **FeeCollector accumulation**: Automated trigger at 100 ibcTFUEL + manual fallback
- **Bank run scenario**: 0.5% reverse fee discourages panic withdrawals + circuit breaker at >20% TVL/24h

**Smart Contract Risks:**
- **Bugs in contracts**: CertiK audit + formal verification + $500K bug bounty
- **Phased rollout**: 1 TFUEL cap Phase C → 10 TFUEL Phase D → uncapped Phase E

**ZK Proof Risks:**
- **Invalid proof acceptance**: Phase B testing (25/25 E2E tests passed, 0 invalid proofs)
- **Circuit breaker**: Auto-pause if >1% invalid proofs detected

### Pre-Audit Status

⚠️ **IMPORTANT**: This is a **beta launch** for traction validation.

- Contracts deployed for testing purposes
- Use at your own risk in beta phase
- **Full security audit planned post-traction** (CertiK, Q2 2026)
- Community testing feedback welcomed

---

## 🏗️ Tech Stack

### Frontend (Vite + React)
- **Framework**: Vite + React 18 + TypeScript
- **Styling**: TailwindCSS (cyberpunk neon theme)
- **Blockchain**: ethers.js v6, Theta Mainnet RPC
- **QR Codes**: `qrcode` package for deposit addresses
- **State**: Zustand (oracle/price data)

### Smart Contracts
- **Language**: Solidity 0.8.22 (Theta), Rust (CosmWasm for Persistence)
- **Network**: Theta Mainnet (Chain ID: 361) + Persistence (core-1)
- **Core Contracts**:
  - `VaultFactory.sol` - Create2 deterministic vaults, deposit + unwrap management (Theta)
  - `RevenueSplitterHybridV2.sol` - Fee distribution (30/30/25/15) (Theta)
  - `ZKVerifier.wasm` - SP1 proof verification (Persistence)
  - `ibcTFUEL.wasm` - CW20 token contract with burn_for_unwrap (Persistence)
  - `FeeCollector.wasm` - 0.5% reverse fee accumulator (Persistence)

### Backend Services
- **Theta Listener**: Monitors Theta blockchain for deposits (`backend/theta-bridge/src/listener.js`)
- **Persistence Listener**: Monitors Persistence for `burn_for_unwrap` events (`backend/theta-bridge/src/persistence-listener.js`)
- **SP1 zkVM Prover**: Generates ZK proofs using SP1 RISC-V (`sp1-prover/program/`, hosted prover at port 8080)
- **Persistence Relayer**: Submits proofs to ZKVerifier.wasm on Persistence
- **Reverse-Burn Handler**: Triggers Theta unwrap transactions after burn detection

---

## 📦 Repo Structure

```
xfuel-protocol/
├── src/                          # Frontend (Vite + React)
│   ├── components/               # React components
│   │   ├── ManualDepositCard.tsx   # QR code + address display
│   │   ├── SimpleSwapCard.tsx      # Manual deposit UI
│   │   └── ...
│   ├── config/                   # Chain config, ABIs
│   ├── utils/                    # Helpers
│   │   └── reverseBridgeClient.ts  # Reverse bridge interaction
│   └── App.tsx                   # Main app (manual deposit flow)
├── contracts/                    # Solidity contracts
│   ├── VaultFactory.sol         # Create2 vaults + deposits + unwrap
│   ├── SubVault.sol             # Individual vault logic
│   ├── RevenueSplitterHybridV2.sol  # Revenue distribution
│   └── ...
├── cosmwasm-contracts/           # CosmWasm contracts (Persistence)
│   ├── zk-verifier/             # SP1 proof verification
│   ├── persistence-minter/       # ibcTFUEL CW20 token + burn_for_unwrap
│   └── fee-collector/            # 0.5% reverse fee accumulator
├── sp1-prover/                   # SP1 prover deployment
│   ├── program/                 # Rust RISC-V circuit (src/main.rs)
│   └── host/                    # Prover host binary
├── backend/theta-bridge/         # Backend service
│   ├── src/
│   │   ├── listener.js          # Theta deposit monitoring (forward)
│   │   ├── persistence-listener.js  # Persistence burn monitoring (reverse)
│   │   ├── sp1-prover-client.js # SP1 proof generation client
│   │   └── ...
│   └── ...
├── scripts/                      # Deployment scripts
├── test/                         # Contract tests
│   ├── VaultFactory.test.cjs    # VaultFactory unit tests
│   ├── ReverseBridge.Integration.test.cjs  # Reverse bridge E2E
│   └── ...
├── legacy-archive/               # Pre-v4.4 legacy code (cleaned up Feb 2026)
├── docs/                         # Documentation
│   ├── governance/              # Governance proposals
│   │   └── PERSISTENCE_WHITELIST_PROPOSAL.md
│   └── ...
├── WHITEPAPER_v4.4.md           # Canonical whitepaper
└── README.md                    # This file
```

**Note:** The `legacy-archive/` folder contains pre-v4.4 code that was refactored during the bi-directional bridge implementation (Feb 2026). See [cleanup/legacy-code-removal](https://github.com/XFuel-Lab/xfuel-protocol/tree/cleanup/legacy-code-removal) branch for details.

---

## 🛠️ Development Setup

### Prerequisites
- Node.js 20+ and npm 10+
- For CosmWasm: Rust toolchain + wasm32 target
- For contracts: Hardhat

### Frontend

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Run tests
npm test
```

**More Setup Guides:**
- [Local Dev Setup](docs/guides/LOCAL_DEV_SETUP.md) - Complete development environment
- [Backend Setup](backend/theta-bridge/README.md) - Backend service configuration

### Smart Contracts (Theta)

```bash
# Compile contracts
npx hardhat compile

# Run tests
npx hardhat test

# Deploy to Theta Mainnet
./scripts/deploy-mainnet.sh
```

### CosmWasm Contracts (Persistence)

```bash
# Build ibcTFUEL minter (with burn_for_unwrap)
cd cosmwasm-contracts/persistence-minter
cargo build --release --target wasm32-unknown-unknown

# Build FeeCollector
cd cosmwasm-contracts/fee-collector
cargo build --release --target wasm32-unknown-unknown

# Optimize WASM (production)
docker run --rm -v "$(pwd)":/code \
  --mount type=volume,source="$(basename "$(pwd)")_cache",target=/target \
  cosmwasm/optimizer:0.15.0
```

### Backend Service

```bash
cd backend/theta-bridge

# Install dependencies
npm install

# Start in development mode
npm run dev

# Start with PM2 (production)
pm2 start ecosystem.config.cjs
```

### Mock Testing (Governance Prep)

For governance validation without live ZK proving, use MOCK_MODE:

```bash
# Clone and build WASM contracts
cd cosmwasm-contracts/persistence-minter
cargo build --release --target wasm32-unknown-unknown

# Instantiate with MOCK_MODE
persistenced tx wasm instantiate $CODE_ID \
  '{"name":"IBC Theta Fuel","symbol":"IBCTFUEL",...,"mock_mode":true}' \
  --from $ADMIN --chain-id core-1 --gas auto

# Run mock tests (skips ZK verification, logs "MOCK MINT")
npm run test:mock

# Backend mock mode (emits mock SP1 attributes)
export MOCK_MODE=true
npm run dev
```

**Mock Testing Documentation:**
- [Mock Testing Plan](MOCK_TESTING_PLAN.md) - Complete mock testing strategy
- [Mock Testing Complete](MOCK_TESTING_COMPLETE.md) - Results and findings

---

## 🚢 Deployment

### Frontend (Vercel)
```bash
npm run build
vercel --prod
```

### Contracts (Theta Mainnet)
```bash
# Set THETA_MAINNET_PRIVATE_KEY in .env.local
./scripts/deploy-mainnet.sh
```

### Backend (AWS/VPS)
```bash
cd backend/theta-bridge
pm2 start ecosystem.config.cjs
```

**Detailed Deployment Guides:**
- [Mainnet Deployment Script](MAINNET_DEPLOYMENT_SCRIPT.md) - Step-by-step mainnet deployment
- [Reverse Bridge Deployment Guide](REVERSE_BRIDGE_DEPLOYMENT_GUIDE.md) - Reverse bridge setup

---

## 🎨 Design Philosophy

**Cyberpunk Neon Aesthetic** — Purple/cyan gradients, glassmorphism cards, neon glows, and a retro-futuristic vibe.

**Manual-First UX** — No wallet connect modals, no extension popups. Just QR codes and addresses for a universal, mobile-friendly experience.

**Trustless by Design** — ZK proofs > multisigs, transparent setup > trusted ceremonies, on-chain settlement > off-chain coordination.

---

## 📝 Contributing

We welcome contributions from the community! XFuel Protocol is open-source and thrives on developer collaboration.

**Focus Areas:**
- Frontend UI polish (cyberpunk neon theme enhancements)
- CosmWasm contract optimization (gas efficiency)
- SP1 proof optimization (faster proving times)
- Documentation improvements (tutorials, guides)
- Testing (unit tests, integration tests, E2E tests)

**Before Contributing:**
1. Read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines
2. Check [GitHub Issues](https://github.com/XFuel-Lab/xfuel-protocol/issues) for open tasks
3. Join our community discussions
4. Review the [Whitepaper v4.4](WHITEPAPER_v4.4.md) for technical context

**Development Workflow:**
```bash
# Fork the repo
git clone https://github.com/YOUR_USERNAME/xfuel-protocol.git

# Create feature branch
git checkout -b feature/your-feature-name

# Make changes, test locally
npm run test

# Commit with descriptive message
git commit -m "feat: add reverse bridge UI component"

# Push and create PR
git push origin feature/your-feature-name
```

**Contribution Recognition:**
- Contributors listed in project credits
- Active contributors invited to governance discussions
- Top contributors eligible for XF token rewards (post-mainnet)

---

## 📞 Community & Support

- **Website**: [xfuel.app](https://xfuel.app)
- **GitHub**: [github.com/XFuel-Lab/xfuel-protocol](https://github.com/XFuel-Lab/xfuel-protocol)
- **Documentation**: [docs/README.md](docs/README.md)
- **Whitepaper**: [WHITEPAPER_v4.4.md](WHITEPAPER_v4.4.md)
- **Security**: Report vulnerabilities to security@xfuel.app
- **Partnerships**: partnerships@xfuel.app
- **Governance**: [Persistence Forum](https://forum.persistence.one)

---

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

## 🔗 Quick Links

**📖 Documentation:**
- [Documentation Hub](docs/README.md) - All guides and docs
- [ZK Bridge Implementation](docs/ZK_BRIDGE_IMPLEMENTATION.md) - Technical details
- [Whitepaper v4.4](WHITEPAPER_v4.4.md) - Complete architecture

**🔧 For Developers:**
- [Local Dev Setup](docs/guides/LOCAL_DEV_SETUP.md) - Development environment
- [Contributing Guide](CONTRIBUTING.md) - Contribution guidelines
- [Mock Testing Plan](MOCK_TESTING_PLAN.md) - Testing strategy

**🚀 For Operators:**
- [Backend Deployment](backend/theta-bridge/README.md) - Backend service setup
- [SP1 Prover Deployment](sp1-prover/DEPLOY_ON_EDGECLOUD.md) - Prover infrastructure
- [Mainnet Deployment Script](MAINNET_DEPLOYMENT_SCRIPT.md) - Full deployment guide

**🏛️ For Governance:**
- [Persistence Whitelist Proposal](docs/governance/PERSISTENCE_WHITELIST_PROPOSAL.md) - Governance template
- [Roadmap](#-roadmap) - Project phases and milestones

---

Built with ⚡ by the XFUEL team.
