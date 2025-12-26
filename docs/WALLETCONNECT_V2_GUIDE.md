# XFuel Protocol - WalletConnect v2 Integration & Mobile UI Refactor

## 🎯 Overview

This guide documents the comprehensive refactor of XFuel Protocol with:
- **WalletConnect v2** for seamless cross-platform wallet integration
- **Unified Provider Architecture** with nonce-based security
- **Hierarchical Mobile UI** with single-button flows
- **Enhanced Security** with input validation and replay attack prevention

## 📋 Table of Contents

1. [WalletConnect v2 Integration](#walletconnect-v2-integration)
2. [Unified Wallet Provider](#unified-wallet-provider)
3. [Mobile UI Architecture](#mobile-ui-architecture)
4. [Security Enhancements](#security-enhancements)
5. [Testing Guide](#testing-guide)
6. [Deployment](#deployment)
7. [Troubleshooting](#troubleshooting)

---

## 🔌 WalletConnect v2 Integration

### Overview

WalletConnect v2 provides a unified protocol for connecting wallets across web and mobile platforms.

### Web Implementation (`src/utils/walletConnect.ts`)

```typescript
// Key features:
- Auto-detection of Theta Wallet extension
- QR modal for mobile scanning
- Deep linking for native apps
- Session management and persistence
```

**Setup:**

1. **Get WalletConnect Project ID:**
   - Visit https://cloud.walletconnect.com
   - Create a new project
   - Copy your Project ID

2. **Configure Environment:**
   ```bash
   # .env.local (for development)
   VITE_WALLETCONNECT_PROJECT_ID=your_project_id_here
   
   # Vercel (for production)
   Add VITE_WALLETCONNECT_PROJECT_ID to environment variables
   ```

3. **Provider Configuration:**
   ```typescript
   const provider = await EthereumProvider.init({
     projectId: WALLETCONNECT_PROJECT_ID,
     chains: [361], // Theta Mainnet
     rpcMap: {
       361: 'https://eth-rpc-api.thetatoken.org/rpc'
     },
     showQrModal: true, // Built-in modal for better UX
     qrModalOptions: {
       themeMode: 'dark',
       mobileWallets: [{
         id: 'theta-wallet',
         name: 'Theta Wallet',
         links: {
           native: 'theta://wc',
           universal: 'https://wallet.thetatoken.org'
         }
       }]
     }
   })
   ```

### Mobile Implementation (`edgefarm-mobile/src/lib/thetaWallet.ts`)

```typescript
// Key features:
- Automatic deep linking (theta://)
- QR code fallback
- App store navigation if wallet not installed
- Connection status tracking
```

**Deep Link Flow:**

1. User taps "Connect Wallet"
2. System generates WalletConnect URI
3. Automatic deep link attempt: `theta://wc?...`
4. If app opens: connection established
5. If app not installed: redirect to App Store/Play Store
6. Fallback: Show QR code for manual scanning

**Testing Deep Links:**

```bash
# iOS Simulator
xcrun simctl openurl booted "theta://wc?..."

# Android Emulator
adb shell am start -a android.intent.action.VIEW -d "theta://wc?..."
```

---

## 🛡️ Unified Wallet Provider

### Architecture (`src/providers/WalletProvider.tsx`)

The `WalletProvider` component provides a unified interface for wallet operations across all providers:

```typescript
interface WalletInfo {
  address: string | null          // Shortened display address
  fullAddress: string | null      // Full address for transactions
  balance: string                 // Formatted balance
  isConnected: boolean
  provider: 'theta' | 'walletconnect' | 'metamask' | null
  nonce: number                   // Security nonce (replay protection)
}
```

### Nonce-Based Security

**Purpose:** Prevent replay attacks where an attacker reuses a signed message.

**Implementation:**

```typescript
// Sign message with nonce
const signMessage = async (message: string) => {
  // Add nonce and timestamp
  const messageWithNonce = `${message}\n\nNonce: ${wallet.nonce}\nTimestamp: ${Date.now()}`
  const signature = await signer.signMessage(messageWithNonce)
  
  // Generate new nonce after signing
  setWallet(prev => ({ ...prev, nonce: generateNonce() }))
  
  return signature
}
```

**Usage in Swap:**

```typescript
// Frontend
const swapParams = {
  amount: tfuelAmount,
  targetLST: selectedLST.name,
  nonce: wallet.nonce,
  timestamp: Date.now()
}

// Backend validates timestamp (5-minute window)
if (timestamp < Date.now() - 5 * 60 * 1000) {
  throw new Error('Request expired')
}
```

### Context API Usage

```typescript
// In any component
import { useWallet } from '../providers/WalletProvider'

function MyComponent() {
  const { 
    wallet, 
    connectWallet, 
    disconnectWallet, 
    signMessage,
    sendTransaction,
    isConnecting,
    error 
  } = useWallet()

  // Connect with specific provider
  await connectWallet('walletconnect')
  
  // Or auto-detect best provider
  await connectWallet()
}
```

---

## 📱 Mobile UI Architecture

### Hierarchical Single-Button Flow

**Before:** Flat hierarchy with scattered buttons  
**After:** Single prominent CTA → Sub-panels (modals/slide-ups)

### HomeScreen Structure

```
HomeScreen (Dashboard)
├─ Live Blended APY (Hero Card with pulsing ring)
├─ Top 2 LST Cards (Tap to navigate to Stake)
├─ Earnings Today (Demo calculation)
└─ Quick Actions
   ├─ "Swap Now" → Navigate to SwapScreen
   └─ "Lock XF for Boost" → Navigate to StakeScreen
```

### SwapScreen Flow

```
SwapScreen
├─ Connect Wallet (if not connected)
├─ Select Amount (Slider: 1-100%)
├─ Choose LST (Auto-selected: highest APY)
├─ Preview Output
└─ Single CTA: "⚡ Swap & Compound"
   └─ On Success: Confetti + Success message
```

**Key Improvements:**

1. **Single Primary Action:** One prominent button per screen
2. **Progressive Disclosure:** Show details only when needed
3. **Smart Defaults:** Pre-select highest APY LST
4. **Immediate Feedback:** Haptics + animations
5. **Pull-to-Refresh:** Update balances and APYs

### Haptic Feedback Implementation

```typescript
import * as Haptics from 'expo-haptics'

// Light tap (navigation, selection)
Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)

// Medium tap (button press)
Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

// Heavy tap (swap initiation)
Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)

// Success notification
Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)

// Error notification
Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
```

---

## 🔒 Security Enhancements

### Input Validation (`server/api/swap.js`)

**Validation Rules:**

```javascript
// Address validation
/^0x[a-fA-F0-9]{40}$/.test(address)

// Amount validation
- Must be > 0
- Must be <= 1,000,000 TFUEL
- Must be <= user balance

// LST validation
- Must be in whitelist: ['stkTIA', 'stkATOM', 'stkXPRT', 'stkOSMO', 'pSTAKE BTC', 'USDC']

// Timestamp validation
- Must be within 5-minute window
- Rejects future timestamps
```

### Reentrancy Protection

All swap contracts use OpenZeppelin's `ReentrancyGuard`:

```solidity
contract XFUELRouter is ReentrancyGuard {
  function swap(...) external nonReentrant {
    // Swap logic protected from reentrancy
  }
}
```

### Rate Limiting (TODO)

For production, implement Redis-based rate limiting:

```javascript
// Example: 10 swaps per address per hour
const rateLimiter = new RateLimiter({
  redis: redisClient,
  maxRequests: 10,
  windowMs: 60 * 60 * 1000
})
```

---

## 🧪 Testing Guide

### Unit Tests

```bash
# Run Jest tests
npm test

# Run with coverage
npm run test:coverage
```

### E2E Tests (Cypress)

```bash
# Open Cypress UI
npm run test:e2e

# Run headless
npm run test:e2e:headless
```

**Key Test Cases:**

1. **Wallet Connection:**
   - Theta extension detection
   - WalletConnect QR flow
   - MetaMask with Theta RPC
   - Connection error handling

2. **Swap Flow:**
   - Amount validation
   - LST selection
   - Balance checks
   - Transaction simulation
   - Success/error states

3. **Security:**
   - Nonce generation
   - Timestamp validation
   - Input sanitization
   - Address format validation

### Mobile Testing (Expo)

```bash
# Start Expo dev server
cd edgefarm-mobile
npm run start

# Test on iOS Simulator
npm run ios

# Test on Android Emulator
npm run android

# Test on physical device (recommended)
# Scan QR code with Expo Go app
```

**Testing WalletConnect on Mobile:**

1. Install Theta Wallet on device
2. Run Expo app on same device
3. Tap "Connect Wallet"
4. Verify deep link opens Theta Wallet
5. Approve connection
6. Verify balance displays

---

## 🚀 Deployment

### Web Deployment (Vercel)

1. **Environment Variables:**
   ```
   VITE_WALLETCONNECT_PROJECT_ID=your_project_id
   VITE_ROUTER_ADDRESS=0x... (Theta Mainnet router)
   VITE_TIP_POOL_ADDRESS=0x... (Theta Mainnet tip pool)
   VITE_API_URL=https://your-api.vercel.app
   ```

2. **Build Command:**
   ```bash
   npm run build
   ```

3. **Deploy:**
   ```bash
   vercel deploy --prod
   ```

### Mobile Deployment (Expo EAS)

1. **Configure EAS:**
   ```json
   // eas.json
   {
     "build": {
       "production": {
         "node": "24.0.0",
         "channel": "production"
       }
     }
   }
   ```

2. **Build APK/IPA:**
   ```bash
   cd edgefarm-mobile
   npx eas-cli build --platform all
   ```

3. **Submit to Stores:**
   ```bash
   npx eas-cli submit --platform ios
   npx eas-cli submit --platform android
   ```

### Backend Deployment

```bash
# Deploy health check server
node server/health.js

# Or use Docker
docker build -t xfuel-backend .
docker run -p 3001:3001 xfuel-backend
```

---

## 🔧 Troubleshooting

### WalletConnect Issues

**Problem:** "Project ID not configured"  
**Solution:** Set `VITE_WALLETCONNECT_PROJECT_ID` in environment variables

**Problem:** QR modal not showing  
**Solution:** Ensure `showQrModal: true` in provider config

**Problem:** Deep link not working on mobile  
**Solution:** Verify URL scheme in `app.json`:
```json
{
  "expo": {
    "scheme": "xfuel"
  }
}
```

### Connection Failures

**Problem:** Extension detected but connection fails  
**Solution:** User may have rejected request. Show clear error message.

**Problem:** Balance not updating  
**Solution:** Call `refreshBalance()` after transactions

**Problem:** Nonce mismatch  
**Solution:** Ensure nonce updates after each signature

### Mobile Build Issues

**Problem:** Metro bundler cache errors  
**Solution:** 
```bash
cd edgefarm-mobile
rm -rf node_modules
npm install
npx expo start --clear
```

**Problem:** Deep linking not working in dev  
**Solution:** Use `npx uri-scheme open theta://wc --ios` for testing

---

## 📚 Additional Resources

- [WalletConnect v2 Docs](https://docs.walletconnect.com/)
- [Theta Network Docs](https://docs.thetatoken.org/)
- [Expo Deep Linking Guide](https://docs.expo.dev/guides/linking/)
- [React Navigation](https://reactnavigation.org/)

---

## 🎓 Learning Path for First-Time Devs

### Step 1: Local Testing (Theta Testnet)

```bash
# 1. Clone and install
git clone https://github.com/XFuel-Lab/xfuel-protocol
cd xfuel-protocol
npm install

# 2. Configure environment
cp .env.example .env.local
# Edit .env.local with your WalletConnect Project ID

# 3. Start dev server
npm run dev

# 4. Test in browser
# - Install Theta Wallet extension
# - Connect wallet
# - Get testnet TFUEL from faucet
# - Execute test swap
```

### Step 2: Mobile Testing

```bash
# 1. Set up mobile app
cd edgefarm-mobile
npm install

# 2. Start Expo
npm run start

# 3. Test on device
# - Install Expo Go on phone
# - Scan QR code
# - Install Theta Wallet app
# - Test wallet connection
```

### Step 3: Iterate Based on Testing

- Monitor console logs for errors
- Test edge cases (low balance, network errors)
- Refine UI based on UX testing
- Add analytics (PostHog, Mixpanel)

### Step 4: Production Deployment

- Deploy to Vercel (web)
- Submit to App Store/Play Store (mobile)
- Monitor with Sentry for error tracking
- Set up Chainalysis alerts

---

## 💡 Pro Tips

1. **Always test on Theta Testnet first** before mainnet
2. **Use simulation mode** for rapid iteration without gas costs
3. **Enable verbose logging** during development
4. **Test on multiple devices** (iOS, Android, various browsers)
5. **Keep WalletConnect SDK updated** for latest features
6. **Monitor gas prices** and adjust transaction parameters
7. **Implement analytics** to understand user behavior
8. **Use feature flags** for gradual rollouts

---

## 📞 Support

- **Discord:** [XFuel Community](https://discord.gg/xfuel)
- **GitHub Issues:** [xfuel-protocol/issues](https://github.com/XFuel-Lab/xfuel-protocol/issues)
- **Docs:** [docs.xfuel.app](https://docs.xfuel.app)

---

**Built with ❤️ by XFuel Labs**  
*Efficiency meets simplicity.*

