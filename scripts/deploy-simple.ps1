# Step-by-Step Mainnet Deployment - Copy & Paste

Write-Host "=== XFuel Mainnet Deployment - Step by Step ===" -ForegroundColor Cyan
Write-Host ""

# Step 1: Get private key
Write-Host "Step 1: Enter your private key" -ForegroundColor Yellow
Write-Host "Format: 0x followed by 64 characters" -ForegroundColor Gray
$privateKey = Read-Host "Private Key"

# Validate format
if (-not $privateKey.StartsWith("0x") -or $privateKey.Length -lt 60) {
    Write-Host "❌ Invalid format. Should be: 0x followed by 64 hex characters" -ForegroundColor Red
    Write-Host "Example: 0x1234567890abcdef..." -ForegroundColor Gray
    exit 1
}

# Set environment variable
$env:THETA_MAINNET_PRIVATE_KEY = $privateKey
Write-Host "✅ Private key set" -ForegroundColor Green
Write-Host ""

# Step 2: Check balance
Write-Host "Step 2: Checking wallet..." -ForegroundColor Yellow
Write-Host "Private key starts with: $($privateKey.Substring(0, 10))..." -ForegroundColor Gray
Write-Host ""

# Step 3: Confirm
Write-Host "⚠️  MAINNET DEPLOYMENT - This will use real TFUEL!" -ForegroundColor Red
$confirm = Read-Host "Type 'yes' to continue"

if ($confirm -ne "yes") {
    Write-Host "Cancelled." -ForegroundColor Yellow
    $env:THETA_MAINNET_PRIVATE_KEY = $null
    exit 0
}

Write-Host ""
Write-Host "Step 3: Compiling contracts..." -ForegroundColor Yellow
npx hardhat compile

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Compilation failed" -ForegroundColor Red
    $env:THETA_MAINNET_PRIVATE_KEY = $null
    exit 1
}

Write-Host "✅ Compiled" -ForegroundColor Green
Write-Host ""

Write-Host "Step 4: Deploying to Theta Mainnet..." -ForegroundColor Yellow
npx hardhat run scripts/deploy-mainnet-beta.ts --network theta-mainnet

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Deployment failed" -ForegroundColor Red
    $env:THETA_MAINNET_PRIVATE_KEY = $null
    exit 1
}

Write-Host ""
Write-Host "✅ DEPLOYMENT COMPLETE!" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Next: Copy contract addresses from above and create .env file" -ForegroundColor Cyan

# Clear private key
$env:THETA_MAINNET_PRIVATE_KEY = $null
Write-Host "🔒 Private key cleared" -ForegroundColor Green

