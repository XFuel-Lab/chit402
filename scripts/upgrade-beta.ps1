# ============================================
# Upgrade Existing Contracts with Beta Limits
# ============================================

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "   Upgrade RevenueSplitter (Beta Limits)" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "This will upgrade your EXISTING RevenueSplitter contract" -ForegroundColor White
Write-Host "to add beta testing safety limits." -ForegroundColor White
Write-Host ""
Write-Host "Existing contract: 0x03973A67449557b14228541Df339Ae041567628B" -ForegroundColor Yellow
Write-Host ""
Write-Host "⚠️  IMPORTANT:" -ForegroundColor Yellow
Write-Host "   • Contract address stays the same" -ForegroundColor White
Write-Host "   • All existing state is preserved" -ForegroundColor White
Write-Host "   • Limits can be removed after beta" -ForegroundColor White
Write-Host ""

# Check for .env.local
if (-not (Test-Path ".env.local")) {
    Write-Host "Enter your private key:" -ForegroundColor Yellow
    $privateKey = Read-Host "Private Key"
    
    @"
THETA_MAINNET_PRIVATE_KEY=$privateKey
"@ | Out-File -FilePath .env.local -Encoding utf8
} else {
    Write-Host "[OK] Using existing .env.local" -ForegroundColor Green
    Write-Host ""
}

Write-Host "⚠️  This will modify your live mainnet contract!" -ForegroundColor Red
$confirm = Read-Host "Type 'UPGRADE' to continue"

if ($confirm -ne "UPGRADE") {
    Write-Host "Cancelled" -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "Upgrading contract..." -ForegroundColor Cyan
Write-Host ""

npx hardhat run scripts/upgrade-add-beta-limits.cjs --network theta-mainnet

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[ERROR] Upgrade failed - see errors above" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "        UPGRADE COMPLETE!" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""

Write-Host "Beta limits are now active on your contract." -ForegroundColor White
Write-Host ""
Write-Host "To remove limits after beta, run:" -ForegroundColor Yellow
Write-Host "   npx hardhat run scripts/remove-beta-limits.cjs --network theta-mainnet" -ForegroundColor Cyan
Write-Host ""

