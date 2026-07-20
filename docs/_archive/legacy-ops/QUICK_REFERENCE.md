# XFuel Protocol - Quick Reference Guide

## 🚀 New Features Overview

### WalletConnect v2 Integration

```
┌─────────────────────────────────────────────────────────┐
│                   Connection Flow                       │
└─────────────────────────────────────────────────────────┘

Web (Desktop):
User clicks "Connect Wallet"
  ├─ Theta Wallet Extension detected? 
  │   └─ Yes → Direct connection (< 2s)
  │   └─ No  → Show WalletConnect QR Modal
  │       └─ User scans with mobile app → Connected

Mobile (iOS/Android):
User clicks "Connect Wallet"
  ├─ Generate WalletConnect URI
  ├─ Attempt deep link: theta://wc?...
  │   ├─ App installed → Opens Theta Wallet → Connected
  │   └─ App not installed → Show App Store/Play Store link
  └─ Fallback: Display QR code for manual scan
```

---

## 🔐 Security Architecture

```
┌─────────────────────────────────────────────────────────┐
│              Security Layers (Defense in Depth)         │
└─────────────────────────────────────────────────────────┘

Layer 1: Client-Side Validation
  ├─ Address format check: /^0x[a-fA-F0-9]{40}$/
  ├─ Amount bounds: 0 < amount <= 1M TFUEL
  ├─ Balance verification: amount <= userBalance
  └─ LST whitelist validation

Layer 2: Nonce-Based Signing
  ├─ Generate nonce on connection: Math.random() + Date.now()
  ├─ Include nonce in every signature request
  ├─ Rotate nonce after each signature
  └─ Prevents replay attacks

Layer 3: Server-Side Validation
  ├─ Re-validate all inputs
  ├─ Check timestamp: within 5-minute window
  ├─ Sanitize strings: lowercase, trim
  └─ Log security events

Layer 4: Smart Contract Protection
  ├─ ReentrancyGuard on all state-changing functions
  ├─ Checks-Effects-Interactions pattern
  └─ OpenZeppelin audited contracts
```

---

## 📱 Mobile UI Flow

```
┌─────────────────────────────────────────────────────────┐
│           Hierarchical Single-Button Design             │
└─────────────────────────────────────────────────────────┘

HomeScreen (Dashboard)
│
├─ Hero Card: Live Blended APY
│   └─ Pulsing ring animation (highest APY)
│
├─ Top 2 LST Cards
│   ├─ stkXPRT (25.7% APY) → Tap → Navigate to Stake
│   └─ stkTIA (15.2% APY)  → Tap → Navigate to Stake
│
├─ Earnings Today Card
│   └─ Real-time calculation based on blended APY
│
└─ Quick Actions
    ├─ "Swap Now" → Navigate to SwapScreen
    └─ "Lock XF for Boost" → Navigate to StakeScreen

SwapScreen (Tesla-Simple)
│
├─ Wallet Connection
│   └─ "Connect Theta Wallet" → QR Modal + Deep Link
│
├─ Amount Selection
│   └─ Slider (1-100%) with haptic feedback
│
├─ LST Selection
│   └─ Auto-selected: Highest APY (smart default)
│
├─ Preview
│   └─ Estimated output + daily yield
│
└─ Single CTA: "⚡ Swap & Compound"
    └─ On Success: Confetti 🎉 + Success message
```

---

## 🛠️ Quick Commands

### Development

```bash
# Web
npm install                  # Install dependencies
npm run dev                  # Start dev server (http://localhost:5173)
npm run build                # Build for production
npm run preview              # Preview production build

# Mobile
cd edgefarm-mobile
npm install                  # Install dependencies
npm run start                # Start Expo dev server
npm run ios                  # Run on iOS Simulator
npm run android              # Run on Android Emulator

# Testing
npm test                     # Run unit tests
npm run test:e2e            # Run Cypress E2E tests
npm run test:contracts       # Hardhat default test discovery
npm run test:contracts:core  # Core listener (node:test) + core Hardhat (*.cjs, phase3, security)
npm run test:contracts:all   # Same listener + full Hardhat (all test/**, circuits, security) — CI `test.yml`
```

### Deployment

```bash
# Web (Vercel)
vercel deploy                # Deploy to staging
vercel deploy --prod         # Deploy to production

# Mobile (EAS)
cd edgefarm-mobile
npx eas-cli build --platform ios --profile production
npx eas-cli build --platform android --profile production
npx eas-cli submit --platform all

# Backend
node server/health.js        # Start backend server
```

---

## 🔧 Environment Variables

### Web (.env.local)

```bash
# WalletConnect v2 (Required)
VITE_WALLETCONNECT_PROJECT_ID=your_project_id_here

# Theta Network Contracts (Required)
VITE_ROUTER_ADDRESS=0x...  # Theta Mainnet router
VITE_TIP_POOL_ADDRESS=0x...  # Theta Mainnet tip pool

# Backend API (Required)
VITE_API_URL=http://localhost:3001  # or https://api.xfuel.app

# Optional
SIMULATION_MODE=true  # Enable for testing without real transactions
```

### Mobile (edgefarm-mobile/.env)

```bash
# Backend API
EXPO_PUBLIC_API_URL=http://localhost:3001  # or production URL

# Contract Addresses (matches web)
EXPO_PUBLIC_ROUTER_ADDRESS=0x...
```

---

## 🧪 Testing Checklist

### Pre-Deployment Testing

#### Web
- [ ] Connect Theta Wallet extension
- [ ] Connect via WalletConnect (scan QR with mobile)
- [ ] Connect with MetaMask (auto-add Theta network)
- [ ] Execute swap (testnet)
- [ ] Verify balance updates
- [ ] Test error: insufficient balance
- [ ] Test error: user rejection
- [ ] Test page refresh (session persistence)

#### Mobile
- [ ] Deep link opens Theta Wallet app
- [ ] Connection success shows address + balance
- [ ] Slider has haptic feedback
- [ ] Swap execution works
- [ ] Confetti shows on success
- [ ] Pull-to-refresh updates balance
- [ ] Error messages display correctly

---

## 📊 File Structure

```
xfuel-protocol/
├── src/
│   ├── providers/
│   │   └── WalletProvider.tsx       ← NEW: Unified wallet context
│   ├── utils/
│   │   ├── walletConnect.ts         ← UPDATED: WC v2
│   │   └── thetaWallet.ts           ← Theta extension utils
│   ├── components/
│   │   └── [existing components]
│   └── App.tsx
│
├── edgefarm-mobile/
│   ├── src/
│   │   ├── lib/
│   │   │   └── thetaWallet.ts       ← UPDATED: Mobile wallet
│   │   ├── screens/
│   │   │   ├── HomeScreen.tsx       ← Dashboard
│   │   │   └── SwapScreen.tsx       ← Swap interface
│   │   └── components/
│   │       └── [neon components]
│   └── App.tsx
│
├── server/
│   ├── validation/
│   │   └── swapValidation.js        ← NEW: Input validation
│   └── api/
│       └── swap.js                  ← UPDATED: Enhanced security
│
├── docs/
│   ├── WALLETCONNECT_V2_GUIDE.md           ← NEW: Complete guide
│   ├── CURSOR_IMPLEMENTATION_GUIDE.md      ← NEW: AI reference
│   ├── DEPLOYMENT_CHECKLIST_V2.md          ← NEW: Deploy guide
│   └── IMPLEMENTATION_SUMMARY.md           ← NEW: This summary
│
└── README.md                                ← UPDATED
```

---

## 🔗 Important Links

### Documentation
- [Complete WalletConnect v2 Guide](./WALLETCONNECT_V2_GUIDE.md) - 8,000+ words
- [Cursor AI Implementation Guide](./CURSOR_IMPLEMENTATION_GUIDE.md) - Quick ref
- [Deployment Checklist](./DEPLOYMENT_CHECKLIST_V2.md) - Production steps

### External Resources
- [WalletConnect Cloud](https://cloud.walletconnect.com) - Get Project ID
- [Theta Explorer](https://explorer.thetatoken.org) - View transactions
- [Theta Faucet](https://faucet.testnet.thetatoken.org) - Get test TFUEL

### Project Links
- GitHub: https://github.com/XFuel-Lab/xfuel-protocol
- Live App: https://xfuel.app (TBD)
- API: https://api.xfuel.app (TBD)

---

## 🐛 Troubleshooting

### "Project ID not configured"

```bash
# Create .env.local with your WalletConnect Project ID
echo "VITE_WALLETCONNECT_PROJECT_ID=your_project_id" > .env.local
npm run dev
```

### Deep link not working

```json
// Check edgefarm-mobile/app.json
{
  "expo": {
    "scheme": "xfuel",
    "android": {
      "intentFilters": [...]
    }
  }
}
```

### Balance not updating

```typescript
// After transaction, explicitly refresh
await sendTransaction(tx)
await refreshBalance()  // ← Add this
```

### Nonce mismatch

```typescript
// Ensure nonce rotates after signing
const signature = await signMessage(message)
setWallet(prev => ({ ...prev, nonce: generateNonce() }))  // ← Add this
```

---

## 💡 Pro Tips

1. **Always test on Theta Testnet first**
   - Get free TFUEL from faucet
   - No risk to real funds
   - Same performance as mainnet

2. **Use simulation mode for rapid iteration**
   ```bash
   SIMULATION_MODE=true npm run dev
   ```

3. **Monitor console logs during development**
   - WalletConnect logs prefixed with 🔌
   - Mobile logs prefixed with 📱
   - Security events prefixed with 🔒

4. **Test on multiple devices**
   - iOS: iPhone 12+, iPad
   - Android: Samsung, Google Pixel
   - Browsers: Chrome, Firefox, Brave

5. **Keep dependencies updated**
   ```bash
   npm outdated
   npm update
   ```

---

## 📞 Getting Help

### Documentation
- Read the [complete guide](./WALLETCONNECT_V2_GUIDE.md) first
- Check [troubleshooting section](./WALLETCONNECT_V2_GUIDE.md#troubleshooting)

### Community
- Discord: [Link TBD]
- GitHub Issues: [xfuel-protocol/issues](https://github.com/XFuel-Lab/xfuel-protocol/issues)

### Security Issues
- Email: security@xfuel.app
- 90-day responsible disclosure policy

---

## ✅ Success Criteria

Your implementation is ready for production when:

- ✅ All wallet providers connect successfully
- ✅ Swap executes in < 4 seconds (Theta Mainnet)
- ✅ No console errors in production build
- ✅ Mobile deep linking works on iOS + Android
- ✅ All validation tests pass
- ✅ Lighthouse score > 90
- ✅ Security audit complete (if required)

---

**Quick Start:** Follow [Cursor Implementation Guide](./CURSOR_IMPLEMENTATION_GUIDE.md)  
**Full Details:** Read [WalletConnect v2 Guide](./WALLETCONNECT_V2_GUIDE.md)  
**Deploy:** Use [Deployment Checklist](./DEPLOYMENT_CHECKLIST_V2.md)

*Happy coding! 🚀*

