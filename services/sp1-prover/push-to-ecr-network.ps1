# Push SP1 Prover (Network Mode) to ECR and Deploy to ECS
# Run this after docker build completes

$ErrorActionPreference = "Stop"

$ECR_REGISTRY = "187510174358.dkr.ecr.us-east-1.amazonaws.com"
$IMAGE_NAME = "sp1-prover-network"
$AWS_REGION = "us-east-1"

Write-Host "`n🚀 Deploying SP1 Prover (Network Mode) to AWS`n" -ForegroundColor Cyan

# Step 1: Tag image for ECR
Write-Host "[1/5] Tagging image for ECR..." -ForegroundColor Yellow
docker tag xfuel/sp1-prover-network:latest $ECR_REGISTRY/${IMAGE_NAME}:latest
Write-Host "✅ Tagged" -ForegroundColor Green

# Step 2: Login to ECR
Write-Host "`n[2/5] Logging into ECR..." -ForegroundColor Yellow
$loginPassword = aws ecr get-login-password --region $AWS_REGION
$loginPassword | docker login --username AWS --password-stdin $ECR_REGISTRY
Write-Host "✅ Logged in" -ForegroundColor Green

# Step 3: Create ECR repository (if doesn't exist)
Write-Host "`n[3/5] Creating ECR repository..." -ForegroundColor Yellow
try {
    aws ecr create-repository --repository-name $IMAGE_NAME --region $AWS_REGION 2>&1 | Out-Null
    Write-Host "✅ Repository created" -ForegroundColor Green
} catch {
    Write-Host "✅ Repository already exists" -ForegroundColor Green
}

# Step 4: Push to ECR
Write-Host "`n[4/5] Pushing image to ECR (this may take 5-10 minutes)..." -ForegroundColor Yellow
docker push $ECR_REGISTRY/${IMAGE_NAME}:latest
Write-Host "✅ Image pushed!" -ForegroundColor Green

# Step 5: Deploy to ECS
Write-Host "`n[5/5] Setting up ECS deployment..." -ForegroundColor Yellow
Write-Host "Image ready at: $ECR_REGISTRY/${IMAGE_NAME}:latest" -ForegroundColor Cyan

Write-Host "`n✅ ECR push complete!" -ForegroundColor Green
Write-Host "`nNext: Deploy to ECS" -ForegroundColor Yellow
Write-Host "  Run: .\deploy-to-ecs.ps1`n" -ForegroundColor White
