#!/bin/bash

# Theta Wallet Integration Setup Script
# Automates installation for both mobile and web

set -e

echo "🚀 XFuel Protocol - Theta Wallet Integration Setup"
echo "=================================================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Error: Must run from project root${NC}"
    exit 1
fi

echo -e "${YELLOW}📦 Installing web dependencies...${NC}"
npm install

echo ""
echo -e "${YELLOW}📱 Installing mobile dependencies...${NC}"
cd edgefarm-mobile
npm install
cd ..

echo ""
echo -e "${YELLOW}⚙️  Configuring environment...${NC}"

# Check for WalletConnect Project ID
if [ ! -f ".env.local" ]; then
    echo -e "${YELLOW}Creating .env.local...${NC}"
    cat > .env.local << EOF
# WalletConnect v2 Project ID
# Get yours at: https://cloud.walletconnect.com
VITE_WALLETCONNECT_PROJECT_ID=d132d658c164146b2546d5cd1ede0595
EOF
    echo -e "${GREEN}✅ Created .env.local with fallback Project ID${NC}"
    echo -e "${YELLOW}⚠️  For production, get your own Project ID at https://cloud.walletconnect.com${NC}"
else
    echo -e "${GREEN}✅ .env.local already exists${NC}"
fi

echo ""
echo -e "${YELLOW}🧪 Running tests...${NC}"

# Run Jest tests
npm test -- --passWithNoTests

echo ""
echo -e "${YELLOW}🔍 Checking mobile configuration...${NC}"

# Check app.json for deep link schemes
if grep -q '"thetawallet"' edgefarm-mobile/app.json; then
    echo -e "${GREEN}✅ Deep link schemes configured${NC}"
else
    echo -e "${RED}❌ Deep link schemes not found in app.json${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ Setup Complete!${NC}"
echo ""
echo "=================================================="
echo "🎯 Next Steps:"
echo "=================================================="
echo ""
echo "📱 Mobile Development:"
echo "   cd edgefarm-mobile"
echo "   npm run ios       # or npm run android"
echo ""
echo "🌐 Web Development:"
echo "   npm run dev"
echo ""
echo "🧪 Run Tests:"
echo "   npm test                    # Jest unit tests"
echo "   npm run test:e2e            # Cypress E2E tests"
echo ""
echo "📚 Documentation:"
echo "   docs/THETA_WALLET_INTEGRATION.md    # Complete guide"
echo "   docs/DEPLOYMENT_THETA_WALLET.md     # Deployment guide"
echo "   INTEGRATION_SUMMARY.md              # Implementation summary"
echo ""
echo "🔧 Configuration:"
echo "   - Web: Set VITE_WALLETCONNECT_PROJECT_ID in .env.local"
echo "   - Mobile: Update routerAddress in edgefarm-mobile/app.json extra config"
echo ""
echo -e "${GREEN}Happy coding! 🚀${NC}"

