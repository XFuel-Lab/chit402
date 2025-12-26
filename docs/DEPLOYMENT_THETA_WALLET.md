# Theta Wallet Integration - Deployment Guide

## Pre-Deployment Checklist

### Mobile (Expo/React Native)

- [ ] Dependencies installed
  ```bash
  cd edgefarm-mobile && npm install
  ```

- [ ] Deep link schemes configured in `app.json`
  - `thetawallet://`
  - `wc://`
  - `xfuel://`

- [ ] Test on physical devices (iOS + Android)
  ```bash
  npm run test-real-device
  ```

- [ ] Session persistence working (AsyncStorage)
  ```typescript
  // Test: Close app, reopen - should auto-reconnect
  ```

- [ ] Haptic feedback working
  ```typescript
  // Test: Connect wallet - should feel vibration
  ```

- [ ] Environment configured (`app.json` extra):
  ```json
  {
    "extra": {
      "useTestnet": false,
      "routerAddress": "0xYourProductionAddress",
      "thetaMainnetRpc": "https://eth-rpc-api.thetatoken.org/rpc"
    }
  }
  ```

### Web (Vite/React)

- [ ] Dependencies installed
  ```bash
  npm install
  ```

- [ ] WalletConnect Project ID set
  ```bash
  echo "VITE_WALLETCONNECT_PROJECT_ID=your_id" > .env.local
  ```
  Get at: https://cloud.walletconnect.com

- [ ] QR modal persistent (no flashing)
  ```tsx
  import ThetaWalletQRModalV2 from './components/ThetaWalletQRModalV2'
  ```

- [ ] Theta chain config correct (ID 361)
  ```typescript
  // utils/walletConnectV2.ts - verify THETA_CHAIN_CONFIG
  ```

- [ ] Session persistence working (localStorage)
  ```typescript
  // Test: Refresh page - should auto-reconnect
  ```

- [ ] Error recovery tested
  ```typescript
  // Test: Force error - should show retry button
  ```

### Both Platforms

- [ ] All tests passing
  ```bash
  # Jest
  npm test
  
  # Cypress
  npm run test:e2e:headless
  ```

- [ ] Linting clean
  ```bash
  npm run lint
  ```

- [ ] Build succeeds
  ```bash
  # Web
  npm run build
  
  # Mobile
  cd edgefarm-mobile && npx expo prebuild
  ```

---

## Mobile Deployment

### Step 1: Configure EAS

```bash
cd edgefarm-mobile

# Install EAS CLI
npm install -g eas-cli

# Login
eas login

# Configure project
eas build:configure
```

### Step 2: Build Production APK/IPA

```bash
# Build for both platforms
eas build --platform all --profile production

# Or individually
eas build --platform android --profile production
eas build --platform ios --profile production
```

**eas.json** (already configured):
```json
{
  "build": {
    "production": {
      "channel": "production",
      "distribution": "store",
      "android": {
        "buildType": "apk"
      },
      "ios": {
        "simulator": false
      }
    }
  }
}
```

### Step 3: Test Build

1. Download APK/IPA from EAS dashboard
2. Install on test device
3. Test wallet connection:
   - Tap "Connect Wallet"
   - Should open Theta Wallet app
   - Approve connection
   - Should return to XFUEL app connected

### Step 4: Submit to Stores

```bash
# Google Play Store
eas submit --platform android --latest

# Apple App Store
eas submit --platform ios --latest
```

**Important**: Ensure deep link handling is tested in store review:
- Reviewer needs Theta Wallet installed
- Provide test account with TFUEL
- Include demo video of deep link flow

---

## Web Deployment (Vercel)

### Step 1: Set Environment Variables

In Vercel dashboard or CLI:

```bash
vercel env add VITE_WALLETCONNECT_PROJECT_ID production
# Paste your WalletConnect Project ID
```

### Step 2: Deploy

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy to production
vercel --prod
```

Or connect GitHub repo in Vercel dashboard for auto-deployments.

### Step 3: Configure Domain

1. Go to Vercel dashboard > Settings > Domains
2. Add custom domain: `app.xfuel.app`
3. Update DNS records as instructed

### Step 4: Test Production

1. Visit production URL
2. Test wallet connections:
   - Desktop: QR code should appear
   - Mobile: Deep link should trigger
   - MetaMask: Browser extension should work
3. Test session persistence:
   - Refresh page - should auto-reconnect
4. Test error recovery:
   - Clear localStorage
   - Retry connection - should work

---

## Post-Deployment

### Monitor Connections

Add analytics to track connection success rates:

```typescript
// Example with Google Analytics
import { useWallet } from './providers/WalletProvider'

function WalletAnalytics() {
  const wallet = useWallet()

  useEffect(() => {
    if (wallet.isConnected) {
      gtag('event', 'wallet_connected', {
        method: wallet.connectionMethod,
        platform: wallet.isMobileDevice ? 'mobile' : 'desktop',
      })
    }
  }, [wallet.isConnected])

  useEffect(() => {
    if (wallet.error) {
      gtag('event', 'wallet_error', {
        error: wallet.error,
      })
    }
  }, [wallet.error])

  return null
}
```

### Error Monitoring

Set up Sentry or similar:

```typescript
import * as Sentry from '@sentry/react'

Sentry.init({
  dsn: 'your-sentry-dsn',
  integrations: [new Sentry.BrowserTracing()],
  tracesSampleRate: 1.0,
})

// In wallet connection error handlers
Sentry.captureException(error, {
  tags: {
    component: 'wallet',
    method: connectionMethod,
  },
})
```

### User Support

Common issues users may face:

1. **"Theta Wallet not opening"**
   - Guide: Install Theta Wallet from app store
   - Provide direct links

2. **"Connection timeout"**
   - Guide: Check internet connection
   - Retry connection

3. **"Wrong network"**
   - Guide: Switch to Theta Mainnet in wallet
   - Provide chain ID (361)

---

## Rollback Plan

If critical issues found:

### Mobile

1. **Revert to previous build**:
   ```bash
   eas build:list
   # Note previous build ID
   eas build:resign --id=<previous-build-id>
   eas submit --id=<previous-build-id>
   ```

2. **Or push hotfix**:
   ```bash
   # Fix issue
   git commit -m "hotfix: wallet connection"
   eas build --platform all --profile production
   eas submit --platform all --latest
   ```

### Web

1. **Revert deployment** in Vercel dashboard
   - Go to Deployments
   - Find previous working deployment
   - Promote to production

2. **Or deploy hotfix**:
   ```bash
   git commit -m "hotfix: QR modal"
   vercel --prod
   ```

---

## Performance Optimization

### Mobile

1. **Enable Hermes** (already configured):
   ```json
   // app.json
   {
     "expo": {
       "android": {
         "enableHermes": true
       }
     }
   }
   ```

2. **Optimize images**:
   ```bash
   npm run extract-logos
   ```

3. **Profile with Flipper**:
   ```bash
   npx react-native run-android --variant=release
   ```

### Web

1. **Enable code splitting**:
   ```tsx
   const ThetaWalletQRModalV2 = lazy(() => import('./components/ThetaWalletQRModalV2'))
   ```

2. **Optimize bundle**:
   ```bash
   npm run build
   npx vite-bundle-visualizer
   ```

3. **Enable Vercel Analytics**:
   ```tsx
   import { Analytics } from '@vercel/analytics/react'
   
   export default function App() {
     return (
       <>
         <YourApp />
         <Analytics />
       </>
     )
   }
   ```

---

## Security Checklist

- [ ] WalletConnect Project ID not committed to repo (use env vars)
- [ ] No private keys or mnemonics in code
- [ ] All transactions require user approval
- [ ] Chain ID verified before transactions
- [ ] Session timeout configured (24 hours)
- [ ] HTTPS enforced in production
- [ ] Content Security Policy configured
- [ ] Rate limiting on backend APIs

---

## Success Metrics

Track these KPIs post-deployment:

- **Connection Success Rate**: >95% target
- **Average Connection Time**: <3s target
- **Session Restore Rate**: >90% target
- **Error Rate**: <5% target
- **User Retention (24h)**: >70% target

---

## Support Resources

- **Theta Wallet Support**: https://support.thetatoken.org
- **WalletConnect Docs**: https://docs.walletconnect.com
- **Expo Docs**: https://docs.expo.dev
- **Vercel Docs**: https://vercel.com/docs

---

**Ready to Deploy? Let's Go! 🚀**

