# XFUEL Protocol

**Sub-4s settlement rail for TFUEL ↔ Cosmos LST atomic swaps & yield automation.**

Live: **[xfuel.app](https://xfuel.app)** (Theta Mainnet)

---

## 🚀 What is XFUEL?

XFUEL is a **manual-deposit cross-chain yield protocol** that enables instant TFUEL-to-LST swaps and automated staking — **no wallet connect required**.

### Core Features

- **📱 Manual Send Flow**: Send TFUEL via QR code or copy/paste address — no browser extensions needed
- **⚡ Instant Swaps**: TFUEL → stkTIA, stkATOM, pSTAKE BTC, and more
- **💰 Auto-Staking**: LST tokens are minted and staked automatically on deposit
- **🔒 No Extensions**: Simple send-and-receive flow works on any device
- **🌐 Cross-Chain**: Theta ↔ Cosmos ecosystem in one tap

---

## 📱 How It Works (Manual Deposit)

1. **Select Your LST**: Choose your target Liquid Staking Token (stkTIA, stkATOM, etc.)
2. **Get Deposit Address**: Click "Show Deposit Address" to see QR code + address
3. **Send TFUEL**: Open your Theta Wallet, scan QR or paste address, send TFUEL
4. **Auto-Mint**: Your LST tokens are minted and sent to your wallet automatically

**No wallet connect, no extensions, no browser dependencies** — just send and receive.

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
- **Language**: Solidity 0.8.22
- **Network**: Theta Mainnet (Chain ID: 361)
- **Core Contracts**:
  - `XFUELRouter.sol` - Swap routing & fee management
  - `XFUELPool.sol` - Liquidity pools
  - `TipPool.sol` - Creator tipping & lottery system
  - `RevenueSplitter.sol` - Fee distribution (60% buyback-burn, 25% veXF yield, 15% treasury)

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
