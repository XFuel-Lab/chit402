# ============================================================================
# SP1 PROVER - COMPREHENSIVE BENCHMARK SCRIPT
# ============================================================================
# Purpose: Run 5 iterations x 3 samples to measure real performance
# Supports: Mock mode and Network mode comparison
# ============================================================================

param(
    [int]$Runs = 5,
    [string]$Mode = "auto"  # auto, mock, network
)

$ErrorActionPreference = "Stop"

Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host "   SP1 PROVER - PERFORMANCE BENCHMARK" -ForegroundColor Cyan  
Write-Host "================================================================`n" -ForegroundColor Cyan

# Detect mode
$modeDetected = "MOCK (Local)"
if ($env:SP1_PRIVATE_KEY) {
    $modeDetected = "NETWORK (Distributed)"
    Write-Host "[INFO] SP1_PRIVATE_KEY detected - Running in NETWORK mode" -ForegroundColor Green
} else {
    Write-Host "[INFO] SP1_PRIVATE_KEY not set - Running in MOCK mode" -ForegroundColor Yellow
    Write-Host "[INFO] Set SP1_PRIVATE_KEY env var for <1s network proving" -ForegroundColor Yellow
}
Write-Host ""

# Test samples
$samples = @(
    @{
        Name = "Small"
        File = "deposit-small.json"
        Description = "0.01 TFUEL deposit"
    },
    @{
        Name = "Medium"
        File = "deposit-medium.json"
        Description = "1.0 TFUEL deposit"
    },
    @{
        Name = "Large"
        File = "deposit-large.json"
        Description = "100 TFUEL deposit"
    }
)

# Results storage
$allResults = @()

# Run benchmarks
foreach ($sample in $samples) {
    Write-Host "================================================================" -ForegroundColor Yellow
    Write-Host "  SAMPLE: $($sample.Name) - $($sample.Description)" -ForegroundColor Yellow
    Write-Host "================================================================`n" -ForegroundColor Yellow
    
    $times = @()
    $sampleResults = @{
        Name = $sample.Name
        Description = $sample.Description
        Times = @()
        Errors = 0
    }
    
    for ($i = 1; $i -le $Runs; $i++) {
        Write-Host "  Run $i/$Runs... " -NoNewline -ForegroundColor Cyan
        
        try {
            $json = Get-Content "test-data\$($sample.File)" -Raw
            $start = Get-Date
            
            $result = Invoke-RestMethod `
                -Uri "http://localhost:8080/prove" `
                -Method Post `
                -ContentType "application/json" `
                -Body $json `
                -TimeoutSec 300
            
            $elapsed = ((Get-Date) - $start).TotalSeconds
            $provingTime = $result.proving_time_ms
            
            $times += $provingTime
            $sampleResults.Times += $provingTime
            
            if ($provingTime -lt 1000) {
                Write-Host "PASS $([math]::Round($provingTime, 0))ms" -ForegroundColor Green
            } elseif ($provingTime -lt 10000) {
                Write-Host "SLOW $([math]::Round($provingTime/1000, 2))s" -ForegroundColor Yellow
            } else {
                Write-Host "VERY SLOW $([math]::Round($provingTime/1000, 1))s" -ForegroundColor Red
            }
            
        } catch {
            Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
            $sampleResults.Errors++
        }
        
        # Brief pause between runs
        Start-Sleep -Milliseconds 500
    }
    
    # Calculate statistics
    if ($times.Count -gt 0) {
        $avg = ($times | Measure-Object -Average).Average
        $min = ($times | Measure-Object -Minimum).Minimum
        $max = ($times | Measure-Object -Maximum).Maximum
        
        Write-Host "`n  Statistics:" -ForegroundColor Cyan
        Write-Host "    Average: $([math]::Round($avg, 0))ms ($([math]::Round($avg/1000, 2))s)" -ForegroundColor White
        Write-Host "    Min:     $([math]::Round($min, 0))ms" -ForegroundColor White
        Write-Host "    Max:     $([math]::Round($max, 0))ms" -ForegroundColor White
        Write-Host "    Errors:  $($sampleResults.Errors)" -ForegroundColor $(if ($sampleResults.Errors -eq 0) { "Green" } else { "Red" })
        
        $sampleResults.Avg = $avg
        $sampleResults.Min = $min
        $sampleResults.Max = $max
    }
    
    $allResults += $sampleResults
    Write-Host ""
}

# Overall results
Write-Host "================================================================" -ForegroundColor Green
Write-Host "                    OVERALL RESULTS" -ForegroundColor Green
Write-Host "================================================================`n" -ForegroundColor Green

Write-Host "Mode: $modeDetected`n" -ForegroundColor Cyan

$allTimes = $allResults | ForEach-Object { $_.Times }
$totalRuns = $allTimes.Count
$overallAvg = ($allTimes | Measure-Object -Average).Average
$overallMin = ($allTimes | Measure-Object -Minimum).Minimum
$overallMax = ($allTimes | Measure-Object -Maximum).Maximum
$totalErrors = ($allResults | Measure-Object -Property Errors -Sum).Sum

Write-Host "Total Runs:      $totalRuns" -ForegroundColor White
Write-Host "Success Rate:    $($totalRuns - $totalErrors)/$totalRuns ($(100 - [math]::Round($totalErrors/$totalRuns*100, 1))%)" -ForegroundColor $(if ($totalErrors -eq 0) { "Green" } else { "Yellow" })
Write-Host ""
Write-Host "Average Time:    $([math]::Round($overallAvg, 0))ms ($([math]::Round($overallAvg/1000, 2))s)" -ForegroundColor Cyan
Write-Host "Min Time:        $([math]::Round($overallMin, 0))ms" -ForegroundColor Green
Write-Host "Max Time:        $([math]::Round($overallMax, 0))ms" -ForegroundColor Yellow
Write-Host ""

# Performance verdict
$under1s = ($allTimes | Where-Object { $_ -lt 1000 }).Count
$under10s = ($allTimes | Where-Object { $_ -lt 10000 }).Count

Write-Host "Runs < 1s:       $under1s / $totalRuns ($([math]::Round($under1s/$totalRuns*100, 0))%)" -ForegroundColor White
Write-Host "Runs < 10s:      $under10s / $totalRuns ($([math]::Round($under10s/$totalRuns*100, 0))%)" -ForegroundColor White
Write-Host ""

# Verdict
if ($overallAvg -lt 1000) {
    Write-Host "VERDICT: EXCELLENT - Target met (<1s)!" -ForegroundColor Green
    Write-Host "System is production-ready for deployment." -ForegroundColor Green
} elseif ($overallAvg -lt 10000) {
    Write-Host "VERDICT: GOOD - Acceptable performance" -ForegroundColor Yellow
    if (-not $env:SP1_PRIVATE_KEY) {
        Write-Host "`nRECOMMENDATION: Enable SP1 Network mode for ~150x speedup" -ForegroundColor Yellow
        Write-Host "  1. Get API key: https://app.succinct.xyz" -ForegroundColor White
        Write-Host "  2. Set: `$env:SP1_PRIVATE_KEY='your_key'" -ForegroundColor White
        Write-Host "  3. Rebuild: docker-compose build" -ForegroundColor White
        Write-Host "  4. Restart: docker-compose up -d" -ForegroundColor White
    }
} else {
    Write-Host "VERDICT: NEEDS OPTIMIZATION" -ForegroundColor Red
    Write-Host "`nCRITICAL ACTIONS:" -ForegroundColor Red
    Write-Host "  1. Enable SP1 Network proving (SP1_PRIVATE_KEY)" -ForegroundColor White
    Write-Host "  2. Consider GPU acceleration for local proving" -ForegroundColor White
}

Write-Host ""

# Export results to JSON
$resultsJson = @{
    Mode = $modeDetected
    Timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    TotalRuns = $totalRuns
    SuccessRate = [math]::Round((1 - $totalErrors/$totalRuns)*100, 1)
    OverallAvg = [math]::Round($overallAvg, 0)
    OverallMin = [math]::Round($overallMin, 0)
    OverallMax = [math]::Round($overallMax, 0)
    Under1Second = $under1s
    Samples = $allResults | ForEach-Object {
        @{
            Name = $_.Name
            Description = $_.Description
            Avg = [math]::Round($_.Avg, 0)
            Min = [math]::Round($_.Min, 0)
            Max = [math]::Round($_.Max, 0)
            Errors = $_.Errors
        }
    }
} | ConvertTo-Json -Depth 10

$resultsFile = "benchmark-results-$(Get-Date -Format 'yyyyMMdd-HHmmss').json"
$resultsJson | Out-File $resultsFile -Encoding UTF8
Write-Host "[INFO] Results exported to: $resultsFile" -ForegroundColor Cyan
Write-Host ""
