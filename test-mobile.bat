@echo off
REM XFuel Mobile App - Quick Testing Script (Windows)
REM Run this script to quickly test the mobile app on your device

echo ========================================
echo XFUEL Mobile App - Quick Test
echo ========================================
echo.

REM Check if we're in the right directory
if not exist "edgefarm-mobile" (
  echo [ERROR] edgefarm-mobile directory not found
  echo         Please run this script from the xfuel-protocol root directory
  exit /b 1
)

cd edgefarm-mobile

REM Check if dependencies are installed
if not exist "node_modules" (
  echo [INFO] Installing dependencies...
  call npm install
)

echo [OK] Dependencies installed
echo.

REM Start Expo dev server
echo [INFO] Starting Expo dev server...
echo.
echo Next steps:
echo 1. Scan the QR code with Expo Go app (iOS/Android)
echo 2. Install Theta Wallet app if not already installed
echo 3. Test the following:
echo.
echo    - Tap 'Connect Wallet' on SwapScreen
echo    - Check if deep link opens Theta Wallet
echo    - Approve connection in Theta Wallet
echo    - Verify balance displays correctly
echo    - Adjust swap amount slider (feel haptic feedback)
echo    - Execute test swap
echo    - See confetti on success
echo    - Pull-to-refresh on HomeScreen
echo.
echo [INFO] Opening Expo dev server...
echo.

call npm run start

