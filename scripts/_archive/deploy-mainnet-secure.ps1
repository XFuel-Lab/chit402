# XFuel Protocol - SECURE Mainnet Deployment Script
# This script prompts for private key securely (doesn't save it)

Write-Host "🚀 XFuel Protocol - Secure Mainnet Deployment" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# Check if private key is already set
if (-not $env:THETA_MAINNET_PRIVATE_KEY) {
    Write-Host "⚠️  Private key not found in environment" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "🔐 SECURITY REMINDER:" -ForegroundColor Red
    Write-Host "  - Private key is ONLY for deployment (backend)" -ForegroundColor White
    Write-Host "  - Never commit private keys to git" -ForegroundColor White
    Write-Host "  - Never put in VITE_ variables (frontend exposed)" -ForegroundColor White
    Write-Host "  - Use a separate wallet for deployment" -ForegroundColor White
    Write-Host ""
    
    # Prompt for private key
    $privateKey = Read-Host "Enter deployment wallet private key (0x...)"
    $env:THETA_MAINNET_PRIVATE_KEY = $privateKey
    
    Write-Host "✅ Private key set for this session (not saved)" -ForegroundColor Green
    Write-Host ""
}

Write-Host "⚠️  MAINNET BETA TESTING MODE" -ForegroundColor Yellow
Write-Host "Safety limits enabled:" -ForegroundColor White
Write-Host "  - Max swap: 1,000 TFUEL per transaction" -ForegroundColor White
Write-Host "  - Total limit: 5,000 TFUEL per user" -ForegroundColor White
Write-Host "  - Emergency pause/kill switches active" -ForegroundColor White
Write-Host ""

$confirm = Read-Host "Continue with mainnet deployment? (yes/no)"
if ($confirm -ne "yes") {
    Write-Host "Deployment cancelled." -ForegroundColor Yellow
    $env:THETA_MAINNET_PRIVATE_KEY = $null
    exit 0
}

Write-Host ""
Write-Host "📦 Compiling contracts..." -ForegroundColor Cyan
npx hardhat compile

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Compilation failed!" -ForegroundColor Red
    $env:THETA_MAINNET_PRIVATE_KEY = $null
    exit 1
}

Write-Host ""
Write-Host "🌐 Deploying to Theta Mainnet (Chain ID: 361)..." -ForegroundColor Cyan
Write-Host ""

# Deploy contracts
npx hardhat run scripts/deploy-mainnet-beta.ts --network theta-mainnet

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Deployment failed!" -ForegroundColor Red
    $env:THETA_MAINNET_PRIVATE_KEY = $null
    exit 1
}

Write-Host ""
Write-Host "✅ Deployment complete!" -ForegroundColor Green
Write-Host ""
Write-Host "🔐 NEXT: Configure Frontend (SAFE - Public Addresses)" -ForegroundColor Cyan
Write-Host ""
Write-Host "Copy the deployed contract addresses above and run:" -ForegroundColor White
Write-Host ""
Write-Host "# Create .env file with public addresses:" -ForegroundColor Yellow
Write-Host 'VITE_ROUTER_ADDRESS=0xYOUR_DEPLOYED_ADDRESS_HERE' -ForegroundColor Yellow
Write-Host 'VITE_NETWORK=mainnet' -ForegroundColor Yellow
Write-Host 'VITE_API_URL=https://api.xfuel.io' -ForegroundColor Yellow
Write-Host ""
Write-Host "✅ These VITE_ variables are SAFE (public contract addresses)" -ForegroundColor Green
Write-Host ""

# Clear private key from memory for security
$env:THETA_MAINNET_PRIVATE_KEY = $null
Write-Host "🔒 Private key cleared from memory" -ForegroundColor Green
