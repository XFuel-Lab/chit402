# Simple ECS Deployment - Step by Step
# Run in PowerShell

$ErrorActionPreference = "Continue"

# Load credentials
Write-Host "`nLoading credentials..." -ForegroundColor Cyan
$envPath = "../.env.local"
Get-Content $envPath | ForEach-Object {
    if ($_ -match '^SP1_PRIVATE_KEY=(.+)$') { $script:sp1Key = $matches[1] }
    if ($_ -match '^AWS_ACCESS_KEY_ID=(.+)$') { $env:AWS_ACCESS_KEY_ID = $matches[1] }
    if ($_ -match '^AWS_SECRET_ACCESS_KEY=(.+)$') { $env:AWS_SECRET_ACCESS_KEY = $matches[1] }
}
Write-Host "[OK] Credentials loaded" -ForegroundColor Green

$region = "us-east-1"
$image = "187510174358.dkr.ecr.us-east-1.amazonaws.com/sp1-prover-network:latest"

# Step 1: Create log group
Write-Host "`n[1/4] Creating log group..." -ForegroundColor Cyan
$null = cmd /c "aws logs create-log-group --log-group-name /ecs/sp1-prover --region $region 2>&1"
Write-Host "[OK] Log group ready" -ForegroundColor Green

# Step 2: Create task definition JSON file
Write-Host "`n[2/4] Creating task definition..." -ForegroundColor Cyan

$jsonContent = @"
{
  "family": "sp1-prover-task",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::187510174358:role/ecsTaskExecutionRole",
  "containerDefinitions": [{
    "name": "sp1-prover",
    "image": "$image",
    "essential": true,
    "portMappings": [{
      "containerPort": 8080,
      "protocol": "tcp"
    }],
    "environment": [{
      "name": "RUST_LOG",
      "value": "info"
    }],
    "secrets": [{
      "name": "SP1_PRIVATE_KEY",
      "valueFrom": "$sp1Key"
    }],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "/ecs/sp1-prover",
        "awslogs-region": "$region",
        "awslogs-stream-prefix": "ecs"
      }
    }
  }]
}
"@

# Save without BOM
[System.IO.File]::WriteAllText("$PWD\task-def.json", $jsonContent)

# Register task
$regResult = cmd /c "aws ecs register-task-definition --cli-input-json file://task-def.json --region $region 2>&1"
Write-Host "[OK] Task definition registered" -ForegroundColor Green

# Step 3: Create service
Write-Host "`n[3/4] Creating ECS service..." -ForegroundColor Cyan

# Get subnets
$vpcId = cmd /c "aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query Vpcs[0].VpcId --output text --region $region"
$subnet1 = cmd /c "aws ec2 describe-subnets --filters Name=vpc-id,Values=$vpcId --query Subnets[0].SubnetId --output text --region $region"
$subnet2 = cmd /c "aws ec2 describe-subnets --filters Name=vpc-id,Values=$vpcId --query Subnets[1].SubnetId --output text --region $region"
$sgId = "sg-0f5c4c2b7a5f35763"

Write-Host "   VPC: $vpcId, Subnets: $subnet1, $subnet2" -ForegroundColor Gray

# Try create service
$networkConfig = "awsvpcConfiguration={subnets=[$subnet1,$subnet2],securityGroups=[$sgId],assignPublicIp=ENABLED}"
$svcResult = cmd /c "aws ecs create-service --cluster sp1-prover-cluster --service-name sp1-prover-service --task-definition sp1-prover-task --desired-count 1 --launch-type FARGATE --network-configuration $networkConfig --region $region 2>&1"

if ($svcResult -match "already exists") {
    Write-Host "[OK] Service exists - updating..." -ForegroundColor Yellow
    cmd /c "aws ecs update-service --cluster sp1-prover-cluster --service sp1-prover-service --task-definition sp1-prover-task --force-new-deployment --region $region" | Out-Null
    Write-Host "[OK] Service updated" -ForegroundColor Green
} else {
    Write-Host "[OK] Service created" -ForegroundColor Green
}

# Step 4: Get endpoint
Write-Host "`n[4/4] Waiting for task (60s)..." -ForegroundColor Cyan
Start-Sleep -Seconds 60

$taskArn = cmd /c "aws ecs list-tasks --cluster sp1-prover-cluster --service-name sp1-prover-service --region $region --query taskArns[0] --output text"

if ($taskArn -and $taskArn -ne "None" -and $taskArn.Length -gt 10) {
    $eniId = cmd /c "aws ecs describe-tasks --cluster sp1-prover-cluster --tasks $taskArn --region $region --query tasks[0].attachments[0].details[?name==``networkInterfaceId``].value --output text"
    
    if ($eniId -and $eniId.Length -gt 5) {
        $publicIp = cmd /c "aws ec2 describe-network-interfaces --network-interface-ids $eniId --region $region --query NetworkInterfaces[0].Association.PublicIp --output text"
        
        Write-Host "`n========================================" -ForegroundColor Green
        Write-Host "  SUCCESS! Your SP1 Prover is LIVE!" -ForegroundColor Green
        Write-Host "========================================`n" -ForegroundColor Green
        
        Write-Host "Endpoint: http://${publicIp}:8080" -ForegroundColor Yellow
        Write-Host "`nTest:" -ForegroundColor Cyan
        Write-Host "  curl.exe http://${publicIp}:8080/health" -ForegroundColor White
    } else {
        Write-Host "[WAIT] Task still starting..." -ForegroundColor Yellow
    }
} else {
    Write-Host "[WAIT] No tasks yet. Check AWS Console:" -ForegroundColor Yellow
    Write-Host "  https://console.aws.amazon.com/ecs/v2/clusters/sp1-prover-cluster" -ForegroundColor White
}

# Cleanup
Remove-Item task-def.json -ErrorAction SilentlyContinue
