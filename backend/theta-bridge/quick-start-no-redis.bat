@echo off
echo ========================================
echo Quick Start - Theta Bridge (No Redis)
echo ========================================
echo.
echo This starts the bridge WITHOUT Redis for quick testing.
echo Some features will be limited:
echo   - No vault mapping storage
echo   - Cannot track deposit status
echo   - Refunds won't work properly
echo.
echo For full functionality, install Redis and use setup.bat
echo.
pause

REM Check dependencies
if not exist node_modules (
    echo Installing dependencies...
    call npm install --package-lock=false
)

REM Check .env
if not exist .env (
    echo Creating .env...
    copy env.example .env
    echo.
    echo CONFIGURE .env FILE:
    echo   - VAULT_FACTORY_ADDRESS
    echo   - RELAYER_PRIVATE_KEY
    echo.
    notepad .env
)

echo.
echo Starting bridge service...
echo Press Ctrl+C to stop
echo.

npm run dev

