# XFuel Protocol - Theta Testnet Deployment Script (PowerShell)
# This script deploys the full protocol with security features to Theta testnet

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "🔐 XFuel Protocol - Theta Testnet Deployment" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

# Check if .env.local exists
if (-not (Test-Path ".env.local")) {
    Write-Host "❌ Error: .env.local file not found" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please create .env.local with the following content:"
    Write-Host ""
    Write-Host "PRIVATE_KEY=your_testnet_private_key_here"
    Write-Host "THETA_TESTNET_RPC=https://eth-rpc-api-testnet.thetatoken.org/rpc"
    Write-Host ""
    exit 1
}

# Check if node_modules exists
if (-not (Test-Path "node_modules")) {
    Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
    npm install
    Write-Host ""
}

# Clean and compile contracts
Write-Host "🔨 Compiling contracts..." -ForegroundColor Yellow
npx hardhat clean
npx hardhat compile
Write-Host ""

# Run deployment
Write-Host "🚀 Starting deployment to Theta Testnet..." -ForegroundColor Green
Write-Host ""
Write-Host "⚠️  Make sure you have:" -ForegroundColor Yellow
Write-Host "   - At least 50 TFUEL in your testnet wallet"
Write-Host "   - Configured PRIVATE_KEY in .env.local"
Write-Host "   - Network connectivity to Theta testnet"
Write-Host ""

$confirmation = Read-Host "Press Enter to continue or Ctrl+C to cancel"
Write-Host ""

# Deploy to testnet
npx hardhat run scripts/testnet-deploy-security.ts --network theta-testnet

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
    Write-Host "✅ Deployment script completed!" -ForegroundColor Green
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
    Write-Host ""
    Write-Host "📝 Next steps:" -ForegroundColor Cyan
    Write-Host "   1. Check deployment output above for contract addresses"
    Write-Host "   2. Verify contracts on Theta Explorer"
    Write-Host "   3. Update frontend .env with new addresses"
    Write-Host "   4. Test all security features"
    Write-Host ""
    Write-Host "📖 For detailed instructions, see:" -ForegroundColor Cyan
    Write-Host "   scripts/TESTNET_DEPLOYMENT_GUIDE.md"
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "❌ Deployment failed!" -ForegroundColor Red
    Write-Host "Please check the error messages above." -ForegroundColor Red
    Write-Host ""
    exit 1
}


