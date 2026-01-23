# Phase 0.5 - ECR Push & Deployment Script
# Pushes optimized image and deploys to ECS
# Run from sp1-prover directory: .\deploy-phase0.5.ps1

Write-Host "`n================================================" -ForegroundColor Cyan
Write-Host "  PHASE 0.5 - ECR PUSH & ECS DEPLOYMENT" -ForegroundColor Yellow
Write-Host "================================================`n" -ForegroundColor Cyan

# Load AWS credentials
Write-Host "[STEP 1] Loading AWS credentials..." -ForegroundColor Cyan
if (Test-Path "../.env.local") {
    Get-Content ../.env.local | ForEach-Object {
        if ($_ -match '^AWS_ACCESS_KEY_ID=(.+)$') {
            $env:AWS_ACCESS_KEY_ID = $matches[1]
            Write-Host "  ✅ AWS_ACCESS_KEY_ID loaded" -ForegroundColor Green
        }
        if ($_ -match '^AWS_SECRET_ACCESS_KEY=(.+)$') {
            $env:AWS_SECRET_ACCESS_KEY = $matches[1]
            Write-Host "  ✅ AWS_SECRET_ACCESS_KEY loaded" -ForegroundColor Green
        }
        if ($_ -match '^AWS_REGION=(.+)$') {
            $env:AWS_DEFAULT_REGION = $matches[1]
            Write-Host "  ✅ AWS_REGION: $($matches[1])" -ForegroundColor Green
        }
    }
} else {
    Write-Host "  ❌ .env.local not found!" -ForegroundColor Red
    exit 1
}

if (-not $env:AWS_DEFAULT_REGION) {
    $env:AWS_DEFAULT_REGION = "us-east-1"
}

$ACCOUNT_ID = "187510174358"
$REGION = $env:AWS_DEFAULT_REGION
$REPO_NAME = "sp1-prover"
$IMAGE_TAG = "phase0.5-optimized"
$ECR_URI = "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$REPO_NAME`:$IMAGE_TAG"

# Step 2: Login to ECR
Write-Host "`n[STEP 2] Logging into ECR..." -ForegroundColor Cyan
$awsCmd = "C:\Program Files\Amazon\AWSCLIV2\aws.exe"
& $awsCmd ecr get-login-password --region $REGION | docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"
if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✅ ECR login successful" -ForegroundColor Green
} else {
    Write-Host "  ❌ ECR login failed!" -ForegroundColor Red
    exit 1
}

# Step 3: Tag image
Write-Host "`n[STEP 3] Tagging Docker image..." -ForegroundColor Cyan
Write-Host "  Local:  sp1-prover-network:phase0.5-optimized" -ForegroundColor White
Write-Host "  Remote: $ECR_URI" -ForegroundColor White
docker tag sp1-prover-network:phase0.5-optimized $ECR_URI
if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✅ Image tagged successfully" -ForegroundColor Green
} else {
    Write-Host "  ❌ Tagging failed!" -ForegroundColor Red
    exit 1
}

# Step 4: Push to ECR
Write-Host "`n[STEP 4] Pushing to ECR (this may take 5-10 minutes)..." -ForegroundColor Cyan
$pushStart = Get-Date
docker push $ECR_URI
if ($LASTEXITCODE -eq 0) {
    $pushDuration = [math]::Round(((Get-Date) - $pushStart).TotalSeconds, 1)
    Write-Host "  ✅ Push completed in $pushDuration seconds" -ForegroundColor Green
} else {
    Write-Host "  ❌ Push failed!" -ForegroundColor Red
    exit 1
}

# Step 5: Update ECS Task Definition
Write-Host "`n[STEP 5] Registering new ECS task definition..." -ForegroundColor Cyan

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
      "portMappings": [
        {
          "containerPort": 8080,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "SP1_PROVER",
          "value": "network"
        },
        {
          "name": "RUST_LOG",
          "value": "info"
        }
      ],
      "secrets": [
        {
          "name": "NETWORK_PRIVATE_KEY",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:$ACCOUNT_ID`:secret:SP1_PRIVATE_KEY-NFV6WS"
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
Write-Host "  📄 Task definition saved to task-def-phase0.5.json" -ForegroundColor White

$taskDefOutput = & $awsCmd ecs register-task-definition --cli-input-json file://task-def-phase0.5.json 2>&1
if ($LASTEXITCODE -eq 0) {
    $taskDefArn = ($taskDefOutput | ConvertFrom-Json).taskDefinition.taskDefinitionArn
    Write-Host "  ✅ Task definition registered: $taskDefArn" -ForegroundColor Green
} else {
    Write-Host "  ❌ Task definition registration failed!" -ForegroundColor Red
    Write-Host "  Error: $taskDefOutput" -ForegroundColor Yellow
    exit 1
}

# Step 6: Update ECS Service
Write-Host "`n[STEP 6] Updating ECS service..." -ForegroundColor Cyan
Write-Host "  This will trigger a rolling deployment (5-10 minutes)" -ForegroundColor Yellow

$updateOutput = & $awsCmd ecs update-service `
    --cluster sp1-cluster `
    --service sp1-prover-service `
    --task-definition sp1-prover-task `
    --force-new-deployment 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✅ Service update initiated" -ForegroundColor Green
    
    # Wait for deployment
    Write-Host "`n[STEP 7] Waiting for deployment to stabilize..." -ForegroundColor Cyan
    Write-Host "  This may take 5-10 minutes. Checking every 30 seconds..." -ForegroundColor Yellow
    
    $maxAttempts = 20
    $attempt = 0
    $deployed = $false
    
    while ($attempt -lt $maxAttempts -and -not $deployed) {
        Start-Sleep -Seconds 30
        $attempt++
        
        $serviceStatus = & $awsCmd ecs describe-services --cluster sp1-cluster --services sp1-prover-service --query "services[0].deployments" | ConvertFrom-Json
        
        $activeDeployments = ($serviceStatus | Where-Object { $_.status -eq "PRIMARY" }).Count
        $runningCount = ($serviceStatus | Where-Object { $_.status -eq "PRIMARY" }).runningCount
        $desiredCount = ($serviceStatus | Where-Object { $_.status -eq "PRIMARY" }).desiredCount
        
        Write-Host "  Attempt $attempt/$maxAttempts`: Running: $runningCount/$desiredCount tasks" -ForegroundColor White
        
        if ($runningCount -eq $desiredCount -and $activeDeployments -eq 1) {
            $deployed = $true
            Write-Host "  ✅ Deployment successful!" -ForegroundColor Green
        }
    }
    
    if (-not $deployed) {
        Write-Host "  ⚠️  Deployment is taking longer than expected" -ForegroundColor Yellow
        Write-Host "  Check AWS Console for details" -ForegroundColor Yellow
    }
} else {
    Write-Host "  ❌ Service update failed!" -ForegroundColor Red
    Write-Host "  Error: $updateOutput" -ForegroundColor Yellow
    exit 1
}

# Step 8: Get service endpoint
Write-Host "`n[STEP 8] Getting service endpoint..." -ForegroundColor Cyan
$tasks = & $awsCmd ecs list-tasks --cluster sp1-cluster --service-name sp1-prover-service --query "taskArns[0]" --output text
if ($tasks) {
    $taskDetails = & $awsCmd ecs describe-tasks --cluster sp1-cluster --tasks $tasks | ConvertFrom-Json
    $eniId = $taskDetails.tasks[0].attachments[0].details | Where-Object { $_.name -eq "networkInterfaceId" } | Select-Object -ExpandProperty value
    
    if ($eniId) {
        $publicIp = & $awsCmd ec2 describe-network-interfaces --network-interface-ids $eniId --query "NetworkInterfaces[0].Association.PublicIp" --output text
        Write-Host "  ✅ Service endpoint: http://$publicIp`:8080" -ForegroundColor Green
        Write-Host "`n  Health check: curl http://$publicIp`:8080/health" -ForegroundColor White
    }
}

Write-Host "`n================================================" -ForegroundColor Cyan
Write-Host "  ✅ PHASE 0.5 DEPLOYMENT COMPLETE!" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "`nNext step: Run benchmark script" -ForegroundColor Yellow
Write-Host "  .\run-benchmark-phase0.5.ps1`n" -ForegroundColor White
