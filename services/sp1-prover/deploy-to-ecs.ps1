# Deploy SP1 Prover to AWS ECS
# Creates ECS cluster, task definition, and service

$ErrorActionPreference = "Stop"

# Load AWS credentials from .env.local
$envPath = Join-Path (Split-Path $PSScriptRoot) ".env.local"
if (Test-Path $envPath) {
    Write-Host "Loading AWS credentials from .env.local..." -ForegroundColor Cyan
    Get-Content $envPath | ForEach-Object {
        if ($_ -match '^AWS_ACCESS_KEY_ID=(.+)$') {
            $env:AWS_ACCESS_KEY_ID = $matches[1]
        }
        if ($_ -match '^AWS_SECRET_ACCESS_KEY=(.+)$') {
            $env:AWS_SECRET_ACCESS_KEY = $matches[1]
        }
        if ($_ -match '^AWS_REGION=(.+)$') {
            $env:AWS_REGION = $matches[1]
        }
        if ($_ -match '^SP1_PRIVATE_KEY=(.+)$') {
            $env:SP1_PRIVATE_KEY = $matches[1]
        }
    }
    Write-Host "[OK] Credentials loaded`n" -ForegroundColor Green
} else {
    Write-Host "[ERROR] .env.local not found!" -ForegroundColor Red
    exit 1
}

$ECR_REGISTRY = "187510174358.dkr.ecr.us-east-1.amazonaws.com"
$IMAGE_NAME = "sp1-prover-network"
$AWS_REGION = if ($env:AWS_REGION) { $env:AWS_REGION } else { "us-east-1" }
$CLUSTER_NAME = "sp1-prover-cluster"
$SERVICE_NAME = "sp1-prover-service"
$TASK_FAMILY = "sp1-prover-task"

Write-Host "[DEPLOYING] to AWS ECS`n" -ForegroundColor Cyan

# Step 1: Create ECS Cluster
Write-Host "[1/5] Creating ECS cluster..." -ForegroundColor Yellow
try {
    aws ecs create-cluster --cluster-name $CLUSTER_NAME --region $AWS_REGION 2>&1 | Out-Null
    Write-Host "[OK] Cluster created" -ForegroundColor Green
} catch {
    Write-Host "[OK] Cluster already exists" -ForegroundColor Green
}

# Step 2: Register Task Definition
Write-Host "[2/5] Registering task definition..." -ForegroundColor Yellow

# Get SP1_PRIVATE_KEY_ARN
$sp1KeyArn = $env:SP1_PRIVATE_KEY
if (-not $sp1KeyArn) {
    Write-Host "[ERROR] SP1_PRIVATE_KEY not found in .env.local!" -ForegroundColor Red
    exit 1
}

# Create task definition JSON
$taskDefJson = @"
{
  "family": "$TASK_FAMILY",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::187510174358:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "sp1-prover",
      "image": "$ECR_REGISTRY/$IMAGE_NAME:latest",
      "portMappings": [
        {
          "containerPort": 8080,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "RUST_LOG",
          "value": "info"
        }
      ],
      "secrets": [
        {
          "name": "SP1_PRIVATE_KEY",
          "valueFrom": "$sp1KeyArn"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/sp1-prover",
          "awslogs-region": "$AWS_REGION",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
"@

# Create log group
try {
    aws logs create-log-group --log-group-name /ecs/sp1-prover --region $AWS_REGION 2>&1 | Out-Null
} catch {}

# Register task
$taskDefJson | Out-File -FilePath task-definition.json -Encoding UTF8
aws ecs register-task-definition --cli-input-json file://task-definition.json --region $AWS_REGION | Out-Null
Write-Host "[OK] Task registered" -ForegroundColor Green

# Step 3: Get default VPC and subnets
Write-Host "`n[3/5] Getting VPC configuration..." -ForegroundColor Yellow
$vpcId = aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" --query "Vpcs[0].VpcId" --output text --region $AWS_REGION
$subnets = aws ec2 describe-subnets --filters "Name=vpc-id,Values=$vpcId" --query "Subnets[*].SubnetId" --output text --region $AWS_REGION
$subnetList = $subnets -split '\s+'
Write-Host "[OK] VPC: $vpcId" -ForegroundColor Green

# Step 4: Create security group
Write-Host "`n[4/5] Creating security group..." -ForegroundColor Yellow
$sgName = "sp1-prover-sg"
try {
    $sgId = aws ec2 create-security-group `
        --group-name $sgName `
        --description "Security group for SP1 Prover" `
        --vpc-id $vpcId `
        --region $AWS_REGION `
        --query "GroupId" `
        --output text
    
    # Allow port 8080
    aws ec2 authorize-security-group-ingress `
        --group-id $sgId `
        --protocol tcp `
        --port 8080 `
        --cidr 0.0.0.0/0 `
        --region $AWS_REGION 2>&1 | Out-Null
    
    Write-Host "[OK] Security group created: $sgId" -ForegroundColor Green
} catch {
    $sgId = aws ec2 describe-security-groups `
        --filters "Name=group-name,Values=$sgName" `
        --query "SecurityGroups[0].GroupId" `
        --output text `
        --region $AWS_REGION
    Write-Host "[OK] Using existing security group: $sgId" -ForegroundColor Green
}

# Step 5: Create service
Write-Host "`n[5/5] Creating ECS service..." -ForegroundColor Yellow
try {
    aws ecs create-service `
        --cluster $CLUSTER_NAME `
        --service-name $SERVICE_NAME `
        --task-definition $TASK_FAMILY `
        --desired-count 1 `
        --launch-type FARGATE `
        --network-configuration "awsvpcConfiguration={subnets=[$($subnetList[0]),$($subnetList[1])],securityGroups=[$sgId],assignPublicIp=ENABLED}" `
        --region $AWS_REGION | Out-Null
    Write-Host "[OK] Service created!" -ForegroundColor Green
} catch {
    Write-Host "[OK] Service already exists, updating..." -ForegroundColor Yellow
    aws ecs update-service `
        --cluster $CLUSTER_NAME `
        --service $SERVICE_NAME `
        --task-definition $TASK_FAMILY `
        --region $AWS_REGION | Out-Null
    Write-Host "[OK] Service updated!" -ForegroundColor Green
}

# Get public IP
Write-Host "`n[WAIT] Waiting for task to start (30 seconds)..." -ForegroundColor Yellow
Start-Sleep -Seconds 30

$taskArn = aws ecs list-tasks --cluster $CLUSTER_NAME --service-name $SERVICE_NAME --region $AWS_REGION --query "taskArns[0]" --output text
if ($taskArn) {
    $taskDetails = aws ecs describe-tasks --cluster $CLUSTER_NAME --tasks $taskArn --region $AWS_REGION --query "tasks[0]" | ConvertFrom-Json
    $eniId = $taskDetails.attachments[0].details | Where-Object { $_.name -eq "networkInterfaceId" } | Select-Object -ExpandProperty value
    
    if ($eniId) {
        $publicIp = aws ec2 describe-network-interfaces --network-interface-ids $eniId --region $AWS_REGION --query "NetworkInterfaces[0].Association.PublicIp" --output text
        
        Write-Host "`n[SUCCESS] DEPLOYMENT COMPLETE!" -ForegroundColor Green
        Write-Host "`nYour SP1 Prover Endpoint:" -ForegroundColor Cyan
        Write-Host "   http://${publicIp}:8080`n" -ForegroundColor Yellow
        
        Write-Host "Test it:" -ForegroundColor Cyan
        Write-Host "  curl.exe http://${publicIp}:8080/health" -ForegroundColor White
        Write-Host "  curl.exe -X POST http://${publicIp}:8080/prove -H `"Content-Type: application/json`" -d `"@test-data/deposit-1tfuel.json`"`n" -ForegroundColor White
    }
}

Write-Host "Estimated cost: ~$20-30/month (Fargate 0.5 vCPU, 1GB RAM)" -ForegroundColor Yellow
Write-Host "View in AWS Console: https://console.aws.amazon.com/ecs/v2/clusters/$CLUSTER_NAME/services`n" -ForegroundColor Cyan

# Cleanup temp file
Remove-Item task-definition.json -ErrorAction SilentlyContinue
