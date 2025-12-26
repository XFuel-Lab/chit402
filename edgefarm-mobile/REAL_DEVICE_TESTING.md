# XFuel Mobile - Real Device Testing Guide

## 🎯 Quick Start

### Prerequisites
- ✅ Physical iOS device (iPhone 12+ with iOS 15+) OR Android device (Android 11+)
- ✅ Expo Go app installed on your device
- ✅ Theta Wallet app installed (for wallet connection testing)
- ✅ Both computer and mobile device on same WiFi network

---

## 📱 Step 1: Install Required Apps on Your Device

### iOS
1. **Expo Go** (Required for testing)
   - App Store: https://apps.apple.com/app/expo-go/id982107779
   
2. **Theta Wallet** (Required for wallet features)
   - App Store: https://apps.apple.com/app/theta-wallet/id1451094550

### Android
1. **Expo Go** (Required for testing)
   - Play Store: https://play.google.com/store/apps/details?id=host.exp.exponent
   
2. **Theta Wallet** (Required for wallet features)
   - Play Store: https://play.google.com/store/apps/details?id=org.thetatoken.wallet

---

## 🚀 Step 2: Start the Development Server

### Windows
```bash
cd edgefarm-mobile
npm install
npm start
```

### Mac/Linux
```bash
cd edgefarm-mobile
npm install
npm start
```

**You should see:**
```
› Metro waiting on exp://192.168.1.XXX:8081
› Scan the QR code above with Expo Go (Android) or Camera (iOS)

› Press a │ open Android
› Press i │ open iOS simulator
› Press w │ open web

› Press r │ reload app
› Press m │ toggle menu
› Press ? │ show all commands
```

---

## 📲 Step 3: Connect Your Device

### iOS (Camera Method - Easier)
1. Open **Camera** app (native iOS camera)
2. Point at the QR code in your terminal
3. Tap the notification that appears
4. App opens in Expo Go automatically

### iOS (Expo Go Method)
1. Open **Expo Go** app
2. Tap "Scan QR Code"
3. Scan the QR code from your terminal
4. App loads in Expo Go

### Android
1. Open **Expo Go** app
2. Tap "Scan QR code"
3. Scan the QR code from your terminal
4. App loads in Expo Go

**First load takes 30-60 seconds** (downloading JavaScript bundle)

---

## 🧪 Step 4: Test Core Features

### Test 1: Navigation & UI ✅

**What to test:**
- [ ] App loads without crashes
- [ ] Bottom tab bar shows (Home, Swap, Stake, Profile)
- [ ] Swipe between tabs works smoothly
- [ ] Tap on tab icons to switch
- [ ] Pull-to-refresh works on Home screen

**Expected:** Smooth 60 FPS navigation, no lag

---

### Test 2: Wallet Connection (Critical) 🔐

**Go to: Swap Tab**

#### Test 2A: Deep Link Connection
1. [ ] Tap "Connect Theta Wallet" button
2. [ ] Wait for deep link attempt
3. [ ] **Expected:** Theta Wallet app should open automatically
4. [ ] In Theta Wallet: Approve connection
5. [ ] **Expected:** Returns to Expo Go with wallet connected
6. [ ] **Verify:** Address displays (e.g., "0x1234...5678")
7. [ ] **Verify:** Balance displays (e.g., "1,234.56 TFUEL")

**If deep link doesn't work:**
- QR modal should appear as fallback
- Scan QR in Theta Wallet manually
- Connection should succeed within 5 seconds

#### Test 2B: QR Fallback
1. [ ] If deep link failed, QR modal appears
2. [ ] Open Theta Wallet app separately
3. [ ] Tap "Connect" → "Scan QR"
4. [ ] Scan the QR code shown in Expo Go
5. [ ] **Expected:** Connection establishes in < 5s
6. [ ] **Verify:** Balance and address display

**Connection Issues?**
- Check both devices on same WiFi
- Restart Expo Go app
- Restart Theta Wallet app
- Check terminal for error messages

---

### Test 3: Haptic Feedback 📳

**What to test:**
1. [ ] Drag the swap amount slider
   - **Expected:** Light haptic feedback during drag
2. [ ] Tap LST selection buttons
   - **Expected:** Medium haptic on tap
3. [ ] Tap "Swap & Compound" button
   - **Expected:** Heavy haptic on tap

**Note:** Haptics work best on physical devices (not simulators)

---

### Test 4: Swap Flow (End-to-End) 💱

**Prerequisites:**
- [ ] Wallet connected
- [ ] Have some test TFUEL (or use simulation mode)

**Steps:**
1. [ ] On Swap screen, adjust slider to 50%
   - **Verify:** Amount updates in real-time
   - **Verify:** Preview shows estimated LST output
   
2. [ ] Select different LST (tap stkATOM)
   - **Verify:** Preview recalculates
   - **Verify:** APY updates
   
3. [ ] Tap "⚡ Swap & Compound"
   - **Expected:** Button shows "Swapping..."
   - **Expected:** Status message appears
   - **Wait:** 3-5 seconds (simulation delay)
   
4. [ ] **On Success:**
   - [ ] Confetti animation appears 🎉
   - [ ] Success message displays
   - [ ] Success haptic feedback
   - [ ] Balance refreshes automatically

**If Swap Fails:**
- Low balance → Faucet button should appear
- Network error → Clear error message
- Check terminal console for logs

---

### Test 5: Pull-to-Refresh 🔄

**Home Screen:**
1. [ ] Pull down from top of screen
2. [ ] **Expected:** Loading indicator
3. [ ] **Expected:** APY data refreshes
4. [ ] **Expected:** Light haptic feedback
5. [ ] Release and watch content update

**Swap Screen (if connected):**
1. [ ] Pull down from top
2. [ ] **Expected:** Balance refreshes
3. [ ] **Expected:** Light haptic feedback

---

### Test 6: Error Handling ⚠️

#### Test 6A: Network Error
1. [ ] Turn on Airplane Mode on device
2. [ ] Try to connect wallet
3. [ ] **Expected:** "Network error" message
4. [ ] **Expected:** Error dismisses after 5 seconds
5. [ ] Turn off Airplane Mode

#### Test 6B: Insufficient Balance
1. [ ] Make sure balance < 0.1 TFUEL
2. [ ] **Expected:** "Get Test TFUEL" button appears
3. [ ] Tap faucet button
4. [ ] **Expected:** "Test TFUEL requested" message

#### Test 6C: Deep Link Failure
1. [ ] Uninstall Theta Wallet temporarily
2. [ ] Tap "Connect Wallet"
3. [ ] **Expected:** App Store/Play Store link appears
4. [ ] Reinstall Theta Wallet

---

## 🔍 Step 5: Check Console Logs

**In your terminal, watch for:**

**Good signs (✅):**
```
🔌 WalletConnect v2: Initializing...
📱 WalletConnect URI generated: wc:...
✅ Successfully opened Theta Wallet app
✅ Account connected: 0x1234...5678
💰 Balance: 1234.56 TFUEL
✅ [SIMULATION] Swap executed
```

**Issues (❌):**
```
❌ Could not open Theta Wallet app
❌ Connection timeout
❌ Wallet connection error: ...
❌ Balance refresh failed: ...
```

---

## 🎯 Performance Testing

### Frame Rate Test
1. [ ] Open Swap screen
2. [ ] Drag slider rapidly back and forth
3. [ ] **Expected:** Smooth 60 FPS, no stuttering

### Memory Test
1. [ ] Navigate through all tabs multiple times
2. [ ] Connect/disconnect wallet 3-4 times
3. [ ] Execute 2-3 test swaps
4. [ ] **Expected:** No crashes, no memory warnings

### Network Test
1. [ ] Switch WiFi networks
2. [ ] Test with slow 3G/4G connection
3. [ ] **Expected:** App handles slow connections gracefully

---

## 📊 Test Results Template

```
=== XFUEL MOBILE TEST RESULTS ===
Date: _______________
Device: _______________
OS Version: _______________

✅ = Pass | ⚠️ = Issue | ❌ = Fail

Navigation & UI:         [   ]
Wallet Connection:       [   ]
  - Deep Link:          [   ]
  - QR Fallback:        [   ]
Haptic Feedback:         [   ]
Swap Flow:               [   ]
Pull-to-Refresh:         [   ]
Error Handling:          [   ]
Performance (60 FPS):    [   ]
Memory Stability:        [   ]

Overall Score: ___/10

Issues Found:
_________________________________
_________________________________
_________________________________

Additional Notes:
_________________________________
_________________________________
_________________________________
```

---

## 🐛 Common Issues & Solutions

### Issue: QR Code Won't Scan
**Solution:**
- Increase screen brightness
- Hold phone 6-8 inches from screen
- Try camera app instead of Expo Go scanner

### Issue: "Unable to connect to Expo Go"
**Solution:**
- Check both devices on same WiFi
- Disable VPN on computer
- Try different WiFi network
- Use LAN connection option in Expo

### Issue: Deep Link Doesn't Open Theta Wallet
**Solution:**
- Check Theta Wallet is installed
- Try reinstalling Theta Wallet
- Use QR code fallback method
- Check Android intent filters in app.json

### Issue: App Crashes on Startup
**Solution:**
```bash
# Clear Metro cache
cd edgefarm-mobile
npx expo start --clear
```

### Issue: Confetti Doesn't Show
**Solution:**
- This is a visual effect only
- Check terminal logs for swap success
- Ensure `react-native-confetti-cannon` is installed

---

## 🚀 Advanced: Test on Multiple Devices

**Recommended Test Matrix:**

| Device | OS | Network | Result |
|--------|----|---------| -------|
| iPhone 12 Pro | iOS 15 | WiFi | [   ] |
| iPhone 14 | iOS 16 | 5G | [   ] |
| Samsung S21 | Android 12 | WiFi | [   ] |
| Pixel 6 | Android 13 | 4G | [   ] |
| iPad Pro | iOS 16 | WiFi | [   ] |

---

## 📱 Next: Build for TestFlight/Internal Testing

Once real device testing passes:

```bash
# Install EAS CLI
npm install -g eas-cli

# Login
eas login

# Configure
eas build:configure

# Build for internal testing
eas build --platform ios --profile preview
eas build --platform android --profile preview

# Distribute
# iOS: Upload to TestFlight
# Android: Internal testing track on Play Console
```

---

## ✅ Completion Checklist

Before marking testing complete:

- [ ] Tested on at least 2 different devices (1 iOS, 1 Android)
- [ ] All core features work as expected
- [ ] No crashes observed
- [ ] Wallet connection succeeds on both platforms
- [ ] Deep linking works (or QR fallback available)
- [ ] Haptic feedback felt on physical device
- [ ] Swap flow completes successfully
- [ ] Error handling works correctly
- [ ] Performance is smooth (60 FPS)
- [ ] Console logs show no critical errors

**Sign-off:**
- Tester Name: _______________
- Date: _______________
- Ready for TestFlight/Internal Testing: [ ] Yes [ ] No

---

## 🆘 Need Help?

**Check:**
1. Terminal console output (look for error messages)
2. Expo Go error overlay (red screen with error details)
3. `docs/MOBILE_APP_REVIEW.md` for detailed troubleshooting

**Common Error Patterns:**
- "Network request failed" → Check WiFi connection
- "Module not found" → Run `npm install` again
- "Unable to resolve module" → Clear cache: `npx expo start --clear`

---

**🎉 Good luck with testing!**

If all tests pass, you're ready to build production versions and submit to app stores!

