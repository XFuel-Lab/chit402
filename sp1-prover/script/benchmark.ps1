# ============================================================================
# SP1 PROVER - BENCHMARK RUNNER (PowerShell)
# ============================================================================
# Runs local benchmarking script with 5 iterations per sample
# ============================================================================

Write-Host "[OK] Building guest program..." -ForegroundColor Cyan
Push-Location "$PSScriptRoot\..\program"
try {
    cargo prove build
    if ($LASTEXITCODE -ne 0) {
        throw "Guest program build failed"
    }
} finally {
    Pop-Location
}

Write-Host "`n[OK] Building benchmark script..." -ForegroundColor Cyan
Push-Location "$PSScriptRoot\..\script"
try {
    cargo build --release
    if ($LASTEXITCODE -ne 0) {
        throw "Benchmark script build failed"
    }
} finally {
    Pop-Location
}

Write-Host "`n[OK] Running benchmarks..." -ForegroundColor Cyan
Push-Location "$PSScriptRoot\..\script"
try {
    cargo run --release
} finally {
    Pop-Location
}

Write-Host "`n[OK] Benchmark complete!" -ForegroundColor Green
