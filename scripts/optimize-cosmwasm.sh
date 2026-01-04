#!/bin/bash
set -e

echo "========================================================================"
echo "⚙️  OPTIMIZING COSMWASM CONTRACTS"
echo "========================================================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running${NC}"
    echo "Please start Docker Desktop and try again"
    exit 1
fi

echo -e "${GREEN}✅ Docker is running${NC}"
echo ""

# Create artifacts directory
mkdir -p artifacts
rm -f artifacts/*.wasm

# Optimize contracts using CosmWasm Rust Optimizer
echo "========================================================================"
echo "🔧 Running CosmWasm Optimizer (this takes ~5-10 minutes)"
echo "========================================================================"
echo ""

docker run --rm -v "$(pwd)":/code \
  --mount type=volume,source="$(basename "$(pwd)")_cache",target=/target \
  --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
  cosmwasm/optimizer:0.16.0

echo ""
echo "========================================================================"
echo "✅ OPTIMIZATION COMPLETE"
echo "========================================================================"
echo ""

# Show results
if [ -f "artifacts/zk_verifier.wasm" ] && [ -f "artifacts/ibc_tfuel_minter.wasm" ]; then
    echo -e "${GREEN}✅ Optimized contracts ready:${NC}"
    echo ""
    
    echo "📦 ZK Verifier:"
    ls -lh artifacts/zk_verifier.wasm
    wc -c < artifacts/zk_verifier.wasm | awk '{printf "   Size: %d bytes (%.2f KB)\n", $1, $1/1024}'
    
    echo ""
    echo "📦 ibcTFUEL Minter:"
    ls -lh artifacts/ibc_tfuel_minter.wasm
    wc -c < artifacts/ibc_tfuel_minter.wasm | awk '{printf "   Size: %d bytes (%.2f KB)\n", $1, $1/1024}'
    
    echo ""
    echo "🔗 Checksums:"
    cat artifacts/checksums.txt
    
    echo ""
    echo "========================================================================"
    echo "🚀 READY FOR DEPLOYMENT"
    echo "========================================================================"
    echo ""
    echo "Deploy to Persistence:"
    echo "  docker-compose run --rm persistence-deployer /app/scripts/docker-deploy-persistence.sh"
    echo ""
else
    echo -e "${RED}❌ Optimization failed - .wasm files not found${NC}"
    exit 1
fi

