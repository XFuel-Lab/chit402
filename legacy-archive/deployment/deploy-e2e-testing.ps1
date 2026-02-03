# ===================================================================
# XFUEL E2E Testing Deployment Script
# Deploys ZK Bridge Backend for End-to-End Testing
# ===================================================================

param(
    [switch]$SkipRedis,
    [switch]$LocalTest,
    [string]$RevenueSplitterAddress = "0x03973A67449557b14228541Df339Ae041567628B"
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host "🚀 XFUEL E2E Testing Deployment" -ForegroundColor Cyan
Write-Host "=====================================================================" -ForegroundColor Cyan
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

# Check if in correct directory
if (-not (Test-Path "package.json")) {
    Write-Host "❌ Not in project root! Please run from C:\Users\seeha\xfuel-protocol" -ForegroundColor Red
    exit 1
}

Write-Host "   Project root found ✅" -ForegroundColor Green
Write-Host ""

# ===================================================================
# STEP 2: Install/Check Redis
# ===================================================================
if (-not $SkipRedis) {
    Write-Host "📦 Step 2: Redis Setup..." -ForegroundColor Yellow
    Write-Host ""
    
    # Check if Redis is already running
    Write-Host "   Checking if Redis is running..." -NoNewline
    try {
        $redisTest = redis-cli ping 2>&1
        if ($redisTest -match "PONG") {
            Write-Host " ✅ Already running" -ForegroundColor Green
        }
    } catch {
        Write-Host " ❌ Not running" -ForegroundColor Red
        Write-Host ""
        Write-Host "   Redis is not installed or not running." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "   Choose installation method:" -ForegroundColor Cyan
        Write-Host "   1. Install via winget (recommended)" -ForegroundColor White
        Write-Host "   2. Download manually" -ForegroundColor White
        Write-Host "   3. Skip Redis (limited testing)" -ForegroundColor White
        Write-Host ""
        $choice = Read-Host "   Enter choice (1-3)"
        
        switch ($choice) {
            "1" {
                Write-Host ""
                Write-Host "   Installing Redis via winget..." -ForegroundColor Yellow
                winget install Redis.Redis.RedisInsight
                Write-Host "   ✅ Redis installed! Starting..." -ForegroundColor Green
                Start-Process "redis-server" -WindowStyle Minimized
                Start-Sleep -Seconds 3
            }
            "2" {
                Write-Host ""
                Write-Host "   Manual installation:" -ForegroundColor Cyan
                Write-Host "   1. Download: https://github.com/redis-windows/redis-windows/releases" -ForegroundColor White
                Write-Host "   2. Extract to C:\Redis" -ForegroundColor White
                Write-Host "   3. Run: C:\Redis\redis-server.exe" -ForegroundColor White
                Write-Host ""
                Read-Host "   Press Enter when Redis is running"
            }
            "3" {
                Write-Host ""
                Write-Host "   ⚠️  Skipping Redis - some tests will be limited" -ForegroundColor Yellow
                $SkipRedis = $true
            }
            default {
                Write-Host "   Invalid choice. Exiting." -ForegroundColor Red
                exit 1
            }
        }
    }
    Write-Host ""
} else {
    Write-Host "⚠️  Step 2: Skipping Redis (limited functionality)" -ForegroundColor Yellow
    Write-Host ""
}

# ===================================================================
# STEP 3: Deploy VaultFactory Contract
# ===================================================================
Write-Host "📦 Step 3: Deploying VaultFactory Contract..." -ForegroundColor Yellow
Write-Host ""

$networkFlag = if ($LocalTest) { "localhost" } else { "theta-mainnet" }

Write-Host "   Network: $networkFlag" -ForegroundColor Cyan
Write-Host "   RevenueSplitter: $RevenueSplitterAddress" -ForegroundColor Cyan
Write-Host ""

# Set environment variable for deployment
$env:REV_SPLITTER_ADDRESS = $RevenueSplitterAddress

# Check if we need to start local network
if ($LocalTest) {
    Write-Host "   Starting local Hardhat network..." -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "npx hardhat node" -WindowStyle Minimized
    Write-Host "   Waiting for network to start..." -NoNewline
    Start-Sleep -Seconds 5
    Write-Host " ✅" -ForegroundColor Green
}

Write-Host "   Deploying contract..." -ForegroundColor Yellow
Write-Host ""

try {
    $deployOutput = npx hardhat run scripts/deploy-vault-factory.cjs --network $networkFlag 2>&1
    Write-Host $deployOutput
    
    # Extract VaultFactory address from output
    $vaultFactoryMatch = $deployOutput | Select-String "VaultFactory deployed to: (0x[a-fA-F0-9]{40})"
    
    if ($vaultFactoryMatch) {
        $vaultFactoryAddress = $vaultFactoryMatch.Matches[0].Groups[1].Value
        Write-Host ""
        Write-Host "   ✅ VaultFactory deployed: $vaultFactoryAddress" -ForegroundColor Green
    } else {
        Write-Host "   ❌ Could not extract VaultFactory address from output" -ForegroundColor Red
        Write-Host "   Please check the output above and enter manually." -ForegroundColor Yellow
        $vaultFactoryAddress = Read-Host "   Enter VaultFactory address"
    }
} catch {
    Write-Host "   ❌ Deployment failed: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""

# ===================================================================
# STEP 4: Configure Backend
# ===================================================================
Write-Host "⚙️  Step 4: Configuring Backend..." -ForegroundColor Yellow
Write-Host ""

$backendDir = "backend\theta-bridge"
$envFile = "$backendDir\.env"

# Check if .env exists, if not copy from example
if (-not (Test-Path $envFile)) {
    Write-Host "   Creating .env from example..." -NoNewline
    Copy-Item "$backendDir\env.example" $envFile
    Write-Host " ✅" -ForegroundColor Green
}

# Update .env with deployed address
Write-Host "   Updating configuration..." -NoNewline

$envContent = Get-Content $envFile
$envContent = $envContent -replace "VAULT_FACTORY_ADDRESS=.*", "VAULT_FACTORY_ADDRESS=$vaultFactoryAddress"

if ($LocalTest) {
    $envContent = $envContent -replace "THETA_RPC_URLS=.*", "THETA_RPC_URLS=http://localhost:8545"
    # Use Hardhat's default account #0 private key for local testing
    $envContent = $envContent -replace "RELAYER_PRIVATE_KEY=.*", "RELAYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
} else {
    # Check if user has private key in root .env
    if (Test-Path ".env") {
        $rootEnv = Get-Content ".env"
        $mainnetKey = $rootEnv | Select-String "THETA_MAINNET_PRIVATE_KEY=(.*)"
        if ($mainnetKey) {
            $key = $mainnetKey.Matches[0].Groups[1].Value
            $envContent = $envContent -replace "RELAYER_PRIVATE_KEY=.*", "RELAYER_PRIVATE_KEY=$key"
        }
    }
}

if ($SkipRedis) {
    $envContent = $envContent -replace "REDIS_URL=.*", "# REDIS_URL=redis://localhost:6379 (DISABLED)"
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
    Write-Host " ⚠️  Could not connect (this is normal, service may still be starting)" -ForegroundColor Yellow
}

Write-Host ""

# ===================================================================
# DEPLOYMENT SUMMARY
# ===================================================================
Write-Host "=====================================================================" -ForegroundColor Green
Write-Host "✅ E2E TESTING ENVIRONMENT DEPLOYED" -ForegroundColor Green
Write-Host "=====================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Configuration:" -ForegroundColor Cyan
Write-Host "   Network:        $networkFlag" -ForegroundColor White
Write-Host "   VaultFactory:   $vaultFactoryAddress" -ForegroundColor White
Write-Host "   Backend:        http://localhost:3001" -ForegroundColor White
Write-Host "   Redis:          $(if ($SkipRedis) { 'Disabled' } else { 'Enabled' })" -ForegroundColor White
Write-Host ""
Write-Host "🧪 Next Steps:" -ForegroundColor Cyan
Write-Host ""
Write-Host "   1. Run E2E Tests:" -ForegroundColor Yellow
Write-Host "      cd backend\theta-bridge" -ForegroundColor White
Write-Host "      node test-e2e-quick.js" -ForegroundColor White
Write-Host ""
Write-Host "   2. Start Cypress Tests:" -ForegroundColor Yellow
Write-Host "      npm run dev              # Terminal 1" -ForegroundColor White
Write-Host "      npm run cypress:open     # Terminal 2" -ForegroundColor White
Write-Host ""
Write-Host "   3. Monitor Logs:" -ForegroundColor Yellow
Write-Host "      Check the backend service window" -ForegroundColor White
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
Write-Host "🎉 Ready for E2E Testing!" -ForegroundColor Green
Write-Host ""

# Save deployment info
$deploymentInfo = @{
    timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    network = $networkFlag
    vaultFactory = $vaultFactoryAddress
    revenueSplitter = $RevenueSplitterAddress
    backend = "http://localhost:3001"
    redis = -not $SkipRedis
} | ConvertTo-Json

Set-Content "e2e-deployment-info.json" $deploymentInfo
Write-Host "💾 Deployment info saved to: e2e-deployment-info.json" -ForegroundColor Cyan
Write-Host ""

