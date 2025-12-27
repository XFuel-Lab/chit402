# XFuel Protocol - Unified Deployment Guide
**Tesla-Style: One Doc, Zero Confusion**

## 🚀 Quick Deploy (Production)

### Prerequisites
```bash
# 1. Install dependencies
npm install

# 2. Set environment variables
cp .env.example .env.local
# Edit .env.local with your keys

# 3. Compile contracts
npm run compile
```

### Deploy to Theta Mainnet
```bash
# Option A: Automated deployment
npm run deploy:mainnet

# Option B: Manual verification
npx hardhat run scripts/deploy-mainnet.sh --network theta_mainnet
npx hardhat verify --network theta_mainnet <ROUTER_ADDRESS>
```

### Deploy Frontend (Vercel)
```bash
# Build production bundle
npm run build

# Deploy via Vercel CLI
vercel --prod

# Or link Git repo for auto-deployment
# Settings → Environment Variables:
# - VITE_NETWORK=mainnet
# - VITE_ROUTER_ADDRESS=<deployed_router>
# - VITE_WALLETCONNECT_PROJECT_ID=<project_id>
```

---

## 📱 Mobile App Deployment (Expo)

### Build for iOS/Android
```bash
cd edgefarm-mobile

# Install dependencies
npm install

# Build production APK/IPA
eas build --platform android --profile production
eas build --platform ios --profile production

# Submit to stores
eas submit --platform android
eas submit --platform ios
```

### Configuration
```json
// edgefarm-mobile/app.json
{
  "expo": {
    "extra": {
      "routerAddress": "<MAINNET_ROUTER>",
      "network": "mainnet",
      "walletConnectProjectId": "<PROJECT_ID>"
    }
  }
}
```

---

## 🔗 Wallet Integration Guide

### Supported Wallets
- **Theta Wallet** (native, mobile deep-linking)
- **MetaMask** (browser extension)
- **WalletConnect v2** (mobile dApps)
- **Keplr** (Cosmos LST staking)

### Implementation Example
```typescript
import { useWallet } from './providers/WalletProvider'

function MyComponent() {
  const { address, balance, connect, disconnect } = useWallet()
  
  return (
    <button onClick={() => connect('theta')}>
      {address ? `Connected: ${address}` : 'Connect Wallet'}
    </button>
  )
}
```

### Theta Wallet QR Flow (Mobile)
```typescript
import ThetaWalletQRModal from './components/ThetaWalletQRModal'

// Auto-generates WalletConnect URI with Theta Wallet deep-link
<ThetaWalletQRModal
  isOpen={showQR}
  onClose={() => setShowQR(false)}
  walletConnectUri={wcUri}
/>
```

### Keplr Integration (Cosmos LST)
```typescript
import { stakeLSTOnStride } from './utils/cosmosLSTStaking'

// Auto-detects uninitialized Stride accounts
// Shows guided modal if account needs 0.5 STRD setup
const result = await stakeLSTOnStride('stkATOM', 10.5)

if (result.success) {
  console.log('Staked! TX:', result.txHash)
} else if (result.error?.includes('does not exist on chain')) {
  // StrideInitModal auto-triggers via App.tsx logic
  // User guided through Osmosis swap → Auto-verify → Retry
}
```

---

## 🧪 Testing Checklist

### Contract Tests (85%+ Coverage Required)
```bash
# Run all contract tests
npm test

# Generate coverage report
npm run test:coverage

# Output should show:
# - XFUELRouter: 90%+
# - RevenueSplitter: 88%+
# - veXF/rXF: 85%+
```

### E2E Tests (Cypress)
```bash
# Run Cypress tests
npm run test:e2e

# Tests cover:
# - Wallet connection (Theta, MetaMask, WalletConnect)
# - Swap flow (TFUEL → LST)
# - Early Believers modal
# - Mainnet beta limits
```

### Manual Testing (Testnet)
1. Deploy contracts to Theta Testnet
2. Test swap with testnet TFUEL (faucet: https://faucet.thetatoken.org)
3. Verify Keplr staking on Stride Testnet
4. Check mobile deep-linking (iOS/Android)

---

## 🔐 Security Audit Checklist

- [ ] All contracts use OpenZeppelin battle-tested libraries
- [ ] Reentrancy guards on all external calls
- [ ] Access control via `Ownable` (owner-only admin functions)
- [ ] Mainnet beta limits: 1,000 TFUEL/swap, 5,000 TFUEL/user
- [ ] Emergency pause/kill switches implemented
- [ ] External audit by CertiK/Trail of Bits recommended before removing limits

---

## 📊 Monitoring & Maintenance

### Key Metrics to Monitor
```bash
# Router balance (should stay near zero, auto-distributes)
cast balance <ROUTER_ADDRESS> --rpc-url https://eth-rpc-api.thetatoken.org/rpc

# Total volume processed
cast call <ROUTER_ADDRESS> "totalVolume()" --rpc-url https://eth-rpc-api.thetatoken.org/rpc

# Fee distribution stats
cast call <REVENUE_SPLITTER> "getTotalDistributed()" --rpc-url https://eth-rpc-api.thetatoken.org/rpc
```

### Upgrade Path (Proxy Pattern)
```bash
# Deploy new implementation
npx hardhat run scripts/upgrade-router.cjs --network theta_mainnet

# Verify upgrade
npx hardhat verify --network theta_mainnet <NEW_IMPL_ADDRESS>
```

---

## 🆘 Troubleshooting

### Common Issues

**"Transaction failed: insufficient funds"**
- Ensure user has enough TFUEL for swap amount + gas (~0.01 TFUEL)
- Check router has liquidity (shouldn't happen, but verify)

**"Keplr staking failed: account does not exist on chain"**
- StrideInitModal auto-triggers
- User needs 0.5 STRD for one-time account activation
- Guided through Osmosis swap → Auto-detection

**"WalletConnect session timeout"**
- Re-scan QR code in Theta Wallet mobile app
- Ensure WalletConnect Project ID is valid

**"Vercel deployment fails to connect"**
- Check environment variables are set correctly
- Ensure CORS headers allow Vercel domain in backend API

---

## 📞 Support

- **Docs:** https://docs.xfuel.app
- **Discord:** https://discord.gg/xfuel
- **Email:** xfuel.support@xfuel.app
- **GitHub Issues:** https://github.com/XFuel-Lab/xfuel-protocol/issues

---

**Built with 🚀 by XFuel Labs | Audacity Level: Musk**

