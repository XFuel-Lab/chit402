# Quick Start - Run the Interstellar App 🚀

## Prerequisites

Ensure you have:
- Node.js v24+ installed
- npm v10+ installed
- Expo Go app on your phone (iOS/Android)

## Installation Steps

### 1. Navigate to Mobile Directory

```bash
cd edgefarm-mobile
```

### 2. Install Dependencies

```bash
npm install
```

**Expected time:** 2-3 minutes

### 3. Start Development Server

```bash
npm start
```

This will:
- Start Expo Metro bundler
- Display QR code in terminal
- Open browser with Expo Dev Tools

### 4. Run on Your Device

**iOS:**
1. Open Camera app
2. Point at QR code in terminal
3. Tap notification to open in Expo Go
4. Wait for bundle to load (~30 seconds first time)

**Android:**
1. Open Expo Go app
2. Tap "Scan QR code"
3. Point at QR code in terminal
4. Wait for bundle to load (~30 seconds first time)

**Emulator/Simulator:**
- Press `i` in terminal for iOS Simulator
- Press `a` in terminal for Android Emulator

### 5. Test Features

Once app loads:

1. **Skip Onboarding** (if shown)
2. **Navigate to Home Screen:**
   - See CockPit Dashboard with animated gauges
   - Check streak badge (1-day streak auto-created)
3. **Navigate to Swap Screen:**
   - Tap "Smart Connect" to connect Theta Wallet
   - Scroll through LST Carousel (parallax animations)
   - Adjust swap amount with slider
   - Tap "Swap & Compound" (will show toast for testing)
4. **Test Voice Commands:**
   - Tap mic icon on Home screen
   - Say "show my yields" or "navigate to swap"
5. **Test Biometric (if available):**
   - Navigate to Profile
   - Enable biometric authentication
   - Close and reopen app
   - Authenticate with Face ID / Touch ID

## Troubleshooting

### "Cannot find module" errors

```bash
# Clear cache and reinstall
rm -rf node_modules
npm install
npm start --clear
```

### "Metro bundler crashed"

```bash
# Reset Metro
npm start -- --reset-cache
```

### Expo Go app not connecting

1. Ensure phone and computer on same WiFi
2. Try tunnel mode: `npm start -- --tunnel`
3. Or use Expo Dev Client (custom build)

### TypeScript errors

These won't prevent the app from running in development, but to fix:

```bash
# Check types
npx tsc --noEmit

# Auto-fix some issues
npm run lint --fix
```

## Next Steps

- See [README.md](./README.md) for full feature documentation
- See [TESTING_GUIDE.md](./TESTING_GUIDE.md) for comprehensive test cases
- See [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) for production deployment

## Need Help?

- Check console logs in terminal
- Enable Debug Mode in Expo Go settings
- Review error messages in app UI

---

**Enjoy your interstellar journey! 🌌**

