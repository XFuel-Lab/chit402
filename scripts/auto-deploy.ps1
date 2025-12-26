# ============================================
# XFuel Mainnet Deployment - FULLY AUTOMATED
# For beginners - Just answer the prompts!
# ============================================

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "   XFuel Protocol - Auto Mainnet Deploy" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Function to show progress
function Show-Progress {
    param($message, $step, $total)
    Write-Host "[$step/$total] $message" -ForegroundColor Yellow
}

# Function to show success
function Show-Success {
    param($message)
    Write-Host "[OK] $message" -ForegroundColor Green
}

# Function to show error
function Show-Error {
    param($message)
    Write-Host "[ERROR] $message" -ForegroundColor Red
}

# ===== STEP 1: CHECK EXISTING ENV FILE =====
if (Test-Path ".env.local") {
    Write-Host "[!] Found existing .env.local file" -ForegroundColor Yellow
    $reuse = Read-Host "Reuse existing private key? (yes/no)"
    
    if ($reuse -ne "yes") {
        Remove-Item .env.local
        Write-Host "[OK] Deleted old .env.local" -ForegroundColor Green
    } else {
        Write-Host "[OK] Reusing existing private key" -ForegroundColor Green
        Write-Host ""
        # Skip to deployment
        goto Deployment
    }
}

# ===== STEP 2: GET PRIVATE KEY =====
Show-Progress "Getting deployment credentials..." 1 5
Write-Host ""
Write-Host "You'll need your Theta wallet private key." -ForegroundColor White
Write-Host "It will be saved temporarily in .env.local (git-ignored)" -ForegroundColor Gray
Write-Host ""
Write-Host "Format: Must start with 0x followed by 64 characters" -ForegroundColor Gray
Write-Host "Example: 0x1234567890abcdef..." -ForegroundColor DarkGray
Write-Host ""

$privateKey = Read-Host "Paste your private key here"

# Validate format
if (-not $privateKey) {
    Show-Error "No private key entered"
    exit 1
}

if (-not $privateKey.StartsWith("0x")) {
    Show-Error "Private key must start with 0x"
    exit 1
}

if ($privateKey.Length -lt 60) {
    Show-Error "Private key too short (should be 66 characters)"
    exit 1
}

Show-Success "Private key accepted"
Write-Host ""

# ===== STEP 3: CREATE SECURE ENV FILE =====
Show-Progress "Creating secure environment file..." 2 5

# Create .env.local (auto-ignored by git)
@"
THETA_MAINNET_PRIVATE_KEY=$privateKey
"@ | Out-File -FilePath .env.local -Encoding utf8

Show-Success "Secure file created (.env.local)"
Write-Host ""

# Verify it was created
if (-not (Test-Path ".env.local")) {
    Show-Error "Failed to create .env.local file!"
    exit 1
}

:Deployment

# ===== STEP 4: CONFIRM DEPLOYMENT =====
Show-Progress "Ready to deploy..." 3 5
Write-Host ""
Write-Host "WARNING: This will deploy to MAINNET with REAL TFUEL!" -ForegroundColor Red
Write-Host ""
Write-Host "Safety limits will be enabled:" -ForegroundColor Yellow
Write-Host "  * Max per swap: 1,000 TFUEL" -ForegroundColor White
Write-Host "  * Total per user: 5,000 TFUEL" -ForegroundColor White
Write-Host "  * Emergency pause: Available" -ForegroundColor White
Write-Host ""
Write-Host "Make sure your wallet has at least 100 TFUEL for gas!" -ForegroundColor Yellow
Write-Host ""

$confirm = Read-Host "Type 'DEPLOY' (all caps) to continue"

if ($confirm -ne "DEPLOY") {
    Show-Error "Deployment cancelled"
    Write-Host ""
    Write-Host "Note: .env.local file was kept. Run script again to reuse it." -ForegroundColor Gray
    exit 0
}

Write-Host ""

# ===== STEP 5: DEPLOY CONTRACTS =====
Show-Progress "Deploying contracts to Theta Mainnet..." 4 5
Write-Host ""
Write-Host "This may take 3-5 minutes. Please be patient..." -ForegroundColor Yellow
Write-Host ""

# Run deployment
npx hardhat run scripts/deploy-mainnet-production.cjs --network theta-mainnet

$deploymentSuccess = ($LASTEXITCODE -eq 0)

if (-not $deploymentSuccess) {
    Write-Host ""
    Show-Error "Deployment failed - see errors above"
    Write-Host ""
    Write-Host "Troubleshooting tips:" -ForegroundColor Yellow
    Write-Host "  1. Make sure your wallet has 100+ TFUEL" -ForegroundColor White
    Write-Host "  2. Check your internet connection" -ForegroundColor White
    Write-Host "  3. Verify your private key is correct" -ForegroundColor White
    Write-Host "  4. Try running .\scripts\test-dotenv.ps1 to test config" -ForegroundColor White
    Write-Host ""
    Write-Host "Note: .env.local file was kept for debugging." -ForegroundColor Gray
    Write-Host "Run .\deploy.ps1 again to retry (will reuse the key)." -ForegroundColor Gray
    exit 1
}

Write-Host ""
Show-Success "Contracts deployed!"
Write-Host ""

# ===== STEP 6: CLEAN UP & NEXT STEPS =====
Show-Progress "Cleaning up and preparing next steps..." 5 5
Write-Host ""

# Ask before deleting
$cleanup = Read-Host "Delete .env.local file now? (yes/no)"
if ($cleanup -eq "yes") {
    Remove-Item .env.local -ErrorAction SilentlyContinue
    Show-Success "Secure files cleaned up"
} else {
    Write-Host "[!] .env.local kept - delete it manually when done" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "        DEPLOYMENT COMPLETE!" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""

Write-Host "NEXT STEPS:" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. SCROLL UP and find 'RevenueSplitter' address" -ForegroundColor White
Write-Host "   Look for: 'RevenueSplitter: 0x...'" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Copy that address and create .env file:" -ForegroundColor White
Write-Host ""
Write-Host "   Replace 0xYOUR_ADDRESS with the actual address:" -ForegroundColor Yellow
Write-Host ""
Write-Host '@"' -ForegroundColor Cyan
Write-Host 'VITE_ROUTER_ADDRESS=0xYOUR_REVENUE_SPLITTER_ADDRESS' -ForegroundColor Cyan
Write-Host 'VITE_NETWORK=mainnet' -ForegroundColor Cyan
Write-Host 'VITE_API_URL=https://api.xfuel.io' -ForegroundColor Cyan
Write-Host '"@ | Out-File -FilePath .env -Encoding utf8' -ForegroundColor Cyan
Write-Host ""
Write-Host "3. Deploy frontend:" -ForegroundColor White
Write-Host "     npm run build" -ForegroundColor Cyan
Write-Host "     vercel --prod" -ForegroundColor Cyan
Write-Host ""
Write-Host "4. View on Theta Explorer:" -ForegroundColor White
Write-Host "     https://explorer.thetatoken.org" -ForegroundColor Blue
Write-Host ""
