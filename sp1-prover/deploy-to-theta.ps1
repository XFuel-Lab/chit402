# Deploy SP1 Prover to Theta EdgeCloud - PowerShell Version
# Uses AWS Secrets Manager for credentials
# Run: .\deploy-to-theta.ps1

$ErrorActionPreference = "Stop"

# Configuration
$CONFIG = @{
    ThetaApiKeyArn = $env:THETA_API_KEY
    AwsRegion = if ($env:AWS_REGION) { $env:AWS_REGION } else { "us-east-1" }
    EcrRegistry = "187510174358.dkr.ecr.us-east-1.amazonaws.com"
    ImageName = "sp1-prover-cuda:latest"
    DeploymentName = "xfuel-sp1-prover"
}

# Load .env.local if exists
if (Test-Path "../.env.local") {
    Get-Content "../.env.local" | ForEach-Object {
        if ($_ -match '^THETA_API_KEY=(.+)$') {
            $CONFIG.ThetaApiKeyArn = $matches[1]
        }
        if ($_ -match '^AWS_REGION=(.+)$') {
            $CONFIG.AwsRegion = $matches[1]
        }
    }
}

Write-Host "`n🚀 Deploying SP1 Prover to Theta EdgeCloud`n" -ForegroundColor Cyan
Write-Host ("=" * 60) -ForegroundColor Cyan

# Step 1: Fetch Theta API key
Write-Host "`n[STEP 1] Loading credentials..." -ForegroundColor Yellow

if (-not $CONFIG.ThetaApiKeyArn) {
    Write-Host "❌ THETA_API_KEY not set in environment!" -ForegroundColor Red
    Write-Host "   Add to .env.local: THETA_API_KEY=arn:aws:secretsmanager:..." -ForegroundColor Yellow
    exit 1
}

Write-Host "🔐 Fetching Theta API key from AWS Secrets Manager..." -ForegroundColor Cyan
try {
    $secretString = aws secretsmanager get-secret-value `
        --secret-id $CONFIG.ThetaApiKeyArn `
        --region $CONFIG.AwsRegion `
        --query SecretString `
        --output text
    
    if (-not $secretString) {
        throw "Empty secret returned"
    }
    
    # Try to parse as JSON first
    try {
        $secretJson = $secretString | ConvertFrom-Json
        $ThetaApiKey = $secretJson.theta_api_key
        if (-not $ThetaApiKey) { $ThetaApiKey = $secretJson.THETA_API_KEY }
        if (-not $ThetaApiKey) { $ThetaApiKey = $secretJson.api_key }
        if (-not $ThetaApiKey) { $ThetaApiKey = $secretJson.key }
        if (-not $ThetaApiKey) { $ThetaApiKey = $secretJson.value }
        if (-not $ThetaApiKey) { $ThetaApiKey = $secretString }
    } catch {
        # Not JSON, use as plain text
        $ThetaApiKey = $secretString
    }
    
    if (-not $ThetaApiKey) {
        throw "Failed to extract API key from secret"
    }
    
    $keyLength = $ThetaApiKey.Length
    Write-Host "✅ Theta API key loaded - $keyLength chars" -ForegroundColor Green
} catch {
    Write-Host "❌ Failed to fetch Theta API key: $_" -ForegroundColor Red
    Write-Host "   Secret ARN: $($CONFIG.ThetaApiKeyArn)" -ForegroundColor Yellow
    exit 1
}

Write-Host "🔐 Getting ECR password..." -ForegroundColor Cyan
try {
    $EcrPassword = aws ecr get-login-password --region $CONFIG.AwsRegion
    Write-Host "✅ ECR password loaded" -ForegroundColor Green
} catch {
    Write-Host "❌ Failed to get ECR password: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""

# Step 2: Deployment configuration
Write-Host "[STEP 2] Preparing deployment configuration..." -ForegroundColor Yellow

$DeploymentConfig = @{
    name = $CONFIG.DeploymentName
    image = "$($CONFIG.EcrRegistry)/$($CONFIG.ImageName)"
    registry = @{
        url = $CONFIG.EcrRegistry
        username = "AWS"
        password = $EcrPassword
    }
    environment = @{
        SP1_PROVER = "cuda"
        RUST_LOG = "info"
        CUDA_VISIBLE_DEVICES = "0"
    }
    ports = @(
        @{ container = 8080; host = 8080; protocol = "tcp" }
    )
    resources = @{
        gpu = @{
            type = "nvidia"
            count = 1
            model = "rtx4090"
        }
        cpu = 4
        memory = "16Gi"
        storage = "30Gi"
    }
    restart = "unless-stopped"
    healthCheck = @{
        path = "/health"
        port = 8080
        interval = 30
    }
}

Write-Host "`nDeployment Configuration:" -ForegroundColor Cyan
$DeploymentConfig | ConvertTo-Json -Depth 10 | Write-Host

Write-Host ""
Write-Host "=" * 60 -ForegroundColor Yellow
Write-Host ""

# Step 3: Deploy
Write-Host "[STEP 3] Deploying to Theta EdgeCloud..." -ForegroundColor Yellow
Write-Host ""
Write-Host "⚠️  Theta EdgeCloud API integration needed" -ForegroundColor Yellow
Write-Host "   Please provide:" -ForegroundColor White
Write-Host "   1. Theta EdgeCloud API endpoint URL" -ForegroundColor White
Write-Host "   2. API documentation or CLI tool" -ForegroundColor White
Write-Host ""

Write-Host "✅ Credentials are ready for deployment:" -ForegroundColor Green
if ($ThetaApiKey -and $ThetaApiKey.Length -gt 0) {
    $keyPreview = if ($ThetaApiKey.Length -gt 10) { $ThetaApiKey.Substring(0, 10) + "..." } else { $ThetaApiKey }
    $keyLen = $ThetaApiKey.Length
    Write-Host "   - Theta API Key: $keyPreview - $keyLen chars" -ForegroundColor White
} else {
    Write-Host "   - Theta API Key: ERROR - Not loaded" -ForegroundColor Red
}
$ecrLen = $EcrPassword.Length
Write-Host "   - ECR Password: Available - $ecrLen chars" -ForegroundColor White
Write-Host "   - Image: $($CONFIG.EcrRegistry)/$($CONFIG.ImageName)" -ForegroundColor White
Write-Host ""

Write-Host "💡 Options to complete deployment:" -ForegroundColor Cyan
Write-Host ""
Write-Host "Option A: Use Theta CLI (if available)" -ForegroundColor Yellow
Write-Host "  theta-edge deploy \" -ForegroundColor White
Write-Host "    --name $($CONFIG.DeploymentName) \" -ForegroundColor White
Write-Host "    --image $($CONFIG.EcrRegistry)/$($CONFIG.ImageName) \" -ForegroundColor White
Write-Host "    --gpu nvidia-rtx4090 \" -ForegroundColor White
Write-Host "    --env SP1_PROVER=cuda \" -ForegroundColor White
Write-Host "    --port 8080:8080" -ForegroundColor White
Write-Host ""

Write-Host "Option B: Use Theta EdgeCloud Web API" -ForegroundColor Yellow
Write-Host "  curl -X POST https://api.edgecloud.thetatoken.org/v1/deployments \" -ForegroundColor White
Write-Host "    -H 'Authorization: Bearer $ThetaApiKey' \" -ForegroundColor White
Write-Host "    -H 'Content-Type: application/json' \" -ForegroundColor White
Write-Host "    -d @deployment-config.json" -ForegroundColor White
Write-Host ""

Write-Host "Option C: Deploy to your own GPU server" -ForegroundColor Yellow
Write-Host "  ssh your-gpu-server" -ForegroundColor White
Write-Host "  docker run -d --gpus all -p 8080:8080 \" -ForegroundColor White
Write-Host "    -e SP1_PROVER=cuda \" -ForegroundColor White
Write-Host "    $($CONFIG.EcrRegistry)/$($CONFIG.ImageName)" -ForegroundColor White
Write-Host ""

# Save config to file for manual deployment
$DeploymentConfig | ConvertTo-Json -Depth 10 | Out-File "deployment-config.json" -Encoding UTF8
Write-Host "📄 Deployment config saved to: deployment-config.json" -ForegroundColor Green
Write-Host ""

Write-Host "What do you need to proceed?" -ForegroundColor Cyan
Write-Host "  1. Theta EdgeCloud API documentation?" -ForegroundColor White
Write-Host "  2. Access to a GPU server?" -ForegroundColor White
Write-Host "  3. Help with manual dashboard deployment?" -ForegroundColor White
