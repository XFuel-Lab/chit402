@echo off
REM Quick setup script for XFUEL Protocol (Windows)

echo ========================================
echo XFUEL Protocol - Environment Setup
echo ========================================
echo.

REM Check if .env file exists
if exist .env goto :found
if exist .env.local goto :found

echo [WARNING] No environment file found. Creating .env.local...
echo.

REM Create .env.local with router address
(
echo # XFUEL Protocol - Environment Configuration
echo # Theta Mainnet Router Address ^(REQUIRED^)
echo VITE_ROUTER_ADDRESS=0x6256D8A728aA102Aa06B6B239ba1247Bd835d816
echo.
echo # API URL ^(optional, defaults to localhost:3001^)
echo VITE_API_URL=http://localhost:3001
echo.
echo # Network ^(optional, defaults to mainnet^)
echo VITE_NETWORK=mainnet
) > .env.local

echo [SUCCESS] Created .env.local with router address
echo.
goto :config

:found
echo [OK] Environment file found
echo.

:config
echo ========================================
echo Current Configuration:
echo ========================================
if exist .env.local (
    echo File: .env.local
    findstr "VITE_ROUTER_ADDRESS" .env.local
) else if exist .env (
    echo File: .env
    findstr "VITE_ROUTER_ADDRESS" .env
)
echo.

echo ========================================
echo Next Steps:
echo ========================================
echo 1. Restart your dev server ^(npm run dev^)
echo 2. Check browser console for: [XFUEL Config] Router address loaded
echo 3. Try the swap again
echo.
echo For more help, see: ROUTER_CONFIG_FIX.md
echo.
pause

