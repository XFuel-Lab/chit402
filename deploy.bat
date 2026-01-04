@echo off
REM Quick E2E Testing Deployment
REM Run this to start E2E testing setup

echo.
echo =====================================================================
echo           XFUEL E2E Testing - Quick Deploy
echo =====================================================================
echo.
echo This will deploy everything you need for E2E testing:
echo   - Redis installation check
echo   - VaultFactory contract deployment
echo   - Backend configuration
echo   - Service startup
echo   - Health checks
echo.
echo Press Ctrl+C to cancel, or
pause

echo.
echo Starting deployment...
echo.

powershell -ExecutionPolicy Bypass -File deploy-e2e-testing.ps1

echo.
echo =====================================================================
echo Deployment complete!
echo.
echo Next step: Run tests with:
echo   run-tests.bat
echo.
echo Or manually:
echo   powershell -File run-e2e-tests.ps1
echo =====================================================================
echo.
pause

