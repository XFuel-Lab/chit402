#!/usr/bin/env node

/**
 * App Store Screenshot Generator
 * 
 * Generates screenshots for App Store submission:
 * - 6.5" iPhone (iPhone 14 Pro Max, iPhone 13 Pro Max)
 * - 5.5" iPhone (iPhone 8 Plus)
 * 
 * Usage:
 *   npx expo start
 *   node scripts/generate-screenshots.js
 * 
 * Or with EAS:
 *   eas build --profile preview
 */

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const SCREENSHOT_SIZES = {
  '6.5': {
    width: 1284,
    height: 2778,
    device: 'iPhone 14 Pro Max',
    name: '6.5-inch',
  },
  '5.5': {
    width: 1242,
    height: 2208,
    device: 'iPhone 8 Plus',
    name: '5.5-inch',
  },
}

const SCREENS_TO_CAPTURE = [
  { screen: 'Home', route: 'Home' },
  { screen: 'Swap', route: 'Swap' },
  { screen: 'Pools', route: 'Pools' },
  { screen: 'Dashboard', route: 'Home' },
  { screen: 'Creator', route: 'Creator' },
  { screen: 'Profile', route: 'Profile' },
]

console.log('📸 XFUEL App Store Screenshot Generator\n')

// Check if Expo is installed
try {
  execSync('npx expo --version', { stdio: 'ignore' })
} catch (error) {
  console.error('❌ Expo CLI not found. Please install: npm install -g expo-cli')
  process.exit(1)
}

// Create screenshots directory
const screenshotsDir = path.join(__dirname, '../screenshots')
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true })
}

console.log('📱 Generating screenshots for App Store submission...\n')

// Instructions for manual screenshot generation
const instructions = `
MANUAL SCREENSHOT GENERATION INSTRUCTIONS
=========================================

Since automated screenshot generation requires a running Expo app,
please follow these steps:

1. Start your Expo development server:
   cd edgefarm-mobile
   npx expo start

2. Open the app in Expo Go or a development build on:
   - iPhone 14 Pro Max (6.5" display) OR
   - iPhone 8 Plus (5.5" display)

3. Navigate to each screen and take screenshots:
${SCREENS_TO_CAPTURE.map((s, i) => `   ${i + 1}. ${s.screen} screen`).join('\n')}

4. Save screenshots to: ${screenshotsDir}

5. Name files as:
   - 6.5-inch: ${SCREENS_TO_CAPTURE.map(s => `${s.screen.toLowerCase()}-6.5.png`).join(', ')}
   - 5.5-inch: ${SCREENS_TO_CAPTURE.map(s => `${s.screen.toLowerCase()}-5.5.png`).join(', ')}

ALTERNATIVE: Use EAS Build Preview
===================================

For automated screenshots with EAS:

1. Configure eas.json with preview profile
2. Run: eas build --profile preview --platform ios
3. Install preview build on physical device
4. Use iOS screenshot shortcut (Power + Volume Up)
5. Screenshots saved to Photos app

REQUIREMENTS FOR APP STORE
==========================

App Store Connect requires:
- 6.5" display: 1284 x 2778 pixels (portrait)
- 5.5" display: 1242 x 2208 pixels (portrait)
- PNG format
- No status bar (use Expo's StatusBar component)
- No device frame (screenshot only)

TIPS
====

1. Ensure all screens show proper glassmorphism effects
2. Use dark mode only (as per design requirements)
3. Include sample data that showcases features
4. Remove any debug overlays or development indicators
5. Test on actual devices for best quality

For more info: https://developer.apple.com/app-store/product-page/
`

console.log(instructions)

// Create a helper script for iOS Simulator (if available)
const simulatorScript = `
# iOS Simulator Screenshot Helper
# Run this after starting Expo in iOS Simulator

SCREENS=("Home" "Swap" "Pools" "Dashboard" "Creator" "Profile")
DEVICES=("iPhone 14 Pro Max" "iPhone 8 Plus")

for device in "${DEVICES[@]}"; do
  echo "📱 Switching to $device..."
  xcrun simctl boot "$device" 2>/dev/null || true
  
  for screen in "${SCREENS[@]}"; do
    echo "📸 Capturing $screen on $device..."
    # Navigate to screen in app (manual step)
    # Then capture:
    xcrun simctl io booted screenshot "screenshots/${screen}-${device// /-}.png"
  done
done

echo "✅ Screenshots saved to screenshots/"
`

fs.writeFileSync(
  path.join(__dirname, '../scripts/simulator-screenshots.sh'),
  simulatorScript,
  { mode: 0o755 }
)

console.log('\n✅ Helper script created: scripts/simulator-screenshots.sh')
console.log('   (Requires Xcode and iOS Simulator)\n')

