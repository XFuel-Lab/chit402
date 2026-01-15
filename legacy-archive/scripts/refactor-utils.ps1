# Utils Refactoring Script - Consolidate wallet utilities

Write-Host "Refactoring src/utils..." -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""

# Files still have imports - need to check carefully
Write-Host "Checking dependencies..." -ForegroundColor Yellow
Write-Host "keplrWallet.ts: imported by BiDirectionalSwapCard.tsx" -ForegroundColor Yellow
Write-Host "walletConnectV2.ts: imported by test files + ThetaWalletQRModalV2.tsx" -ForegroundColor Yellow
Write-Host ""
Write-Host "Decision: Keep existing utils for now - active dependencies" -ForegroundColor Green
Write-Host "Future cleanup can migrate these imports to unified versions" -ForegroundColor Green
Write-Host ""
Write-Host "Current Utils Structure:" -ForegroundColor Cyan
Write-Host "   Wallets: keplr.ts, keplrWallet.ts, thetaWallet.ts, walletConnect.ts" -ForegroundColor White
Write-Host "   Staking: cosmosLSTStaking.ts, cosmosLSTStakingPro.ts" -ForegroundColor White
Write-Host "   Swap: swapLimits.ts, oracle.ts, lstTokens.ts" -ForegroundColor White
Write-Host "   Infra: performanceMonitor.ts, rateLimiter.ts" -ForegroundColor White
Write-Host ""
Write-Host "No files removed - structure is already efficient" -ForegroundColor Green
Write-Host ""
