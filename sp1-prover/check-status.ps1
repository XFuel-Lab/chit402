# Check SP1 Prover Status and Get Endpoint
# Run this every 30 seconds until you get the IP

# Load credentials
$envPath = "../.env.local"
if (Test-Path $envPath) {
    Get-Content $envPath | ForEach-Object {
        if ($_ -match '^AWS_ACCESS_KEY_ID=(.+)$') { $env:AWS_ACCESS_KEY_ID = $matches[1] }
        if ($_ -match '^AWS_SECRET_ACCESS_KEY=(.+)$') { $env:AWS_SECRET_ACCESS_KEY = $matches[1] }
    }
}

$region = "us-east-1"
$cluster = "sp1-prover-cluster"
$service = "sp1-prover-service"

Write-Host "`nChecking SP1 Prover status...`n" -ForegroundColor Cyan

# Get task ARN
$taskArn = cmd /c "aws ecs list-tasks --cluster $cluster --service-name $service --region $region --query taskArns[0] --output text 2>&1"

if (-not $taskArn -or $taskArn -eq "None" -or $taskArn.Length -lt 20) {
    Write-Host "[WAIT] No task running yet. Image is still being pulled." -ForegroundColor Yellow
    Write-Host "       This takes 2-3 minutes for a 14GB image.`n" -ForegroundColor Gray
    Write-Host "Run this script again in 30 seconds." -ForegroundColor Cyan
    exit
}

Write-Host "[OK] Task is running: $($taskArn.Substring($taskArn.Length - 20))" -ForegroundColor Green

# Get task status
$taskStatus = cmd /c "aws ecs describe-tasks --cluster $cluster --tasks $taskArn --region $region --query tasks[0].lastStatus --output text 2>&1"
Write-Host "     Status: $taskStatus" -ForegroundColor Gray

if ($taskStatus -ne "RUNNING") {
    Write-Host "`n[WAIT] Task is $taskStatus - not ready yet." -ForegroundColor Yellow
    Write-Host "       Wait 30 more seconds and run again.`n" -ForegroundColor Gray
    exit
}

# Get network interface
$eniId = cmd /c "aws ecs describe-tasks --cluster $cluster --tasks $taskArn --region $region --query tasks[0].attachments[0].details[?name==``networkInterfaceId``].value --output text 2>&1"

if (-not $eniId -or $eniId.Length -lt 10) {
    Write-Host "`n[WAIT] Network interface not assigned yet." -ForegroundColor Yellow
    Write-Host "       Wait 30 more seconds and run again.`n" -ForegroundColor Gray
    exit
}

Write-Host "[OK] Network interface: $eniId" -ForegroundColor Green

# Get public IP
$publicIp = cmd /c "aws ec2 describe-network-interfaces --network-interface-ids $eniId --region $region --query NetworkInterfaces[0].Association.PublicIp --output text 2>&1"

if (-not $publicIp -or $publicIp.Length -lt 7) {
    Write-Host "`n[WAIT] Public IP not assigned yet." -ForegroundColor Yellow
    Write-Host "       Wait 30 more seconds and run again.`n" -ForegroundColor Gray
    exit
}

# SUCCESS!
Write-Host "`n========================================" -ForegroundColor Green
Write-Host "  SUCCESS! SP1 Prover is LIVE!" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Green

Write-Host "Your Endpoint:" -ForegroundColor Cyan
Write-Host "  http://${publicIp}:8080`n" -ForegroundColor Yellow

Write-Host "Test it:" -ForegroundColor Cyan
Write-Host "  curl.exe http://${publicIp}:8080/health" -ForegroundColor White
Write-Host ""
Write-Host "Generate a proof:" -ForegroundColor Cyan
Write-Host "  curl.exe -X POST http://${publicIp}:8080/prove -H `"Content-Type: application/json`" -d `"@test-data/deposit-1tfuel.json`"" -ForegroundColor White
Write-Host ""

Write-Host "Add to your .env.local:" -ForegroundColor Cyan
Write-Host "  SP1_PROVER_URL=http://${publicIp}:8080`n" -ForegroundColor White
