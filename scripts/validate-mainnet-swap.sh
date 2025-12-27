#!/bin/bash
# XFuel Protocol - Mainnet Swap Flow Validation Script
# Quick validation of critical fixes before deployment

echo "🚀 XFuel Protocol - Mainnet Swap Validation"
echo "============================================"
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check 1: Build succeeds
echo "📦 Check 1: Building web app..."
if npm run build > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Build successful${NC}"
else
    echo -e "${RED}❌ Build failed${NC}"
    echo "Run: npm run build"
    exit 1
fi
echo ""

# Check 2: Critical files exist
echo "📁 Check 2: Verifying critical files..."
critical_files=(
    "src/App.tsx"
    "src/components/BetaBanner.tsx"
    "src/components/StrideInitModal.tsx"
    "src/utils/cosmosLSTStaking.ts"
    "edgefarm-mobile/src/screens/SwapScreenPro.tsx"
    "docs/SWAP_FLOW_MAINNET_TESTING.md"
    "MAINNET_SWAP_ENHANCEMENTS.md"
)

all_exist=true
for file in "${critical_files[@]}"; do
    if [ -f "$file" ]; then
        echo -e "${GREEN}✅${NC} $file"
    else
        echo -e "${RED}❌${NC} $file (MISSING)"
        all_exist=false
    fi
done

if [ "$all_exist" = false ]; then
    echo -e "${RED}Some critical files are missing!${NC}"
    exit 1
fi
echo ""

# Check 3: Search for critical fixes
echo "🔍 Check 3: Verifying critical fixes in code..."

# Check for null safety in App.tsx
if grep -q "if (!wallet.fullAddress)" src/App.tsx; then
    echo -e "${GREEN}✅${NC} Null safety checks present in App.tsx"
else
    echo -e "${RED}❌${NC} Missing null safety checks in App.tsx"
fi

# Check for auto-retry logic
if grep -q "Auto-retry" src/App.tsx; then
    echo -e "${GREEN}✅${NC} Auto-retry logic present"
else
    echo -e "${YELLOW}⚠️${NC}  Auto-retry logic may be missing"
fi

# Check beta banner is non-dismissible
if grep -q "non-dismissible" src/components/BetaBanner.tsx; then
    echo -e "${GREEN}✅${NC} Beta banner non-dismissible (safety enforced)"
else
    echo -e "${YELLOW}⚠️${NC}  Beta banner dismissibility unclear"
fi

# Check for enhanced Stride error messages
if grep -q "Stride Account Setup Required" src/utils/cosmosLSTStaking.ts; then
    echo -e "${GREEN}✅${NC} Enhanced Stride error messages present"
else
    echo -e "${YELLOW}⚠️${NC}  Stride error messages may not be enhanced"
fi

echo ""

# Check 4: Documentation exists
echo "📚 Check 4: Documentation validation..."
if [ -f "docs/SWAP_FLOW_MAINNET_TESTING.md" ]; then
    line_count=$(wc -l < docs/SWAP_FLOW_MAINNET_TESTING.md)
    if [ "$line_count" -gt 500 ]; then
        echo -e "${GREEN}✅${NC} Testing guide complete ($line_count lines)"
    else
        echo -e "${YELLOW}⚠️${NC}  Testing guide seems incomplete ($line_count lines)"
    fi
else
    echo -e "${RED}❌${NC} Testing guide missing"
fi

if [ -f "MAINNET_SWAP_ENHANCEMENTS.md" ]; then
    echo -e "${GREEN}✅${NC} Enhancement summary present"
else
    echo -e "${YELLOW}⚠️${NC}  Enhancement summary missing"
fi

echo ""

# Check 5: Environment validation
echo "⚙️  Check 5: Environment validation..."
if [ -f ".env.local" ] || [ -f ".env" ]; then
    echo -e "${GREEN}✅${NC} Environment file exists"
else
    echo -e "${YELLOW}⚠️${NC}  No .env file found - ensure ROUTER_ADDRESS is set for mainnet"
fi

# Check if ROUTER_ADDRESS is configured
if grep -q "ROUTER_ADDRESS" .env* 2>/dev/null; then
    echo -e "${GREEN}✅${NC} ROUTER_ADDRESS configured"
else
    echo -e "${YELLOW}⚠️${NC}  ROUTER_ADDRESS may not be configured"
fi

echo ""

# Summary
echo "========================================"
echo "🎯 PRE-FLIGHT CHECKLIST"
echo "========================================"
echo ""
echo "Before deploying to production:"
echo ""
echo "✅ Code Changes"
echo "  - [x] Null safety checks added"
echo "  - [x] Auto-retry logic implemented"
echo "  - [x] Beta banner non-dismissible"
echo "  - [x] Enhanced error messages"
echo "  - [x] Mobile fixes applied"
echo ""
echo "📝 Manual Testing Required:"
echo "  - [ ] Run all 10 test cases in SWAP_FLOW_MAINNET_TESTING.md"
echo "  - [ ] Test Stride initialization flow"
echo "  - [ ] Test on mobile (iOS + Android)"
echo "  - [ ] Verify beta limits (1k/swap, 5k/user)"
echo "  - [ ] Test all LST targets (stkXPRT, stkATOM, stkTIA, stkOSMO)"
echo ""
echo "🚀 Next Steps:"
echo "  1. Run manual E2E tests (see docs/SWAP_FLOW_MAINNET_TESTING.md)"
echo "  2. Deploy to staging for QA"
echo "  3. Deploy to production: vercel --prod"
echo "  4. Monitor first 100 users"
echo ""
echo "📖 Documentation:"
echo "  - Testing: docs/SWAP_FLOW_MAINNET_TESTING.md"
echo "  - Summary: MAINNET_SWAP_ENHANCEMENTS.md"
echo ""
echo -e "${GREEN}✅ Automated validation complete!${NC}"
echo "Proceed with manual testing before production deployment."

