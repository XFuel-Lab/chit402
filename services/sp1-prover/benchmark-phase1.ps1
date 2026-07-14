# Phase 1 Batch Processing Benchmark
# Tests mix of single and batch deposits
# Run from sp1-prover directory: .\benchmark-phase1.ps1

param(
    [string]$ServiceEndpoint = "http://100.26.247.5:8080"
)

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  PHASE 1 BENCHMARK (Batch Processing)" -ForegroundColor Yellow
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

# Load test deposits
$testFiles = @(
    "test-data\deposit-small.json",
    "test-data\deposit-medium.json",
    "test-data\deposit-large.json",
    "test-data\deposit-1tfuel.json"
)

# Helper: Load deposit data
function Load-Deposit {
    param([string]$file)
    if (Test-Path $file) {
        return Get-Content $file -Raw | ConvertFrom-Json
    }
    return $null
}

# Helper: Run single proof
function Run-SingleProof {
    param([int]$testNum, [string]$file)
    
    Write-Host "[$testNum/20] SINGLE: $file..." -NoNewline
    
    $deposit = Load-Deposit $file
    if (!$deposit) {
        Write-Host " SKIPPED (file not found)" -ForegroundColor Yellow
        return $null
    }
    
    $start = Get-Date
    
    try {
        $response = Invoke-WebRequest `
            -Uri "$ServiceEndpoint/prove" `
            -Method POST `
            -ContentType "application/json" `
            -Body (ConvertTo-Json $deposit -Depth 10) `
            -UseBasicParsing `
            -TimeoutSec 120
        
        $end = Get-Date
        $duration = ($end - $start).TotalMilliseconds
        
        if ($response.StatusCode -eq 200) {
            $data = $response.Content | ConvertFrom-Json
            Write-Host " SUCCESS ($([math]::Round($data.proving_time_ms/1000, 2))s)" -ForegroundColor Green
            
            return @{
                test = $testNum
                type = "single"
                batch_size = 1
                file = $file
                status = "success"
                proving_time_ms = $data.proving_time_ms
                e2e_time_ms = [math]::Round($duration)
                effective_time_ms = $data.proving_time_ms
                nullifier = $data.nullifier
            }
        }
    } catch {
        $end = Get-Date
        $duration = ($end - $start).TotalSeconds
        Write-Host " FAILED ($([math]::Round($duration, 1))s)" -ForegroundColor Red
        
        return @{
            test = $testNum
            type = "single"
            batch_size = 1
            file = $file
            status = "failed"
            error = $_.Exception.Message
        }
    }
    
    return $null
}

# Helper: Run batch proof
function Run-BatchProof {
    param([int]$testNum, [int]$batchSize, [array]$files)
    
    Write-Host "[$testNum/20] BATCH($batchSize): Loading deposits..." -NoNewline
    
    $deposits = @()
    foreach ($file in $files) {
        $deposit = Load-Deposit $file
        if ($deposit) {
            $deposits += $deposit
        }
    }
    
    if ($deposits.Count -ne $batchSize) {
        Write-Host " SKIPPED (couldn't load all deposits)" -ForegroundColor Yellow
        return $null
    }
    
    $batchRequest = @{
        batch = $true
        deposits = $deposits
    }
    
    $start = Get-Date
    
    try {
        $response = Invoke-WebRequest `
            -Uri "$ServiceEndpoint/prove" `
            -Method POST `
            -ContentType "application/json" `
            -Body (ConvertTo-Json $batchRequest -Depth 10) `
            -UseBasicParsing `
            -TimeoutSec 120
        
        $end = Get-Date
        $duration = ($end - $start).TotalMilliseconds
        
        if ($response.StatusCode -eq 200) {
            $data = $response.Content | ConvertFrom-Json
            Write-Host " SUCCESS ($([math]::Round($data.proving_time_ms/1000, 2))s total, $([math]::Round($data.effective_time_per_deposit_ms/1000, 2))s/deposit)" -ForegroundColor Green
            
            return @{
                test = $testNum
                type = "batch"
                batch_size = $data.batch_size
                files = $files -join ", "
                status = "success"
                proving_time_ms = $data.proving_time_ms
                e2e_time_ms = [math]::Round($duration)
                effective_time_ms = $data.effective_time_per_deposit_ms
                nullifiers = $data.nullifiers
                batch_commitment = $data.batch_commitment
            }
        }
    } catch {
        $end = Get-Date
        $duration = ($end - $start).TotalSeconds
        Write-Host " FAILED ($([math]::Round($duration, 1))s)" -ForegroundColor Red
        
        return @{
            test = $testNum
            type = "batch"
            batch_size = $batchSize
            files = $files -join ", "
            status = "failed"
            error = $_.Exception.Message
        }
    }
    
    return $null
}

# Run benchmark
$results = @()
$testNum = 0
$benchStart = Get-Date

Write-Host ""
Write-Host "[CATEGORY] Single Deposits (5 tests - baseline)" -ForegroundColor Cyan
for ($i = 0; $i -lt 5; $i++) {
    $testNum++
    $file = $testFiles[$i % $testFiles.Count]
    $result = Run-SingleProof -testNum $testNum -file $file
    if ($result) { $results += $result }
    Start-Sleep -Seconds 2
}

Write-Host ""
Write-Host "[CATEGORY] Batch-of-3 (5 tests, 15 deposits total)" -ForegroundColor Cyan
for ($i = 0; $i -lt 5; $i++) {
    $testNum++
    $batchFiles = @($testFiles[0], $testFiles[1], $testFiles[2])
    $result = Run-BatchProof -testNum $testNum -batchSize 3 -files $batchFiles
    if ($result) { $results += $result }
    Start-Sleep -Seconds 2
}

Write-Host ""
Write-Host "[CATEGORY] Batch-of-5 (5 tests, 25 deposits total)" -ForegroundColor Cyan
for ($i = 0; $i -lt 5; $i++) {
    $testNum++
    $batchFiles = @($testFiles[0], $testFiles[1], $testFiles[2], $testFiles[3], $testFiles[0])
    $result = Run-BatchProof -testNum $testNum -batchSize 5 -files $batchFiles
    if ($result) { $results += $result }
    Start-Sleep -Seconds 2
}

Write-Host ""
Write-Host "[CATEGORY] Batch-of-10 (5 tests, 50 deposits total)" -ForegroundColor Cyan
for ($i = 0; $i -lt 5; $i++) {
    $testNum++
    $batchFiles = $testFiles * 3 | Select-Object -First 10
    $result = Run-BatchProof -testNum $testNum -batchSize 10 -files $batchFiles
    if ($result) { $results += $result }
    Start-Sleep -Seconds 2
}

$benchEnd = Get-Date
$totalTime = ($benchEnd - $benchStart).TotalSeconds

# Calculate stats
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  RESULTS" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$successResults = $results | Where-Object { $_.status -eq "success" }
$successCount = $successResults.Count
$failCount = $results.Count - $successCount

if ($successCount -gt 0) {
    Write-Host "Total tests:        $($results.Count)" -ForegroundColor White
    Write-Host "Successful:         $successCount" -ForegroundColor Green
    Write-Host "Failed:             $failCount" -ForegroundColor $(if ($failCount -gt 0) { "Red" } else { "Green" })
    Write-Host "Success rate:       $([math]::Round($successCount/$results.Count*100, 1))%" -ForegroundColor White
    Write-Host "Total time:         $([math]::Round($totalTime, 1))s" -ForegroundColor White
    Write-Host ""
    
    # Stats by batch size
    Write-Host "Performance by Batch Size:" -ForegroundColor Cyan
    $batchSizes = @(1, 3, 5, 10)
    foreach ($size in $batchSizes) {
        $sizeResults = $successResults | Where-Object { $_.batch_size -eq $size }
        if ($sizeResults.Count -gt 0) {
            $avgProving = ($sizeResults | Measure-Object -Property proving_time_ms -Average).Average
            $avgEffective = ($sizeResults | Measure-Object -Property effective_time_ms -Average).Average
            
            Write-Host "  Batch=$size ($($sizeResults.Count) tests):" -ForegroundColor White
            Write-Host "    Avg proving time:   $([math]::Round($avgProving/1000, 2))s" -ForegroundColor White
            Write-Host "    Avg effective time: $([math]::Round($avgEffective/1000, 2))s per deposit" -ForegroundColor Green
            
            if ($size -gt 1) {
                $baseline = 23000
                $speedup = ($baseline / $avgEffective)
                Write-Host "    Speedup vs single:  $([math]::Round($speedup, 2))x" -ForegroundColor Green
            }
            Write-Host ""
        }
    }
    
    # Save results
    $data = @{
        timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        phase = "1"
        total_tests = $results.Count
        successful = $successCount
        failed = $failCount
        total_time_seconds = [math]::Round($totalTime, 1)
        results = $results
    }
    
    $data | ConvertTo-Json -Depth 10 | Out-File "benchmark-results-phase1.json" -Encoding utf8
    Write-Host "Results saved to: benchmark-results-phase1.json" -ForegroundColor Cyan
} else {
    Write-Host "ERROR: All tests failed!" -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  BENCHMARK COMPLETE" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
