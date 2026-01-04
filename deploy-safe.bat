@echo off
REM Quick E2E Testing Deployment for Safe Wallet
REM This script helps you deploy with Safe + MetaMask

echo.
echo =====================================================================
echo           XFUEL E2E Testing - Safe Wallet Deployment
echo =====================================================================
echo.
echo Your Wallets:
echo   Deployer: 0xEb4f292E2f1E5Ff1d3B1aEe6E02794b5fc40e698 (Safe)
echo   Relayer:  0xDC17Cbd201E7347555e428690f702bbFcAF2d33c (Theta)
echo.
echo This script will:
echo   1. Check prerequisites
echo   2. Install/check Redis
echo   3. Guide you through contract deployment (via Remix + Safe)
echo   4. Configure backend automatically
echo   5. Start services
echo.
echo Press Ctrl+C to cancel, or
pause

echo.
echo Starting deployment helper...
echo.

powershell -ExecutionPolicy Bypass -File deploy-e2e-manual.ps1

echo.
echo =====================================================================
echo.
pause

