# Manual Optimization Script (Windows PowerShell)
# Use this if bash scripts fail on Windows

Write-Host "========================================================================" -ForegroundColor Blue
Write-Host "🔧 MANUAL WASM OPTIMIZATION (Windows)" -ForegroundColor Blue
Write-Host "========================================================================" -ForegroundColor Blue
Write-Host ""

# Check if unoptimized WASM files exist
$zkPath = "target\wasm32-unknown-unknown\release\zk_verifier.wasm"
$minterPath = "target\wasm32-unknown-unknown\release\ibc_tfuel_minter.wasm"

if (-not (Test-Path $zkPath)) {
    Write-Host "❌ zk_verifier.wasm not found" -ForegroundColor Red
    Write-Host "Build contracts first: bash scripts/build-cosmwasm-contracts.sh"
    exit 1
}

if (-not (Test-Path $minterPath)) {
    Write-Host "❌ ibc_tfuel_minter.wasm not found" -ForegroundColor Red
    Write-Host "Build contracts first: bash scripts/build-cosmwasm-contracts.sh"
    exit 1
}

Write-Host "✅ Found unoptimized WASM files" -ForegroundColor Green
Write-Host ""

# Show current sizes
Write-Host "📦 Current sizes (unoptimized):" -ForegroundColor Cyan
$zkItem = Get-Item $zkPath
$minterItem = Get-Item $minterPath
Write-Host "  ZK Verifier:     $([math]::Round($zkItem.Length/1KB,2)) KB ($($zkItem.Length) bytes)"
Write-Host "  ibcTFUEL Minter: $([math]::Round($minterItem.Length/1KB,2)) KB ($($minterItem.Length) bytes)"
Write-Host ""

# Create artifacts directory
New-Item -ItemType Directory -Force -Path "artifacts" | Out-Null

# Check if Docker is available
Write-Host "========================================================================" -ForegroundColor Blue
Write-Host "🔍 Checking for Docker" -ForegroundColor Blue
Write-Host "========================================================================" -ForegroundColor Blue
Write-Host ""

try {
    docker info | Out-Null
    Write-Host "✅ Docker is available" -ForegroundColor Green
    Write-Host "ℹ️  Using emscripten/emsdk image for wasm-opt" -ForegroundColor Cyan
    Write-Host ""
} catch {
    Write-Host "❌ Docker is not available" -ForegroundColor Red
    Write-Host ""
    Write-Host "Install Docker Desktop: https://www.docker.com/products/docker-desktop/"
    Write-Host "Or install binaryen locally: scoop install binaryen"
    Write-Host ""
    exit 1
}

# Function to optimize a WASM file
function Optimize-Wasm {
    param(
        [string]$InputPath,
        [string]$OutputPath,
        [string]$Name
    )
    
    Write-Host "========================================================================" -ForegroundColor Blue
    Write-Host "⚙️  Optimizing: $Name" -ForegroundColor Blue
    Write-Host "========================================================================" -ForegroundColor Blue
    Write-Host ""
    
    $inputFull = (Resolve-Path $InputPath).Path
    $workDir = (Get-Location).Path
    
    # Convert Windows paths to Linux paths for Docker
    $inputLinux = "/app/" + ($InputPath -replace '\\', '/')
    $outputLinux = "/app/" + ($OutputPath -replace '\\', '/')
    
    # Run wasm-opt in Docker
    docker run --rm -v "${workDir}:/app" -w /app emscripten/emsdk:3.1.50 `
        wasm-opt -Oz --signext-lowering --strip-debug --strip-producers `
        $inputLinux -o $outputLinux
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Optimization failed for $Name" -ForegroundColor Red
        return $false
    }
    
    # Show results
    $originalSize = (Get-Item $InputPath).Length
    $optimizedSize = (Get-Item $OutputPath).Length
    $reduction = [math]::Round((1 - $optimizedSize / $originalSize) * 100, 1)
    
    Write-Host "✅ Optimized: $Name" -ForegroundColor Green
    Write-Host "  Original:  $([math]::Round($originalSize/1KB,2)) KB"
    Write-Host "  Optimized: $([math]::Round($optimizedSize/1KB,2)) KB"
    Write-Host "  Reduction: $reduction%"
    Write-Host ""
    
    # Check if size is acceptable
    if ($optimizedSize -lt 153600) {
        Write-Host "✅ Size acceptable for mainnet (<150 KB)" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Warning: Size still large (>150 KB)" -ForegroundColor Yellow
        Write-Host "   This may cause deployment issues"
    }
    Write-Host ""
    
    return $true
}

# Optimize both contracts
$success1 = Optimize-Wasm `
    -InputPath "target\wasm32-unknown-unknown\release\zk_verifier.wasm" `
    -OutputPath "artifacts\zk_verifier.wasm" `
    -Name "ZK Verifier"

$success2 = Optimize-Wasm `
    -InputPath "target\wasm32-unknown-unknown\release\ibc_tfuel_minter.wasm" `
    -OutputPath "artifacts\ibc_tfuel_minter.wasm" `
    -Name "ibcTFUEL Minter"

if (-not ($success1 -and $success2)) {
    Write-Host "❌ Optimization failed" -ForegroundColor Red
    exit 1
}

# Generate checksums
Write-Host "========================================================================" -ForegroundColor Blue
Write-Host "📝 GENERATING CHECKSUMS" -ForegroundColor Blue
Write-Host "========================================================================" -ForegroundColor Blue
Write-Host ""

$zkHash = (Get-FileHash "artifacts\zk_verifier.wasm" -Algorithm SHA256).Hash.ToLower()
$minterHash = (Get-FileHash "artifacts\ibc_tfuel_minter.wasm" -Algorithm SHA256).Hash.ToLower()

$checksums = @"
$zkHash  zk_verifier.wasm
$minterHash  ibc_tfuel_minter.wasm
"@

$checksums | Out-File -FilePath "artifacts\checksums.txt" -Encoding utf8
Write-Host $checksums
Write-Host ""

# Summary
Write-Host "========================================================================" -ForegroundColor Blue
Write-Host "✅ OPTIMIZATION COMPLETE" -ForegroundColor Green
Write-Host "========================================================================" -ForegroundColor Blue
Write-Host ""
Write-Host "📦 Optimized files ready:" -ForegroundColor Cyan
Write-Host "  - artifacts\zk_verifier.wasm"
Write-Host "  - artifacts\ibc_tfuel_minter.wasm"
Write-Host "  - artifacts\checksums.txt"
Write-Host ""
Write-Host "📊 Final sizes:" -ForegroundColor Cyan
Get-ChildItem "artifacts\*.wasm" | ForEach-Object {
    Write-Host "  $($_.Name): $([math]::Round($_.Length/1KB,2)) KB"
}
Write-Host ""
Write-Host "🚀 Next step: Deploy to Persistence" -ForegroundColor Cyan
Write-Host "   Run: docker-compose run --rm persistence-deployer /app/scripts/docker-deploy-persistence.sh"
Write-Host ""
Write-Host "💡 Tip: Verify deployment with updated script that uses artifacts/" -ForegroundColor Yellow
Write-Host ""

