# Create ECS Task Execution Role
# This role allows ECS to pull images and access secrets

$ErrorActionPreference = "Continue"

# Load AWS credentials
$envPath = "../.env.local"
Get-Content $envPath | ForEach-Object {
    if ($_ -match '^AWS_ACCESS_KEY_ID=(.+)$') { $env:AWS_ACCESS_KEY_ID = $matches[1] }
    if ($_ -match '^AWS_SECRET_ACCESS_KEY=(.+)$') { $env:AWS_SECRET_ACCESS_KEY = $matches[1] }
}

$region = "us-east-1"
$roleName = "ecsTaskExecutionRole"

Write-Host "`nCreating ECS Task Execution Role...`n" -ForegroundColor Cyan

# Step 1: Create trust policy
$trustPolicy = @"
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ecs-tasks.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
"@

[System.IO.File]::WriteAllText("$PWD\trust-policy.json", $trustPolicy)

Write-Host "[1/4] Creating IAM role..." -ForegroundColor Yellow
$createResult = cmd /c "aws iam create-role --role-name $roleName --assume-role-policy-document file://trust-policy.json --region $region 2>&1"

if ($createResult -match "already exists" -or $createResult -match "EntityAlreadyExists") {
    Write-Host "     Role already exists" -ForegroundColor Gray
} else {
    Write-Host "     Role created" -ForegroundColor Green
}

# Step 2: Attach ECS execution policy
Write-Host "[2/4] Attaching ECS execution policy..." -ForegroundColor Yellow
cmd /c "aws iam attach-role-policy --role-name $roleName --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy --region $region 2>&1" | Out-Null
Write-Host "     Policy attached" -ForegroundColor Green

# Step 3: Add Secrets Manager policy
Write-Host "[3/4] Adding Secrets Manager permissions..." -ForegroundColor Yellow

$secretsPolicy = @"
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:$region:187510174358:secret:*"
    }
  ]
}
"@

[System.IO.File]::WriteAllText("$PWD\secrets-policy.json", $secretsPolicy)

cmd /c "aws iam put-role-policy --role-name $roleName --policy-name SecretsManagerAccess --policy-document file://secrets-policy.json --region $region 2>&1" | Out-Null
Write-Host "     Secrets access granted" -ForegroundColor Green

# Step 4: Wait for role to propagate
Write-Host "[4/4] Waiting for IAM role to propagate (10 seconds)..." -ForegroundColor Yellow
Start-Sleep -Seconds 10
Write-Host "     Ready!" -ForegroundColor Green

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "  IAM Role Created Successfully!" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Green

Write-Host "Now update the ECS service:" -ForegroundColor Cyan
Write-Host "  cd C:\Users\seeha\xfuel-protocol\sp1-prover" -ForegroundColor White
Write-Host "  cmd /c `"aws ecs update-service --cluster sp1-prover-cluster --service sp1-prover-service --task-definition sp1-prover-task --force-new-deployment --region us-east-1`"`n" -ForegroundColor White

Write-Host "Then check status:" -ForegroundColor Cyan
Write-Host "  .\check-status.ps1`n" -ForegroundColor White

# Cleanup
Remove-Item trust-policy.json -ErrorAction SilentlyContinue
Remove-Item secrets-policy.json -ErrorAction SilentlyContinue
