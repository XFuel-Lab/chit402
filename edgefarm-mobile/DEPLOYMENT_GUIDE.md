# XFuel Protocol Mobile - Production Deployment Guide

## Overview

Complete guide for deploying the XFuel Protocol mobile app to production (iOS App Store & Google Play Store) using Expo EAS (Expo Application Services).

---

## Prerequisites

### Required Accounts

1. **Apple Developer Account** ($99/year)
   - Required for iOS builds
   - Sign up: https://developer.apple.com

2. **Google Play Developer Account** ($25 one-time)
   - Required for Android builds
   - Sign up: https://play.google.com/console

3. **Expo Account** (Free)
   - Required for EAS builds
   - Sign up: https://expo.dev

### Required Tools

```bash
# Install Node.js (v24+)
node --version  # Should be >= 24.0.0

# Install EAS CLI globally
npm install -g eas-cli

# Login to Expo
eas login
```

---

## Step 1: Environment Configuration

### 1.1 Update `app.json`

```json
{
  "expo": {
    "name": "XFuel Protocol",
    "slug": "xfuel-protocol",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "userInterfaceStyle": "dark",
    "splash": {
      "image": "./assets/splash-icon.png",
      "resizeMode": "contain",
      "backgroundColor": "#05050a"
    },
    "assetBundlePatterns": [
      "**/*"
    ],
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.xfuel.protocol",
      "buildNumber": "1",
      "infoPlist": {
        "NSFaceIDUsageDescription": "Unlock XFuel Protocol with Face ID for secure access to your wallet.",
        "NSCameraUsageDescription": "Scan QR codes for wallet connection.",
        "NSPhotoLibraryUsageDescription": "Save QR codes and share yield reports."
      }
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#05050a"
      },
      "package": "com.xfuel.protocol",
      "versionCode": 1,
      "permissions": [
        "USE_BIOMETRIC",
        "USE_FINGERPRINT",
        "CAMERA",
        "WRITE_EXTERNAL_STORAGE",
        "READ_EXTERNAL_STORAGE"
      ]
    },
    "web": {
      "favicon": "./assets/favicon.png"
    },
    "extra": {
      "routerAddress": "0xYourProductionRouterAddress",
      "apiUrl": "https://api.xfuel.app",
      "thetaMainnetRpc": "https://eth-rpc-api.thetatoken.org/rpc",
      "thetaMainnetChainId": 361,
      "thetaExplorerUrl": "https://explorer.thetatoken.org",
      "eas": {
        "projectId": "your-expo-project-id"
      }
    },
    "updates": {
      "url": "https://u.expo.dev/your-expo-project-id"
    },
    "runtimeVersion": {
      "policy": "appVersion"
    }
  }
}
```

### 1.2 Create `eas.json`

```json
{
  "cli": {
    "version": ">= 5.0.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": {
        "simulator": true
      }
    },
    "preview": {
      "distribution": "internal",
      "ios": {
        "simulator": false
      },
      "android": {
        "buildType": "apk"
      }
    },
    "production": {
      "autoIncrement": true,
      "env": {
        "NODE_ENV": "production"
      }
    }
  },
  "submit": {
    "production": {
      "ios": {
        "appleId": "your-apple-id@example.com",
        "ascAppId": "your-app-store-connect-app-id",
        "appleTeamId": "your-apple-team-id"
      },
      "android": {
        "serviceAccountKeyPath": "./google-service-account.json",
        "track": "internal"
      }
    }
  }
}
```

---

## Step 2: Assets Preparation

### 2.1 App Icon (1024x1024 PNG)

Create high-resolution app icon:
- Location: `./assets/icon.png`
- Size: 1024x1024px
- Format: PNG with transparency
- Design: XFuel logo with neon glow effect

### 2.2 Adaptive Icon (Android)

Create adaptive icon foreground:
- Location: `./assets/adaptive-icon.png`
- Size: 1024x1024px
- Safe area: Center 512x512px
- Format: PNG with transparency

### 2.3 Splash Screen

Create splash screen:
- Location: `./assets/splash-icon.png`
- Size: 1242x2436px (iPhone X resolution)
- Format: PNG
- Design: XFuel logo centered on dark cyberpunk background

---

## Step 3: iOS Build & Submission

### 3.1 Configure iOS Credentials

```bash
# Generate iOS credentials (certificates, provisioning profiles)
eas credentials
```

Select:
- Platform: iOS
- Action: "Set up new credentials"
- Follow prompts to generate or upload certificates

### 3.2 Build for iOS

```bash
# Production build
eas build --platform ios --profile production

# Wait for build to complete (~15-30 minutes)
# Build URL will be provided
```

### 3.3 Test iOS Build (TestFlight)

```bash
# Submit to TestFlight for internal testing
eas submit --platform ios --profile production

# Or manually upload via Transporter app
# Download .ipa from EAS dashboard
# Upload to App Store Connect
```

### 3.4 App Store Submission

1. **App Store Connect Setup:**
   - Go to https://appstoreconnect.apple.com
   - Create new app
   - Fill in app information:
     - Name: "XFuel Protocol"
     - Primary Category: Finance
     - Subtitle: "DeFi Yields Made Luxury"
     - Keywords: "defi, cryptocurrency, staking, yields, cosmos, theta"

2. **Screenshots (Required):**
   - 6.5" Display (iPhone 14 Pro Max): 1290x2796px
   - 5.5" Display (iPhone 8 Plus): 1242x2208px
   - Upload 3-5 screenshots per size showing:
     - CockPit Dashboard with gauges
     - LST Carousel with parallax
     - Swap screen with confetti
     - Profile with streak badges

3. **App Description:**

```
Transform Theta EdgeCloud revenue into Cosmos LST yields—seamlessly, beautifully, instantly.

🚀 LUXURY DEFI
• Tesla dashboard elegance
• Bugatti-grade UI polish
• Cyberpunk neon aesthetics

💎 FEATURES
• AI Smart Connect - Predictive wallet sessions
• CockPit Dashboard - Animated gauge clusters
• LST Carousel - Parallax yield selection
• Biometric Security - Face ID / Touch ID
• Gamified Streaks - Mars-themed badge unlocks
• Voice Commands - Hands-free navigation

⚡ ONE-TAP SWAPS
Swap TFUEL to stkXPRT, stkATOM, stkTIA with confetti celebrations and real-time APY tracking.

🔐 INSTITUTIONAL SECURITY
• Nonce-based replay protection
• AsyncStorage session persistence
• WalletConnect v2 with deep linking

Built for those who demand excellence. Launch to Mars with us.
```

4. **Submit for Review:**
   - Select build from TestFlight
   - Answer App Store review questions
   - Submit for review (typically 24-48 hours)

---

## Step 4: Android Build & Submission

### 4.1 Generate Keystore

```bash
# EAS will auto-generate or you can provide your own
eas credentials
```

Select:
- Platform: Android
- Action: "Generate new keystore"

### 4.2 Build for Android

```bash
# Production build (AAB for Play Store)
eas build --platform android --profile production

# Wait for build to complete (~15-30 minutes)
```

### 4.3 Test Android Build

```bash
# Download APK for testing
# Or create preview build:
eas build --platform android --profile preview
```

Install on test device:
```bash
adb install path/to/app.apk
```

### 4.4 Google Play Submission

1. **Play Console Setup:**
   - Go to https://play.google.com/console
   - Create new app
   - Fill in app details:
     - App name: "XFuel Protocol"
     - Category: Finance
     - Tags: defi, cryptocurrency, staking

2. **Store Listing:**

   **Short Description:**
   ```
   Transform Theta revenue to Cosmos LST yields. Luxury DeFi with AI, biometrics, and Tesla vibes.
   ```

   **Full Description:**
   ```
   XFuel Protocol: The Future of DeFi in Your Pocket

   LUXURY DEFI EXPERIENCE
   • Tesla dashboard elegance meets Bugatti polish
   • Dark cyberpunk theme with neon glows
   • 60fps animations powered by React Native Reanimated

   SMART FEATURES
   • AI Smart Connect - Predictive wallet restoration
   • CockPit Dashboard - Real-time animated gauges
   • LST Carousel - Parallax scrolling yield selection
   • Biometric Security - Fingerprint / Face unlock
   • Gamified Streaks - Daily check-ins with Mars badges
   • Voice Commands - "Show my yields" hands-free nav

   ONE-TAP SWAPS
   Swap TFUEL to stkXPRT, stkATOM, stkTIA, stkOSMO with:
   • Confetti celebrations on success
   • Live APY tracking
   • Real-time price feeds
   • Gas-free transactions

   SECURITY FIRST
   • Nonce + timestamp validation
   • Replay attack prevention
   • Session persistence with AsyncStorage
   • WalletConnect v2 with deep linking

   Join the crew. Launch to Mars. 🚀
   ```

3. **Screenshots (Required):**
   - 16:9 aspect ratio: 1920x1080px
   - Upload 4-8 screenshots showing key features
   - Add feature graphic: 1024x500px

4. **Content Rating:**
   - Complete questionnaire (app is for ages 13+)
   - Select "Finance" category

5. **Release:**
   - Upload AAB (Android App Bundle)
   - Create internal testing track first
   - Test with 20+ users for 14 days
   - Promote to production
   - Submit for review (typically 1-3 days)

---

## Step 5: OTA Updates (Over-The-Air)

For instant updates without app store review:

### 5.1 Configure Updates

Already configured in `app.json`:
```json
{
  "updates": {
    "url": "https://u.expo.dev/your-expo-project-id"
  },
  "runtimeVersion": {
    "policy": "appVersion"
  }
}
```

### 5.2 Publish Update

```bash
# Publish update to production branch
eas update --branch production --message "Luxury polish: smoother animations"

# Users will receive update on next app launch
```

### 5.3 Update Best Practices

**What can be updated via OTA:**
- JavaScript/TypeScript code
- React components
- Assets (images, fonts)
- Business logic

**What requires new build:**
- Native modules (Expo modules)
- `app.json` configuration
- Permissions changes
- Native code modifications

---

## Step 6: Monitoring & Analytics

### 6.1 Crash Reporting

Integrate Sentry:

```bash
npm install @sentry/react-native
```

Configure in `App.tsx`:
```typescript
import * as Sentry from '@sentry/react-native'

Sentry.init({
  dsn: 'your-sentry-dsn',
  environment: 'production',
})
```

### 6.2 Analytics

Integrate Expo Analytics:

```bash
npm install expo-firebase-analytics
```

Or use custom analytics:
```typescript
import Analytics from '@segment/analytics-react-native'

Analytics.track('Swap Completed', {
  amount: tfuelAmount,
  targetLST: selectedLST.name,
  apy: selectedLST.apy,
})
```

### 6.3 Performance Monitoring

Use Expo Performance Monitoring:

```bash
npx expo install expo-performance
```

---

## Step 7: Post-Launch

### 7.1 App Store Optimization (ASO)

**Keywords:**
- defi protocol
- cryptocurrency yields
- staking rewards
- cosmos network
- theta network
- liquid staking
- passive income crypto

**Screenshots Tips:**
- Show confetti animations
- Highlight luxury UI
- Display real APY numbers
- Show streak badges

### 7.2 User Feedback

Monitor:
- App Store reviews
- Google Play reviews
- Discord feedback
- Twitter mentions

### 7.3 Marketing

**Launch Channels:**
- Twitter announcement thread
- Discord community event
- Theta Labs partnership announcement
- Cosmos community forums
- Product Hunt launch
- Reddit (r/cosmosnetwork, r/theta_network)

---

## Troubleshooting

### Build Failures

**iOS Code Signing Error:**
```bash
# Regenerate credentials
eas credentials --clear-provisioning-profile
eas build --platform ios --profile production
```

**Android Keystore Error:**
```bash
# Generate new keystore
eas credentials --platform android
```

### OTA Update Not Applying

**Check runtime version:**
```bash
# Ensure runtimeVersion matches between app and update
eas update:configure
```

### Performance Issues

**Optimize bundle size:**
```bash
# Analyze bundle
npx react-native-bundle-visualizer

# Remove unused dependencies
npm uninstall unused-package
```

---

## Checklist

### Pre-Launch
- [ ] All features tested on Theta Mainnet
- [ ] UI/UX reviewed for luxury polish
- [ ] Performance: 60fps animations verified
- [ ] Biometric auth working (iOS/Android)
- [ ] Voice commands functional
- [ ] Crash reporting configured
- [ ] Analytics integrated
- [ ] Privacy policy hosted (required)
- [ ] Terms of service hosted (required)

### iOS Submission
- [ ] Apple Developer account active
- [ ] App icon 1024x1024 ready
- [ ] Screenshots taken (all sizes)
- [ ] App description written
- [ ] TestFlight testing complete
- [ ] Build uploaded to App Store Connect
- [ ] Submitted for review

### Android Submission
- [ ] Google Play account active
- [ ] App icon 512x512 ready
- [ ] Screenshots taken (1920x1080)
- [ ] Feature graphic created (1024x500)
- [ ] Store listing complete
- [ ] Content rating obtained
- [ ] Internal testing complete (14 days)
- [ ] Submitted for review

### Post-Launch
- [ ] Monitor crash reports
- [ ] Respond to reviews
- [ ] Plan OTA updates
- [ ] Marketing campaign launched
- [ ] Community engagement active

---

## Resources

- **Expo EAS Docs:** https://docs.expo.dev/eas
- **App Store Guidelines:** https://developer.apple.com/app-store/review/guidelines
- **Google Play Policies:** https://play.google.com/about/developer-content-policy
- **XFuel Discord:** [Your Discord Link]
- **Support Email:** support@xfuel.app

---

**Ready to launch? Execute with confidence. To Mars! 🚀**

