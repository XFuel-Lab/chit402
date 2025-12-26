#!/bin/bash
# XFuel Mobile App - Quick Testing Script
# Run this script to quickly test the mobile app on your device

echo "🚀 XFUEL Mobile App - Quick Test"
echo "================================"
echo ""

# Check if we're in the right directory
if [ ! -d "edgefarm-mobile" ]; then
  echo "❌ Error: edgefarm-mobile directory not found"
  echo "   Please run this script from the xfuel-protocol root directory"
  exit 1
fi

cd edgefarm-mobile

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  npm install
fi

echo "✅ Dependencies installed"
echo ""

# Start Expo dev server
echo "🎯 Starting Expo dev server..."
echo ""
echo "Next steps:"
echo "1. Scan the QR code with Expo Go app (iOS/Android)"
echo "2. Install Theta Wallet app if not already installed"
echo "3. Test the following:"
echo ""
echo "   ✓ Tap 'Connect Wallet' on SwapScreen"
echo "   ✓ Check if deep link opens Theta Wallet"
echo "   ✓ Approve connection in Theta Wallet"
echo "   ✓ Verify balance displays correctly"
echo "   ✓ Adjust swap amount slider (feel haptic feedback)"
echo "   ✓ Execute test swap"
echo "   ✓ See confetti on success 🎉"
echo "   ✓ Pull-to-refresh on HomeScreen"
echo ""
echo "📱 Opening Expo dev server..."
echo ""

npm run start

