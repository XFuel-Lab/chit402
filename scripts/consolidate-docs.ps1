# Documentation Consolidation Script
# Merges redundant deployment and wallet guides into unified docs

Write-Host "Consolidating XFuel Documentation..." -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""

# Files to archive (move to docs/archive/)
$filesToArchive = @(
    "DEPLOYMENT_CHECKLIST.md",
    "DEPLOYMENT_CHECKLIST_WALLET_INTEGRATION.md",
    "DEPLOYMENT_GUIDE.md",
    "DEPLOYMENT_INSTRUCTIONS.md",
    "WALLET_INTEGRATION_README.md",
    "THETA_WALLET_QUICKSTART.md",
    "docs\DEPLOYMENT_THETA_WALLET.md",
    "docs\DEPLOYMENT_CHECKLIST_V2.md",
    "docs\WALLET_INTEGRATION_SUMMARY.md",
    "docs\THETA_WALLET_INTEGRATION.md",
    "docs\THETA_WALLET_INTEGRATION_GUIDE.md"
)

# Create archive directory
$archiveDir = "docs\archive"
if (-not (Test-Path $archiveDir)) {
    New-Item -ItemType Directory -Path $archiveDir -Force | Out-Null
    Write-Host "Created archive directory: $archiveDir" -ForegroundColor Green
}

$archivedCount = 0
$notFoundCount = 0

foreach ($file in $filesToArchive) {
    if (Test-Path $file) {
        $fileName = Split-Path $file -Leaf
        $destPath = Join-Path $archiveDir $fileName
        
        try {
            Move-Item $file $destPath -Force
            Write-Host "Archived: $file → $destPath" -ForegroundColor Green
            $archivedCount++
        } catch {
            Write-Host "Failed to archive: $file" -ForegroundColor Red
            Write-Host "   Error: $_" -ForegroundColor Red
        }
    } else {
        Write-Host "Not found: $file" -ForegroundColor Yellow
        $notFoundCount++
    }
}

Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "Archived: $archivedCount files" -ForegroundColor Green
Write-Host "Not found: $notFoundCount files" -ForegroundColor Yellow
Write-Host ""
Write-Host "Unified Documentation:" -ForegroundColor Cyan
Write-Host "   - docs/UNIFIED_DEPLOYMENT_GUIDE.md (NEW - Read this first!)" -ForegroundColor Green
Write-Host "   - docs/WALLETCONNECT_V2_GUIDE.md (WalletConnect specifics)" -ForegroundColor Green
Write-Host "   - README.md (Quick start + overview)" -ForegroundColor Green
Write-Host ""
Write-Host "Old docs moved to: docs/archive/" -ForegroundColor Yellow
Write-Host ""

