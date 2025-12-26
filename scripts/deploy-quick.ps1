# Quick Deploy - Skip Compilation (already compiled)

Write-Host "=== XFuel Mainnet Deployment (Quick) ===" -ForegroundColor Cyan
Write-Host ""

# Get private key
Write-Host "Enter your private key (starts with 0x):" -ForegroundColor Yellow
$privateKey = Read-Host "Private Key"

if (-not $privateKey.StartsWith("0x")) {
    Write-Host "❌ Must start with 0x" -ForegroundColor Red
    exit 1
}

$env:THETA_MAINNET_PRIVATE_KEY = $privateKey
Write-Host "✅ Private key set" -ForegroundColor Green
Write-Host ""

# Verify account
Write-Host "Checking account..." -ForegroundColor Yellow
npx hardhat run scripts/check-accounts.ts --network theta-mainnet

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Account check failed" -ForegroundColor Red
    $env:THETA_MAINNET_PRIVATE_KEY = $null
    exit 1
}

Write-Host ""
Write-Host "⚠️  MAINNET DEPLOYMENT - This uses real TFUEL!" -ForegroundColor Red
$confirm = Read-Host "Type 'yes' to deploy"

if ($confirm -ne "yes") {
    Write-Host "Cancelled" -ForegroundColor Yellow
    $env:THETA_MAINNET_PRIVATE_KEY = $null
    exit 0
}

Write-Host ""
Write-Host "Deploying to Theta Mainnet..." -ForegroundColor Cyan
npx hardhat run scripts/deploy-mainnet-beta.ts --network theta-mainnet

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Deployment failed" -ForegroundColor Red
    $env:THETA_MAINNET_PRIVATE_KEY = $null
    exit 1
}

Write-Host ""
Write-Host "✅ DEPLOYMENT COMPLETE!" -ForegroundColor Green

# Clear key
$env:THETA_MAINNET_PRIVATE_KEY = $null
Write-Host "🔒 Private key cleared" -ForegroundColor Green

