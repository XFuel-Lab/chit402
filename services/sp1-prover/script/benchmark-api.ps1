# ============================================================================
# SP1 PROVER - HTTP API BENCHMARK
# ============================================================================
# Benchmarks proof generation via HTTP API
# Runs 5 iterations with different deposit samples
# ============================================================================

Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host "       SP1 DEPOSIT PROVER - PERFORMANCE BENCHMARK             " -ForegroundColor Cyan
Write-Host "================================================================`n" -ForegroundColor Cyan

# Check if prover is running
Write-Host "[INFO] Checking if SP1 prover is running..." -ForegroundColor Yellow
try {
    $health = Invoke-WebRequest -Uri http://localhost:8080/health -UseBasicParsing -TimeoutSec 5
    if ($health.StatusCode -eq 200) {
        Write-Host "[OK] SP1 prover is running`n" -ForegroundColor Green
    }
} catch {
    Write-Host "[ERROR] SP1 prover is not running!" -ForegroundColor Red
    Write-Host "   Start it with: docker-compose up -d`n" -ForegroundColor Yellow
    exit 1
}

# Sample test data (3 different deposit sizes)
$samples = @(
    @{
        name = "small_deposit"
        description = "Minimum deposit (0.01 TFUEL)"
        data = @{
            vault_address = "0x0000000000000000000000000000000000000001"
            sender_address = "0x0000000000000000000000000000000000000002"
            gross_amount = "0x2386F26FC10000"  # 0.01 TFUEL
            fee_amount = "0xB1A2BC2EC5000"     # 0.5%
            net_amount = "0x2347D43CFB000"     # After fee
            block_number = 12345678
            block_timestamp = 1737331200
            block_hash = "0x1111111111111111111111111111111111111111111111111111111111111111"
            tx_hash = "0x2222222222222222222222222222222222222222222222222222222222222222"
            tx_index = 0
            merkle_root = "0x3333333333333333333333333333333333333333333333333333333333333333"
            merkle_proof = @(
                "0x4444444444444444444444444444444444444444444444444444444444444444",
                "0x5555555555555555555555555555555555555555555555555555555555555555",
                "0x6666666666666666666666666666666666666666666666666666666666666666"
            )
            merkle_path_indices = @(0, 1, 0)
            identity_secret = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            identity_nullifier = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
            identity_trapdoor = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
            identity_commitment = "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
        }
    },
    @{
        name = "medium_deposit"
        description = "Standard deposit (1.0 TFUEL)"
        data = @{
            vault_address = "0x0000000000000000000000000000000000000001"
            sender_address = "0x0000000000000000000000000000000000000003"
            gross_amount = "0xDE0B6B3A7640000"  # 1.0 TFUEL
            fee_amount = "0x11C37937E08000"     # 0.5%
            net_amount = "0xDCCE3D1B96E8000"    # After fee
            block_number = 12345679
            block_timestamp = 1737331260
            block_hash = "0x7777777777777777777777777777777777777777777777777777777777777777"
            tx_hash = "0x8888888888888888888888888888888888888888888888888888888888888888"
            tx_index = 5
            merkle_root = "0x9999999999999999999999999999999999999999999999999999999999999999"
            merkle_proof = @(
                "0xaaaa111111111111111111111111111111111111111111111111111111111111",
                "0xbbbb222222222222222222222222222222222222222222222222222222222222",
                "0xcccc333333333333333333333333333333333333333333333333333333333333",
                "0xdddd444444444444444444444444444444444444444444444444444444444444",
                "0xeeee555555555555555555555555555555555555555555555555555555555555",
                "0xffff666666666666666666666666666666666666666666666666666666666666"
            )
            merkle_path_indices = @(0, 1, 0, 1, 0, 1)
            identity_secret = "0x1111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            identity_nullifier = "0x2222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
            identity_trapdoor = "0x3333cccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
            identity_commitment = "0x4444dddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
        }
    },
    @{
        name = "large_deposit"
        description = "Large deposit (100 TFUEL)"
        data = @{
            vault_address = "0x0000000000000000000000000000000000000001"
            sender_address = "0x0000000000000000000000000000000000000004"
            gross_amount = "0x56BC75E2D63100000"  # 100 TFUEL
            fee_amount = "0x1BC16D674EC80000"     # 0.5%
            net_amount = "0x54FE7D77DDE50000"     # After fee
            block_number = 12345680
            block_timestamp = 1737331320
            block_hash = "0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"
            tx_hash = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
            tx_index = 42
            merkle_root = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
            merkle_proof = @(
                "0x1010101010101010101010101010101010101010101010101010101010101010",
                "0x2020202020202020202020202020202020202020202020202020202020202020",
                "0x3030303030303030303030303030303030303030303030303030303030303030",
                "0x4040404040404040404040404040404040404040404040404040404040404040",
                "0x5050505050505050505050505050505050505050505050505050505050505050",
                "0x6060606060606060606060606060606060606060606060606060606060606060",
                "0x7070707070707070707070707070707070707070707070707070707070707070",
                "0x8080808080808080808080808080808080808080808080808080808080808080",
                "0x9090909090909090909090909090909090909090909090909090909090909090",
                "0xa0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0"
            )
            merkle_path_indices = @(0, 1, 0, 1, 0, 1, 0, 1, 0, 1)
            identity_secret = "0xcafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe"
            identity_nullifier = "0xdeadc0dedeadc0dedeadc0dedeadc0dedeadc0dedeadc0dedeadc0dedeadc0de"
            identity_trapdoor = "0x0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d"
            identity_commitment = "0xfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeed"
        }
    }
)

$allDurations = @()
$totalRuns = 0

foreach ($sample in $samples) {
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host (" Sample: {0} - {1}" -f $sample.name, $sample.description) -ForegroundColor Cyan
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host ("  Merkle proof depth: {0} levels" -f $sample.data.merkle_proof.Count) -ForegroundColor Gray
    Write-Host ("  Transaction index: {0}" -f $sample.data.tx_index) -ForegroundColor Gray
    Write-Host ""
    
    $sampleDurations = @()
    
    # Run 5 iterations
    for ($run = 1; $run -le 5; $run++) {
        Write-Host ("  Run {0}/5... " -f $run) -NoNewline
        
        try {
            $json = $sample.data | ConvertTo-Json -Depth 10
            $start = Get-Date
            
            $response = Invoke-RestMethod -Uri http://localhost:8080/prove -Method Post -ContentType "application/json" -Body $json -TimeoutSec 30
            
            $end = Get-Date
            $duration = ($end - $start).TotalSeconds
            
            $sampleDurations += $duration
            $allDurations += $duration
            $totalRuns++
            
            if ($duration -lt 1.0) {
                Write-Host ("[OK] {0:F3}s" -f $duration) -ForegroundColor Green
            } elseif ($duration -lt 2.0) {
                Write-Host ("[WARN] {0:F3}s (>1s target)" -f $duration) -ForegroundColor Yellow
            } else {
                Write-Host ("[ERROR] {0:F3}s (SLOW!)" -f $duration) -ForegroundColor Red
            }
        } catch {
            Write-Host "[ERROR] Failed: $($_.Exception.Message)" -ForegroundColor Red
            Write-Host "   This is expected if guest program hasn't been built yet." -ForegroundColor Yellow
            Write-Host "   The prover validates inputs but may not generate actual proofs." -ForegroundColor Yellow
        }
        
        Start-Sleep -Milliseconds 500
    }
    
    if ($sampleDurations.Count -gt 0) {
        $avg = ($sampleDurations | Measure-Object -Average).Average
        $min = ($sampleDurations | Measure-Object -Minimum).Minimum
        $max = ($sampleDurations | Measure-Object -Maximum).Maximum
        
        Write-Host "`n  Statistics:" -ForegroundColor Cyan
        Write-Host ("     Average: {0:F3}s" -f $avg) -ForegroundColor Gray
        Write-Host ("     Min:     {0:F3}s" -f $min) -ForegroundColor Gray
        Write-Host ("     Max:     {0:F3}s" -f $max) -ForegroundColor Gray
    }
    
    Write-Host ""
}

# Overall results
if ($allDurations.Count -gt 0) {
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host "                    OVERALL RESULTS                            " -ForegroundColor Cyan
    Write-Host "================================================================`n" -ForegroundColor Cyan
    
    $avgAll = ($allDurations | Measure-Object -Average).Average
    $minAll = ($allDurations | Measure-Object -Minimum).Minimum
    $maxAll = ($allDurations | Measure-Object -Maximum).Maximum
    
    $under1s = ($allDurations | Where-Object { $_ -lt 1.0 }).Count
    $under2s = ($allDurations | Where-Object { $_ -lt 2.0 }).Count
    
    Write-Host ("  Total runs:      {0}" -f $totalRuns) -ForegroundColor Gray
    Write-Host ("  Average time:    {0:F3}s" -f $avgAll) -ForegroundColor Gray
    Write-Host ("  Min time:        {0:F3}s" -f $minAll) -ForegroundColor Gray
    Write-Host ("  Max time:        {0:F3}s" -f $maxAll) -ForegroundColor Gray
    Write-Host ""
    Write-Host ("  Runs < 1s:       {0} / {1} ({2:F0}%)" -f $under1s, $totalRuns, (($under1s / $totalRuns) * 100)) -ForegroundColor Gray
    Write-Host ("  Runs < 2s:       {0} / {1} ({2:F0}%)" -f $under2s, $totalRuns, (($under2s / $totalRuns) * 100)) -ForegroundColor Gray
    Write-Host ""
    
    # Performance verdict
    if ($avgAll -lt 1.0) {
        Write-Host "[OK] VERDICT: Excellent performance! Meeting <1s target." -ForegroundColor Green
    } elseif ($avgAll -lt 2.0) {
        Write-Host "[WARN] VERDICT: Good, but could be optimized to meet <1s target." -ForegroundColor Yellow
        Write-Host "`nOPTIMIZATION SUGGESTIONS:" -ForegroundColor Cyan
        Write-Host "   1. Use SP1 Poseidon precompile (replace XOR stub)" -ForegroundColor Gray
        Write-Host "   2. Enable GPU acceleration (add CUDA support)" -ForegroundColor Gray
        Write-Host "   3. Optimize field arithmetic in guest program" -ForegroundColor Gray
        Write-Host "   4. Consider reducing Merkle proof depth" -ForegroundColor Gray
    } else {
        Write-Host "[ERROR] VERDICT: Performance needs optimization!" -ForegroundColor Red
        Write-Host "`nCRITICAL OPTIMIZATIONS NEEDED:" -ForegroundColor Yellow
        Write-Host "   1. Replace XOR hash stub with SP1 Poseidon precompile" -ForegroundColor Gray
        Write-Host "   2. Enable GPU acceleration (currently CPU-only)" -ForegroundColor Gray
        Write-Host "   3. Profile with SP1 tools to find bottlenecks" -ForegroundColor Gray
        Write-Host "   4. Consider circuit simplification" -ForegroundColor Gray
    }
    
    Write-Host ""
} else {
    Write-Host "[ERROR] No successful runs completed. Check prover logs:" -ForegroundColor Red
    Write-Host "   docker-compose logs sp1-prover" -ForegroundColor Yellow
    Write-Host ""
}
