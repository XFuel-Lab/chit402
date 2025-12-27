# XFuel Protocol - WalletConnect v2 Deployment Checklist

## 🎯 Pre-Deployment Checklist

### Environment Configuration

#### Web Application

- [ ] **WalletConnect Project ID**
  - Create project at https://cloud.walletconnect.com
  - Add `VITE_WALLETCONNECT_PROJECT_ID` to Vercel environment variables
  - Test in local `.env.local` first

- [ ] **Contract Addresses**
  - Verify `VITE_ROUTER_ADDRESS` points to Theta Mainnet router
  - Verify `VITE_TIP_POOL_ADDRESS` points to Theta Mainnet tip pool
  - Confirm addresses match deployed contracts in `deployments/` folder

- [ ] **API Configuration**
  - Set `VITE_API_URL` to production backend URL
  - Ensure CORS is configured for production domain
  - Test API health endpoint: `https://api.xfuel.app/health`

#### Mobile Application

- [ ] **Expo Configuration**
  - Update `edgefarm-mobile/app.json` with production metadata
  - Set correct `scheme` for deep linking (e.g., "xfuel")
  - Configure Android `intentFilters` for `theta://` scheme
  - Update app icons and splash screens

- [ ] **Environment Variables**
  - Add production API URL to `edgefarm-mobile/.env`
  - Verify router address matches mainnet

- [ ] **EAS Build**
  - Configure `eas.json` for production builds
  - Set Node version to 24.0.0
  - Configure iOS/Android signing credentials

#### Backend

- [ ] **Server Configuration**
  - Set `SIMULATION_MODE=false` for production
  - Configure rate limiting (if implemented)
  - Set up error tracking (Sentry)
  - Enable production logging

---

## 🧪 Testing Requirements

### Web Testing

#### Wallet Connection

- [ ] **Theta Wallet Extension**
  - Connect on Chrome
  - Connect on Firefox
  - Connect on Brave
  - Verify balance displays correctly
  - Test disconnect/reconnect

- [ ] **WalletConnect v2**
  - Scan QR with Theta Wallet mobile app
  - Verify connection establishes in < 3 seconds
  - Test session persistence (refresh page)
  - Test disconnect from mobile

- [ ] **MetaMask**
  - Connect with MetaMask
  - Verify Theta network auto-add prompt
  - Switch between networks
  - Test transaction signing

#### Swap Functionality

- [ ] **Amount Selection**
  - Test preset buttons (25%, 50%, 100%, MAX)
  - Test manual input
  - Test MAX button with gas reservation
  - Verify balance validation

- [ ] **LST Selection**
  - Test all LST options (stkTIA, stkATOM, stkXPRT, stkOSMO, pSTAKE BTC, USDC)
  - Verify APY data loads from API
  - Test fallback APY values if API fails

- [ ] **Swap Execution**
  - Execute swap with < 0.1 TFUEL (should simulate)
  - Execute swap with sufficient balance (real transaction)
  - Verify transaction submission
  - Verify success modal displays
  - Check transaction on Theta Explorer

#### Error Handling

- [ ] Test insufficient balance error
- [ ] Test network error (disconnect during swap)
- [ ] Test user rejection (cancel transaction)
- [ ] Test invalid input (negative amounts, etc.)
- [ ] Test expired session (reconnect prompt)

### Mobile Testing

#### Device Testing

- [ ] **iOS**
  - iPhone 12+ (iOS 15+)
  - iPad Pro
  - Test on Simulator
  - Test on physical device

- [ ] **Android**
  - Samsung Galaxy S21+
  - Google Pixel 6+
  - Test on Emulator
  - Test on physical device

#### Wallet Connection

- [ ] Tap "Connect Wallet" opens Theta Wallet app
- [ ] QR fallback if app not installed
- [ ] App Store redirect if wallet missing
- [ ] Connection success shows address and balance
- [ ] Reconnection works after app restart

#### Swap Flow

- [ ] Slider changes amount smoothly
- [ ] Haptic feedback on all taps
- [ ] LST selection updates preview
- [ ] "Swap & Compound" executes correctly
- [ ] Confetti animation on success
- [ ] Error messages display clearly

#### Pull-to-Refresh

- [ ] Pull-to-refresh updates balance
- [ ] Pull-to-refresh updates APYs
- [ ] Loading indicator shows during refresh

### Security Testing

- [ ] **Input Validation**
  - Submit invalid address → rejected
  - Submit negative amount → rejected
  - Submit amount > balance → rejected
  - Submit invalid LST → rejected
  - Submit expired timestamp → rejected

- [ ] **Nonce Validation**
  - Sign message twice with same nonce → second rejected
  - Verify nonce updates after each signature

- [ ] **SQL Injection** (if using database)
  - Test input: `'; DROP TABLE users; --`
  - Verify proper escaping/parameterization

- [ ] **XSS Prevention**
  - Test input: `<script>alert('XSS')</script>`
  - Verify output is sanitized

---

## 🚀 Deployment Steps

### Step 1: Web Deployment (Vercel)

```bash
# 1. Build locally to verify
npm run build
npm run preview

# 2. Deploy to staging
vercel deploy

# 3. Test staging environment
# - Connect wallet
# - Execute test swap
# - Verify all features work

# 4. Deploy to production
vercel deploy --prod

# 5. Post-deployment checks
# - Test on multiple browsers
# - Check Sentry for errors
# - Monitor API logs
```

**Vercel Configuration:**

```json
// vercel.json
{
  "framework": "vite",
  "buildCommand": "npm run build",
  "devCommand": "npm run dev",
  "installCommand": "npm install",
  "outputDirectory": "dist",
  "env": {
    "VITE_WALLETCONNECT_PROJECT_ID": "@walletconnect-project-id",
    "VITE_ROUTER_ADDRESS": "@router-address-mainnet",
    "VITE_TIP_POOL_ADDRESS": "@tip-pool-address-mainnet",
    "VITE_API_URL": "https://api.xfuel.app"
  }
}
```

### Step 2: Mobile Deployment (Expo EAS)

```bash
cd edgefarm-mobile

# 1. Login to Expo
npx eas-cli login

# 2. Configure project
npx eas-cli build:configure

# 3. Build for iOS
npx eas-cli build --platform ios --profile production

# 4. Build for Android
npx eas-cli build --platform android --profile production

# 5. Download builds and test locally
# iOS: Install on device via TestFlight first
# Android: Install APK directly for testing

# 6. Submit to App Store
npx eas-cli submit --platform ios

# 7. Submit to Google Play
npx eas-cli submit --platform android
```

**EAS Configuration:**

```json
// eas.json
{
  "build": {
    "production": {
      "node": "24.0.0",
      "channel": "production",
      "env": {
        "EXPO_PUBLIC_API_URL": "https://api.xfuel.app"
      },
      "ios": {
        "bundleIdentifier": "com.xfuel.app"
      },
      "android": {
        "package": "com.xfuel.app"
      }
    },
    "preview": {
      "node": "24.0.0",
      "channel": "preview",
      "distribution": "internal"
    }
  },
  "submit": {
    "production": {
      "ios": {
        "appleId": "your-apple-id@example.com",
        "ascAppId": "your-app-store-connect-id"
      },
      "android": {
        "serviceAccountKeyPath": "./google-play-key.json"
      }
    }
  }
}
```

### Step 3: Backend Deployment

```bash
# Option 1: Deploy to Vercel (serverless)
vercel deploy --prod

# Option 2: Deploy to Docker
docker build -t xfuel-backend .
docker run -p 3001:3001 \
  -e SIMULATION_MODE=false \
  -e PORT=3001 \
  xfuel-backend

# Option 3: Deploy to VPS
ssh user@your-server
cd /opt/xfuel-backend
git pull origin main
npm install --production
pm2 restart xfuel-backend
```

---

## 📊 Post-Deployment Monitoring

### Metrics to Track

- [ ] **Connection Success Rate**
  - Target: > 95%
  - Track: Theta, WalletConnect, MetaMask separately

- [ ] **Swap Success Rate**
  - Target: > 98% (excluding user rejections)
  - Track: By LST type

- [ ] **Average Swap Time**
  - Target: < 4 seconds on Theta Mainnet
  - Measure: From button click to confirmation

- [ ] **Error Rate**
  - Target: < 2%
  - Track: By error type (network, validation, user rejection)

- [ ] **Mobile App Stability**
  - Target: < 0.5% crash rate
  - Monitor: Via Sentry or Firebase Crashlytics

### Monitoring Tools

- [ ] **Sentry** - Error tracking
- [ ] **PostHog** - Analytics and feature flags
- [ ] **Vercel Analytics** - Web vitals
- [ ] **Expo Application Services** - Mobile crashes

---

## 🔒 Security Post-Launch

### Immediate Actions

- [ ] Enable Chainalysis alerts for suspicious transactions
- [ ] Set up rate limiting (10 requests/minute per IP)
- [ ] Monitor for unusual wallet activity patterns
- [ ] Review smart contract permissions

### Weekly Reviews

- [ ] Review error logs for security-related errors
- [ ] Check for failed validation attempts
- [ ] Monitor API rate limit hits
- [ ] Review WalletConnect session metrics

### Monthly Audits

- [ ] Smart contract audit (if changes made)
- [ ] Penetration testing
- [ ] Dependency updates (npm audit)
- [ ] Review access logs

---

## 🆘 Rollback Plan

### Web Application

```bash
# Rollback to previous deployment
vercel rollback
```

### Mobile Application

**iOS:**
- Submit hotfix build to App Store Connect
- Request expedited review (if critical bug)
- Typical approval time: 24-48 hours

**Android:**
- Submit hotfix to Google Play
- Use staged rollout (10% → 50% → 100%)
- Rollback available within minutes

### Backend

```bash
# If using PM2
pm2 restart xfuel-backend --update-env

# If using Docker
docker stop xfuel-backend
docker run <previous-image-tag>

# If using git
git revert HEAD
npm install
pm2 restart xfuel-backend
```

---

## ✅ Final Sign-Off

Before marking deployment as complete:

- [ ] All checklist items above completed
- [ ] No critical errors in Sentry
- [ ] All team members tested on their devices
- [ ] Documentation updated (README, API docs)
- [ ] Announcement prepared for users
- [ ] Support team briefed on new features
- [ ] Monitoring dashboards configured

**Deployed By:** _______________  
**Date:** _______________  
**Verified By:** _______________  
**Production URL:** https://xfuel.app  
**API URL:** https://api.xfuel.app  
**iOS App:** https://apps.apple.com/app/xfuel  
**Android App:** https://play.google.com/store/apps/details?id=com.xfuel.app

---

**🎉 Congratulations on the deployment!**

Monitor closely for the first 24 hours and be ready to rollback if needed.

