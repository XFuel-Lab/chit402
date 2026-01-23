#!/bin/bash

# XFuel Protocol - Theta Testnet Deployment Script
# This script deploys the full protocol with security features to Theta testnet

set -e  # Exit on error

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔐 XFuel Protocol - Theta Testnet Deployment"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if .env.local exists
if [ ! -f .env.local ]; then
    echo "❌ Error: .env.local file not found"
    echo ""
    echo "Please create .env.local with the following content:"
    echo ""
    echo "PRIVATE_KEY=your_testnet_private_key_here"
    echo "THETA_TESTNET_RPC=https://eth-rpc-api-testnet.thetatoken.org/rpc"
    echo ""
    exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo ""
fi

# Clean and compile contracts
echo "🔨 Compiling contracts..."
npx hardhat clean
npx hardhat compile
echo ""

# Run deployment
echo "🚀 Starting deployment to Theta Testnet..."
echo ""
echo "⚠️  Make sure you have:"
echo "   - At least 50 TFUEL in your testnet wallet"
echo "   - Configured PRIVATE_KEY in .env.local"
echo "   - Network connectivity to Theta testnet"
echo ""
read -p "Press Enter to continue or Ctrl+C to cancel..."
echo ""

# Deploy to testnet
npx hardhat run scripts/testnet-deploy-security.ts --network theta-testnet

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Deployment script completed!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📝 Next steps:"
echo "   1. Check deployment output above for contract addresses"
echo "   2. Verify contracts on Theta Explorer"
echo "   3. Update frontend .env with new addresses"
echo "   4. Test all security features"
echo ""
echo "📖 For detailed instructions, see:"
echo "   scripts/TESTNET_DEPLOYMENT_GUIDE.md"
echo ""


