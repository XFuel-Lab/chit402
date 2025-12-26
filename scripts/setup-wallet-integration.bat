@echo off
REM XFuel Protocol - Wallet Integration Setup Script (Windows)

echo.
echo ============================================
echo  XFuel Protocol - Wallet Integration Setup
echo ============================================
echo.

REM Check Node.js
echo Checking Node.js...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Please install Node.js 18+
    exit /b 1
)
node --version
echo.

REM Check npm
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] npm not found
    exit /b 1
)
npm --version
echo.

REM Install dependencies
echo Installing dependencies...
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install dependencies
    exit /b 1
)
echo.

REM Check for .env file
echo Checking environment variables...
if not exist ".env.local" (
    echo [WARNING] .env.local not found. Creating from template...
    (
        echo # WalletConnect v2 Project ID
        echo # Get yours at: https://cloud.walletconnect.com
        echo VITE_WALLETCONNECT_PROJECT_ID=your_project_id_here
        echo.
        echo # Theta Network Configuration
        echo VITE_THETA_MAINNET_RPC=https://eth-rpc-api.thetatoken.org/rpc
        echo VITE_THETA_TESTNET_RPC=https://eth-rpc-api-testnet.thetatoken.org/rpc
        echo.
        echo # Use testnet for development
        echo VITE_USE_TESTNET=true
    ) > .env.local
    echo [INFO] Please update .env.local with your WalletConnect Project ID
) else (
    echo [OK] .env.local found
)
echo.

REM Run TypeScript check
echo Checking TypeScript...
call npx tsc --noEmit
if %errorlevel% neq 0 (
    echo [WARNING] TypeScript errors detected
)
echo.

REM Run tests
echo Running unit tests...
call npm test -- src/utils/__tests__/
echo.

REM Setup mobile (if exists)
if exist "edgefarm-mobile" (
    echo Setting up mobile app...
    cd edgefarm-mobile
    
    if not exist "node_modules" (
        echo Installing mobile dependencies...
        call npm install
    ) else (
        echo [OK] Mobile dependencies already installed
    )
    
    cd ..
    echo.
)

REM Setup complete
echo.
echo ============================================
echo [SUCCESS] Setup complete!
echo ============================================
echo.
echo Next steps:
echo.
echo 1. Update .env.local with your WalletConnect Project ID
echo    Get one at: https://cloud.walletconnect.com
echo.
echo 2. Start the development server:
echo    npm run dev
echo.
echo 3. Test wallet integration:
echo    npm test
echo.
echo 4. Run E2E tests:
echo    npm run cypress:open
echo.
echo 5. Test mobile app (if using):
echo    cd edgefarm-mobile ^&^& npm start
echo.
echo Documentation: docs/THETA_WALLET_INTEGRATION_GUIDE.md
echo.
echo Happy building!
echo ============================================
echo.

pause

