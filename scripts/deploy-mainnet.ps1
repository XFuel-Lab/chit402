# XFuel Protocol - Mainnet Deployment Script (Windows PowerShell)
# Deploys upgraded contracts with beta testing safety limits

Write-Host "🚀 XFuel Protocol - Mainnet Deployment (Beta Testing Mode)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# Check for required environment variables
if (-not $env:THETA_MAINNET_PRIVATE_KEY) {
  Write-Host "❌ Error: THETA_MAINNET_PRIVATE_KEY not set" -ForegroundColor Red
  Write-Host "Please set your private key:" -ForegroundColor Yellow
  Write-Host '  $env:THETA_MAINNET_PRIVATE_KEY = "your_private_key_here"' -ForegroundColor Yellow
  exit 1
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
  exit 0
}

Write-Host ""
Write-Host "📦 Compiling contracts..." -ForegroundColor Cyan
npx hardhat compile

if ($LASTEXITCODE -ne 0) {
  Write-Host "❌ Compilation failed!" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "🌐 Deploying to Theta Mainnet (Chain ID: 361)..." -ForegroundColor Cyan
Write-Host ""

# Deploy contracts with safety limits
npx hardhat run scripts/deploy-mainnet-beta.ts --network theta-mainnet

if ($LASTEXITCODE -ne 0) {
  Write-Host "❌ Deployment failed!" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "✅ Deployment complete!" -ForegroundColor Green
Write-Host ""
Write-Host "⚠️  IMPORTANT POST-DEPLOYMENT STEPS:" -ForegroundColor Yellow
Write-Host "1. Verify contracts on Theta Explorer" -ForegroundColor White
Write-Host "2. Test with small amounts first (< 10 TFUEL)" -ForegroundColor White
Write-Host "3. Monitor logs and events closely" -ForegroundColor White
Write-Host "4. Have emergency pause ready" -ForegroundColor White
Write-Host "5. Update frontend environment variables:" -ForegroundColor White
Write-Host '   $env:VITE_ROUTER_ADDRESS = "<deployed_router_address>"' -ForegroundColor Cyan
Write-Host '   $env:VITE_NETWORK = "mainnet"' -ForegroundColor Cyan
Write-Host ""
Write-Host "📊 Monitor swaps: Check contract events for UserSwapRecorded" -ForegroundColor White
Write-Host "🛑 Emergency pause: Call setPaused(true) on contracts" -ForegroundColor White
Write-Host ""

