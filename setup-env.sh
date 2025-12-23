#!/bin/bash
# Quick setup script for XFUEL Protocol

echo "🚀 XFUEL Protocol - Environment Setup"
echo "====================================="
echo ""

# Check if .env file exists
if [ -f ".env" ] || [ -f ".env.local" ]; then
    echo "✅ Environment file found"
else
    echo "⚠️  No environment file found. Creating .env.local..."
    echo ""
    
    # Create .env.local with router address
    cat > .env.local << EOF
# XFUEL Protocol - Environment Configuration
# Theta Mainnet Router Address (REQUIRED)
VITE_ROUTER_ADDRESS=0x6256D8A728aA102Aa06B6B239ba1247Bd835d816

# API URL (optional, defaults to localhost:3001)
VITE_API_URL=http://localhost:3001

# Network (optional, defaults to mainnet)
VITE_NETWORK=mainnet
EOF
    
    echo "✅ Created .env.local with router address"
    echo ""
fi

echo "📋 Current Configuration:"
echo "------------------------"
if [ -f ".env.local" ]; then
    echo "File: .env.local"
    grep "VITE_ROUTER_ADDRESS" .env.local || echo "⚠️  VITE_ROUTER_ADDRESS not found!"
elif [ -f ".env" ]; then
    echo "File: .env"
    grep "VITE_ROUTER_ADDRESS" .env || echo "⚠️  VITE_ROUTER_ADDRESS not found!"
fi
echo ""

echo "🔄 Next Steps:"
echo "1. Restart your dev server (npm run dev)"
echo "2. Check browser console for: [XFUEL Config] Router address loaded"
echo "3. Try the swap again"
echo ""
echo "📖 For more help, see: ROUTER_CONFIG_FIX.md"

