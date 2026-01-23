# Deploy SP1 Prover to Theta EdgeCloud via API
# This script uses your THETA_API_KEY from AWS Secrets Manager

$ErrorActionPreference = "Stop"

Write-Host "`n🚀 Deploying to Theta EdgeCloud via API...`n" -ForegroundColor Cyan

# Load .env.local from project root
$envPath = Join-Path (Split-Path $PSScriptRoot) ".env.local"
if (Test-Path $envPath) {
    Write-Host "Loading environment from .env.local..." -ForegroundColor Cyan
    Get-Content $envPath | ForEach-Object {
        if ($_ -match '^THETA_API_KEY=(.+)$') {
            $env:THETA_API_KEY = $matches[1]
        }
        if ($_ -match '^AWS_REGION=(.+)$') {
            $env:AWS_REGION = $matches[1]
        }
    }
}

# Step 1: Get Theta API key from AWS Secrets Manager
Write-Host "[1/4] Fetching Theta API key from AWS Secrets Manager..." -ForegroundColor Yellow

$thetaApiKeyArn = $env:THETA_API_KEY
if (-not $thetaApiKeyArn) {
    Write-Host "❌ THETA_API_KEY not set in environment!" -ForegroundColor Red
    exit 1
}

try {
    $secretString = aws secretsmanager get-secret-value `
        --secret-id $thetaApiKeyArn `
        --region us-east-1 `
        --query SecretString `
        --output text
    
    # Try to parse as JSON
    try {
        $secretJson = $secretString | ConvertFrom-Json
        if ($secretJson.THETA_API_KEY) {
            $thetaApiKey = $secretJson.THETA_API_KEY
        } elseif ($secretJson.api_key) {
            $thetaApiKey = $secretJson.api_key
        } else {
            $thetaApiKey = $secretString
        }
    } catch {
        $thetaApiKey = $secretString
    }
    
    Write-Host "✅ API key loaded" -ForegroundColor Green
} catch {
    Write-Host "❌ Failed to fetch Theta API key: $_" -ForegroundColor Red
    exit 1
}

# Step 2: Get your project ID
Write-Host "`n[2/4] Getting project info..." -ForegroundColor Yellow
$projectId = "prj_1bizpatqufkpkni7bn134qht31z6"  # From your dashboard URL
Write-Host "   Project ID: $projectId" -ForegroundColor White

# Step 3: Deploy via Theta API
Write-Host "`n[3/4] Deploying container..." -ForegroundColor Yellow

$deploymentBody = @{
    name = "xfuel-sp1-prover"
    image = "xfuel/sp1-prover-cuda:latest"
    ports = @(
        @{
            containerPort = 80
            protocol = "tcp"
        }
    )
    env = @(
        @{ name = "SP1_PROVER"; value = "cuda" },
        @{ name = "RUST_LOG"; value = "info" },
        @{ name = "CUDA_VISIBLE_DEVICES"; value = "0" }
    )
    replicas = 1
    gpu = @{
        type = "nvidia"
        count = 1
    }
} | ConvertTo-Json -Depth 10

try {
    $response = curl.exe -X POST "https://api.thetaedgecloud.com/api/v1/projects/$projectId/deployments" `
        -H "x-api-key: $thetaApiKey" `
        -H "Content-Type: application/json" `
        -d $deploymentBody
    
    Write-Host "`nAPI Response:" -ForegroundColor Yellow
    Write-Host $response -ForegroundColor White
    
    $result = $response | ConvertFrom-Json
    
    Write-Host "`n✅ Deployment created!" -ForegroundColor Green
    Write-Host "   Deployment ID: $($result.id)" -ForegroundColor White
    Write-Host "   Full result:" -ForegroundColor Yellow
    Write-Host ($result | ConvertTo-Json -Depth 10) -ForegroundColor White
    
    # Step 4: Get endpoint
    Write-Host "`n[4/4] Getting endpoint..." -ForegroundColor Yellow
    Start-Sleep -Seconds 5
    
    $endpointResponse = curl.exe -X GET "https://api.thetaedgecloud.com/api/v1/projects/$projectId/deployments/$($result.id)" `
        -H "x-api-key: $thetaApiKey"
    
    $deploymentInfo = $endpointResponse | ConvertFrom-Json
    
    Write-Host "`n✅ SUCCESS! Deployment ready!" -ForegroundColor Green
    Write-Host "`nEndpoint: $($deploymentInfo.endpoint)" -ForegroundColor Yellow
    Write-Host "`nTest it:" -ForegroundColor Cyan
    Write-Host "  curl.exe $($deploymentInfo.endpoint)/health" -ForegroundColor White
    
} catch {
    Write-Host "❌ Deployment failed: $_" -ForegroundColor Red
    Write-Host "`nAPI Response: $response" -ForegroundColor Yellow
    exit 1
}
