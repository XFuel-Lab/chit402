# Load AWS credentials from .env.local and push to ECR
# Run this in PowerShell: .\push-to-ecr.ps1

Write-Host "`n[STEP 1] Loading AWS credentials from .env.local..." -ForegroundColor Cyan

# Read .env.local file
if (Test-Path ".env.local") {
    Get-Content .env.local | ForEach-Object {
        if ($_ -match '^AWS_ACCESS_KEY_ID=(.+)$') {
            $env:AWS_ACCESS_KEY_ID = $matches[1]
            Write-Host "✅ AWS_ACCESS_KEY_ID loaded" -ForegroundColor Green
        }
        if ($_ -match '^AWS_SECRET_ACCESS_KEY=(.+)$') {
            $env:AWS_SECRET_ACCESS_KEY = $matches[1]
            Write-Host "✅ AWS_SECRET_ACCESS_KEY loaded" -ForegroundColor Green
        }
        if ($_ -match '^AWS_REGION=(.+)$') {
            $env:AWS_DEFAULT_REGION = $matches[1]
            Write-Host "✅ AWS_REGION loaded: $($matches[1])" -ForegroundColor Green
        }
    }
} else {
    Write-Host "❌ .env.local not found!" -ForegroundColor Red
    Write-Host "Please run this from the project root directory" -ForegroundColor Yellow
    exit 1
}

# Verify credentials are loaded
if (-not $env:AWS_ACCESS_KEY_ID -or -not $env:AWS_SECRET_ACCESS_KEY) {
    Write-Host "`n❌ AWS credentials not found in .env.local!" -ForegroundColor Red
    Write-Host "Please add to .env.local:" -ForegroundColor Yellow
    Write-Host "  AWS_ACCESS_KEY_ID=your_key" -ForegroundColor White
    Write-Host "  AWS_SECRET_ACCESS_KEY=your_secret" -ForegroundColor White
    Write-Host "  AWS_REGION=us-east-1" -ForegroundColor White
    exit 1
}

# Set default region if not set
if (-not $env:AWS_DEFAULT_REGION) {
    $env:AWS_DEFAULT_REGION = "us-east-1"
    Write-Host "✅ Using default region: us-east-1" -ForegroundColor Green
}

Write-Host "`n[STEP 2] Creating ECR repository..." -ForegroundColor Cyan
$repoResult = aws ecr create-repository --repository-name sp1-prover-cuda --region $env:AWS_DEFAULT_REGION 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Repository created" -ForegroundColor Green
} elseif ($repoResult -match "RepositoryAlreadyExistsException") {
    Write-Host "✅ Repository already exists" -ForegroundColor Green
} else {
    Write-Host "⚠️  Warning: $repoResult" -ForegroundColor Yellow
}

Write-Host "`n[STEP 3] Logging into ECR..." -ForegroundColor Cyan
$loginResult = aws ecr get-login-password --region $env:AWS_DEFAULT_REGION | docker login --username AWS --password-stdin 187510174358.dkr.ecr.$env:AWS_DEFAULT_REGION.amazonaws.com 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Login successful" -ForegroundColor Green
} else {
    Write-Host "❌ Login failed: $loginResult" -ForegroundColor Red
    exit 1
}

Write-Host "`n[STEP 4] Pushing image to ECR..." -ForegroundColor Cyan
Write-Host "This will take 5-10 minutes (24GB image)..." -ForegroundColor Yellow
Write-Host "Progress will be shown below:`n" -ForegroundColor White

docker push 187510174358.dkr.ecr.$env:AWS_DEFAULT_REGION.amazonaws.com/sp1-prover-cuda:latest

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n✅ SUCCESS! Image pushed to ECR!" -ForegroundColor Green
    Write-Host "`nYour image URL:" -ForegroundColor Cyan
    Write-Host "  187510174358.dkr.ecr.$env:AWS_DEFAULT_REGION.amazonaws.com/sp1-prover-cuda:latest" -ForegroundColor Yellow
    Write-Host "`nNext step: Deploy on Theta EdgeCloud dashboard!" -ForegroundColor Green
} else {
    Write-Host "`n❌ Push failed!" -ForegroundColor Red
    Write-Host "Check the error above and try again" -ForegroundColor Yellow
    exit 1
}
