# XFuel Protocol - Docker Deployment Helper
# Run this script to set up and deploy Persistence contracts on Windows

Write-Host "========================================================================"  -ForegroundColor Cyan
Write-Host "🐳 XFUEL PERSISTENCE DOCKER DEPLOYMENT" -ForegroundColor Cyan
Write-Host "========================================================================"
Write-Host ""

# Function to check if command exists
function Test-Command {
    param($Command)
    $null -ne (Get-Command $Command -ErrorAction SilentlyContinue)
}

# Step 1: Check Docker
Write-Host "Step 1: Checking Docker installation..." -ForegroundColor Yellow
if (Test-Command docker) {
    $dockerVersion = docker --version
    Write-Host "✅ Docker found: $dockerVersion" -ForegroundColor Green
} else {
    Write-Host "❌ Docker not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install Docker Desktop for Windows:" -ForegroundColor Yellow
    Write-Host "  https://www.docker.com/products/docker-desktop/" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "After installation:" -ForegroundColor Yellow
    Write-Host "  1. Restart your computer" -ForegroundColor White
    Write-Host "  2. Start Docker Desktop" -ForegroundColor White
    Write-Host "  3. Run this script again" -ForegroundColor White
    Write-Host ""
    exit 1
}

# Check Docker is running
Write-Host "Checking if Docker is running..." -ForegroundColor Yellow
try {
    docker ps | Out-Null
    Write-Host "✅ Docker is running" -ForegroundColor Green
} catch {
    Write-Host "❌ Docker is not running!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please start Docker Desktop from the Start Menu" -ForegroundColor Yellow
    Write-Host "Wait for the whale icon in the system tray to stabilize" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

Write-Host ""

# Step 2: Check for .env.docker
Write-Host "Step 2: Checking configuration..." -ForegroundColor Yellow
if (Test-Path ".env.docker") {
    Write-Host "✅ .env.docker found" -ForegroundColor Green
    
    # Check if mnemonic is set
    $content = Get-Content ".env.docker" -Raw
    if ($content -match 'KEPLR_MNEMONIC="your twelve') {
        Write-Host "⚠️  WARNING: Mnemonic not configured!" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Please edit .env.docker and add your Keplr mnemonic:" -ForegroundColor Yellow
        Write-Host "  notepad .env.docker" -ForegroundColor Cyan
        Write-Host ""
        $continue = Read-Host "Continue anyway? (y/N)"
        if ($continue -ne "y" -and $continue -ne "Y") {
            exit 1
        }
    } else {
        Write-Host "✅ Mnemonic configured" -ForegroundColor Green
    }
} else {
    Write-Host "⚠️  .env.docker not found, creating from template..." -ForegroundColor Yellow
    if (Test-Path "env.docker.example") {
        Copy-Item "env.docker.example" ".env.docker"
        Write-Host "✅ Created .env.docker" -ForegroundColor Green
        Write-Host ""
        Write-Host "Please edit .env.docker and add your Keplr mnemonic:" -ForegroundColor Yellow
        Write-Host "  notepad .env.docker" -ForegroundColor Cyan
        Write-Host ""
        notepad .env.docker
        Write-Host "Press Enter when done editing..." -ForegroundColor Yellow
        Read-Host
    } else {
        Write-Host "❌ env.docker.example not found!" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""

# Step 3: Menu
Write-Host "========================================================================"  -ForegroundColor Cyan
Write-Host "What would you like to do?" -ForegroundColor Cyan
Write-Host "========================================================================"
Write-Host ""
Write-Host "1. Build Docker image" -ForegroundColor White
Write-Host "2. Deploy Persistence contracts" -ForegroundColor White
Write-Host "3. Test mint" -ForegroundColor White
Write-Host "4. View logs" -ForegroundColor White
Write-Host "5. Interactive shell (debugging)" -ForegroundColor White
Write-Host "6. Clean up (stop containers)" -ForegroundColor White
Write-Host "7. Full deployment (build + deploy + test)" -ForegroundColor Green
Write-Host "0. Exit" -ForegroundColor Gray
Write-Host ""

$choice = Read-Host "Enter your choice (0-7)"

switch ($choice) {
    "1" {
        Write-Host ""
        Write-Host "Building Docker image..." -ForegroundColor Yellow
        docker-compose build persistence-deployer
        Write-Host ""
        Write-Host "✅ Build complete!" -ForegroundColor Green
    }
    "2" {
        Write-Host ""
        Write-Host "Deploying Persistence contracts..." -ForegroundColor Yellow
        docker-compose --profile deploy up deploy-persistence
        Write-Host ""
        Write-Host "✅ Deployment complete!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Check your .env file for deployed addresses" -ForegroundColor Cyan
    }
    "3" {
        Write-Host ""
        Write-Host "Testing mint..." -ForegroundColor Yellow
        docker-compose --profile test up test-persistence-mint
        Write-Host ""
        Write-Host "✅ Test complete!" -ForegroundColor Green
    }
    "4" {
        Write-Host ""
        Write-Host "Viewing logs (Ctrl+C to exit)..." -ForegroundColor Yellow
        docker-compose logs -f
    }
    "5" {
        Write-Host ""
        Write-Host "Starting interactive shell..." -ForegroundColor Yellow
        Write-Host "Type 'exit' to return" -ForegroundColor Gray
        docker-compose run --rm persistence-deployer
    }
    "6" {
        Write-Host ""
        Write-Host "Cleaning up..." -ForegroundColor Yellow
        docker-compose down
        Write-Host "✅ Cleanup complete!" -ForegroundColor Green
    }
    "7" {
        Write-Host ""
        Write-Host "========================================================================"  -ForegroundColor Cyan
        Write-Host "🚀 FULL DEPLOYMENT SEQUENCE" -ForegroundColor Cyan
        Write-Host "========================================================================"
        Write-Host ""
        
        Write-Host "[1/3] Building Docker image..." -ForegroundColor Yellow
        docker-compose build persistence-deployer
        if ($LASTEXITCODE -ne 0) {
            Write-Host "❌ Build failed!" -ForegroundColor Red
            exit 1
        }
        Write-Host "✅ Build complete!" -ForegroundColor Green
        Write-Host ""
        
        Write-Host "[2/3] Deploying contracts..." -ForegroundColor Yellow
        docker-compose --profile deploy up deploy-persistence
        if ($LASTEXITCODE -ne 0) {
            Write-Host "❌ Deployment failed!" -ForegroundColor Red
            exit 1
        }
        Write-Host "✅ Deployment complete!" -ForegroundColor Green
        Write-Host ""
        
        Write-Host "[3/3] Testing mint..." -ForegroundColor Yellow
        docker-compose --profile test up test-persistence-mint
        if ($LASTEXITCODE -ne 0) {
            Write-Host "⚠️  Test had issues, but continuing..." -ForegroundColor Yellow
        } else {
            Write-Host "✅ Test complete!" -ForegroundColor Green
        }
        Write-Host ""
        
        Write-Host "========================================================================"  -ForegroundColor Cyan
        Write-Host "✅ ALL STEPS COMPLETE!" -ForegroundColor Green
        Write-Host "========================================================================"
        Write-Host ""
        Write-Host "🎉 Persistence contracts deployed!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Check .env for deployed addresses:" -ForegroundColor Cyan
        Write-Host "  - ZK_VERIFIER_ADDRESS" -ForegroundColor White
        Write-Host "  - IBCTFUEL_MINTER_ADDRESS" -ForegroundColor White
        Write-Host ""
        Write-Host "Next steps:" -ForegroundColor Yellow
        Write-Host "  1. Read STEP5_E2E_BRIDGE_TEST_GUIDE.md" -ForegroundColor White
        Write-Host "  2. Run full E2E test" -ForegroundColor White
        Write-Host "  3. Test Ferrari hybrid tokenomics" -ForegroundColor White
        Write-Host ""
    }
    "0" {
        Write-Host ""
        Write-Host "Goodbye! 👋" -ForegroundColor Cyan
        exit 0
    }
    default {
        Write-Host ""
        Write-Host "Invalid choice. Please run the script again." -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "Press Enter to exit..." -ForegroundColor Gray
Read-Host

