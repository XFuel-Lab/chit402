#!/bin/bash
# Quick test deployment script with high gas limits

set -e

echo "🧪 QUICK TEST DEPLOYMENT"
echo "========================"
echo ""

DEPLOYER_ADDR=$(persistenceCore keys show deployer -a --keyring-backend test)
echo "Deployer: $DEPLOYER_ADDR"
echo ""

echo "📤 Storing ZK Verifier (with high gas limit)..."
persistenceCore tx wasm store /app/target/wasm32-unknown-unknown/release/zk_verifier.wasm \
  --from deployer \
  --gas 5000000 \
  --gas-prices 0.025uxprt \
  --chain-id core-1 \
  --node https://rpc.core.persistence.one:443 \
  --keyring-backend test \
  --yes \
  --output json

echo ""
echo "✅ Done! Check output above for tx hash"


