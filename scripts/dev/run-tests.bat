@echo off
REM Quick E2E Test Runner
REM Run this to execute E2E tests

echo.
echo =====================================================================
echo           XFUEL E2E Testing - Test Runner
echo =====================================================================
echo.
echo Select test mode:
echo   1. Interactive (opens Cypress UI)
echo   2. Headless (runs all tests)
echo   3. Backend tests only
echo   4. Frontend tests only
echo   5. Visual tests (Memarai)
echo.

set /p choice="Enter choice (1-5): "

if "%choice%"=="1" (
    echo.
    echo Running interactive tests...
    powershell -ExecutionPolicy Bypass -File "%~dp0run-e2e-tests.ps1"
) else if "%choice%"=="2" (
    echo.
    echo Running headless tests...
    powershell -ExecutionPolicy Bypass -File "%~dp0run-e2e-tests.ps1" -Headless
) else if "%choice%"=="3" (
    echo.
    echo Running backend tests...
    powershell -ExecutionPolicy Bypass -File "%~dp0run-e2e-tests.ps1" -Suite backend
) else if "%choice%"=="4" (
    echo.
    echo Running frontend tests...
    powershell -ExecutionPolicy Bypass -File "%~dp0run-e2e-tests.ps1" -Suite frontend
) else if "%choice%"=="5" (
    echo.
    echo Running visual tests...
    powershell -ExecutionPolicy Bypass -File "%~dp0run-e2e-tests.ps1" -Suite visual -Headless
) else (
    echo Invalid choice!
    pause
    exit /b 1
)

echo.
echo =====================================================================
echo Tests complete! Check results in:
echo   - cypress/videos/
echo   - cypress/screenshots/
echo   - e2e-test-report-*.json
echo =====================================================================
echo.
pause

