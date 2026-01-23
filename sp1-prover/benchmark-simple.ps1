# Simple Phase 0.5 Benchmark
param([string]$ServiceEndpoint = "http://100.26.247.5:8080")

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  PHASE 0.5 BENCHMARK (20 proofs)" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Test endpoint
Write-Host "[SETUP] Testing endpoint: $ServiceEndpoint" -ForegroundColor Cyan
try {
    $health = Invoke-WebRequest -Uri "$ServiceEndpoint/health" -UseBasicParsing -TimeoutSec 10
    Write-Host "  Service is healthy" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: Service not reachable!" -ForegroundColor Red
    exit 1
}

# Test files
$testFiles = @(
    @{file="deposit-small.json"; category="small"; count=5},
    @{file="deposit-medium.json"; category="medium"; count=5},
    @{file="deposit-large.json"; category="large"; count=5},
    @{file="deposit-1tfuel.json"; category="mixed"; count=5}
)

$results = @()
$testNum = 0
$benchStart = Get-Date

Write-Host ""
Write-Host "[BENCHMARK] Running 20 proofs..." -ForegroundColor Cyan
Write-Host ""

foreach ($testGroup in $testFiles) {
    Write-Host "[CATEGORY] $($testGroup.category) deposits ($($testGroup.count) tests)" -ForegroundColor Cyan
    
    for ($i = 1; $i -le $testGroup.count; $i++) {
        $testNum++
        $testFile = "test-data\$($testGroup.file)"
        
        Write-Host "  [$testNum/20] $($testGroup.file)..." -NoNewline
        
        if (!(Test-Path $testFile)) {
            Write-Host " SKIPPED (file not found)" -ForegroundColor Yellow
            continue
        }
        
        $body = Get-Content $testFile -Raw
        $start = Get-Date
        
        try {
            $response = Invoke-WebRequest `
                -Uri "$ServiceEndpoint/prove" `
                -Method POST `
                -ContentType "application/json" `
                -Body $body `
                -UseBasicParsing `
                -TimeoutSec 120
            
            $end = Get-Date
            $duration = ($end - $start).TotalMilliseconds
            
            if ($response.StatusCode -eq 200) {
                $data = $response.Content | ConvertFrom-Json
                $provingTime = $data.proving_time_ms
                
                Write-Host " SUCCESS ($([math]::Round($provingTime/1000, 2))s)" -ForegroundColor Green
                
                $results += @{
                    test = $testNum
                    category = $testGroup.category
                    file = $testGroup.file
                    status = "success"
                    proving_time_ms = $provingTime
                    e2e_time_ms = [math]::Round($duration)
                }
            }
        } catch {
            $end = Get-Date
            $duration = ($end - $start).TotalSeconds
            Write-Host " FAILED ($([math]::Round($duration, 1))s)" -ForegroundColor Red
            
            $results += @{
                test = $testNum
                category = $testGroup.category
                file = $testGroup.file
                status = "failed"
                error = $_.Exception.Message
            }
        }
        
        Start-Sleep -Seconds 2
    }
    Write-Host ""
}

$benchEnd = Get-Date
$totalTime = ($benchEnd - $benchStart).TotalSeconds

# Calculate stats
$successResults = $results | Where-Object { $_.status -eq "success" }
$successCount = $successResults.Count
$failCount = $results.Count - $successCount

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  RESULTS" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($successCount -gt 0) {
    $avgTime = ($successResults | Measure-Object -Property proving_time_ms -Average).Average
    $minTime = ($successResults | Measure-Object -Property proving_time_ms -Minimum).Minimum
    $maxTime = ($successResults | Measure-Object -Property proving_time_ms -Maximum).Maximum
    
    Write-Host "Total tests:        $($results.Count)" -ForegroundColor White
    Write-Host "Successful:         $successCount" -ForegroundColor Green
    Write-Host "Failed:             $failCount" -ForegroundColor $(if ($failCount -gt 0) { "Red" } else { "Green" })
    Write-Host "Success rate:       $([math]::Round($successCount/$results.Count*100, 1))%" -ForegroundColor White
    Write-Host "Total time:         $([math]::Round($totalTime, 1))s" -ForegroundColor White
    Write-Host ""
    Write-Host "Proving Time:" -ForegroundColor Cyan
    Write-Host "  Average:          $([math]::Round($avgTime/1000, 2))s" -ForegroundColor White
    Write-Host "  Min:              $([math]::Round($minTime/1000, 2))s" -ForegroundColor Green
    Write-Host "  Max:              $([math]::Round($maxTime/1000, 2))s" -ForegroundColor Yellow
    Write-Host ""
    
    # vs Baseline
    $baseline = 23000
    $improvement = (($baseline - $avgTime) / $baseline) * 100
    Write-Host "vs Baseline (23s):" -ForegroundColor Cyan
    Write-Host "  Improvement:      $([math]::Round($improvement, 1))%" -ForegroundColor $(if ($improvement -gt 0) { "Green" } else { "Red" })
    Write-Host "  Time saved:       $([math]::Round(($baseline - $avgTime)/1000, 2))s" -ForegroundColor Green
    Write-Host ""
    
    # Save JSON
    $data = @{
        timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        phase = "0.5"
        total_tests = $results.Count
        successful = $successCount
        failed = $failCount
        avg_proving_time_ms = [math]::Round($avgTime)
        min_proving_time_ms = $minTime
        max_proving_time_ms = $maxTime
        improvement_percent = [math]::Round($improvement, 1)
        results = $results
    }
    
    $data | ConvertTo-Json -Depth 10 | Out-File "benchmark-results-phase0.5.json" -Encoding utf8
    Write-Host "Results saved to: benchmark-results-phase0.5.json" -ForegroundColor Cyan
} else {
    Write-Host "ERROR: All tests failed!" -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  BENCHMARK COMPLETE" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
