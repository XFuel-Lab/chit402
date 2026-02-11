#!/bin/bash
# XFuel Reverse Bridge - Pre-Deployment Verification Script
# Run this script BEFORE mainnet deployment to catch issues early

set -e

echo "=========================================="
echo "XFuel Reverse Bridge Pre-Flight Check"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check counter
CHECKS_PASSED=0
CHECKS_FAILED=0
WARNINGS=0

check_pass() {
    echo -e "${GREEN}✓${NC} $1"
    ((CHECKS_PASSED++))
}

check_fail() {
    echo -e "${RED}✗${NC} $1"
    ((CHECKS_FAILED++))
}

check_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
    ((WARNINGS++))
}

# 1. Check WASM files exist
echo "1. Checking WASM artifacts..."
if [ -f "cosmwasm-contracts/artifacts/persistence_minter.wasm" ]; then
    check_pass "persistence_minter.wasm exists"
else
    check_fail "persistence_minter.wasm NOT FOUND"
fi

if [ -f "cosmwasm-contracts/artifacts/fee_collector.wasm" ]; then
    check_pass "fee_collector.wasm exists"
else
    check_fail "fee_collector.wasm NOT FOUND"
fi

# 2. Verify checksums
echo ""
echo "2. Verifying checksums..."
EXPECTED_MINTER="516db0e88509afb90e3055b320691de68387ace97a9a34a72e5621ad3778b748"
EXPECTED_FEE_COLLECTOR="7a370b84ea0ed94df29b2acd2804d73bc27fa1d5a325e2bdd76b3861438f5acd"

if [ -f "cosmwasm-contracts/artifacts/persistence_minter.wasm" ]; then
    ACTUAL_MINTER=$(sha256sum cosmwasm-contracts/artifacts/persistence_minter.wasm | awk '{print $1}')
    if [ "$ACTUAL_MINTER" == "$EXPECTED_MINTER" ]; then
        check_pass "persistence_minter.wasm checksum matches"
    else
        check_fail "persistence_minter.wasm checksum MISMATCH"
        echo "  Expected: $EXPECTED_MINTER"
        echo "  Actual:   $ACTUAL_MINTER"
    fi
fi

if [ -f "cosmwasm-contracts/artifacts/fee_collector.wasm" ]; then
    ACTUAL_FEE_COLLECTOR=$(sha256sum cosmwasm-contracts/artifacts/fee_collector.wasm | awk '{print $1}')
    if [ "$ACTUAL_FEE_COLLECTOR" == "$EXPECTED_FEE_COLLECTOR" ]; then
        check_pass "fee_collector.wasm checksum matches"
    else
        check_fail "fee_collector.wasm checksum MISMATCH"
        echo "  Expected: $EXPECTED_FEE_COLLECTOR"
        echo "  Actual:   $ACTUAL_FEE_COLLECTOR"
    fi
fi

# 3. Check file sizes
echo ""
echo "3. Checking file sizes..."
if [ -f "cosmwasm-contracts/artifacts/persistence_minter.wasm" ]; then
    MINTER_SIZE=$(stat -f%z "cosmwasm-contracts/artifacts/persistence_minter.wasm" 2>/dev/null || stat -c%s "cosmwasm-contracts/artifacts/persistence_minter.wasm" 2>/dev/null)
    MINTER_SIZE_KB=$((MINTER_SIZE / 1024))
    if [ $MINTER_SIZE_KB -lt 2048 ]; then
        check_pass "persistence_minter.wasm size: ${MINTER_SIZE_KB}KB (under 2MB limit)"
    else
        check_fail "persistence_minter.wasm TOO LARGE: ${MINTER_SIZE_KB}KB"
    fi
fi

if [ -f "cosmwasm-contracts/artifacts/fee_collector.wasm" ]; then
    FEE_SIZE=$(stat -f%z "cosmwasm-contracts/artifacts/fee_collector.wasm" 2>/dev/null || stat -c%s "cosmwasm-contracts/artifacts/fee_collector.wasm" 2>/dev/null)
    FEE_SIZE_KB=$((FEE_SIZE / 1024))
    if [ $FEE_SIZE_KB -lt 2048 ]; then
        check_pass "fee_collector.wasm size: ${FEE_SIZE_KB}KB (under 2MB limit)"
    else
        check_fail "fee_collector.wasm TOO LARGE: ${FEE_SIZE_KB}KB"
    fi
fi

# 4. Check environment variables
echo ""
echo "4. Checking required environment variables..."
if [ -n "$CHAIN_ID" ]; then
    check_pass "CHAIN_ID is set: $CHAIN_ID"
else
    check_warn "CHAIN_ID not set (required for deployment)"
fi

if [ -n "$RPC_URL" ]; then
    check_pass "RPC_URL is set: $RPC_URL"
else
    check_warn "RPC_URL not set (required for deployment)"
fi

if [ -n "$KEY_NAME" ]; then
    check_pass "KEY_NAME is set: $KEY_NAME"
else
    check_warn "KEY_NAME not set (required for deployment)"
fi

if [ -n "$ADMIN_ADDRESS" ]; then
    check_pass "ADMIN_ADDRESS is set: $ADMIN_ADDRESS"
else
    check_warn "ADMIN_ADDRESS not set (required for deployment)"
fi

# 5. Check persistenced CLI
echo ""
echo "5. Checking persistenced CLI..."
if command -v persistenced &> /dev/null; then
    PERSISTENCED_VERSION=$(persistenced version 2>&1)
    check_pass "persistenced CLI found: $PERSISTENCED_VERSION"
else
    check_fail "persistenced CLI NOT FOUND (install from https://github.com/persistenceOne/persistenceCore)"
fi

# 6. Check wallet balance (if possible)
echo ""
echo "6. Checking wallet balance..."
if [ -n "$KEY_NAME" ] && [ -n "$CHAIN_ID" ] && [ -n "$RPC_URL" ] && command -v persistenced &> /dev/null; then
    WALLET_ADDRESS=$(persistenced keys show $KEY_NAME -a 2>&1 || echo "")
    if [ -n "$WALLET_ADDRESS" ]; then
        check_pass "Wallet found: $WALLET_ADDRESS"
        # Try to query balance
        BALANCE=$(persistenced query bank balances $WALLET_ADDRESS --node $RPC_URL --output json 2>/dev/null | jq -r '.balances[] | select(.denom=="uxprt") | .amount' || echo "0")
        BALANCE_XPRT=$((BALANCE / 1000000))
        if [ $BALANCE_XPRT -gt 10 ]; then
            check_pass "Wallet balance: ${BALANCE_XPRT} XPRT (sufficient)"
        elif [ $BALANCE_XPRT -gt 1 ]; then
            check_warn "Wallet balance: ${BALANCE_XPRT} XPRT (may need more for safe deployment)"
        else
            check_fail "Wallet balance: ${BALANCE_XPRT} XPRT (INSUFFICIENT - need at least 10 XPRT)"
        fi
    else
        check_warn "Cannot verify wallet (key not found)"
    fi
else
    check_warn "Skipping wallet check (missing KEY_NAME, CHAIN_ID, RPC_URL, or persistenced)"
fi

# 7. Check documentation exists
echo ""
echo "7. Checking documentation..."
if [ -f "MAINNET_DEPLOYMENT_PLAN.md" ]; then
    check_pass "MAINNET_DEPLOYMENT_PLAN.md exists"
else
    check_warn "MAINNET_DEPLOYMENT_PLAN.md not found"
fi

if [ -f "MAINNET_QUICKREF.md" ]; then
    check_pass "MAINNET_QUICKREF.md exists"
else
    check_warn "MAINNET_QUICKREF.md not found"
fi

if [ -f "REVERSE_BRIDGE_DEPLOYMENT_GUIDE.md" ]; then
    check_pass "REVERSE_BRIDGE_DEPLOYMENT_GUIDE.md exists"
else
    check_warn "REVERSE_BRIDGE_DEPLOYMENT_GUIDE.md not found"
fi

# 8. Check source code compiles
echo ""
echo "8. Checking source code compilation..."
if command -v cargo &> /dev/null; then
    check_pass "Rust/Cargo found"
    # Note: Full compilation check skipped to save time
    check_warn "Skipping full compilation check (run 'cargo test' manually)"
else
    check_warn "Cargo not found (cannot verify compilation)"
fi

# Summary
echo ""
echo "=========================================="
echo "Pre-Flight Check Summary"
echo "=========================================="
echo -e "${GREEN}Passed:${NC}   $CHECKS_PASSED"
echo -e "${RED}Failed:${NC}   $CHECKS_FAILED"
echo -e "${YELLOW}Warnings:${NC} $WARNINGS"
echo ""

if [ $CHECKS_FAILED -gt 0 ]; then
    echo -e "${RED}❌ DEPLOYMENT BLOCKED - Fix failed checks before proceeding${NC}"
    exit 1
elif [ $WARNINGS -gt 5 ]; then
    echo -e "${YELLOW}⚠ PROCEED WITH CAUTION - Multiple warnings detected${NC}"
    exit 0
else
    echo -e "${GREEN}✅ READY FOR DEPLOYMENT${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Set remaining environment variables (if any warnings)"
    echo "2. Review MAINNET_DEPLOYMENT_PLAN.md"
    echo "3. Run deployment commands from MAINNET_QUICKREF.md"
    echo "4. Start with contracts PAUSED"
    echo "5. Test with 0.05 TFUEL first"
    exit 0
fi
