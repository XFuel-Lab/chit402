# 📦 Mobile App Package Installation Guide

## **Required Packages for New Features**

The following packages need to be installed in `edgefarm-mobile/` for the new features to work:

### **1. Push Notifications (Priority 4)**

```bash
cd edgefarm-mobile
npx expo install expo-notifications
```

**Usage**: Sends local notifications when Edge Node earns TFUEL.

### **2. QR Code Generation (Priority 5)**

Already installed in package.json:
- ✅ `react-native-qrcode-svg` (v6.3.1)
- ✅ `react-native-svg` (v15.9.0)

**No additional installation needed.**

---

## **Installation Script (Run in edgefarm-mobile/)**

```bash
# Navigate to mobile app directory
cd edgefarm-mobile

# Install required packages
npx expo install expo-notifications

# Verify installation
npm list expo-notifications

# Expected output:
# edgefarm-mobile@1.0.0 /path/to/edgefarm-mobile
# └── expo-notifications@~0.XX.XX
```

---

## **Configuration Steps**

### **1. Update app.json (iOS Permissions)**

Add notification permissions to `edgefarm-mobile/app.json`:

```json
{
  "expo": {
    "plugins": [
      "expo-font",
      [
        "expo-notifications",
        {
          "sounds": ["./assets/notification-sound.wav"],
          "icon": "./assets/notification-icon.png",
          "color": "#A855F7",
          "mode": "production"
        }
      ]
    ],
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "app.xfuel.mobile",
      "infoPlist": {
        "NSUserNotificationsUsageDescription": "XFUEL sends you notifications when your Edge Node earns TFUEL, so you never miss a pulse!"
      }
    },
    "android": {
      ...
    }
  }
}
```

### **2. Update HomeScreen to Request Permissions**

The `EdgeNodePulseTracker` component already has the hook for push notifications. Add permission request on app launch:

```typescript
// In edgefarm-mobile/App.tsx (or HomeScreen.tsx)
import { requestNotificationPermissions } from './src/lib/pushNotifications'

useEffect(() => {
  // Request notification permissions on app launch
  requestNotificationPermissions().then(granted => {
    if (granted) {
      console.log('Notification permissions granted')
    } else {
      console.warn('Notification permissions denied')
    }
  })
}, [])
```

### **3. Wire Up Push Notifications in EdgeNodePulseTracker**

Update the `onEarningPulse` callback in `HomeScreen.tsx`:

```typescript
import { sendEarningNotification } from '../lib/pushNotifications'

<EdgeNodePulseTracker
  nodeAddress={walletAddress} // Connect to real wallet
  isDemo={false} // Use real data
  onEarningPulse={async (earning) => {
    console.log('New earning pulse:', earning)
    // Send push notification
    await sendEarningNotification(earning)
  }}
/>
```

---

## **Testing**

### **1. Test Push Notifications (Expo Go)**

```bash
cd edgefarm-mobile
npm run start
```

1. Scan QR code with Expo Go app
2. App requests notification permissions → **Allow**
3. EdgeNodePulseTracker detects new earnings (demo mode)
4. Notification appears: "🎥 Edge Node Earning: Your node earned 2.4 TFUEL from video! 🤑"

### **2. Test Referral QR (Physical Device)**

```bash
npm run start
```

1. Navigate to HomeScreen (or wherever ReferralQRCard is)
2. Connect wallet (or use demo address)
3. Tap "Show QR Code" → QR appears
4. Tap "Share Link" → native share sheet opens
5. Share to WhatsApp/Telegram → referral link appears

---

## **Build for Production**

### **iOS TestFlight**

```bash
cd edgefarm-mobile
npx eas-cli build --platform ios --profile preview
```

### **Android APK**

```bash
cd edgefarm-mobile
npx eas-cli build --platform android --profile preview
```

---

## **Troubleshooting**

### **Issue: Notifications not appearing**

**Solution**:
1. Check permissions: Settings → XFUEL → Notifications → **Enabled**
2. Verify Expo Notifications installed: `npm list expo-notifications`
3. Check logs: `npx expo start` → look for "Notification sent" logs

### **Issue: QR code not rendering**

**Solution**:
1. Verify `react-native-svg` installed: `npm list react-native-svg`
2. Clear cache: `npx expo start -c`
3. Rebuild app: `npx expo prebuild --clean`

### **Issue: Share sheet not opening**

**Solution**:
1. Test on physical device (share doesn't work in simulator)
2. Verify `expo-sharing` permissions in app.json
3. Check console for errors: `await Share.share({ ... })`

---

## **Post-Installation Checklist**

- ✅ `expo-notifications` installed
- ✅ `app.json` updated with notification permissions
- ✅ Notification permissions requested on app launch
- ✅ Push notifications wired up in EdgeNodePulseTracker
- ✅ Referral QR tested on physical device
- ✅ Share functionality tested (WhatsApp/Telegram)
- ✅ Production build tested (TestFlight/APK)

---

## **Next Steps**

1. **Connect real Edge Node address**: Replace `isDemo={true}` with real wallet address
2. **Backend API for referral tracking**: Store referrals on-chain or backend
3. **Daily summary notifications**: Schedule at 11 PM daily
4. **Deep linking**: Handle notification taps → navigate to dashboard

---

**Ready to ship! 🚀**

