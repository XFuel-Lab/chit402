# Diagnose ECS Status
# Check what's happening with the deployment

# Load credentials
$envPath = "../.env.local"
Get-Content $envPath | ForEach-Object {
    if ($_ -match '^AWS_ACCESS_KEY_ID=(.+)$') { $env:AWS_ACCESS_KEY_ID = $matches[1] }
    if ($_ -match '^AWS_SECRET_ACCESS_KEY=(.+)$') { $env:AWS_SECRET_ACCESS_KEY = $matches[1] }
}

$region = "us-east-1"
$cluster = "sp1-prover-cluster"
$service = "sp1-prover-service"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  ECS Deployment Diagnostics" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Check service status
Write-Host "[1] Service Status:" -ForegroundColor Yellow
$svcStatus = cmd /c "aws ecs describe-services --cluster $cluster --services $service --region $region --query services[0].[runningCount,desiredCount,deployments[0].status] --output text 2>&1"
Write-Host "   $svcStatus" -ForegroundColor White

# Check tasks
Write-Host "`n[2] Tasks:" -ForegroundColor Yellow
$taskArns = cmd /c "aws ecs list-tasks --cluster $cluster --service-name $service --region $region --output text 2>&1"
if ($taskArns -match "arn:") {
    Write-Host "   Tasks found!" -ForegroundColor Green
    $tasks = $taskArns -split '\s+'
    foreach ($task in $tasks) {
        if ($task -match "task/") {
            $taskStatus = cmd /c "aws ecs describe-tasks --cluster $cluster --tasks $task --region $region --query tasks[0].[lastStatus,healthStatus,stoppedReason] --output text 2>&1"
            Write-Host "   - Task: $($task.Substring($task.Length - 20))" -ForegroundColor Gray
            Write-Host "     Status: $taskStatus" -ForegroundColor Gray
        }
    }
} else {
    Write-Host "   No tasks running!" -ForegroundColor Red
}

# Check recent events
Write-Host "`n[3] Recent Service Events:" -ForegroundColor Yellow
$events = cmd /c "aws ecs describe-services --cluster $cluster --services $service --region $region --query services[0].events[0:3].[message] --output text 2>&1"
Write-Host "   $events" -ForegroundColor Gray

# Get task definition
Write-Host "`n[4] Current Task Definition:" -ForegroundColor Yellow
$taskDef = cmd /c "aws ecs describe-services --cluster $cluster --services $service --region $region --query services[0].taskDefinition --output text 2>&1"
Write-Host "   $taskDef" -ForegroundColor White

# Check latest logs
Write-Host "`n[5] Latest Log Entries (last 10):" -ForegroundColor Yellow
$logs = cmd /c "aws logs tail /ecs/sp1-prover --since 5m --region $region 2>&1" | Select-Object -Last 10
if ($logs) {
    $logs | ForEach-Object { Write-Host "   $_" -ForegroundColor Gray }
} else {
    Write-Host "   No recent logs" -ForegroundColor Red
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Diagnosis Complete" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  If no tasks: Service might be stuck, try deleting and recreating" -ForegroundColor White
Write-Host "  If tasks failing: Check events for error messages" -ForegroundColor White
Write-Host "  If logs show errors: We can fix the root cause`n" -ForegroundColor White
