@echo off
REM XFuel Mobile - Real Device Testing Launcher (Windows)
REM This script helps you quickly start testing on a real device

echo ========================================
echo XFUEL Mobile - Real Device Testing
echo ========================================
echo.

REM Check if we're in the right directory
if not exist "edgefarm-mobile" (
  echo [ERROR] edgefarm-mobile directory not found
  echo         Run this from xfuel-protocol root: test-real-device.bat
  exit /b 1
)

cd edgefarm-mobile

echo Pre-flight Checklist:
echo ========================================
echo.
echo Before starting, make sure you have:
echo   - Physical iOS or Android device
echo   - Expo Go app installed on device
echo   - Theta Wallet app installed on device
echo   - Both computer and device on same WiFi
echo.

REM Check if node_modules exists
if not exist "node_modules" (
  echo [INFO] Installing dependencies (this may take a few minutes)...
  call npm install
  echo [OK] Dependencies installed!
  echo.
)

REM Check for .env file
if not exist ".env" (
  echo [WARN] No .env file found. Creating one...
  echo EXPO_PUBLIC_API_URL=http://localhost:3001 > .env
  echo [OK] Created .env file
  echo.
)

echo Testing Instructions:
echo ========================================
echo.
echo 1. A QR code will appear in your terminal
echo 2. On iOS: Open Camera app and scan QR
echo    On Android: Open Expo Go and tap 'Scan QR code'
echo.
echo 3. Test these features (see REAL_DEVICE_TESTING.md):
echo    - Navigation (swipe between tabs)
echo    - Wallet connection (deep link to Theta Wallet)
echo    - Haptic feedback (drag sliders, tap buttons)
echo    - Swap flow (execute test swap)
echo    - Pull-to-refresh (on Home screen)
echo.
echo 4. Watch this terminal for logs:
echo    [OK] = Success ^| [WARN] = Warning ^| [ERROR] = Error
echo.

REM Ask user if ready
echo ========================================
set /p ready="Ready to start? (y/n): "

if /i not "%ready%"=="y" (
  echo Cancelled. Run this script again when ready!
  exit /b 0
)

echo.
echo [INFO] Starting Expo dev server...
echo ========================================
echo.

REM Start Expo with specific settings for testing
set EXPO_DEVTOOLS_LISTEN_ADDRESS=0.0.0.0
call npm start

REM This will keep running until you press Ctrl+C

