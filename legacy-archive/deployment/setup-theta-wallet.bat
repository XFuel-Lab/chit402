@echo off
REM Theta Wallet Integration Setup Script for Windows
REM Automates installation for both mobile and web

echo.
echo 🚀 XFuel Protocol - Theta Wallet Integration Setup
echo ==================================================
echo.

REM Check if we're in the right directory
if not exist "package.json" (
    echo ❌ Error: Must run from project root
    exit /b 1
)

echo 📦 Installing web dependencies...
call npm install

echo.
echo 📱 Installing mobile dependencies...
cd edgefarm-mobile
call npm install
cd ..

echo.
echo ⚙️  Configuring environment...

REM Check for WalletConnect Project ID
if not exist ".env.local" (
    echo Creating .env.local...
    (
        echo # WalletConnect v2 Project ID
        echo # Get yours at: https://cloud.walletconnect.com
        echo VITE_WALLETCONNECT_PROJECT_ID=d132d658c164146b2546d5cd1ede0595
    ) > .env.local
    echo ✅ Created .env.local with fallback Project ID
    echo ⚠️  For production, get your own Project ID at https://cloud.walletconnect.com
) else (
    echo ✅ .env.local already exists
)

echo.
echo 🧪 Running tests...
call npm test -- --passWithNoTests

echo.
echo 🔍 Checking mobile configuration...

REM Check app.json for deep link schemes
findstr /C:"thetawallet" edgefarm-mobile\app.json > nul
if %ERRORLEVEL% EQU 0 (
    echo ✅ Deep link schemes configured
) else (
    echo ❌ Deep link schemes not found in app.json
    exit /b 1
)

echo.
echo ✅ Setup Complete!
echo.
echo ==================================================
echo 🎯 Next Steps:
echo ==================================================
echo.
echo 📱 Mobile Development:
echo    cd edgefarm-mobile
echo    npm run android
echo.
echo 🌐 Web Development:
echo    npm run dev
echo.
echo 🧪 Run Tests:
echo    npm test                    # Jest unit tests
echo    npm run test:e2e            # Cypress E2E tests
echo.
echo 📚 Documentation:
echo    docs\THETA_WALLET_INTEGRATION.md    # Complete guide
echo    docs\DEPLOYMENT_THETA_WALLET.md     # Deployment guide
echo    INTEGRATION_SUMMARY.md              # Implementation summary
echo.
echo 🔧 Configuration:
echo    - Web: Set VITE_WALLETCONNECT_PROJECT_ID in .env.local
echo    - Mobile: Update routerAddress in edgefarm-mobile\app.json extra config
echo.
echo Happy coding! 🚀

