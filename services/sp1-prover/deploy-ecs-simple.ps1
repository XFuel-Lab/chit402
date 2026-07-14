# Simple ECS Deployment Script
# Creates task definition and service manually

$ErrorActionPreference = "Stop"

# Load credentials
$envPath = "../.env.local"
$sp1Key = ""
Get-Content $envPath | ForEach-Object {
    if ($_ -match '^SP1_PRIVATE_KEY=(.+)$') { $sp1Key = $matches[1] }
    if ($_ -match '^AWS_ACCESS_KEY_ID=(.+)$') { $env:AWS_ACCESS_KEY_ID = $matches[1] }
    if ($_ -match '^AWS_SECRET_ACCESS_KEY=(.+)$') { $env:AWS_SECRET_ACCESS_KEY = $matches[1] }
    if ($_ -match '^AWS_REGION=(.+)$') { $env:AWS_REGION = $matches[1] }
}

$region = "us-east-1"
$image = "187510174358.dkr.ecr.us-east-1.amazonaws.com/sp1-prover-network:latest"

Write-Host "`n[STEP 1] Register Task Definition" -ForegroundColor Cyan

# Use AWS CLI to register directly
$output = aws ecs register-task-definition `
    --family sp1-prover-task `
    --network-mode awsvpc `
    --requires-compatibilities FARGATE `
    --cpu 512 `
    --memory 1024 `
    --execution-role-arn "arn:aws:iam::187510174358:role/ecsTaskExecutionRole" `
    --container-definitions "[{`"name`":`"sp1-prover`",`"image`":`"$image`",`"portMappings`":[{`"containerPort`":8080,`"protocol`":`"tcp`"}],`"environment`":[{`"name`":`"RUST_LOG`",`"value`":`"info`"}],`"secrets`":[{`"name`":`"SP1_PRIVATE_KEY`",`"valueFrom`":`"$sp1Key`"}],`"logConfiguration`":{`"logDriver`":`"awslogs`",`"options`":{`"awslogs-group`":`"/ecs/sp1-prover`",`"awslogs-region`":`"$region`",`"awslogs-stream-prefix`":`"ecs`"}}}]" `
    --region $region 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK] Task registered!" -ForegroundColor Green
} else {
    Write-Host "[ERROR] Failed to register task" -ForegroundColor Red
    Write-Host $output
    exit 1
}

Write-Host "`n[STEP 2] Create/Update Service" -ForegroundColor Cyan

# Get VPC and subnets
$vpcId = aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" --query "Vpcs[0].VpcId" --output text --region $region
$subnets = aws ec2 describe-subnets --filters "Name=vpc-id,Values=$vpcId" --query "Subnets[*].SubnetId" --output text --region $region
$subnetList = $subnets -split '\s+'
$sgId = "sg-0f5c4c2b7a5f35763"  # From previous run

# Try to create service
$createOutput = aws ecs create-service `
    --cluster sp1-prover-cluster `
    --service-name sp1-prover-service `
    --task-definition sp1-prover-task `
    --desired-count 1 `
    --launch-type FARGATE `
    --network-configuration "awsvpcConfiguration={subnets=[$($subnetList[0]),$($subnetList[1])],securityGroups=[$sgId],assignPublicIp=ENABLED}" `
    --region $region 2>&1

if ($createOutput -match "service already exists") {
    Write-Host "[OK] Service exists, updating..." -ForegroundColor Yellow
    aws ecs update-service `
        --cluster sp1-prover-cluster `
        --service sp1-prover-service `
        --task-definition sp1-prover-task `
        --region $region | Out-Null
    Write-Host "[OK] Service updated!" -ForegroundColor Green
} elseif ($LASTEXITCODE -eq 0) {
    Write-Host "[OK] Service created!" -ForegroundColor Green
} else {
    Write-Host "[ERROR] Failed to create/update service" -ForegroundColor Red
    Write-Host $createOutput
}

Write-Host "`n[STEP 3] Getting Public IP (wait 60s for task to start)..." -ForegroundColor Cyan
Start-Sleep -Seconds 60

$taskArn = aws ecs list-tasks --cluster sp1-prover-cluster --service-name sp1-prover-service --region $region --query "taskArns[0]" --output text

if ($taskArn -and $taskArn -ne "None") {
    $taskJson = aws ecs describe-tasks --cluster sp1-prover-cluster --tasks $taskArn --region $region
    $taskDetails = $taskJson | ConvertFrom-Json
    
    $eni = $taskDetails.tasks[0].attachments[0].details | Where-Object { $_.name -eq "networkInterfaceId" }
    if ($eni) {
        $eniId = $eni.value
        $publicIp = aws ec2 describe-network-interfaces --network-interface-ids $eniId --region $region --query "NetworkInterfaces[0].Association.PublicIp" --output text
        
        Write-Host "`n[SUCCESS] Deployment Complete!" -ForegroundColor Green
        Write-Host "`nYour SP1 Prover Endpoint:" -ForegroundColor Cyan
        Write-Host "  http://${publicIp}:8080`n" -ForegroundColor Yellow
        
        Write-Host "Test it:" -ForegroundColor Cyan
        Write-Host "  curl.exe http://${publicIp}:8080/health" -ForegroundColor White
        Write-Host "  curl.exe -X POST http://${publicIp}:8080/prove -H `"Content-Type: application/json`" -d `"@test-data/deposit-1tfuel.json`"`n" -ForegroundColor White
    }
} else {
    Write-Host "[WAIT] Task still starting. Check AWS Console:" -ForegroundColor Yellow
    Write-Host "  https://console.aws.amazon.com/ecs/v2/clusters/sp1-prover-cluster/services`n" -ForegroundColor White
}
