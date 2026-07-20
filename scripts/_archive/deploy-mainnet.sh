#!/bin/bash

# XFuel Protocol - Mainnet Deployment Script
# Deploys upgraded contracts with beta testing safety limits

set -e

echo "🚀 XFuel Protocol - Mainnet Deployment (Beta Testing Mode)"
echo "============================================================"
echo ""

# Check for required environment variables
if [ -z "$THETA_MAINNET_PRIVATE_KEY" ]; then
  echo "❌ Error: THETA_MAINNET_PRIVATE_KEY not set"
  echo "Please set your private key:"
  echo "  export THETA_MAINNET_PRIVATE_KEY=your_private_key_here"
  exit 1
fi

echo "⚠️  MAINNET BETA TESTING MODE"
echo "Safety limits enabled:"
echo "  - Max swap: 1,000 TFUEL per transaction"
echo "  - Total limit: 5,000 TFUEL per user"
echo "  - Emergency pause/kill switches active"
echo ""

read -p "Continue with mainnet deployment? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
  echo "Deployment cancelled."
  exit 0
fi

echo ""
echo "📦 Compiling contracts..."
npx hardhat compile

echo ""
echo "🌐 Deploying to Theta Mainnet (Chain ID: 361)..."
echo ""

# Deploy contracts with safety limits
npx hardhat run scripts/deploy-mainnet-beta.ts --network theta-mainnet

echo ""
echo "✅ Deployment complete!"
echo ""
echo "⚠️  IMPORTANT POST-DEPLOYMENT STEPS:"
echo "1. Verify contracts on Theta Explorer"
echo "2. Test with small amounts first (< 10 TFUEL)"
echo "3. Monitor logs and events closely"
echo "4. Have emergency pause ready"
echo "5. Update frontend environment variables:"
echo "   - VITE_ROUTER_ADDRESS=<deployed_router_address>"
echo "   - VITE_NETWORK=mainnet"
echo ""
echo "📊 Monitor swaps: Check contract events for UserSwapRecorded"
echo "🛑 Emergency pause: Call setPaused(true) on contracts"
echo ""

