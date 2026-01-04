#!/bin/bash
set -e

echo "========================================================================"
echo "🧪 TESTING OPTIMIZED WASM FILES"
echo "========================================================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

# Helper functions
pass_test() {
    echo -e "${GREEN}✅ PASS:${NC} $1"
    ((TESTS_PASSED++))
}

fail_test() {
    echo -e "${RED}❌ FAIL:${NC} $1"
    ((TESTS_FAILED++))
}

warn_test() {
    echo -e "${YELLOW}⚠️  WARN:${NC} $1"
}

# Test 1: Check if artifacts exist
echo "Test 1: Checking for optimized artifacts..."
if [ -f "artifacts/zk_verifier.wasm" ] && [ -f "artifacts/ibc_tfuel_minter.wasm" ]; then
    pass_test "Optimized WASM files exist"
else
    fail_test "Optimized WASM files not found"
    echo ""
    echo "Run optimization first:"
    echo "  ./scripts/optimize-cosmwasm-debug.sh"
    echo "  OR ./scripts/manual-optimize-wasm.sh"
    exit 1
fi
echo ""

# Test 2: Check file sizes
echo "Test 2: Checking file sizes..."
ZK_SIZE=$(wc -c < artifacts/zk_verifier.wasm)
MINTER_SIZE=$(wc -c < artifacts/ibc_tfuel_minter.wasm)

echo "  ZK Verifier:     $(awk "BEGIN {printf \"%.2f KB\", $ZK_SIZE / 1024}") ($ZK_SIZE bytes)"
echo "  ibcTFUEL Minter: $(awk "BEGIN {printf \"%.2f KB\", $MINTER_SIZE / 1024}") ($MINTER_SIZE bytes)"

if [ $ZK_SIZE -lt 153600 ]; then
    pass_test "ZK Verifier size acceptable (<150 KB)"
else
    fail_test "ZK Verifier too large (>150 KB)"
fi

if [ $MINTER_SIZE -lt 153600 ]; then
    pass_test "Minter size acceptable (<150 KB)"
else
    fail_test "Minter too large (>150 KB)"
fi
echo ""

# Test 3: Check for size reduction
echo "Test 3: Checking optimization ratio..."
if [ -f "target/wasm32-unknown-unknown/release/zk_verifier.wasm" ]; then
    ORIGINAL_ZK_SIZE=$(wc -c < target/wasm32-unknown-unknown/release/zk_verifier.wasm)
    ZK_REDUCTION=$(awk "BEGIN {printf \"%.1f\", (1 - $ZK_SIZE / $ORIGINAL_ZK_SIZE) * 100}")
    echo "  ZK Verifier reduction: ${ZK_REDUCTION}%"
    
    if [ $(echo "$ZK_REDUCTION > 30" | bc -l) -eq 1 ]; then
        pass_test "ZK Verifier well optimized (>${ZK_REDUCTION}% reduction)"
    else
        warn_test "ZK Verifier optimization could be better (${ZK_REDUCTION}% reduction)"
    fi
else
    warn_test "Original ZK Verifier not found (skipping reduction test)"
fi

if [ -f "target/wasm32-unknown-unknown/release/ibc_tfuel_minter.wasm" ]; then
    ORIGINAL_MINTER_SIZE=$(wc -c < target/wasm32-unknown-unknown/release/ibc_tfuel_minter.wasm)
    MINTER_REDUCTION=$(awk "BEGIN {printf \"%.1f\", (1 - $MINTER_SIZE / $ORIGINAL_MINTER_SIZE) * 100}")
    echo "  Minter reduction: ${MINTER_REDUCTION}%"
    
    if [ $(echo "$MINTER_REDUCTION > 30" | bc -l) -eq 1 ]; then
        pass_test "Minter well optimized (>${MINTER_REDUCTION}% reduction)"
    else
        warn_test "Minter optimization could be better (${MINTER_REDUCTION}% reduction)"
    fi
else
    warn_test "Original Minter not found (skipping reduction test)"
fi
echo ""

# Test 4: Validate WASM structure
echo "Test 4: Validating WASM structure..."
if command -v wasm-validate &> /dev/null; then
    if wasm-validate artifacts/zk_verifier.wasm 2>/dev/null; then
        pass_test "ZK Verifier WASM is valid"
    else
        fail_test "ZK Verifier WASM is invalid"
    fi
    
    if wasm-validate artifacts/ibc_tfuel_minter.wasm 2>/dev/null; then
        pass_test "Minter WASM is valid"
    else
        fail_test "Minter WASM is invalid"
    fi
elif docker info > /dev/null 2>&1; then
    echo "  Using Docker for validation..."
    if docker run --rm -v "$(pwd)":/app emscripten/emsdk:3.1.50 wasm-validate /app/artifacts/zk_verifier.wasm 2>/dev/null; then
        pass_test "ZK Verifier WASM is valid (Docker)"
    else
        fail_test "ZK Verifier WASM is invalid (Docker)"
    fi
    
    if docker run --rm -v "$(pwd)":/app emscripten/emsdk:3.1.50 wasm-validate /app/artifacts/ibc_tfuel_minter.wasm 2>/dev/null; then
        pass_test "Minter WASM is valid (Docker)"
    else
        fail_test "Minter WASM is invalid (Docker)"
    fi
else
    warn_test "wasm-validate not available (install binaryen or Docker)"
fi
echo ""

# Test 5: Check checksums
echo "Test 5: Checking checksums..."
if [ -f "artifacts/checksums.txt" ]; then
    pass_test "Checksums file exists"
    
    cd artifacts
    if sha256sum -c checksums.txt >/dev/null 2>&1; then
        pass_test "Checksums verified"
    else
        fail_test "Checksum verification failed"
    fi
    cd ..
else
    warn_test "Checksums file not found"
fi
echo ""

# Test 6: Check WASM magic number
echo "Test 6: Checking WASM magic number..."
ZK_MAGIC=$(xxd -l 4 -p artifacts/zk_verifier.wasm)
MINTER_MAGIC=$(xxd -l 4 -p artifacts/ibc_tfuel_minter.wasm)

if [ "$ZK_MAGIC" = "0061736d" ]; then
    pass_test "ZK Verifier has valid WASM magic number"
else
    fail_test "ZK Verifier has invalid magic number: $ZK_MAGIC"
fi

if [ "$MINTER_MAGIC" = "0061736d" ]; then
    pass_test "Minter has valid WASM magic number"
else
    fail_test "Minter has invalid magic number: $MINTER_MAGIC"
fi
echo ""

# Test 7: Check if CosmWasm entry points exist (basic check)
echo "Test 7: Checking for CosmWasm exports..."

check_exports() {
    local FILE=$1
    local NAME=$2
    local HAS_INSTANTIATE=0
    local HAS_EXECUTE=0
    local HAS_QUERY=0
    
    # Use wasm-objdump or strings to check for exports
    if command -v wasm-objdump &> /dev/null; then
        if wasm-objdump -x "$FILE" | grep -q "instantiate"; then
            HAS_INSTANTIATE=1
        fi
        if wasm-objdump -x "$FILE" | grep -q "execute"; then
            HAS_EXECUTE=1
        fi
        if wasm-objdump -x "$FILE" | grep -q "query"; then
            HAS_QUERY=1
        fi
    else
        # Fallback: use strings (less reliable)
        if strings "$FILE" | grep -q "instantiate"; then
            HAS_INSTANTIATE=1
        fi
        if strings "$FILE" | grep -q "execute"; then
            HAS_EXECUTE=1
        fi
        if strings "$FILE" | grep -q "query"; then
            HAS_QUERY=1
        fi
    fi
    
    if [ $HAS_INSTANTIATE -eq 1 ] && [ $HAS_EXECUTE -eq 1 ] && [ $HAS_QUERY -eq 1 ]; then
        pass_test "$NAME has CosmWasm entry points"
    else
        warn_test "$NAME: Some entry points may be missing (limited check)"
    fi
}

if command -v strings &> /dev/null; then
    check_exports "artifacts/zk_verifier.wasm" "ZK Verifier"
    check_exports "artifacts/ibc_tfuel_minter.wasm" "Minter"
else
    warn_test "Cannot check exports (strings command not available)"
fi
echo ""

# Test 8: Cargo tests (optional but recommended)
echo "Test 8: Running Cargo tests (optional)..."
if [ "$SKIP_CARGO_TESTS" = "1" ]; then
    warn_test "Skipping Cargo tests (SKIP_CARGO_TESTS=1)"
else
    echo "  Testing ZK Verifier..."
    if (cd cosmwasm/zk-verifier && cargo test --release --quiet 2>&1 | grep -q "test result: ok"); then
        pass_test "ZK Verifier tests pass"
    else
        fail_test "ZK Verifier tests failed"
    fi
    
    echo "  Testing ibcTFUEL Minter..."
    if (cd cosmwasm/ibc-tfuel-minter && cargo test --release --quiet 2>&1 | grep -q "test result: ok"); then
        pass_test "Minter tests pass"
    else
        fail_test "Minter tests failed"
    fi
fi
echo ""

# Summary
echo "========================================================================"
echo "📊 TEST SUMMARY"
echo "========================================================================"
echo ""
echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Failed: $TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ ALL TESTS PASSED${NC}"
    echo ""
    echo "🚀 Ready for deployment!"
    echo ""
    echo "Next step:"
    echo "  docker-compose run --rm persistence-deployer /app/scripts/docker-deploy-persistence.sh"
    echo ""
    exit 0
else
    echo -e "${RED}❌ SOME TESTS FAILED${NC}"
    echo ""
    echo "Please fix the issues above before deploying."
    echo ""
    echo "Common fixes:"
    echo "  - Re-run optimization: ./scripts/optimize-cosmwasm-debug.sh"
    echo "  - Check Cargo.toml optimization settings"
    echo "  - Verify Docker/wasm-opt is working correctly"
    echo ""
    exit 1
fi

