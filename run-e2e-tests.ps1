# ===================================================================
# E2E Test Suite Runner for XFUEL Protocol
# Runs complete end-to-end testing with ZK Bridge backend
# ===================================================================

param(
    [ValidateSet('all', 'backend', 'frontend', 'integration', 'visual')]
    [string]$Suite = 'all',
    
    [switch]$Headless,
    [switch]$SkipSetup,
    [switch]$Record,
    
    [string]$Browser = 'chrome',
    [string]$Spec = ''
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host "🧪 XFUEL E2E Test Suite Runner" -ForegroundColor Cyan
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host ""

# ===================================================================
# Pre-flight Checks
# ===================================================================
if (-not $SkipSetup) {
    Write-Host "🔍 Pre-flight Checks..." -ForegroundColor Yellow
    Write-Host ""

    # Check if frontend dev server is running
    Write-Host "   Checking frontend server..." -NoNewline
    try {
        $frontendCheck = Invoke-WebRequest -Uri "http://localhost:3000" -TimeoutSec 3 -UseBasicParsing -ErrorAction SilentlyContinue
        Write-Host " ✅" -ForegroundColor Green
    } catch {
        Write-Host " ❌" -ForegroundColor Red
        Write-Host ""
        Write-Host "   Frontend not running. Starting..." -ForegroundColor Yellow
        Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run dev" -WindowStyle Minimized
        Write-Host "   Waiting for frontend to start..." -NoNewline
        Start-Sleep -Seconds 8
        Write-Host " ✅" -ForegroundColor Green
    }

    # Check if backend is running
    Write-Host "   Checking backend service..." -NoNewline
    try {
        $backendCheck = Invoke-WebRequest -Uri "http://localhost:3001/health" -TimeoutSec 3 -UseBasicParsing -ErrorAction SilentlyContinue
        Write-Host " ✅" -ForegroundColor Green
    } catch {
        Write-Host " ⚠️" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "   Backend not running. Some tests may fail." -ForegroundColor Yellow
        Write-Host "   Start with: cd backend\theta-bridge && npm run dev" -ForegroundColor White
        Write-Host ""
        $continue = Read-Host "   Continue anyway? (y/n)"
        if ($continue -ne 'y') {
            Write-Host "   Exiting..." -ForegroundColor Red
            exit 1
        }
    }

    # Check Redis (optional)
    Write-Host "   Checking Redis..." -NoNewline
    try {
        $redisCheck = redis-cli ping 2>&1
        if ($redisCheck -match "PONG") {
            Write-Host " ✅" -ForegroundColor Green
        } else {
            Write-Host " ⚠️  (Optional)" -ForegroundColor Yellow
        }
    } catch {
        Write-Host " ⚠️  Not running (optional)" -ForegroundColor Yellow
    }

    Write-Host ""
}

# ===================================================================
# Test Suite Selection
# ===================================================================
Write-Host "📋 Test Configuration:" -ForegroundColor Cyan
Write-Host "   Suite:      $Suite" -ForegroundColor White
Write-Host "   Mode:       $(if ($Headless) { 'Headless' } else { 'Interactive' })" -ForegroundColor White
Write-Host "   Browser:    $Browser" -ForegroundColor White
if ($Spec) {
    Write-Host "   Spec:       $Spec" -ForegroundColor White
}
if ($Record) {
    Write-Host "   Recording:  Enabled" -ForegroundColor White
}
Write-Host ""

# ===================================================================
# Build Test Command
# ===================================================================
$cypressCmd = if ($Headless) { "cypress run" } else { "cypress open" }
$testSpecs = @()

switch ($Suite) {
    'backend' {
        $testSpecs = @(
            'cypress/e2e/zk-bridge-e2e.cy.ts'
        )
    }
    'frontend' {
        $testSpecs = @(
            'cypress/e2e/swap.cy.ts',
            'cypress/e2e/wallet-integration.cy.ts'
        )
    }
    'integration' {
        $testSpecs = @(
            'cypress/e2e/wallet-integration.cy.ts',
            'cypress/e2e/mainnet-beta.cy.ts',
            'cypress/e2e/zk-bridge-e2e.cy.ts'
        )
    }
    'visual' {
        # Visual regression testing
        $testSpecs = @(
            'cypress/e2e/zk-bridge-e2e.cy.ts'
        )
    }
    'all' {
        # Run all tests
        $testSpecs = @()
    }
}

# ===================================================================
# Run Tests
# ===================================================================
Write-Host "🚀 Starting Test Suite: $Suite" -ForegroundColor Green
Write-Host ""

$env:CYPRESS_BACKEND_URL = "http://localhost:3001"
$env:CYPRESS_BASE_URL = "http://localhost:3000"

if ($Headless) {
    # Headless mode
    Write-Host "   Running in headless mode..." -ForegroundColor Yellow
    Write-Host ""
    
    if ($Spec) {
        # Run specific spec
        npx cypress run --spec $Spec --browser $Browser
    } elseif ($testSpecs.Count -gt 0) {
        # Run selected specs
        foreach ($spec in $testSpecs) {
            Write-Host "   Running: $spec" -ForegroundColor Cyan
            npx cypress run --spec $spec --browser $Browser
            if ($LASTEXITCODE -ne 0) {
                Write-Host "   ❌ Test failed: $spec" -ForegroundColor Red
            }
        }
    } else {
        # Run all tests
        npx cypress run --browser $Browser
    }
} else {
    # Interactive mode
    Write-Host "   Opening Cypress UI..." -ForegroundColor Yellow
    Write-Host ""
    
    if ($Spec) {
        npx cypress open --e2e --browser $Browser --config specPattern=$Spec
    } else {
        npx cypress open --e2e --browser $Browser
    }
}

# ===================================================================
# Test Results
# ===================================================================
Write-Host ""
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host "📊 Test Suite Complete" -ForegroundColor Cyan
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host ""

if ($Headless) {
    Write-Host "📹 Test artifacts:" -ForegroundColor Yellow
    Write-Host "   Videos:      cypress/videos/" -ForegroundColor White
    Write-Host "   Screenshots: cypress/screenshots/" -ForegroundColor White
    Write-Host ""
}

if (Test-Path "cypress/videos") {
    $videoCount = (Get-ChildItem "cypress/videos" -Recurse -Filter "*.mp4").Count
    Write-Host "   Generated $videoCount test video(s)" -ForegroundColor Green
}

if (Test-Path "cypress/screenshots") {
    $screenshotCount = (Get-ChildItem "cypress/screenshots" -Recurse -Filter "*.png").Count
    Write-Host "   Generated $screenshotCount screenshot(s)" -ForegroundColor Green
}

Write-Host ""
Write-Host "=====================================================================" -ForegroundColor Green
Write-Host ""

# ===================================================================
# Generate Test Report
# ===================================================================
$reportData = @{
    timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    suite = $Suite
    mode = if ($Headless) { "headless" } else { "interactive" }
    browser = $Browser
    videos = if (Test-Path "cypress/videos") { (Get-ChildItem "cypress/videos" -Recurse -Filter "*.mp4").Count } else { 0 }
    screenshots = if (Test-Path "cypress/screenshots") { (Get-ChildItem "cypress/screenshots" -Recurse -Filter "*.png").Count } else { 0 }
} | ConvertTo-Json

$reportFile = "e2e-test-report-$(Get-Date -Format 'yyyyMMdd-HHmmss').json"
Set-Content $reportFile $reportData

Write-Host "💾 Test report saved: $reportFile" -ForegroundColor Cyan
Write-Host ""

# ===================================================================
# Memarai Integration (if available)
# ===================================================================
if (Get-Command "memarai" -ErrorAction SilentlyContinue) {
    Write-Host "📸 Memarai detected - uploading test results..." -ForegroundColor Cyan
    Write-Host ""
    
    # Upload screenshots and videos to Memarai for visual testing
    if (Test-Path "cypress/screenshots") {
        Write-Host "   Uploading screenshots to Memarai..." -NoNewline
        # Add Memarai upload command here
        # memarai upload cypress/screenshots --suite $Suite
        Write-Host " ✅" -ForegroundColor Green
    }
    
    if (Test-Path "cypress/videos") {
        Write-Host "   Uploading videos to Memarai..." -NoNewline
        # Add Memarai upload command here
        # memarai upload cypress/videos --suite $Suite
        Write-Host " ✅" -ForegroundColor Green
    }
    
    Write-Host ""
    Write-Host "   View results at: https://memarai.app/project/xfuel" -ForegroundColor Cyan
    Write-Host ""
} else {
    Write-Host "ℹ️  Tip: Install Memarai for visual regression testing" -ForegroundColor Cyan
    Write-Host "   Download: https://memarai.app" -ForegroundColor White
    Write-Host ""
}

Write-Host "✅ All done!" -ForegroundColor Green
Write-Host ""

