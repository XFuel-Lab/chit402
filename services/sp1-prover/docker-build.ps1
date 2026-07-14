# PowerShell script to build and run SP1 prover in Docker
$ErrorActionPreference = "Stop"

Write-Host "[Docker] Building SP1 Prover..." -ForegroundColor Cyan
Write-Host ""

# Check if Docker is running
try {
    docker info | Out-Null
} catch {
    Write-Host "[ERROR] Docker is not running!" -ForegroundColor Red
    Write-Host "Please start Docker Desktop and try again." -ForegroundColor Yellow
    exit 1
}

Write-Host "[OK] Docker is running" -ForegroundColor Green

# Build the image
Write-Host ""
Write-Host "[Docker] Building image (this will take 10-15 minutes first time)..." -ForegroundColor Cyan
docker-compose build

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Docker build failed" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[SUCCESS] Docker image built!" -ForegroundColor Green
Write-Host ""
Write-Host "To start the prover:" -ForegroundColor Cyan
Write-Host "  docker-compose up -d" -ForegroundColor White
Write-Host ""
Write-Host "To test:" -ForegroundColor Cyan
Write-Host "  curl -X POST http://localhost:8080/health" -ForegroundColor White
