#!/bin/bash
set -e

echo "========================================================================"
echo "🦀 BUILDING COSMWASM CONTRACTS"
echo "========================================================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Rust is installed
if ! command -v rustc &> /dev/null; then
    echo -e "${RED}❌ Rust not installed${NC}"
    echo "Install from: https://rustup.rs/"
    exit 1
fi

echo -e "${GREEN}✅ Rust $(rustc --version)${NC}"
echo ""

# Check if wasm32 target is installed
if ! rustup target list --installed | grep -q "wasm32-unknown-unknown"; then
    echo -e "${YELLOW}📦 Installing wasm32-unknown-unknown target...${NC}"
    rustup target add wasm32-unknown-unknown
fi

echo -e "${GREEN}✅ wasm32-unknown-unknown target installed${NC}"
echo ""

# Build ZK Verifier
echo "========================================================================"
echo "🔐 Building ZK Verifier Contract"
echo "========================================================================"
cd cosmwasm/zk-verifier

echo "Running tests..."
cargo test --release

echo ""
echo "Building WASM..."
cargo build --release --target wasm32-unknown-unknown --lib

echo ""
echo -e "${GREEN}✅ ZK Verifier built successfully${NC}"
ls -lh ../../target/wasm32-unknown-unknown/release/zk_verifier.wasm
echo ""

cd ../..

# Build ibcTFUEL Minter
echo "========================================================================"
echo "🪙 Building ibcTFUEL Minter Contract"
echo "========================================================================"
cd cosmwasm/ibc-tfuel-minter

echo "Running tests..."
cargo test --release

echo ""
echo "Building WASM..."
cargo build --release --target wasm32-unknown-unknown --lib

echo ""
echo -e "${GREEN}✅ ibcTFUEL Minter built successfully${NC}"
ls -lh ../../target/wasm32-unknown-unknown/release/ibc_tfuel_minter.wasm
echo ""

cd ../..

echo "========================================================================"
echo "✅ BUILD COMPLETE"
echo "========================================================================"
echo ""
echo "📦 Unoptimized WASM files:"
echo "  - target/wasm32-unknown-unknown/release/zk_verifier.wasm"
echo "  - target/wasm32-unknown-unknown/release/ibc_tfuel_minter.wasm"
echo ""
echo "📝 Next step: Optimize with CosmWasm Optimizer"
echo "   Run: ./scripts/optimize-cosmwasm.sh"
echo ""

