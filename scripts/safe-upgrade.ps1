# Safe Upgrade Script

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "   Safe Upgrade: RevenueSplitter" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Ensure .env.local exists
if (-not (Test-Path ".env.local")) {
    Write-Host "Enter your private key:" -ForegroundColor Yellow
    $privateKey = Read-Host "Private Key"
    @"
THETA_MAINNET_PRIVATE_KEY=$privateKey
"@ | Out-File -FilePath .env.local -Encoding utf8
}

Write-Host "Step 1: Compiling contracts..." -ForegroundColor Yellow
npx hardhat compile --force

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[ERROR] Compilation failed" -ForegroundColor Red
    exit 1
}

Write-Host "[OK] Compiled" -ForegroundColor Green
Write-Host ""

Write-Host "Step 2: Running upgrade..." -ForegroundColor Yellow
npx hardhat run scripts/upgrade-safe.cjs --network theta-mainnet

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[ERROR] Upgrade failed" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "        SUCCESS!" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""

