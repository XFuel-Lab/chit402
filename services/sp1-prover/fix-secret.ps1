# Fix SP1_PRIVATE_KEY Secret Format
# The secret is stored as JSON but needs to be plain text

# Load credentials
$envPath = "../.env.local"
Get-Content $envPath | ForEach-Object {
    if ($_ -match '^AWS_ACCESS_KEY_ID=(.+)$') { $env:AWS_ACCESS_KEY_ID = $matches[1] }
    if ($_ -match '^AWS_SECRET_ACCESS_KEY=(.+)$') { $env:AWS_SECRET_ACCESS_KEY = $matches[1] }
    if ($_ -match '^SP1_PRIVATE_KEY=(.+)$') { $script:sp1KeyArn = $matches[1] }
}

$region = "us-east-1"

Write-Host "`nFixing SP1_PRIVATE_KEY secret format...`n" -ForegroundColor Cyan

# Get current secret value
Write-Host "[1/3] Getting current secret..." -ForegroundColor Yellow
$secretJson = cmd /c "aws secretsmanager get-secret-value --secret-id $sp1KeyArn --region $region --query SecretString --output text"

Write-Host "     Current format: $($secretJson.Substring(0, 50))..." -ForegroundColor Gray

# Extract the actual key value if it's JSON
$actualKey = $secretJson
if ($secretJson.StartsWith("{")) {
    $parsed = $secretJson | ConvertFrom-Json
    if ($parsed.SP1_PRIVATE_KEY) {
        $actualKey = $parsed.SP1_PRIVATE_KEY
    } elseif ($parsed.key) {
        $actualKey = $parsed.key
    }
}

Write-Host "     Extracted key: $($actualKey.Substring(0, 20))..." -ForegroundColor Green

# Update secret to plain text
Write-Host "`n[2/3] Updating secret to plain text format..." -ForegroundColor Yellow
$updateResult = cmd /c "aws secretsmanager update-secret --secret-id $sp1KeyArn --secret-string $actualKey --region $region 2>&1"
Write-Host "     Secret updated!" -ForegroundColor Green

# Force new deployment to pick up the change
Write-Host "`n[3/3] Restarting ECS service..." -ForegroundColor Yellow
cmd /c "aws ecs update-service --cluster sp1-prover-cluster --service sp1-prover-service --force-new-deployment --region $region 2>&1" | Out-Null
Write-Host "     Service restarting..." -ForegroundColor Green

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "  Secret Fixed!" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Green

Write-Host "Wait 30 seconds for container to restart, then test:" -ForegroundColor Cyan
Write-Host "  curl.exe -X POST http://100.26.209.192:8080/prove -H `"Content-Type: application/json`" -d `"@test-data/deposit-1tfuel.json`"`n" -ForegroundColor White
