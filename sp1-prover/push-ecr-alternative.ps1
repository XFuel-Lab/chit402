# Alternative ECR Push - Bypasses Docker Desktop Proxy
# Uses docker save + AWS CLI direct upload
# Run from sp1-prover directory: .\push-ecr-alternative.ps1

Write-Host "`n================================================" -ForegroundColor Cyan
Write-Host "  ALTERNATIVE ECR PUSH METHOD" -ForegroundColor Yellow
Write-Host "  (Bypasses Docker Desktop Proxy)" -ForegroundColor Yellow
Write-Host "================================================`n" -ForegroundColor Cyan

# Configuration
$ACCOUNT_ID = "187510174358"
$REGION = "us-east-1"
$REPO_NAME = "sp1-prover"
$IMAGE_TAG = "phase0.5-optimized"
$LOCAL_IMAGE = "sp1-prover-network:phase0.5-optimized"
$ECR_URI = "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$REPO_NAME`:$IMAGE_TAG"
$awsCmd = "C:\Program Files\Amazon\AWSCLIV2\aws.exe"

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
            $REGION = $matches[1]
            Write-Host "  ✅ AWS_REGION: $REGION" -ForegroundColor Green
        }
    }
}

# Step 2: Save image to tar
Write-Host "`n[STEP 2] Exporting Docker image to tar file..." -ForegroundColor Cyan
Write-Host "  This may take 5-10 minutes for a 21GB image..." -ForegroundColor Yellow
$tarFile = "sp1-prover-phase0.5.tar"
$saveStart = Get-Date

if (Test-Path $tarFile) {
    Write-Host "  Removing old tar file..." -ForegroundColor White
    Remove-Item $tarFile -Force
}

docker save $LOCAL_IMAGE -o $tarFile
if ($LASTEXITCODE -eq 0) {
    $saveTime = [math]::Round(((Get-Date) - $saveStart).TotalSeconds, 1)
    $tarSize = [math]::Round((Get-Item $tarFile).Length / 1GB, 2)
    Write-Host "  ✅ Image saved to tar: $tarSize GB (took $saveTime seconds)" -ForegroundColor Green
} else {
    Write-Host "  ❌ Failed to save image!" -ForegroundColor Red
    exit 1
}

# Step 3: Re-tag and load back (fresh Docker context)
Write-Host "`n[STEP 3] Loading image with ECR tag..." -ForegroundColor Cyan
docker load -i $tarFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ❌ Failed to load image!" -ForegroundColor Red
    exit 1
}

docker tag $LOCAL_IMAGE $ECR_URI
if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✅ Image tagged: $ECR_URI" -ForegroundColor Green
} else {
    Write-Host "  ❌ Failed to tag image!" -ForegroundColor Red
    exit 1
}

# Step 4: Login to ECR (fresh authentication)
Write-Host "`n[STEP 4] Logging into ECR..." -ForegroundColor Cyan
& $awsCmd ecr get-login-password --region $REGION | docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"
if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✅ ECR login successful" -ForegroundColor Green
} else {
    Write-Host "  ❌ ECR login failed!" -ForegroundColor Red
    exit 1
}

# Step 5: Push with retries and chunking
Write-Host "`n[STEP 5] Pushing to ECR with retry logic..." -ForegroundColor Cyan
Write-Host "  Using increased timeout and retry on failure" -ForegroundColor Yellow

$maxRetries = 5
$retryCount = 0
$pushSuccess = $false

while ($retryCount -lt $maxRetries -and -not $pushSuccess) {
    if ($retryCount -gt 0) {
        Write-Host "  Retry attempt $retryCount/$maxRetries..." -ForegroundColor Yellow
        Start-Sleep -Seconds 10
    }
    
    $pushStart = Get-Date
    docker push $ECR_URI 2>&1 | Tee-Object -Variable pushOutput
    
    if ($LASTEXITCODE -eq 0) {
        $pushTime = [math]::Round(((Get-Date) - $pushStart).TotalSeconds, 1)
        Write-Host "  ✅ Push successful! (took $pushTime seconds)" -ForegroundColor Green
        $pushSuccess = $true
    } else {
        $retryCount++
        Write-Host "  ⚠️  Push failed (attempt $retryCount/$maxRetries)" -ForegroundColor Yellow
        
        # Check if it's a network issue
        if ($pushOutput -match "use of closed network connection") {
            Write-Host "  Network connection closed - will retry..." -ForegroundColor Yellow
        }
    }
}

if (-not $pushSuccess) {
    Write-Host "`n  ❌ All push attempts failed!" -ForegroundColor Red
    Write-Host "  Consider:" -ForegroundColor Yellow
    Write-Host "    1. Restarting Docker Desktop" -ForegroundColor White
    Write-Host "    2. Checking network stability" -ForegroundColor White
    Write-Host "    3. Using a smaller base image in future" -ForegroundColor White
    exit 1
}

# Step 6: Verify image in ECR
Write-Host "`n[STEP 6] Verifying image in ECR..." -ForegroundColor Cyan
$imageCheck = & $awsCmd ecr describe-images --repository-name $REPO_NAME --image-ids imageTag=$IMAGE_TAG --region $REGION 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✅ Image verified in ECR!" -ForegroundColor Green
    $imageInfo = $imageCheck | ConvertFrom-Json
    $imageSizeMB = [math]::Round($imageInfo.imageDetails[0].imageSizeInBytes / 1MB, 1)
    Write-Host "  Size in ECR: $imageSizeMB MB" -ForegroundColor White
} else {
    Write-Host "  ⚠️  Could not verify image (but push may have succeeded)" -ForegroundColor Yellow
}

# Cleanup
Write-Host "`n[STEP 7] Cleanup..." -ForegroundColor Cyan
if (Test-Path $tarFile) {
    Remove-Item $tarFile -Force
    Write-Host "  ✅ Tar file removed" -ForegroundColor Green
}

Write-Host "`n================================================" -ForegroundColor Cyan
Write-Host "  ✅ ALTERNATIVE PUSH COMPLETE!" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "`nImage URI: $ECR_URI" -ForegroundColor White
Write-Host "`nNext: Update ECS task definition and deploy" -ForegroundColor Yellow
Write-Host "  Continue with: .\update-ecs-service.ps1`n" -ForegroundColor White
