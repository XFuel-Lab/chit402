# Remove Beta Limits - Run after successful testing

Write-Host ""
Write-Host "================================================" -ForegroundColor Yellow
Write-Host "   Remove Beta Limits" -ForegroundColor Yellow
Write-Host "================================================" -ForegroundColor Yellow
Write-Host ""

Write-Host "⚠️  WARNING:" -ForegroundColor Red
Write-Host "This will set swap limits to UNLIMITED!" -ForegroundColor Yellow
Write-Host ""

$confirmation = Read-Host "Type 'REMOVE' to continue or press Enter to cancel"

if ($confirmation -ne "REMOVE") {
    Write-Host "Cancelled" -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "Removing limits..." -ForegroundColor Yellow
Write-Host ""

npx hardhat run scripts/remove-beta-limits.cjs --network theta-mainnet

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ Beta limits removed successfully!" -ForegroundColor Green
    Write-Host "Contract is now in full production mode." -ForegroundColor Green
    Write-Host ""
}

