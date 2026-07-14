# SP1 Prover Benchmark Script
# Tests proof generation with different test data sizes

$ecsUrl = "http://54.174.193.127:8080/prove"
$testFiles = @("deposit-small.json", "deposit-medium.json", "deposit-large.json")
$results = @()

Write-Host "========================================"
Write-Host "SP1 PROVER NETWORK MODE BENCHMARK"
Write-Host "========================================"
Write-Host ""
Write-Host "ECS Endpoint: $ecsUrl"
Write-Host "Test: 3 proof types x 3 runs each = 9 proofs"
Write-Host ""

foreach ($testFile in $testFiles) {
    $filePath = "test-data\$testFile"
    
    if (-not (Test-Path $filePath)) {
        Write-Host "⚠️  Skipping $testFile (not found)"
        continue
    }
    
    Write-Host "Testing with $testFile..."
    Write-Host "----------------------------"
    
    $body = Get-Content $filePath -Raw
    $times = @()
    
    for ($i = 1; $i -le 3; $i++) {
        Write-Host "  Run $i/3... " -NoNewline
        
        try {
            $start = Get-Date
            $response = Invoke-WebRequest -Uri $ecsUrl -Method POST -ContentType "application/json" -Body $body -UseBasicParsing -TimeoutSec 120
            $end = Get-Date
            $duration = ($end - $start).TotalSeconds
            
            $proofData = $response.Content | ConvertFrom-Json
            $provingTime = $proofData.proving_time_ms
            
            $times += $provingTime
            Write-Host "✅ $provingTime ms"
            
        } catch {
            Write-Host "❌ Failed: $_"
        }
        
        # Small delay between requests
        Start-Sleep -Seconds 2
    }
    
    if ($times.Count -gt 0) {
        $avg = ($times | Measure-Object -Average).Average
        $min = ($times | Measure-Object -Minimum).Minimum
        $max = ($times | Measure-Object -Maximum).Maximum
        
        $results += [PSCustomObject]@{
            TestFile = $testFile
            AvgTime = [math]::Round($avg, 2)
            MinTime = $min
            MaxTime = $max
            SuccessRate = "$($times.Count)/3"
        }
        
        Write-Host "  Summary: Avg=$([math]::Round($avg/1000, 2))s Min=$([math]::Round($min/1000, 2))s Max=$([math]::Round($max/1000, 2))s"
    }
    
    Write-Host ""
}

Write-Host "========================================"
Write-Host "BENCHMARK RESULTS"
Write-Host "========================================"
$results | Format-Table -AutoSize

# Save results
$results | ConvertTo-Json | Out-File -FilePath "benchmark-results.json" -Encoding UTF8
Write-Host "✅ Results saved to benchmark-results.json"
