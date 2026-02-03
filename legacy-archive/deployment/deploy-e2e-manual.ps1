# ===================================================================
# E2E Testing Deployment - Manual (Safe Wallet + MetaMask)
# ===================================================================

param(
    [string]$VaultFactoryAddress = "",
    [switch]$SkipRedis
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host "🚀 XFUEL E2E Testing - Manual Deployment for Safe Wallet" -ForegroundColor Cyan
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Your Wallet Configuration:" -ForegroundColor Yellow
Write-Host "  Deployer: 0xEb4f292E2f1E5Ff1d3B1aEe6E02794b5fc40e698 (Safe)" -ForegroundColor White
Write-Host "  Relayer:  0xDC17Cbd201E7347555e428690f702bbFcAF2d33c (Theta)" -ForegroundColor White
Write-Host ""

# ===================================================================
# STEP 1: Check Prerequisites
# ===================================================================
Write-Host "📋 Step 1: Checking Prerequisites..." -ForegroundColor Yellow
Write-Host ""

# Check Node.js
Write-Host "   Checking Node.js..." -NoNewline
try {
    $nodeVersion = node --version
    Write-Host " ✅ $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host " ❌" -ForegroundColor Red
    Write-Host "   Node.js not found! Please install Node.js 20+ first." -ForegroundColor Red
    exit 1
}

Write-Host ""

# ===================================================================
# STEP 2: Redis Setup
# ===================================================================
if (-not $SkipRedis) {
    Write-Host "📦 Step 2: Redis Setup..." -ForegroundColor Yellow
    Write-Host ""
    
    Write-Host "   Checking if Redis is running..." -NoNewline
    try {
        $redisTest = redis-cli ping 2>&1
        if ($redisTest -match "PONG") {
            Write-Host " ✅ Already running" -ForegroundColor Green
        }
    } catch {
        Write-Host " ❌ Not running" -ForegroundColor Red
        Write-Host ""
        Write-Host "   Redis is required. Choose installation:" -ForegroundColor Yellow
        Write-Host "   1. Install via winget" -ForegroundColor White
        Write-Host "   2. Download manually" -ForegroundColor White
        Write-Host "   3. Skip (limited functionality)" -ForegroundColor White
        Write-Host ""
        $choice = Read-Host "   Enter choice (1-3)"
        
        switch ($choice) {
            "1" {
                Write-Host "   Installing Redis via winget..." -ForegroundColor Yellow
                winget install Redis.Redis.RedisInsight
                Write-Host "   Starting Redis..." -ForegroundColor Yellow
                Start-Process "redis-server" -WindowStyle Minimized
                Start-Sleep -Seconds 3
                Write-Host "   ✅ Redis started" -ForegroundColor Green
            }
            "2" {
                Write-Host ""
                Write-Host "   Manual installation:" -ForegroundColor Cyan
                Write-Host "   1. Download: https://github.com/redis-windows/redis-windows/releases" -ForegroundColor White
                Write-Host "   2. Extract and run redis-server.exe" -ForegroundColor White
                Write-Host ""
                Read-Host "   Press Enter when Redis is running"
            }
            "3" {
                Write-Host "   ⚠️  Skipping Redis - limited functionality" -ForegroundColor Yellow
                $SkipRedis = $true
            }
        }
    }
    Write-Host ""
}

# ===================================================================
# STEP 3: VaultFactory Deployment Instructions
# ===================================================================
Write-Host "📦 Step 3: Deploy VaultFactory Contract" -ForegroundColor Yellow
Write-Host ""

if (-not $VaultFactoryAddress) {
    Write-Host "   ⚠️  Since you're using a Safe wallet, deployment must be done manually." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "   🔧 Deployment Steps:" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "   1. Open Remix: https://remix.ethereum.org" -ForegroundColor White
    Write-Host ""
    Write-Host "   2. Upload contracts:" -ForegroundColor White
    Write-Host "      - contracts/VaultFactory.sol" -ForegroundColor Gray
    Write-Host "      - contracts/SubVault.sol" -ForegroundColor Gray
    Write-Host ""
    Write-Host "   3. Compile with Solidity 0.8.22" -ForegroundColor White
    Write-Host ""
    Write-Host "   4. Deploy VaultFactory:" -ForegroundColor White
    Write-Host "      - Environment: Injected Provider - MetaMask" -ForegroundColor Gray
    Write-Host "      - Account: 0xEb4f292E2f1E5Ff1d3B1aEe6E02794b5fc40e698" -ForegroundColor Gray
    Write-Host "      - Constructor args:" -ForegroundColor Gray
    Write-Host "        * _adminAddress: 0xEb4f292E2f1E5Ff1d3B1aEe6E02794b5fc40e698" -ForegroundColor Gray
    Write-Host "        * _revSplitter:  0x03973A67449557b14228541Df339Ae041567628B" -ForegroundColor Gray
    Write-Host ""
    Write-Host "   5. Approve transaction in MetaMask & Safe UI" -ForegroundColor White
    Write-Host ""
    Write-Host "   6. Copy the deployed VaultFactory address" -ForegroundColor White
    Write-Host ""
    
    $VaultFactoryAddress = Read-Host "   Enter deployed VaultFactory address (or press Enter to exit)"
    
    if (-not $VaultFactoryAddress) {
        Write-Host ""
        Write-Host "   Exiting. Run this script again with -VaultFactoryAddress after deployment." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "   Example:" -ForegroundColor Cyan
        Write-Host "   .\deploy-e2e-manual.ps1 -VaultFactoryAddress 0x1234...5678" -ForegroundColor White
        Write-Host ""
        exit 0
    }
}

Write-Host ""
Write-Host "   ✅ VaultFactory Address: $VaultFactoryAddress" -ForegroundColor Green
Write-Host ""

# ===================================================================
# STEP 4: Configure Backend
# ===================================================================
Write-Host "⚙️  Step 4: Configuring Backend..." -ForegroundColor Yellow
Write-Host ""

$backendDir = "backend\theta-bridge"
$envFile = "$backendDir\.env"
$rootEnvFile = ".env"

# Check if root .env exists and has relayer key
if (-not (Test-Path $rootEnvFile)) {
    Write-Host "   ❌ Root .env not found at: $rootEnvFile" -ForegroundColor Red
    Write-Host "   Create .env in project root with:" -ForegroundColor Yellow
    Write-Host "   RELAYER_PRIVATE_KEY=0xYourRelayerKeyHere" -ForegroundColor White
    exit 1
}

# Extract relayer key from root .env
$relayerKey = Get-Content $rootEnvFile | Select-String "RELAYER_PRIVATE_KEY" | ForEach-Object { $_.ToString().Split('=')[1].Trim() }

if (-not $relayerKey) {
    Write-Host "   ❌ RELAYER_PRIVATE_KEY not found in root .env" -ForegroundColor Red
    Write-Host "   Add to .env:" -ForegroundColor Yellow
    Write-Host "   RELAYER_PRIVATE_KEY=0xYourRelayerKeyHere" -ForegroundColor White
    exit 1
}

Write-Host "   Found relayer private key in root .env ✅" -ForegroundColor Green

# Create backend .env if doesn't exist
if (-not (Test-Path $envFile)) {
    Write-Host "   Creating backend .env from example..." -NoNewline
    Copy-Item "$backendDir\env.example" $envFile
    Write-Host " ✅" -ForegroundColor Green
}

# Update backend .env
Write-Host "   Updating backend configuration..." -NoNewline

$envContent = Get-Content $envFile

# Update VaultFactory address
$envContent = $envContent -replace "VAULT_FACTORY_ADDRESS=.*", "VAULT_FACTORY_ADDRESS=$VaultFactoryAddress"

# Update relayer key
$envContent = $envContent -replace "RELAYER_PRIVATE_KEY=.*", "RELAYER_PRIVATE_KEY=$relayerKey"

# Update RPC URLs (mainnet)
$envContent = $envContent -replace "THETA_RPC_URLS=.*", "THETA_RPC_URLS=https://eth-rpc-api.thetatoken.org/rpc,https://theta-eth-rpc.thetatoken.org/rpc"

# Update Redis
if ($SkipRedis) {
    $envContent = $envContent -replace "REDIS_URL=.*", "# REDIS_URL=redis://localhost:6379 (DISABLED)"
} else {
    $envContent = $envContent -replace "REDIS_URL=.*", "REDIS_URL=redis://localhost:6379"
}

Set-Content $envFile $envContent
Write-Host " ✅" -ForegroundColor Green
Write-Host ""

# ===================================================================
# STEP 5: Install Backend Dependencies
# ===================================================================
Write-Host "📦 Step 5: Installing Backend Dependencies..." -ForegroundColor Yellow
Write-Host ""

Push-Location $backendDir
try {
    Write-Host "   Running npm install..." -ForegroundColor Yellow
    npm install --silent
    Write-Host "   ✅ Dependencies installed" -ForegroundColor Green
} catch {
    Write-Host "   ❌ Failed to install dependencies: $_" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location

Write-Host ""

# ===================================================================
# STEP 6: Start Backend Service
# ===================================================================
Write-Host "🚀 Step 6: Starting Backend Service..." -ForegroundColor Yellow
Write-Host ""

Write-Host "   Starting service in new window..." -ForegroundColor Yellow
Push-Location $backendDir
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run dev" -WindowStyle Normal
Pop-Location

Write-Host "   Waiting for service to start..." -NoNewline
Start-Sleep -Seconds 5
Write-Host " ✅" -ForegroundColor Green
Write-Host ""

# ===================================================================
# STEP 7: Health Check
# ===================================================================
Write-Host "🏥 Step 7: Health Check..." -ForegroundColor Yellow
Write-Host ""

Write-Host "   Testing backend endpoint..." -NoNewline
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3001/health" -TimeoutSec 10 -UseBasicParsing
    if ($response.StatusCode -eq 200) {
        Write-Host " ✅ Healthy" -ForegroundColor Green
    } else {
        Write-Host " ⚠️  Status: $($response.StatusCode)" -ForegroundColor Yellow
    }
} catch {
    Write-Host " ⚠️  Could not connect (service may still be starting)" -ForegroundColor Yellow
}

Write-Host ""

# ===================================================================
# DEPLOYMENT SUMMARY
# ===================================================================
Write-Host "=====================================================================" -ForegroundColor Green
Write-Host "✅ E2E TESTING ENVIRONMENT CONFIGURED" -ForegroundColor Green
Write-Host "=====================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Configuration:" -ForegroundColor Cyan
Write-Host "   Network:        Theta Mainnet (361)" -ForegroundColor White
Write-Host "   Deployer:       0xEb4f292E2f1E5Ff1d3B1aEe6E02794b5fc40e698 (Safe)" -ForegroundColor White
Write-Host "   Relayer:        0xDC17Cbd201E7347555e428690f702bbFcAF2d33c" -ForegroundColor White
Write-Host "   VaultFactory:   $VaultFactoryAddress" -ForegroundColor White
Write-Host "   Backend:        http://localhost:3001" -ForegroundColor White
Write-Host "   Redis:          $(if ($SkipRedis) { 'Disabled' } else { 'Enabled' })" -ForegroundColor White
Write-Host ""
Write-Host "🧪 Next Steps:" -ForegroundColor Cyan
Write-Host ""
Write-Host "   1. Start Frontend (Terminal 3):" -ForegroundColor Yellow
Write-Host "      npm run dev" -ForegroundColor White
Write-Host ""
Write-Host "   2. Run E2E Tests:" -ForegroundColor Yellow
Write-Host "      .\run-e2e-tests.ps1" -ForegroundColor White
Write-Host ""
Write-Host "   3. Run Backend Unit Test:" -ForegroundColor Yellow
Write-Host "      cd backend\theta-bridge" -ForegroundColor White
Write-Host "      node test-e2e-quick.js" -ForegroundColor White
Write-Host ""
Write-Host "   4. Check Health:" -ForegroundColor Yellow
Write-Host "      curl http://localhost:3001/health" -ForegroundColor White
Write-Host ""

if (-not $SkipRedis) {
    Write-Host "   5. Check Redis:" -ForegroundColor Yellow
    Write-Host "      redis-cli KEYS vault:*" -ForegroundColor White
    Write-Host ""
}

Write-Host "=====================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "📚 Documentation:" -ForegroundColor Cyan
Write-Host "   Full Guide: DEPLOY_E2E_MANUAL_SAFE.md" -ForegroundColor White
Write-Host "   Quick Ref:  E2E_QUICK_START.md" -ForegroundColor White
Write-Host ""
Write-Host "🎉 Ready for E2E Testing!" -ForegroundColor Green
Write-Host ""

# Save deployment info
$deploymentInfo = @{
    timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    network = "theta-mainnet"
    chainId = 361
    deployer = "0xEb4f292E2f1E5Ff1d3B1aEe6E02794b5fc40e698"
    deployerType = "Safe"
    relayer = "0xDC17Cbd201E7347555e428690f702bbFcAF2d33c"
    vaultFactory = $VaultFactoryAddress
    revenueSplitter = "0x03973A67449557b14228541Df339Ae041567628B"
    backend = "http://localhost:3001"
    redis = -not $SkipRedis
} | ConvertTo-Json

Set-Content "e2e-deployment-info.json" $deploymentInfo
Write-Host "💾 Deployment info saved to: e2e-deployment-info.json" -ForegroundColor Cyan
Write-Host ""

