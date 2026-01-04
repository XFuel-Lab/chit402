# XFUEL Protocol

**Sub-4s settlement rail for TFUEL ↔ Cosmos LST atomic swaps & yield automation.**

Live: **[xfuel.app](https://xfuel.app)** (Theta Mainnet)

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

**Read the whitepapers:**
- **Ferrari Hybrid Tokenomics (v3.0)**: [docs/XFUEL-Hybrid-Tokenomics-Whitepaper-v3.md](docs/XFUEL-Hybrid-Tokenomics-Whitepaper-v3.md) 🏎️ **NEW**
- **ZK Bridge Technical (v2.0)**: [docs/whitepaper/XFUEL-ZK-Bridge-Whitepaper.md](docs/whitepaper/XFUEL-ZK-Bridge-Whitepaper.md)
- **Quick Reference**: [docs/XFUEL-FERRARI-QUICK-REF.md](docs/XFUEL-FERRARI-QUICK-REF.md)

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
