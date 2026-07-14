# Test zkGPT flow: POST task-request with proof_system: zkgpt, poll task-status
# Run with M2M server and ZKGPT_PROVER_URL configured.
# Usage: .\scripts\test-task-zkgpt.ps1 [baseUrl]

param([string]$baseUrl = "http://localhost:3002")

$body = @{
    message_type = "inference_request"
    chain_id     = "theta"
    amount       = "1000000"
    sender       = "0x1234567890123456789012345678901234567890"
    model_id     = "llama-3-70b"
    input_hash   = "0xabcd"
    proof_system = "zkgpt"
} | ConvertTo-Json

Write-Host "POST $baseUrl/task-request"
try {
    $r = Invoke-RestMethod -Uri "$baseUrl/task-request" -Method Post -ContentType "application/json" -Body $body
} catch {
    Write-Host "Error: $_"
    exit 1
}

$taskId = $r.task_id
Write-Host "task_id: $taskId"
Write-Host "status:  $($r.status)"
Write-Host 'Polling task-status (every 2s, max 90s). zkGPT proof can take 30-60s...'

$pollUrl = "$baseUrl/task-status?task_id=$taskId"
$maxAttempts = 45
$attempt = 0

while ($attempt -lt $maxAttempts) {
    Start-Sleep -Seconds 2
    $attempt++
    try {
        $status = Invoke-RestMethod -Uri $pollUrl -Method Get
    } catch {
        Write-Host "Poll error: $_"
        exit 1
    }
    Write-Host "  [$attempt] status=$($status.status) proof_outcome=$($status.proof_outcome)"
    # For zkGPT, wait for fee_collected so proof generation has finished (proof can take 30-60s)
    if ($status.status -eq "fee_collected") {
        Write-Host "Done."
        $status | ConvertTo-Json -Depth 5
        exit 0
    }
    if ($status.status -eq "failed") {
        Write-Host "Task failed."
        $status | ConvertTo-Json -Depth 5
        exit 1
    }
}

Write-Host 'Timeout: waiting for fee_collected. zkGPT proof can take 30-60s.'
$status | ConvertTo-Json -Depth 5
exit 1
