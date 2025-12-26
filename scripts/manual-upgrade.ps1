# Manual Upgrade Script - Step by Step

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "   Manual Upgrade: RevenueSplitter" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Ensure .env.local exists
if (-not (Test-Path ".env.local")) {
    Write-Host "[ERROR] No .env.local file found!" -ForegroundColor Red
    Write-Host "Run .\deploy.ps1 first to set up your private key" -ForegroundColor Yellow
    exit 1
}

Write-Host "Step 1: Compiling contracts..." -ForegroundColor Yellow
Write-Host ""

npx hardhat compile --force 2>&1 | Select-String -Pattern "Compiled|error|Error"

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[ERROR] Compilation failed" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[OK] Compiled successfully" -ForegroundColor Green
Write-Host ""

Write-Host "Step 2: Deploying new implementation..." -ForegroundColor Yellow
Write-Host "This will:"
Write-Host "  1. Deploy new RevenueSplitter implementation"
Write-Host "  2. Upgrade the proxy to use new implementation"
Write-Host "  3. Initialize beta limits (1,000 / 5,000 TFUEL)"
Write-Host ""

$confirmation = Read-Host "Type 'UPGRADE' to continue"

if ($confirmation -ne "UPGRADE") {
    Write-Host "Upgrade cancelled" -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "Running upgrade..." -ForegroundColor Yellow
Write-Host ""

npx hardhat run scripts/upgrade-manual.cjs --network theta-mainnet

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[ERROR] Upgrade failed" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "        UPGRADE COMPLETE!" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Update web UI (.env with CONTRACT_ADDRESS)" -ForegroundColor White
Write-Host "  2. Update mobile UI (config/contracts.ts)" -ForegroundColor White
Write-Host "  3. Test swaps with limits (1k/5k TFUEL)" -ForegroundColor White
Write-Host ""

