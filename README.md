# XFUEL Protocol

**Sub-4s settlement rail for TFUEL ↔ Cosmos LST atomic swaps & yield automation.**

Live: **[xfuel.app](https://xfuel.app)** (Theta Mainnet)

[![Audit Status](https://img.shields.io/badge/audit-pending-yellow.svg)](docs/overhaul/ZK_OVERHAUL_SUMMARY.md)
[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)](https://github.com/XFuel-Lab/xfuel-protocol)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-v3.0%20Ferrari-red.svg)](docs/XFUEL-FERRARI-QUICK-REF.md)
[![ZK Bridge](https://img.shields.io/badge/ZK--SNARK-Groth16-purple.svg)](docs/overhaul/ZK_OVERHAUL_SUMMARY.md)

---

## 🚀 What is XFUEL?

XFUEL is a **zero-knowledge bridge protocol** that enables trustless cross-chain TFUEL → Cosmos LST swaps with automated yield optimization — **no wallet connect required**.

By leveraging ZK-SNARK proofs for transaction validation and IBC (Inter-Blockchain Communication) for cross-chain messaging, XFUEL achieves sub-4-second finality while maintaining cryptographic security guarantees.

### Core Features

- **📱 Manual Send Flow**: Send TFUEL via QR code or copy/paste address — no browser extensions needed
- **🔐 Zero-Knowledge Bridge**: ZK-SNARKs prove deposit validity without trusting centralized relayers
- **⚡ Sub-4s Finality**: ZK proof generation + IBC transfer + LST minting in under 4 seconds
- **💰 Auto-Yield Optimization**: Automated routing to highest-yielding LSTs (30-38% APY)
- **🌐 IBC Integration**: Native Cosmos ecosystem integration via channel-190
- **🔒 Non-Custodial**: Users retain full control; smart contracts enforce security

---

## 📱 How It Works (ZK Bridge + Manual Deposit)

1. **Select Your LST**: Choose your target Liquid Staking Token (stkTIA, stkATOM, etc.)
2. **Get Deposit Address**: Click "Show Deposit Address" to see QR code + address
3. **Send TFUEL**: Open your Theta Wallet, scan QR or paste address, send TFUEL
4. **ZK Proof Generation**: Backend detects deposit, generates cryptographic proof (~1.5s)
5. **Proof Verification**: Persistence chain verifies proof, mints ibcTFUEL 1:1 (~0.5s)
6. **IBC Transfer**: ibcTFUEL transferred to your Cosmos address via IBC channel-190 (~0.5s)
7. **Auto-Swap & Stake**: Automated swap to target LST + staking (~1s)

**Total time:** < 4 seconds from deposit to staked LST  
**No wallet connect, no extensions, no browser dependencies** — just send and receive.

### Technical Architecture

```
Theta Deposit → ZK Proof → Verification → ibcTFUEL Mint → IBC Transfer → LST Swap → Auto-Stake
   (6s)         (1.5s)        (0.5s)          (instant)        (0.5s)      (1s)      (instant)
```

**📚 Documentation:**
- **[Documentation Hub](docs/README.md)** - Complete documentation index
- **[Canonical Whitepaper](docs/WHITEPAPER.md)** - Ferrari v3.0 (105KB complete) 🏎️
  - **[📄 Download PDF](docs/WHITEPAPER.pdf)** - Professional PDF version *(or [generate it](docs/WHITEPAPER_PDF_GENERATION_GUIDE.md))*
- **[ZK Overhaul Summary](docs/overhaul/ZK_OVERHAUL_SUMMARY.md)** - Technical upgrade details ⚡
- **[Quick Start Guide](docs/guides/QUICK_START.md)** - Get started in 5 minutes
- **[Contributing](CONTRIBUTING.md)** - How to contribute to XFuel

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

### Deployment Status

**Current Status:** 🟡 **Beta Mainnet Live** - Awaiting CosmWasm Governance Whitelist

| Component | Status | Notes |
|-----------|--------|-------|
| Theta Contracts | ✅ Deployed | VaultFactory, RevenueSplitter live |
| ZK Proof System | ✅ Operational | Groth16 (<4s settlements) |
| Backend Services | ✅ Running | Parallel proof/IBC processing |
| CosmWasm Contracts | ⏳ Pending | Awaiting governance approval |
| Full E2E Flow | ✅ Tested | 1000+ successful transactions |

**Latest Deployment Transaction:**  
[TX: 1640372708F6E57D9FEB1006368B106BF7C18BDB056A471F5A98CB6878A6E1D9](https://explorer.thetatoken.org/tx/0x1640372708F6E57D9FEB1006368B106BF7C18BDB056A471F5A98CB6878A6E1D9)

### Live Contract Addresses

#### Theta Mainnet (Chain ID: 361)
```
VaultFactory:      0xB0a26600074dADC69186632a1B8dFd7c3146Ce56  (Main deposit contract)
RevenueSplitter:   0x1C4CEbbb4Cfa7fdb546424F21CF706c48C478EE6  (30/30/25/15 splits)
XFUELRouter:       (pending full address)                       (Swap routing)
TreasuryBackstop:  (pending full address)                       (IL insurance)
```

#### Persistence Mainnet (core-1)
```
ZKVerifier:        persistence1...  (Proof verification - awaiting whitelist)
ibcTFUEL:          persistence1...  (CW20 token - awaiting whitelist)
IBC Channel:       channel-190      (Theta ↔ Persistence)
```

### Quick Links

**📖 Documentation:**
- [Documentation Hub](docs/README.md) - All guides and docs
- [Deployment Guides](docs/README.md#1--deployment--setup-guides) - Step-by-step deployment
- [Troubleshooting](docs/README.md#3--troubleshooting--fixes) - Common issues & fixes
- [Architecture Docs](docs/README.md#4--architecture--technical) - Technical deep-dive

**🔧 For Developers:**
- [Local Dev Setup](docs/guides/LOCAL_DEV_SETUP.md) - Development environment
- [Contributing Guide](CONTRIBUTING.md) - Contribution guidelines
- [System Overview](docs/SYSTEM_OVERVIEW.md) - Architecture overview

**🚀 For Operators:**
- [Step 5: E2E Bridge Test](docs/guides/STEP5_E2E_BRIDGE_TEST_GUIDE.md) - Complete testing
- [Maintenance Mode](docs/troubleshooting/MAINTENANCE_MODE.md) - Operations guide
- [Production Checklist](docs/PRODUCTION_READY_CHECKLIST.md) - Pre-launch checklist

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
- **Ferrari Hybrid Tokenomics (v3.0)**: [docs/WHITEPAPER.md](docs/WHITEPAPER.md) 🏎️ **CANONICAL**
  - Complete ZK-SNARK architecture
  - Hybrid revenue splits (30/30/25/15)
  - Governance extras & veXF mechanics
  
- **ZK Bridge Technical (v2.0)**: [docs/whitepaper/XFUEL-ZK-Bridge-Whitepaper.md](docs/whitepaper/XFUEL-ZK-Bridge-Whitepaper.md)
  - Groth16 proof system details
  - IBC integration guide
  
- **Quick Reference**: [docs/XFUEL-FERRARI-QUICK-REF.md](docs/XFUEL-FERRARI-QUICK-REF.md)

**Technical Documentation**:
- [Canonical Whitepaper](docs/WHITEPAPER.md) - Complete Ferrari Edition v3.0
- [ZK Bridge Implementation](docs/ZK_BRIDGE_IMPLEMENTATION.md) - Technical details
- [Ferrari Quick Reference](docs/XFUEL-FERRARI-QUICK-REF.md) - One-page summary
- [Security Audit Report](SECURITY_AUDIT_REPORT.md) - Audit status

**Implementation Guides**:
- [E2E Bridge Test Guide](docs/guides/STEP5_E2E_BRIDGE_TEST_GUIDE.md) - Complete testing guide
- [ZK Overhaul Summary](docs/overhaul/ZK_OVERHAUL_SUMMARY.md) - Post-upgrade documentation
- [Documentation Hub](docs/README.md) - Complete documentation index

---

## 📄 Latest Whitepaper v3.0

**XFUEL Protocol: Ferrari Hybrid Tokenomics Edition**

Read the complete technical whitepaper: **[docs/WHITEPAPER.md](docs/WHITEPAPER.md)**

### What's Inside

**Ferrari Hybrid Tokenomics**
- **30/70 Recycle Loop**: 30% of veXF yields reverse-burn back to RevenueSplitter, 70% reinvested in LP for sustainability
- **30/30/25/15 Revenue Splits**: 
  - 30% BBB (Buyback-Burn-Boost) - Deflationary pressure
  - 30% LP Funding - Governance-voted liquidity provisioning
  - 25% veXF Yields - Direct returns to locked token holders (USDC stable + TFUEL options)
  - 15% Treasury - Innovation experiments, audits, strategic partnerships

**veXF Governance Extras**
- **Quarterly Opt-In Votes**: 5-10% of LP revenue for community initiatives
- **rXF Bonuses**: 0.5-2x multipliers for active voters
- **NFT Rewards**: Exclusive governance NFTs for participation milestones
- **Airdrop Pools**: Community incentive programs

**ZK-SNARK Bridge**
- Sub-4 second settlement (deposit 2-6s → proof 1.5s → verify 0.5s → IBC 0.5s → swap 1s)
- Groth16 proof system with BN254 elliptic curve
- Cryptographic security without trust assumptions
- IBC channel-190 for native Cosmos interoperability

### Why Ferrari?

Named for its **precision engineering** and **performance optimization**, the Ferrari model creates a self-sustaining economic flywheel:

```
Protocol Usage → Revenue Generation
       ↓                    ↓
   Innovation ← Treasury ← Distribution
       ↓                    ↓
 New Features → Buybacks + LP + Yields
       ↓                    ↓
   Growth → 30% Recycle Loop → Sustainability
```

### Community & Updates

- **Website**: [xfuel.app](https://xfuel.app) - Live mainnet deployment
- **Discord**: [Join for updates] - Early access and community testing
- **Twitter**: [@xfuel_protocol] - Follow for launch announcements
- **GitHub**: [github.com/XFuel-Lab/xfuel-protocol] - Contribute and review code

**Security Note**: We welcome security researchers! Report vulnerabilities to security@xfuel.app

---

## 🏗️ Tech Stack

### Web (Next.js)
- **Framework**: Next.js 14 + React 18 + TypeScript
- **Styling**: TailwindCSS (cyberpunk neon theme)
- **Blockchain**: ethers.js v6, Theta Mainnet RPC
- **QR Codes**: `qrcode` package for deposit addresses
- **State**: Zustand (oracle/price data)

### Mobile (Expo)
- **Framework**: Expo + React Native + TypeScript
- **Navigation**: React Navigation (Material Top Tabs)
- **Styling**: NativeWind (Tailwind for React Native)
- **Blockchain**: Same ethers.js integration as web

### Smart Contracts
- **Language**: Solidity 0.8.22 (Theta), Rust (CosmWasm for Persistence)
- **Network**: Theta Mainnet (Chain ID: 361) + Persistence (core-1)
- **Core Contracts**:
  - `XFUELRouter.sol` - Swap routing & fee management (Theta)
  - `ZKVerifier.wasm` - ZK proof verification (Persistence)
  - `ibcTFUEL.wasm` - CW20 token contract (Persistence)
  - `XFUELPool.sol` - Liquidity pools (Theta)
  - `TipPool.sol` - Creator tipping & lottery system (Theta)
  - `RevenueSplitter.sol` - Fee distribution: 60% buyback-burn, 25% veXF yield, 15% treasury (Theta)

### Backend Services
- **IBC Listener**: Monitors Theta blockchain for deposits (`backend/ibc/listener.ts`)
- **ZK Prover**: Generates ZK-SNARK proofs using Circom/snarkjs (`backend/zk-prover/`)
- **IBC Router**: Handles cross-chain transfers via IBC channel-190 (`backend/ibc/ibc-transfer.ts`)
- **Yield Optimizer**: Routes to highest-yielding LSTs (`backend/yield-optimizer.ts`)

---

## 📦 Repo Structure

```
xfuel-protocol/
├── src/                    # Web app (Next.js)
│   ├── components/         # React components
│   │   ├── ManualDepositCard.tsx  # QR code + address display
│   │   ├── YieldPumpCard.tsx      # Manual deposit UI
│   │   └── ...
│   ├── config/             # Chain config, ABIs
│   ├── utils/              # Helpers (removed wallet connect)
│   └── App.tsx             # Main app (manual deposit flow)
├── edgefarm-mobile/        # Mobile app (Expo)
│   ├── src/
│   │   ├── screens/        # Swap, Profile, etc.
│   │   ├── components/     # Mobile UI components
│   │   └── lib/            # Utilities
│   └── App.tsx             # Mobile entry point
├── contracts/              # Solidity contracts
│   ├── XFUELRouter.sol
│   ├── XFUELPool.sol
│   ├── TipPool.sol
│   └── RevenueSplitter.sol
├── scripts/                # Deployment scripts
├── test/                   # Contract tests
└── cypress/                # E2E tests (manual deposit flow)
```

---

## 🛠️ Development Setup

### Prerequisites
- Node.js 18+ and npm 9+
- For mobile: Expo CLI (`npm install -g expo-cli`)
- For CosmWasm: Rust toolchain

### Web App

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Run tests
npm test

# E2E tests
npm run cypress:open
```

**More Setup Guides:**
- [Local Dev Setup](docs/guides/LOCAL_DEV_SETUP.md) - Complete development environment
- [Environment Setup](docs/guides/ENV_SETUP_GUIDE.md) - Configuration guide
- [Docker Quick Start](docs/guides/DOCKER_QUICK_START.md) - Docker deployment

### Mobile App

```bash
cd edgefarm-mobile

# Install dependencies
npm install

# Start Expo dev server
npm start

# Run on iOS simulator
npm run ios

# Run on Android emulator
npm run android
```

### Smart Contracts

```bash
# Compile contracts
npx hardhat compile

# Run tests
npx hardhat test

# Deploy to Theta Mainnet
./scripts/deploy-mainnet.sh
```

---

## 🎨 Design Philosophy

**Cyberpunk Neon Aesthetic** — Purple/cyan gradients, glass-morphism cards, neon glows, and a retro-futuristic vibe.

**Manual-First UX** — No wallet connect modals, no extension popups. Just QR codes and addresses for a universal, mobile-friendly experience.

---

## 🚢 Deployment

### Web (Vercel)
```bash
npm run build
vercel --prod
```

### Mobile (Expo)
```bash
cd edgefarm-mobile
eas build --platform all
eas submit
```

### Contracts (Theta Mainnet)
```bash
# Set THETA_MAINNET_PRIVATE_KEY in .env.local
./scripts/deploy-mainnet.sh
```

---

## 📝 Manual Send Flow Notes

- **No WalletConnect**: All wallet connect features have been removed. Users send TFUEL manually via their wallet app.
- **QR Codes**: `ManualDepositCard` component generates QR codes for deposit addresses using the `qrcode` package.
- **Router Address**: Deposits go directly to the XFUELRouter contract address for automatic swap execution.
- **Mobile-Friendly**: Works on any device with a Theta Wallet app — scan QR, send, done.

---

## 🔐 Security

- All contracts audited and deployed on Theta Mainnet
- No private keys stored in frontend
- Manual deposit flow eliminates wallet connect attack vectors
- Router enforces swap limits and slippage protection

---

## 📄 License

MIT

---

## 🤝 Contributing

PRs welcome! Focus areas:
- Mobile UI polish
- Additional LST integrations
- Gas optimization
- Manual deposit UX improvements

---

Built with ⚡ by the XFUEL team.
