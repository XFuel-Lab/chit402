#!/bin/bash

# 🚀 XFuel Protocol - Wallet Integration Setup Script
# Sets up environment and runs tests for Theta Wallet and Keplr integration

set -e

echo "🚀 XFuel Protocol - Wallet Integration Setup"
echo "=============================================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check Node.js
echo "📦 Checking Node.js..."
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js not found. Please install Node.js 18+${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Node.js $(node --version)${NC}"

# Check npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm not found${NC}"
    exit 1
fi
echo -e "${GREEN}✅ npm $(npm --version)${NC}"

# Install dependencies
echo ""
echo "📥 Installing dependencies..."
npm install

# Check for .env file
echo ""
echo "🔐 Checking environment variables..."
if [ ! -f ".env.local" ]; then
    echo -e "${YELLOW}⚠️  .env.local not found. Creating from template...${NC}"
    cat > .env.local << EOF
# WalletConnect v2 Project ID
# Get yours at: https://cloud.walletconnect.com
VITE_WALLETCONNECT_PROJECT_ID=your_project_id_here

# Theta Network Configuration
VITE_THETA_MAINNET_RPC=https://eth-rpc-api.thetatoken.org/rpc
VITE_THETA_TESTNET_RPC=https://eth-rpc-api-testnet.thetatoken.org/rpc

# Use testnet for development
VITE_USE_TESTNET=true
EOF
    echo -e "${YELLOW}📝 Please update .env.local with your WalletConnect Project ID${NC}"
else
    echo -e "${GREEN}✅ .env.local found${NC}"
fi

# Check WalletConnect Project ID
if grep -q "your_project_id_here" .env.local 2>/dev/null; then
    echo -e "${YELLOW}⚠️  WalletConnect Project ID not set in .env.local${NC}"
    echo -e "${YELLOW}   Get one at: https://cloud.walletconnect.com${NC}"
fi

# Run TypeScript compilation check
echo ""
echo "🔍 Checking TypeScript..."
npx tsc --noEmit || {
    echo -e "${YELLOW}⚠️  TypeScript errors detected. Run 'npm run build' to see details${NC}"
}

# Run Jest tests
echo ""
echo "🧪 Running unit tests..."
npm test -- src/utils/__tests__/ || {
    echo -e "${YELLOW}⚠️  Some tests failed. Review output above${NC}"
}

# Setup mobile (if exists)
if [ -d "edgefarm-mobile" ]; then
    echo ""
    echo "📱 Setting up mobile app..."
    cd edgefarm-mobile
    
    if [ ! -d "node_modules" ]; then
        echo "📥 Installing mobile dependencies..."
        npm install
    else
        echo -e "${GREEN}✅ Mobile dependencies already installed${NC}"
    fi
    
    # Check for Expo CLI
    if ! command -v expo &> /dev/null; then
        echo -e "${YELLOW}⚠️  Expo CLI not found. Install with: npm install -g expo-cli${NC}"
    else
        echo -e "${GREEN}✅ Expo CLI $(expo --version)${NC}"
    fi
    
    cd ..
fi

# Setup instructions
echo ""
echo "=============================================="
echo -e "${GREEN}✅ Setup complete!${NC}"
echo ""
echo "📋 Next steps:"
echo ""
echo "1️⃣  Update .env.local with your WalletConnect Project ID"
echo "    Get one at: https://cloud.walletconnect.com"
echo ""
echo "2️⃣  Start the development server:"
echo "    npm run dev"
echo ""
echo "3️⃣  Test wallet integration:"
echo "    npm test"
echo ""
echo "4️⃣  Run E2E tests:"
echo "    npm run cypress:open"
echo ""
echo "5️⃣  Test mobile app (if using):"
echo "    cd edgefarm-mobile && npm start"
echo ""
echo "📚 Documentation:"
echo "    docs/THETA_WALLET_INTEGRATION_GUIDE.md"
echo ""
echo "🐛 Troubleshooting:"
echo "    - Approve button disabled? Clear Theta Wallet cache"
echo "    - Deep linking not working? Test on real device"
echo "    - Keplr showing 0x address? Reconnect and approve chain"
echo ""
echo "🚀 Happy building!"
echo "=============================================="

