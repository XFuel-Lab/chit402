#!/bin/bash

# XFuel Protocol Mobile - Setup Script
# Installs dependencies and starts development server

echo "🚀 XFuel Protocol Mobile - Interstellar Setup"
echo "=============================================="
echo ""

# Check Node.js version
echo "📋 Checking prerequisites..."
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)

if [ "$NODE_VERSION" -lt 24 ]; then
  echo "❌ Error: Node.js v24+ required (you have v$(node -v))"
  echo "   Install from: https://nodejs.org"
  exit 1
fi

echo "✅ Node.js version: $(node -v)"
echo "✅ npm version: $(npm -v)"
echo ""

# Navigate to mobile directory
echo "📁 Navigating to edgefarm-mobile..."
cd "$(dirname "$0")"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
echo "   This may take 2-3 minutes..."
npm install

if [ $? -ne 0 ]; then
  echo "❌ Installation failed. Please check errors above."
  exit 1
fi

echo ""
echo "✅ Dependencies installed successfully!"
echo ""

# Start development server
echo "🎯 Starting Expo development server..."
echo ""
echo "📱 Next steps:"
echo "   1. Install Expo Go on your phone (iOS/Android)"
echo "   2. Scan the QR code that appears"
echo "   3. Or press 'i' for iOS Simulator, 'a' for Android Emulator"
echo ""
echo "🌌 Launching to interstellar space in 3... 2... 1..."
echo ""

npm start

# If npm start fails
if [ $? -ne 0 ]; then
  echo ""
  echo "❌ Failed to start development server."
  echo "   Try: npm start -- --clear"
  exit 1
fi

