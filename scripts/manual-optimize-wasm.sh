#!/bin/bash
set -e

echo "========================================================================"
echo "🔧 MANUAL WASM OPTIMIZATION (Fallback Method)"
echo "========================================================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Check if unoptimized WASM files exist
if [ ! -f "target/wasm32-unknown-unknown/release/zk_verifier.wasm" ]; then
    echo -e "${RED}❌ zk_verifier.wasm not found${NC}"
    echo "Build contracts first: ./scripts/build-cosmwasm-contracts.sh"
    exit 1
fi

if [ ! -f "target/wasm32-unknown-unknown/release/ibc_tfuel_minter.wasm" ]; then
    echo -e "${RED}❌ ibc_tfuel_minter.wasm not found${NC}"
    echo "Build contracts first: ./scripts/build-cosmwasm-contracts.sh"
    exit 1
fi

echo -e "${GREEN}✅ Found unoptimized WASM files${NC}"
echo ""

# Show current sizes
echo "📦 Current sizes (unoptimized):"
ls -lh target/wasm32-unknown-unknown/release/zk_verifier.wasm | awk '{print "  ZK Verifier:    " $5 " (" $9 ")"}'
ls -lh target/wasm32-unknown-unknown/release/ibc_tfuel_minter.wasm | awk '{print "  ibcTFUEL Minter: " $5 " (" $9 ")"}'
echo ""

# Create artifacts directory
mkdir -p artifacts

# Check if wasm-opt is available
echo "========================================================================"
echo "🔍 Checking for wasm-opt"
echo "========================================================================"
echo ""

USE_DOCKER=0

if command -v wasm-opt &> /dev/null; then
    WASM_OPT_VERSION=$(wasm-opt --version 2>&1 | head -n1)
    echo -e "${GREEN}✅ Found local wasm-opt: $WASM_OPT_VERSION${NC}"
    echo ""
elif docker info > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  wasm-opt not found locally${NC}"
    echo -e "${BLUE}ℹ️  Using Docker with emscripten/emsdk image${NC}"
    USE_DOCKER=1
    echo ""
else
    echo -e "${RED}❌ Neither wasm-opt nor Docker available${NC}"
    echo ""
    echo "Install options:"
    echo "  1. Local (Ubuntu/Debian): sudo apt install binaryen"
    echo "  2. Local (macOS): brew install binaryen"
    echo "  3. Local (Windows): scoop install binaryen"
    echo "  4. Docker: Install Docker Desktop"
    echo ""
    exit 1
fi

# Optimization function
optimize_wasm() {
    local INPUT=$1
    local OUTPUT=$2
    local NAME=$3
    
    echo "========================================================================"
    echo "⚙️  Optimizing: $NAME"
    echo "========================================================================"
    echo ""
    
    if [ $USE_DOCKER -eq 1 ]; then
        # Use Docker with emscripten
        docker run --rm -v "$(pwd)":/app -w /app emscripten/emsdk:3.1.50 \
            wasm-opt -Oz --signext-lowering --strip-debug --strip-producers \
            "$INPUT" -o "$OUTPUT"
    else
        # Use local wasm-opt
        wasm-opt -Oz --signext-lowering --strip-debug --strip-producers \
            "$INPUT" -o "$OUTPUT"
    fi
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ Optimization failed for $NAME${NC}"
        return 1
    fi
    
    # Show results
    local ORIGINAL_SIZE=$(wc -c < "$INPUT")
    local OPTIMIZED_SIZE=$(wc -c < "$OUTPUT")
    local REDUCTION=$(awk "BEGIN {printf \"%.1f\", (1 - $OPTIMIZED_SIZE / $ORIGINAL_SIZE) * 100}")
    
    echo -e "${GREEN}✅ Optimized: $NAME${NC}"
    echo "  Original:  $(awk "BEGIN {printf \"%.2f KB\", $ORIGINAL_SIZE / 1024}")"
    echo "  Optimized: $(awk "BEGIN {printf \"%.2f KB\", $OPTIMIZED_SIZE / 1024}")"
    echo "  Reduction: ${REDUCTION}%"
    echo ""
    
    # Check if size is acceptable (<150KB)
    if [ $OPTIMIZED_SIZE -lt 153600 ]; then
        echo -e "${GREEN}✅ Size acceptable for mainnet (<150 KB)${NC}"
    else
        echo -e "${YELLOW}⚠️  Warning: Size still large (>150 KB)${NC}"
        echo "   This may cause deployment issues on some chains"
    fi
    echo ""
}

# Optimize both contracts
optimize_wasm \
    "target/wasm32-unknown-unknown/release/zk_verifier.wasm" \
    "artifacts/zk_verifier.wasm" \
    "ZK Verifier"

optimize_wasm \
    "target/wasm32-unknown-unknown/release/ibc_tfuel_minter.wasm" \
    "artifacts/ibc_tfuel_minter.wasm" \
    "ibcTFUEL Minter"

# Validate optimized WASM files
echo "========================================================================"
echo "✅ VALIDATION"
echo "========================================================================"
echo ""

if [ $USE_DOCKER -eq 1 ]; then
    echo "🔍 Validating WASM structure (Docker)..."
    docker run --rm -v "$(pwd)":/app -w /app emscripten/emsdk:3.1.50 bash -c "
        wasm-validate /app/artifacts/zk_verifier.wasm && echo '  ✅ zk_verifier.wasm is valid'
        wasm-validate /app/artifacts/ibc_tfuel_minter.wasm && echo '  ✅ ibc_tfuel_minter.wasm is valid'
    "
elif command -v wasm-validate &> /dev/null; then
    echo "🔍 Validating WASM structure..."
    wasm-validate artifacts/zk_verifier.wasm && echo -e "${GREEN}  ✅ zk_verifier.wasm is valid${NC}"
    wasm-validate artifacts/ibc_tfuel_minter.wasm && echo -e "${GREEN}  ✅ ibc_tfuel_minter.wasm is valid${NC}"
else
    echo -e "${YELLOW}⚠️  wasm-validate not available, skipping validation${NC}"
    echo "   (Optimized files should still work)"
fi

echo ""

# Generate checksums
echo "========================================================================"
echo "📝 GENERATING CHECKSUMS"
echo "========================================================================"
echo ""

cd artifacts
sha256sum zk_verifier.wasm ibc_tfuel_minter.wasm > checksums.txt
cat checksums.txt
cd ..

echo ""

# Summary
echo "========================================================================"
echo "✅ OPTIMIZATION COMPLETE"
echo "========================================================================"
echo ""
echo "📦 Optimized files ready:"
echo "  - artifacts/zk_verifier.wasm"
echo "  - artifacts/ibc_tfuel_minter.wasm"
echo "  - artifacts/checksums.txt"
echo ""
echo "📊 Final sizes:"
ls -lh artifacts/zk_verifier.wasm artifacts/ibc_tfuel_minter.wasm | awk '{print "  " $9 ": " $5}'
echo ""
echo "🚀 Next step: Deploy to Persistence"
echo "   Run: docker-compose run --rm persistence-deployer /app/scripts/docker-deploy-persistence.sh"
echo ""
echo "💡 Tip: Verify deployment with updated script that uses artifacts/ instead of target/"
echo ""

