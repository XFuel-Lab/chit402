# XFUEL Protocol

**Zero-Knowledge bridge for trustless TFUEL → Cosmos LST swaps with automated yield optimization.**

Live: **[xfuel.app](https://xfuel.app)** (Theta Mainnet Beta)

[![Audit Status](https://img.shields.io/badge/audit-pending-yellow.svg)](docs/ZK_BRIDGE_IMPLEMENTATION.md)
[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)](https://github.com/XFuel-Lab/xfuel-protocol)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-v4.3-red.svg)](docs/WHITEPAPER.md)
[![ZK Bridge](https://img.shields.io/badge/ZK--VM-SP1-purple.svg)](sp1-program/README.md)

---

## 📄 Whitepaper v4.3

**XFuel Protocol: SP1 zkVM Bridge for TFUEL-Persistence LSTfi**

Read the complete technical whitepaper: **[docs/WHITEPAPER.md](docs/WHITEPAPER.md)**

**What's Inside:**
- SP1 zkVM zero-knowledge bridge architecture (RISC-V → STARK → Groth16 wrapper)
- VaultFactory deposit system (Create2 deterministic vaults, 0.5% bridge fee)
- CosmWasm contracts on Persistence (ZKVerifier, ibcTFUEL minter)
- Phase B benchmarks (8.997s avg proving, 52.89 tx/min throughput, 11.6x batching speedup)
- IBC Channel-190 integration for post-mint Cosmos-internal routing
- Complete technical specifications & deployment roadmap

---

## 🚀 What is XFUEL?

XFUEL is a **zero-knowledge bridge protocol** that enables trustless cross-chain TFUEL → Cosmos LST swaps with automated yield optimization.

By leveraging SP1 zkVM proofs for cryptographic transaction validation and CosmWasm contracts on Persistence, XFUEL achieves secure cross-chain bridging while maintaining non-custodial security guarantees.

### Core Features

- **📱 Manual Send Flow**: Send TFUEL via QR code or copy/paste address — no browser extensions needed
- **🔐 Zero-Knowledge Bridge**: SP1 zkVM proofs validate deposits without trusting centralized relayers
- **⚡ ~11-12s Settlement**: ZK proof generation + verification + minting in ~11-12 seconds
- **💰 Auto-Yield Optimization**: Automated routing to highest-yielding LSTs (planned Phase D)
- **🔒 Non-Custodial**: Users retain full control; smart contracts enforce security

---

## 📱 How It Works (ZK Bridge Flow)

1. **Select Your LST**: Choose your target Liquid Staking Token (stkTIA, stkATOM, etc.)
2. **Get Deposit Address**: Click "Show Deposit Address" to see QR code + vault address
3. **Send TFUEL**: Open your Theta Wallet, scan QR or paste address, send TFUEL to vault
4. **ZK Proof Generation**: Backend detects deposit, generates SP1 zkVM proof (~9s)
5. **Proof Verification**: Persistence ZKVerifier.wasm verifies proof (~100ms)
6. **ibcTFUEL Mint**: CW20 token minted 1:1 with locked TFUEL (awaiting governance whitelist)
7. **IBC Transfer**: ibcTFUEL routed via IBC channel-190 (post-mint Cosmos-internal, planned)
8. **Auto-Swap & Stake**: Automated swap to target LST + staking (planned Phase D)

**Current Status:** Phase C - Awaiting Persistence governance whitelist approval  
**Total time (when live):** ~11-12 seconds from deposit to staked LST  
**No wallet connect, no extensions, no browser dependencies** — just send and receive.

### Technical Architecture

```
Theta VaultFactory → SP1 zkVM Proof → CosmWasm Verify → ibcTFUEL Mint → [IBC Transfer → LST Swap]*
   (Create2 vault)      (~9s)             (~100ms)         (awaiting)      (*planned Phase D)
```

---

## 🔐 ZK Bridge Architecture

XFUEL's Zero-Knowledge bridge achieves trustless cross-chain transfers using SP1 zkVM cryptographic proofs instead of trusted intermediaries.

### Core Components

#### 1. **Theta Layer** (EVM Smart Contracts)
- **VaultFactory**: `0xB0a266...` - Create2 deterministic vaults for deposits (0.5% bridge fee)
- **RevenueSplitterHybridV2**: Revenue distribution (30/30/25/15 split to treasury/LP/buyback/innovation)

#### 2. **ZK Proof Layer** (Off-Chain Backend)
- **Backend Listener**: Monitors Theta deposits every 2 seconds (`backend/theta-bridge/`)
- **SP1 zkVM Prover**: Generates RISC-V-based ZK proofs (~9s, Phase B: 8.997s avg)
- **Relayer Service**: Submits proofs to Persistence chain
- **Production Stack**: Rust RISC-V program → STARK → Groth16 wrapper (transparent setup)

#### 3. **Persistence Layer** (CosmWasm Contracts)
- **ZKVerifier.wasm**: `persistence1...` - Verifies SP1 proofs in ~100ms constant time
- **ibcTFUEL.wasm**: CW20 token minted 1:1 with locked TFUEL (awaiting governance whitelist)
- **IBC Channel-190**: Post-mint Cosmos-internal routing (planned Phase D)

### Settlement Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     XFUEL ZK BRIDGE FLOW                        │
└─────────────────────────────────────────────────────────────────┘

Step 1: DEPOSIT
  ↓
  User sends TFUEL to VaultFactory vault (Create2 deterministic address)
  ↓
Step 2: SP1 zkVM PROOF GENERATION (~9s)
  ↓
  Backend detects deposit → Generates SP1 proof (RISC-V → STARK → Groth16 wrapper)
  ↓
Step 3: PROOF VERIFICATION (~100ms)
  ↓
  Persistence ZKVerifier.wasm validates proof cryptographically
  ↓
Step 4: MINT (awaiting governance whitelist)
  ↓
  ibcTFUEL minted 1:1 on Persistence
  ↓
Step 5: POST-MINT ROUTING (planned Phase D)
  ↓
  IBC channel-190 → Automated swap to target LST → Auto-stake

Total: ~11-12 seconds (when fully deployed)
```

### Deployment Status

**Current Phase:** 🟡 **Phase C - Awaiting Persistence Governance Whitelist**

| Component | Status | Notes |
|-----------|--------|-------|
| Theta Contracts | ✅ Deployed | VaultFactory, RevenueSplitter live |
| SP1 zkVM Prover | ✅ Operational | ~9s proving (Phase B: 8.997s avg) |
| Backend Services | ✅ Running | SP1 batching enabled (11.6x speedup) |
| CosmWasm Contracts | ⏳ Pending | Awaiting governance approval |
| Full E2E Flow | ✅ Tested | Phase B: 52.89 tx/min throughput |

**Latest Deployment Transaction:**  
[TX: 1640372708F6E57D9FEB1006368B106BF7C18BDB056A471F5A98CB6878A6E1D9](https://explorer.thetatoken.org/tx/0x1640372708F6E57D9FEB1006368B106BF7C18BDB056A471F5A98CB6878A6E1D9)

### Live Contract Addresses

#### Theta Mainnet (Chain ID: 361)
```
VaultFactory:       0xB0a26600074dADC69186632a1B8dFd7c3146Ce56  (Main deposit contract)
RevenueSplitter:    0x1C4CEbbb4Cfa7fdb546424F21CF706c48C478EE6  (30/30/25/15 splits)
```

#### Persistence Mainnet (core-1)
```
ZKVerifier:         persistence1...  (Proof verification - awaiting whitelist)
ibcTFUEL:           persistence1...  (CW20 token - awaiting whitelist)
IBC Channel:        channel-190      (Post-mint Cosmos-internal routing)
```

**Note:** IBC Channel-190 is for post-mint transfers within the Cosmos ecosystem. Theta blockchain does not have native IBC support; the bridge uses VaultFactory + ZK proofs + CosmWasm minter.

### Quick Links

**📖 Documentation:**
- [Documentation Hub](docs/README.md) - All guides and docs
- [ZK Bridge Implementation](docs/ZK_BRIDGE_IMPLEMENTATION.md) - Technical details
- [Whitepaper](docs/WHITEPAPER.md) - Complete architecture

**🔧 For Developers:**
- [Local Dev Setup](docs/guides/LOCAL_DEV_SETUP.md) - Development environment
- [Contributing Guide](CONTRIBUTING.md) - Contribution guidelines

**🚀 For Operators:**
- [Backend Deployment](backend/theta-bridge/README.md) - Backend service setup
- [SP1 Prover Deployment](sp1-prover/DEPLOY_ON_EDGECLOUD.md) - Prover infrastructure

### Pre-Audit Status

⚠️ **IMPORTANT**: This is a **beta launch** for traction validation.

- Contracts deployed for testing purposes
- Use at your own risk in beta phase
- **Full security audit planned post-traction**
- Community testing feedback welcomed

**Security Measures in Place**:
- SP1 zkVM cryptographic proofs (no trust assumptions)
- Non-custodial architecture (users control keys)
- Smart contract access controls
- Phase B E2E testing complete (8.997s avg proving, 52.89 tx/min)

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
  - `VaultFactory.sol` - Create2 deterministic vaults, deposit management (Theta)
  - `RevenueSplitterHybridV2.sol` - Fee distribution (30/30/25/15) (Theta)
  - `ZKVerifier.wasm` - SP1 proof verification (Persistence)
  - `ibcTFUEL.wasm` - CW20 token contract (Persistence)

### Backend Services
- **Theta Listener**: Monitors Theta blockchain for deposits (`backend/theta-bridge/src/listener.js`)
- **SP1 zkVM Prover**: Generates ZK proofs using SP1 RISC-V (`sp1-program/`, hosted prover at port 8080)
- **Persistence Relayer**: Submits proofs to ZKVerifier.wasm on Persistence
- **Reverse-Burn Listener**: Monitors Persistence for unwrap events (planned Phase D: `persistence-listener.js`, `yield-unwrapper.js`)

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
│   └── App.tsx                   # Main app (manual deposit flow)
├── contracts/                    # Solidity contracts
│   ├── VaultFactory.sol         # Create2 vaults + deposits
│   ├── SubVault.sol             # Individual vault logic
│   ├── RevenueSplitterHybridV2.sol  # Revenue distribution
│   └── ...
├── cosmwasm-contracts/           # CosmWasm contracts (Persistence)
│   ├── zk-verifier/             # SP1 proof verification
│   └── ibcTFUEL-minter/         # CW20 token minter
├── sp1-program/                  # SP1 zkVM proof program (Rust)
├── sp1-prover/                   # SP1 prover deployment
├── backend/theta-bridge/         # Backend service
│   ├── src/
│   │   ├── listener.js          # Theta deposit monitoring
│   │   ├── sp1-prover-client.js # SP1 proof generation
│   │   ├── persistence-listener.js  # Unwrap monitoring (Phase D)
│   │   └── yield-unwrapper.js       # Revenue routing (Phase D)
│   └── ...
├── scripts/                      # Deployment scripts
├── test/                         # Contract tests (VaultFactory, ZK bridge)
└── docs/                         # Documentation
```

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
cd cosmwasm-contracts/zk-verifier
cargo build --release --target wasm32-unknown-unknown
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

---

## 🎨 Design Philosophy

**Cyberpunk Neon Aesthetic** — Purple/cyan gradients, glassmorphism cards, neon glows, and a retro-futuristic vibe.

**Manual-First UX** — No wallet connect modals, no extension popups. Just QR codes and addresses for a universal, mobile-friendly experience.

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

---

## 📝 Manual Send Flow Notes

- **No WalletConnect**: Wallet connect features removed for simpler UX
- **QR Codes**: `ManualDepositCard` generates QR codes for vault addresses
- **VaultFactory**: Deposits go to Create2 deterministic vaults (0.5% bridge fee)
- **Mobile-Friendly**: Works on any device with a Theta Wallet — scan QR, send, done

---

## 🔐 Security

- ZK bridge uses SP1 zkVM cryptographic proofs (no trust assumptions)
- Non-custodial architecture (users control keys)
- Smart contract access controls
- Phase B E2E testing complete (8.997s proving, 52.89 tx/min)
- Beta launch - full audit planned post-traction

---

## 📄 License

MIT

---

## 🤝 Contributing

PRs welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

**Focus areas:**
- Frontend UI polish
- CosmWasm contract optimization
- SP1 proof optimization
- Documentation improvements

---

## 📞 Community & Support

- **Website**: [xfuel.app](https://xfuel.app)
- **GitHub**: [github.com/XFuel-Lab/xfuel-protocol](https://github.com/XFuel-Lab/xfuel-protocol)
- **Security**: Report vulnerabilities to security@xfuel.app

---

Built with ⚡ by the XFUEL team.
