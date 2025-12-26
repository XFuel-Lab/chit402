@echo off
REM XFuel Mobile - Real Device Testing Script
REM This script starts the Expo development server for testing on physical devices

echo ====================================
echo XFuel Mobile - Real Device Testing
echo ====================================
echo.
echo Prerequisites:
echo  - Expo Go app installed on your device
echo  - Device and computer on same WiFi network
echo.
echo After server starts:
echo  1. Open Expo Go on your device
echo  2. Scan the QR code that appears
echo  3. App will load in 30-60 seconds
echo.
echo ====================================
echo.

REM Check if we're in the right directory
if not exist "package.json" (
    echo Error: package.json not found!
    echo Please run this script from the edgefarm-mobile directory
    pause
    exit /b 1
)

REM Check if node_modules exists
if not exist "node_modules" (
    echo node_modules not found. Running npm install...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo Error: npm install failed!
        pause
        exit /b 1
    )
    echo.
    echo Installation complete!
    echo.
)

echo Starting Expo development server...
echo.
echo TIP: Press Ctrl+C to stop the server when done testing
echo.

REM Start the Expo server
call npm start

pause

