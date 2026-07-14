# Check ECS Logs
# Loads AWS credentials and tails logs

# Load credentials
$envPath = "../.env.local"
Get-Content $envPath | ForEach-Object {
    if ($_ -match '^AWS_ACCESS_KEY_ID=(.+)$') { $env:AWS_ACCESS_KEY_ID = $matches[1] }
    if ($_ -match '^AWS_SECRET_ACCESS_KEY=(.+)$') { $env:AWS_SECRET_ACCESS_KEY = $matches[1] }
}

Write-Host "`nTailing ECS logs (press Ctrl+C to stop)...`n" -ForegroundColor Cyan
aws logs tail /ecs/sp1-prover --follow --region us-east-1
