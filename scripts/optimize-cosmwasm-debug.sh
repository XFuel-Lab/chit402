#!/bin/bash
set -e

echo "========================================================================"
echo "🔧 COSMWASM OPTIMIZER DEBUG (with Cache Clear)"
echo "========================================================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running${NC}"
    echo "Please start Docker Desktop and try again"
    exit 1
fi

echo -e "${GREEN}✅ Docker is running${NC}"
echo ""

# Display Docker info
echo "📊 Docker Environment:"
docker version | grep -E "Version|OS/Arch" | head -4
echo ""

# Check for old volumes
echo "========================================================================"
echo "🧹 CLEANING OLD CACHE"
echo "========================================================================"
echo ""

echo "Checking for existing cache volumes..."
VOLUMES=$(docker volume ls -q | grep -E "cache|xfuel")

if [ -z "$VOLUMES" ]; then
    echo -e "${GREEN}✅ No old cache volumes found${NC}"
else
    echo -e "${YELLOW}Found cache volumes:${NC}"
    echo "$VOLUMES" | while read vol; do
        echo "  - $vol"
    done
    echo ""
    
    read -p "Remove these volumes? (y/N) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Removing volumes..."
        echo "$VOLUMES" | while read vol; do
            docker volume rm "$vol" 2>/dev/null || echo "  ⚠️  Could not remove $vol (may be in use)"
        done
        echo -e "${GREEN}✅ Cache cleared${NC}"
    else
        echo "Skipping volume removal"
    fi
fi

echo ""

# Clean old artifacts
echo "🧹 Cleaning old artifacts..."
rm -f artifacts/*.wasm
rm -f artifacts/checksums.txt
mkdir -p artifacts
echo -e "${GREEN}✅ Artifacts directory cleaned${NC}"
echo ""

# Check Rust contracts are built
echo "========================================================================"
echo "📦 CHECKING BUILD STATUS"
echo "========================================================================"
echo ""

if [ ! -f "target/wasm32-unknown-unknown/release/zk_verifier.wasm" ] || \
   [ ! -f "target/wasm32-unknown-unknown/release/ibc_tfuel_minter.wasm" ]; then
    echo -e "${YELLOW}⚠️  Unoptimized WASM files not found${NC}"
    echo "Building contracts first..."
    ./scripts/build-cosmwasm-contracts.sh
else
    echo -e "${GREEN}✅ Found unoptimized WASM files${NC}"
    echo ""
    echo "Current sizes:"
    ls -lh target/wasm32-unknown-unknown/release/zk_verifier.wasm | awk '{print "  ZK Verifier:    " $5}'
    ls -lh target/wasm32-unknown-unknown/release/ibc_tfuel_minter.wasm | awk '{print "  ibcTFUEL Minter: " $5}'
fi

echo ""

# Run optimizer with verbose logging
echo "========================================================================"
echo "🔧 RUNNING COSMWASM OPTIMIZER (v0.16.0)"
echo "========================================================================"
echo ""
echo -e "${BLUE}ℹ️  This may take 5-10 minutes...${NC}"
echo -e "${BLUE}ℹ️  Logs saved to: optimizer-debug.log${NC}"
echo ""

# Get absolute path for Windows compatibility
WORK_DIR=$(pwd)

# Run optimizer with fresh volumes and logging
docker run --rm \
  -v "${WORK_DIR}:/code" \
  --mount type=volume,source="$(basename "${WORK_DIR}")_cache_new",target=/target \
  --mount type=volume,source=registry_cache_new,target=/usr/local/cargo/registry \
  cosmwasm/optimizer:0.16.0 2>&1 | tee optimizer-debug.log

OPTIMIZER_EXIT_CODE=${PIPESTATUS[0]}

echo ""

# Check if optimizer succeeded
if [ $OPTIMIZER_EXIT_CODE -ne 0 ]; then
    echo -e "${RED}========================================================================"
    echo "❌ OPTIMIZER FAILED"
    echo -e "========================================================================${NC}"
    echo ""
    echo "Error details:"
    cat optimizer-debug.log | grep -i "error\|fail\|panic" | tail -20
    echo ""
    echo -e "${YELLOW}Troubleshooting steps:${NC}"
    echo "  1. Check Rust version in Cargo.toml (should be edition 2021)"
    echo "  2. Try updating optimizer: cosmwasm/optimizer:0.16.1"
    echo "  3. Check Docker memory (increase to 8GB+ in Docker Desktop)"
    echo "  4. Fallback to manual optimization: ./scripts/manual-optimize-wasm.sh"
    echo ""
    exit 1
fi

echo ""
echo "========================================================================"
echo "✅ OPTIMIZER COMPLETED"
echo "========================================================================"
echo ""

# Verify output files exist
if [ ! -f "artifacts/zk_verifier.wasm" ] || [ ! -f "artifacts/ibc_tfuel_minter.wasm" ]; then
    echo -e "${RED}❌ Optimized files not found in artifacts/${NC}"
    echo ""
    echo "Expected files:"
    echo "  - artifacts/zk_verifier.wasm"
    echo "  - artifacts/ibc_tfuel_minter.wasm"
    echo ""
    echo "Check optimizer-debug.log for details"
    exit 1
fi

# Show results
echo "📦 Optimized contracts:"
echo ""

ZK_SIZE=$(wc -c < artifacts/zk_verifier.wasm)
MINTER_SIZE=$(wc -c < artifacts/ibc_tfuel_minter.wasm)

echo "  ZK Verifier:"
ls -lh artifacts/zk_verifier.wasm | awk '{print "    " $5 " (" $9 ")"}'
awk "BEGIN {printf \"    %.2f KB\n\", $ZK_SIZE / 1024}"

echo ""
echo "  ibcTFUEL Minter:"
ls -lh artifacts/ibc_tfuel_minter.wasm | awk '{print "    " $5 " (" $9 ")"}'
awk "BEGIN {printf \"    %.2f KB\n\", $MINTER_SIZE / 1024}"

echo ""

# Check if sizes are acceptable
if [ $ZK_SIZE -lt 153600 ] && [ $MINTER_SIZE -lt 153600 ]; then
    echo -e "${GREEN}✅ Both contracts are <150KB (mainnet ready!)${NC}"
else
    echo -e "${YELLOW}⚠️  Warning: One or more contracts exceed 150KB${NC}"
    echo "   This may cause deployment issues on some chains"
    echo "   Consider further optimization or splitting functionality"
fi

echo ""

# Show checksums
if [ -f "artifacts/checksums.txt" ]; then
    echo "🔗 Checksums:"
    cat artifacts/checksums.txt
    echo ""
fi

# Save detailed report
echo "========================================================================"
echo "📝 OPTIMIZATION REPORT"
echo "========================================================================"
echo ""

cat > optimization-report.txt << EOF
CosmWasm Optimization Report
Generated: $(date)

=== Build Environment ===
Docker Version: $(docker --version)
Optimizer: cosmwasm/optimizer:0.16.0
Rust Edition: 2021

=== Input (Unoptimized) ===
ZK Verifier:     $(ls -lh target/wasm32-unknown-unknown/release/zk_verifier.wasm 2>/dev/null | awk '{print $5}' || echo "N/A")
ibcTFUEL Minter: $(ls -lh target/wasm32-unknown-unknown/release/ibc_tfuel_minter.wasm 2>/dev/null | awk '{print $5}' || echo "N/A")

=== Output (Optimized) ===
ZK Verifier:     $(awk "BEGIN {printf \"%.2f KB (%d bytes)\", $ZK_SIZE / 1024, $ZK_SIZE}")
ibcTFUEL Minter: $(awk "BEGIN {printf \"%.2f KB (%d bytes)\", $MINTER_SIZE / 1024, $MINTER_SIZE}")

=== Status ===
Mainnet Ready: $(if [ $ZK_SIZE -lt 153600 ] && [ $MINTER_SIZE -lt 153600 ]; then echo "YES"; else echo "NO"; fi)
Target: <150 KB per contract

=== Checksums ===
$(cat artifacts/checksums.txt 2>/dev/null || echo "Not generated")

=== Next Steps ===
1. Deploy to Persistence: docker-compose run --rm persistence-deployer /app/scripts/docker-deploy-persistence.sh
2. Verify on explorer: https://www.mintscan.io/persistence
3. Test mint function with 0.1 TFUEL cap

=== Debug Log ===
Full logs available in: optimizer-debug.log
EOF

cat optimization-report.txt

echo ""
echo -e "${GREEN}✅ Report saved to: optimization-report.txt${NC}"
echo ""

echo "========================================================================"
echo "🚀 READY FOR DEPLOYMENT"
echo "========================================================================"
echo ""
echo "Next commands:"
echo "  1. Review report: cat optimization-report.txt"
echo "  2. Deploy: docker-compose run --rm persistence-deployer /app/scripts/docker-deploy-persistence.sh"
echo ""
echo "💡 Note: Make sure .env.docker has KEPLR_MNEMONIC set"
echo ""

