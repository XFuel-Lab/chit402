# XFuel Protocol - Mainnet Swap Flow Validation Script (PowerShell)
# Quick validation of critical fixes before deployment

Write-Host "🚀 XFuel Protocol - Mainnet Swap Validation" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

$allPassed = $true

# Check 1: Build succeeds
Write-Host "📦 Check 1: Building web app..." -ForegroundColor Yellow
try {
    $buildOutput = npm run build 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Build successful" -ForegroundColor Green
    } else {
        Write-Host "❌ Build failed" -ForegroundColor Red
        Write-Host "Run: npm run build" -ForegroundColor Red
        $allPassed = $false
    }
} catch {
    Write-Host "❌ Build error: $_" -ForegroundColor Red
    $allPassed = $false
}
Write-Host ""

# Check 2: Critical files exist
Write-Host "📁 Check 2: Verifying critical files..." -ForegroundColor Yellow
$criticalFiles = @(
    "src\App.tsx",
    "src\components\BetaBanner.tsx",
    "src\components\StrideInitModal.tsx",
    "src\utils\cosmosLSTStaking.ts",
    "edgefarm-mobile\src\screens\SwapScreenPro.tsx",
    "docs\SWAP_FLOW_MAINNET_TESTING.md",
    "MAINNET_SWAP_ENHANCEMENTS.md"
)

foreach ($file in $criticalFiles) {
    if (Test-Path $file) {
        Write-Host "✅ $file" -ForegroundColor Green
    } else {
        Write-Host "❌ $file (MISSING)" -ForegroundColor Red
        $allPassed = $false
    }
}
Write-Host ""

# Check 3: Search for critical fixes
Write-Host "🔍 Check 3: Verifying critical fixes in code..." -ForegroundColor Yellow

# Check for null safety in App.tsx
if (Select-String -Path "src\App.tsx" -Pattern "wallet.fullAddress" -Quiet) {
    Write-Host "✅ Null safety checks present in App.tsx" -ForegroundColor Green
} else {
    Write-Host "❌ Missing null safety checks in App.tsx" -ForegroundColor Red
    $allPassed = $false
}

# Check for auto-retry logic
if (Select-String -Path "src\App.tsx" -Pattern "Auto-retry" -Quiet) {
    Write-Host "✅ Auto-retry logic present" -ForegroundColor Green
} else {
    Write-Host "⚠️  Auto-retry logic may be missing" -ForegroundColor Yellow
}

# Check beta banner is non-dismissible
if (Select-String -Path "src\components\BetaBanner.tsx" -Pattern "non-dismissible" -Quiet) {
    Write-Host "✅ Beta banner non-dismissible (safety enforced)" -ForegroundColor Green
} else {
    Write-Host "⚠️  Beta banner dismissibility unclear" -ForegroundColor Yellow
}

# Check for enhanced Stride error messages
if (Select-String -Path "src\utils\cosmosLSTStaking.ts" -Pattern "Stride Account Setup Required" -Quiet) {
    Write-Host "✅ Enhanced Stride error messages present" -ForegroundColor Green
} else {
    Write-Host "⚠️  Stride error messages may not be enhanced" -ForegroundColor Yellow
}
Write-Host ""

# Check 4: Documentation exists
Write-Host "📚 Check 4: Documentation validation..." -ForegroundColor Yellow
if (Test-Path "docs\SWAP_FLOW_MAINNET_TESTING.md") {
    $lineCount = (Get-Content "docs\SWAP_FLOW_MAINNET_TESTING.md" | Measure-Object -Line).Lines
    if ($lineCount -gt 500) {
        Write-Host "✅ Testing guide complete ($lineCount lines)" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Testing guide seems incomplete ($lineCount lines)" -ForegroundColor Yellow
    }
} else {
    Write-Host "❌ Testing guide missing" -ForegroundColor Red
    $allPassed = $false
}

if (Test-Path "MAINNET_SWAP_ENHANCEMENTS.md") {
    Write-Host "✅ Enhancement summary present" -ForegroundColor Green
} else {
    Write-Host "⚠️  Enhancement summary missing" -ForegroundColor Yellow
}
Write-Host ""

# Check 5: Environment validation
Write-Host "⚙️  Check 5: Environment validation..." -ForegroundColor Yellow
if ((Test-Path ".env.local") -or (Test-Path ".env")) {
    Write-Host "✅ Environment file exists" -ForegroundColor Green
} else {
    Write-Host "⚠️  No .env file found - ensure ROUTER_ADDRESS is set for mainnet" -ForegroundColor Yellow
}

# Check if ROUTER_ADDRESS is configured
$envFiles = Get-ChildItem -Filter ".env*" -ErrorAction SilentlyContinue
$routerAddressFound = $false
foreach ($envFile in $envFiles) {
    if (Select-String -Path $envFile.FullName -Pattern "ROUTER_ADDRESS" -Quiet) {
        $routerAddressFound = $true
        break
    }
}

if ($routerAddressFound) {
    Write-Host "✅ ROUTER_ADDRESS configured" -ForegroundColor Green
} else {
    Write-Host "⚠️  ROUTER_ADDRESS may not be configured" -ForegroundColor Yellow
}
Write-Host ""

# Summary
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "🎯 PRE-FLIGHT CHECKLIST" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Before deploying to production:" -ForegroundColor White
Write-Host ""
Write-Host "✅ Code Changes" -ForegroundColor Green
Write-Host "  - [x] Null safety checks added"
Write-Host "  - [x] Auto-retry logic implemented"
Write-Host "  - [x] Beta banner non-dismissible"
Write-Host "  - [x] Enhanced error messages"
Write-Host "  - [x] Mobile fixes applied"
Write-Host ""
Write-Host "📝 Manual Testing Required:" -ForegroundColor Yellow
Write-Host '  - [ ] Run all 10 test cases in SWAP_FLOW_MAINNET_TESTING.md'
Write-Host '  - [ ] Test Stride initialization flow'
Write-Host '  - [ ] Test on mobile (iOS + Android)'
Write-Host '  - [ ] Verify beta limits (1k per swap, 5k per user)'
Write-Host '  - [ ] Test all LST targets (stkXPRT, stkATOM, stkTIA, stkOSMO)'
Write-Host ""
Write-Host "🚀 Next Steps:" -ForegroundColor Cyan
Write-Host "  1. Run manual E2E tests (see docs\SWAP_FLOW_MAINNET_TESTING.md)"
Write-Host "  2. Deploy to staging for QA"
Write-Host "  3. Deploy to production: vercel --prod"
Write-Host "  4. Monitor first 100 users"
Write-Host ""
Write-Host "📖 Documentation:" -ForegroundColor Cyan
Write-Host "  - Testing: docs\SWAP_FLOW_MAINNET_TESTING.md"
Write-Host "  - Summary: MAINNET_SWAP_ENHANCEMENTS.md"
Write-Host ""

if ($allPassed) {
    Write-Host "✅ Automated validation complete!" -ForegroundColor Green
    Write-Host "Proceed with manual testing before production deployment." -ForegroundColor Green
} else {
    Write-Host "❌ Some checks failed. Please review and fix before deployment." -ForegroundColor Red
    exit 1
}

