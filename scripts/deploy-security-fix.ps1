# Deploy Security Fix - PowerShell Wrapper

Write-Host ""
Write-Host "🔴 CRITICAL SECURITY UPGRADE" -ForegroundColor Red
Write-Host "Fix tx.origin vulnerability (CVE-XF-2024-001)" -ForegroundColor Red
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""

# Check .env.local exists
if (-not (Test-Path ".env.local")) {
    Write-Host "⚠️  WARNING: .env.local not found" -ForegroundColor Yellow
    Write-Host ""
    $createEnv = Read-Host "Create .env.local with your private key? (y/n)"
    
    if ($createEnv -eq "y") {
        $privateKey = Read-Host "Enter THETA_MAINNET_PRIVATE_KEY (0x...)" -AsSecureString
        $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($privateKey)
        $plainKey = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
        
        @"
THETA_MAINNET_PRIVATE_KEY=$plainKey
"@ | Out-File -FilePath .env.local -Encoding utf8
        
        Write-Host "✅ Created .env.local" -ForegroundColor Green
        Write-Host ""
    } else {
        Write-Host "❌ Cannot proceed without private key" -ForegroundColor Red
        exit 1
    }
}

# Compile contracts
Write-Host "Step 1: Compiling fixed contracts..." -ForegroundColor Yellow
npx hardhat compile --force 2>&1 | Out-Null

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Compilation failed" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Compiled successfully" -ForegroundColor Green
Write-Host ""

# Confirmation
Write-Host "⚠️  You are about to deploy a CRITICAL SECURITY FIX to mainnet" -ForegroundColor Yellow
Write-Host ""
Write-Host "Changes:" -ForegroundColor Cyan
Write-Host "   - RevenueSplitter: tx.origin → msg.sender" -ForegroundColor White
Write-Host "   - BuybackBurner: tx.origin → msg.sender" -ForegroundColor White
Write-Host ""
Write-Host "Cost: ~50 TFUEL" -ForegroundColor Cyan
Write-Host "Time: ~3 minutes" -ForegroundColor Cyan
Write-Host ""

$confirm = Read-Host "Type 'DEPLOY' to continue or press Enter to cancel"

if ($confirm -ne "DEPLOY") {
    Write-Host "Cancelled" -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "Step 2: Deploying upgrade to mainnet..." -ForegroundColor Yellow
Write-Host ""

# Run upgrade script
npx hardhat run scripts/upgrade-fix-tx-origin.cjs --network theta-mainnet

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "=================================================" -ForegroundColor Green
    Write-Host "✅ SECURITY FIX DEPLOYED SUCCESSFULLY" -ForegroundColor Green
    Write-Host "=================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next Steps:" -ForegroundColor Cyan
    Write-Host "   1. Verify on Theta Explorer" -ForegroundColor White
    Write-Host "   2. Test with small swap" -ForegroundColor White
    Write-Host "   3. Update PR with tx hashes" -ForegroundColor White
    Write-Host "   4. Monitor for 24 hours" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "❌ DEPLOYMENT FAILED" -ForegroundColor Red
    Write-Host "Check errors above" -ForegroundColor Red
    Write-Host ""
    exit 1
}

