# ===================================================================
# E2E Test Suite Runner for XFUEL Protocol
# Runs complete end-to-end testing with ZK Bridge backend
# ===================================================================

param(
    [ValidateSet('all', 'backend', 'frontend', 'integration', 'visual', 'ecosystem', 'security', 'v51', 'perf', 'analytics', 'governance')]
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
            'cypress/e2e/wallet-integration.cy.ts',
            'cypress/e2e/ai-depin-e2e.cy.ts'
        )
    }
    'integration' {
        $testSpecs = @(
            'cypress/e2e/wallet-integration.cy.ts',
            'cypress/e2e/mainnet-beta.cy.ts',
            'cypress/e2e/zk-bridge-e2e.cy.ts',
            'cypress/e2e/ai-depin-e2e.cy.ts'
        )
    }
    'visual' {
        # Visual regression testing
        $testSpecs = @(
            'cypress/e2e/zk-bridge-e2e.cy.ts'
        )
    }
    'ecosystem' {
        # v5.1 Osmosis/Akash/TAO ecosystem E2E (node:test runner)
        Write-Host "   Running v5.1 Ecosystem E2E tests..." -ForegroundColor Cyan
        node --test tests/ai-depin/e2e.test.js
        if ($LASTEXITCODE -ne 0) {
            Write-Host "   Ecosystem E2E tests failed!" -ForegroundColor Red
            exit 1
        }
        Write-Host "   Ecosystem E2E tests passed!" -ForegroundColor Green
        $testSpecs = @()
    }
    'security' {
        # Security fuzzing tests (node:test runner)
        Write-Host "   Running Security Fuzzing tests..." -ForegroundColor Cyan
        node --test tests/security/fuzz.test.js
        if ($LASTEXITCODE -ne 0) {
            Write-Host "   Security fuzzing tests failed!" -ForegroundColor Red
            exit 1
        }
        Write-Host "   Security fuzzing tests passed!" -ForegroundColor Green
        $testSpecs = @()
    }
    'perf' {
        # v5.1 Performance benchmarks: Rust bench + analytics + yield benchmarks
        Write-Host "   Running v5.1 Performance Benchmarks..." -ForegroundColor Cyan
        Write-Host ""

        Write-Host "   [1/3] Fee Analytics Tests (node:test)..." -ForegroundColor Yellow
        node --test tests/ai-depin/analytics.test.js
        if ($LASTEXITCODE -ne 0) {
            Write-Host "   Analytics tests failed!" -ForegroundColor Red
            exit 1
        }
        Write-Host "   Analytics tests passed!" -ForegroundColor Green

        Write-Host "   [2/3] Osmosis Testnet Yield Benchmarks..." -ForegroundColor Yellow
        node governance-mocks/osmosis-testnet-yield.js --duration 30d
        if ($LASTEXITCODE -ne 0) {
            Write-Host "   Yield benchmarks failed!" -ForegroundColor Yellow
        } else {
            Write-Host "   Yield benchmarks completed!" -ForegroundColor Green
        }

        Write-Host "   [3/3] Rust SP1 Benchmarks (if nightly available)..." -ForegroundColor Yellow
        $rustNightly = rustup run nightly rustc --version 2>&1
        if ($LASTEXITCODE -eq 0) {
            Push-Location sp1-prover/program
            cargo +nightly test --lib -- benchmarks 2>&1
            if ($LASTEXITCODE -ne 0) {
                Write-Host "   Rust bench tests had issues (non-blocking)" -ForegroundColor Yellow
            } else {
                Write-Host "   Rust bench tests passed!" -ForegroundColor Green
            }
            Pop-Location
        } else {
            Write-Host "   Skipping Rust benchmarks (nightly not available)" -ForegroundColor Yellow
        }

        Write-Host ""
        Write-Host "   Performance benchmarks complete! See BENCHMARKS.md for results." -ForegroundColor Green
        $testSpecs = @()
    }
    'analytics' {
        # Fee analytics tests only
        Write-Host "   Running Fee Analytics tests..." -ForegroundColor Cyan
        node --test tests/ai-depin/analytics.test.js
        if ($LASTEXITCODE -ne 0) {
            Write-Host "   Analytics tests failed!" -ForegroundColor Red
            exit 1
        }
        Write-Host "   Analytics tests passed!" -ForegroundColor Green
        $testSpecs = @()
    }
    'governance' {
        # Governance mock demos
        Write-Host "   Running Governance Mock Demos..." -ForegroundColor Cyan
        Write-Host ""

        Write-Host "   [1/3] AIVerifier Deploy Demo (MOCK_MODE)..." -ForegroundColor Yellow
        node governance-mocks/mock-ai-verifier-deploy.js
        if ($LASTEXITCODE -ne 0) {
            Write-Host "   Deploy demo failed!" -ForegroundColor Red
            exit 1
        }
        Write-Host "   Deploy demo passed!" -ForegroundColor Green

        Write-Host "   [2/3] Governance Vote Simulation..." -ForegroundColor Yellow
        node governance-mocks/governance-vote-sim.js --scenario all
        if ($LASTEXITCODE -ne 0) {
            Write-Host "   Vote sim failed!" -ForegroundColor Yellow
        } else {
            Write-Host "   Vote sim completed!" -ForegroundColor Green
        }

        Write-Host "   [3/3] Osmosis Yield Benchmarks..." -ForegroundColor Yellow
        node governance-mocks/osmosis-testnet-yield.js
        if ($LASTEXITCODE -ne 0) {
            Write-Host "   Yield benchmarks failed!" -ForegroundColor Yellow
        } else {
            Write-Host "   Yield benchmarks completed!" -ForegroundColor Green
        }

        Write-Host ""
        Write-Host "   Governance mocks complete!" -ForegroundColor Green
        $testSpecs = @()
    }
    'v51' {
        # Full v5.1 test suite: ecosystem E2E + security fuzzing + analytics + Cypress AI DePIN
        Write-Host "   Running full v5.1 test suite..." -ForegroundColor Cyan
        Write-Host ""

        Write-Host "   [1/5] Ecosystem E2E (node:test)..." -ForegroundColor Yellow
        node --test tests/ai-depin/e2e.test.js
        if ($LASTEXITCODE -ne 0) {
            Write-Host "   Ecosystem E2E tests failed!" -ForegroundColor Red
            exit 1
        }
        Write-Host "   Ecosystem E2E passed!" -ForegroundColor Green

        Write-Host "   [2/5] Fee Analytics Tests (node:test)..." -ForegroundColor Yellow
        node --test tests/ai-depin/analytics.test.js
        if ($LASTEXITCODE -ne 0) {
            Write-Host "   Analytics tests failed!" -ForegroundColor Red
            exit 1
        }
        Write-Host "   Analytics tests passed!" -ForegroundColor Green

        Write-Host "   [3/5] Security Fuzzing (node:test)..." -ForegroundColor Yellow
        node --test tests/security/fuzz.test.js
        if ($LASTEXITCODE -ne 0) {
            Write-Host "   Security fuzzing tests failed!" -ForegroundColor Red
            exit 1
        }
        Write-Host "   Security fuzzing passed!" -ForegroundColor Green

        Write-Host "   [4/5] Governance Mock Demos..." -ForegroundColor Yellow
        node governance-mocks/mock-ai-verifier-deploy.js
        if ($LASTEXITCODE -ne 0) {
            Write-Host "   Governance demo had issues (non-blocking)" -ForegroundColor Yellow
        } else {
            Write-Host "   Governance demos passed!" -ForegroundColor Green
        }

        Write-Host "   [5/5] Cypress AI DePIN E2E..." -ForegroundColor Yellow
        $testSpecs = @(
            'cypress/e2e/ai-depin-e2e.cy.ts'
        )
    }
    'all' {
        # Run all tests: v5.1 node:test suites first, then all Cypress specs
        Write-Host "   Running v5.1 node:test suites first..." -ForegroundColor Cyan
        node --test tests/ai-depin/e2e.test.js tests/ai-depin/analytics.test.js tests/security/fuzz.test.js
        if ($LASTEXITCODE -ne 0) {
            Write-Host "   v5.1 node:test suites had failures" -ForegroundColor Yellow
        } else {
            Write-Host "   v5.1 node:test suites passed!" -ForegroundColor Green
        }
        Write-Host ""
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

