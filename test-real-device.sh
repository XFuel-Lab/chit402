#!/bin/bash
# XFuel Mobile - Real Device Testing Launcher
# This script helps you quickly start testing on a real device

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📱 XFUEL Mobile - Real Device Testing"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if we're in the right directory
if [ ! -d "edgefarm-mobile" ]; then
  echo "❌ Error: edgefarm-mobile directory not found"
  echo "   Run this from xfuel-protocol root: ./test-real-device.sh"
  exit 1
fi

cd edgefarm-mobile

echo "📋 Pre-flight Checklist:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Before starting, make sure you have:"
echo "  ✓ Physical iOS or Android device"
echo "  ✓ Expo Go app installed on device"
echo "  ✓ Theta Wallet app installed on device"
echo "  ✓ Both computer and device on same WiFi"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies (this may take a few minutes)..."
  npm install
  echo "✅ Dependencies installed!"
  echo ""
fi

# Check for .env file
if [ ! -f ".env" ]; then
  echo "⚠️  No .env file found. Creating one..."
  echo "EXPO_PUBLIC_API_URL=http://localhost:3001" > .env
  echo "✅ Created .env file"
  echo ""
fi

echo "🎯 Testing Instructions:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. A QR code will appear in your terminal"
echo "2. On iOS: Open Camera app and scan QR"
echo "   On Android: Open Expo Go and tap 'Scan QR code'"
echo ""
echo "3. Test these features (see REAL_DEVICE_TESTING.md):"
echo "   • Navigation (swipe between tabs)"
echo "   • Wallet connection (deep link to Theta Wallet)"
echo "   • Haptic feedback (drag sliders, tap buttons)"
echo "   • Swap flow (execute test swap)"
echo "   • Pull-to-refresh (on Home screen)"
echo ""
echo "4. Watch this terminal for logs:"
echo "   ✅ = Success | ⚠️ = Warning | ❌ = Error"
echo ""

# Ask user if ready
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
read -p "Ready to start? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Cancelled. Run this script again when ready!"
  exit 0
fi

echo ""
echo "🚀 Starting Expo dev server..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Start Expo with specific settings for testing
EXPO_DEVTOOLS_LISTEN_ADDRESS=0.0.0.0 npm start

# This will keep running until you press Ctrl+C



