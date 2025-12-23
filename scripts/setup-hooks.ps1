# Setup Git Hooks for Windows
# This script ensures git hooks are properly configured

Write-Host "Setting up git hooks..." -ForegroundColor Cyan

$hooksDir = ".git\hooks"
$preCommit = "$hooksDir\pre-commit"
$prePush = "$hooksDir\pre-push"

# Check if hooks directory exists
if (-not (Test-Path $hooksDir)) {
    Write-Host "Creating hooks directory..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $hooksDir -Force | Out-Null
}

# Check if hooks exist
if (-not (Test-Path $preCommit)) {
    Write-Host "WARNING: pre-commit hook not found!" -ForegroundColor Red
    Write-Host "Expected location: $preCommit" -ForegroundColor Yellow
} else {
    Write-Host "✓ pre-commit hook found" -ForegroundColor Green
}

if (-not (Test-Path $prePush)) {
    Write-Host "WARNING: pre-push hook not found!" -ForegroundColor Red
    Write-Host "Expected location: $prePush" -ForegroundColor Yellow
} else {
    Write-Host "✓ pre-push hook found" -ForegroundColor Green
}

Write-Host ""
Write-Host "Note: On Windows, git hooks should work automatically with Git Bash." -ForegroundColor Cyan
Write-Host "If you're using PowerShell or CMD, ensure you have Git Bash installed." -ForegroundColor Cyan
Write-Host ""
Write-Host "To test hooks:" -ForegroundColor Cyan
Write-Host "  1. Make a change to a file" -ForegroundColor White
Write-Host "  2. Try: git commit -m 'test'" -ForegroundColor White
Write-Host "  3. You should be prompted to type YES" -ForegroundColor White
Write-Host ""

