# Update ECS Service with Phase 0.5 Image
# Assumes image is already in ECR
# Run from sp1-prover directory: .\update-ecs-service.ps1

Write-Host "`n================================================" -ForegroundColor Cyan
Write-Host "  UPDATE ECS SERVICE - PHASE 0.5" -ForegroundColor Yellow
Write-Host "================================================`n" -ForegroundColor Cyan

$ACCOUNT_ID = "187510174358"
$REGION = "us-east-1"
$REPO_NAME = "sp1-prover"
$IMAGE_TAG = "phase0.5-optimized"
$ECR_URI = "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$REPO_NAME`:$IMAGE_TAG"
$awsCmd = "C:\Program Files\Amazon\AWSCLIV2\aws.exe"

# Load AWS credentials
Write-Host "[STEP 1] Loading AWS credentials..." -ForegroundColor Cyan
if (Test-Path "../.env.local") {
    Get-Content ../.env.local | ForEach-Object {
        if ($_ -match '^AWS_ACCESS_KEY_ID=(.+)$') { $env:AWS_ACCESS_KEY_ID = $matches[1] }
        if ($_ -match '^AWS_SECRET_ACCESS_KEY=(.+)$') { $env:AWS_SECRET_ACCESS_KEY = $matches[1] }
        if ($_ -match '^AWS_REGION=(.+)$') { 
            $env:AWS_DEFAULT_REGION = $matches[1]
            $REGION = $matches[1]
        }
    }
    Write-Host "  ✅ Credentials loaded" -ForegroundColor Green
}

# Step 2: Create task definition
Write-Host "`n[STEP 2] Registering ECS task definition..." -ForegroundColor Cyan

$taskDefJson = @"
{
  "family": "sp1-prover-task",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "4096",
  "memory": "8192",
  "executionRoleArn": "arn:aws:iam::$ACCOUNT_ID`:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::$ACCOUNT_ID`:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "sp1-prover",
      "image": "$ECR_URI",
      "portMappings": [{"containerPort": 8080, "protocol": "tcp"}],
      "environment": [
        {"name": "SP1_PROVER", "value": "network"},
        {"name": "RUST_LOG", "value": "info"}
      ],
      "secrets": [
        {
          "name": "NETWORK_PRIVATE_KEY",
          "valueFrom": "arn:aws:secretsmanager:$REGION`:$ACCOUNT_ID`:secret:SP1_PRIVATE_KEY-NFV6WS"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/sp1-prover",
          "awslogs-region": "$REGION",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost:8080/health || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 60
      }
    }
  ]
}
"@

$taskDefJson | Out-File -FilePath "task-def-phase0.5.json" -Encoding utf8
$taskDefOutput = & $awsCmd ecs register-task-definition --cli-input-json file://task-def-phase0.5.json 2>&1

if ($LASTEXITCODE -eq 0) {
    $taskDefArn = ($taskDefOutput | ConvertFrom-Json).taskDefinition.taskDefinitionArn
    Write-Host "  ✅ Task definition registered: $taskDefArn" -ForegroundColor Green
} else {
    Write-Host "  ❌ Task definition registration failed!" -ForegroundColor Red
    exit 1
}

# Step 3: Update service
Write-Host "`n[STEP 3] Updating ECS service..." -ForegroundColor Cyan
$updateOutput = & $awsCmd ecs update-service `
    --cluster sp1-cluster `
    --service sp1-prover-service `
    --task-definition sp1-prover-task `
    --force-new-deployment 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✅ Service update initiated" -ForegroundColor Green
} else {
    Write-Host "  ❌ Service update failed!" -ForegroundColor Red
    exit 1
}

# Step 4: Monitor deployment
Write-Host "`n[STEP 4] Monitoring deployment (this takes 5-10 minutes)..." -ForegroundColor Cyan
$maxAttempts = 20
$attempt = 0
$deployed = $false

while ($attempt -lt $maxAttempts -and -not $deployed) {
    Start-Sleep -Seconds 30
    $attempt++
    
    $serviceStatus = & $awsCmd ecs describe-services --cluster sp1-cluster --services sp1-prover-service --query "services[0].deployments" | ConvertFrom-Json
    
    $primaryDeployment = $serviceStatus | Where-Object { $_.status -eq "PRIMARY" }
    if ($primaryDeployment) {
        $runningCount = $primaryDeployment.runningCount
        $desiredCount = $primaryDeployment.desiredCount
        
        Write-Host "  Attempt $attempt/$maxAttempts`: Running: $runningCount/$desiredCount tasks" -ForegroundColor White
        
        if ($runningCount -eq $desiredCount -and $serviceStatus.Count -eq 1) {
            $deployed = $true
            Write-Host "  ✅ Deployment successful!" -ForegroundColor Green
        }
    }
}

if (-not $deployed) {
    Write-Host "  ⚠️  Deployment taking longer than expected" -ForegroundColor Yellow
}

# Step 5: Get endpoint
Write-Host "`n[STEP 5] Getting service endpoint..." -ForegroundColor Cyan
$tasks = & $awsCmd ecs list-tasks --cluster sp1-cluster --service-name sp1-prover-service --query "taskArns[0]" --output text
if ($tasks -and $tasks -ne "None") {
    $taskDetails = & $awsCmd ecs describe-tasks --cluster sp1-cluster --tasks $tasks | ConvertFrom-Json
    $eniId = $taskDetails.tasks[0].attachments[0].details | Where-Object { $_.name -eq "networkInterfaceId" } | Select-Object -ExpandProperty value
    
    if ($eniId) {
        $publicIp = & $awsCmd ec2 describe-network-interfaces --network-interface-ids $eniId --query "NetworkInterfaces[0].Association.PublicIp" --output text
        Write-Host "  ✅ Service endpoint: http://$publicIp`:8080" -ForegroundColor Green
        Write-Host "`n  Health check: curl http://$publicIp`:8080/health" -ForegroundColor White
        
        # Save endpoint for benchmark script
        $publicIp | Out-File -FilePath "service-endpoint.txt" -Encoding utf8
    }
}

Write-Host "`n================================================" -ForegroundColor Cyan
Write-Host "  ✅ ECS UPDATE COMPLETE!" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "`nNext: Run benchmark" -ForegroundColor Yellow
Write-Host "  .\run-benchmark-phase0.5.ps1`n" -ForegroundColor White
