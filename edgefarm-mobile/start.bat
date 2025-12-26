@echo off
REM XFuel Protocol Mobile - Setup Script (Windows)
REM Installs dependencies and starts development server

echo.
echo 🚀 XFuel Protocol Mobile - Interstellar Setup
echo ==============================================
echo.

REM Check Node.js
echo 📋 Checking prerequisites...
node -v >nul 2>&1
if errorlevel 1 (
  echo ❌ Error: Node.js not found. Install from https://nodejs.org
  pause
  exit /b 1
)

echo ✅ Node.js version:
node -v
echo ✅ npm version:
npm -v
echo.

REM Navigate to mobile directory
echo 📁 Navigating to edgefarm-mobile...
cd /d "%~dp0"
echo.

REM Install dependencies
echo 📦 Installing dependencies...
echo    This may take 2-3 minutes...
call npm install

if errorlevel 1 (
  echo ❌ Installation failed. Please check errors above.
  pause
  exit /b 1
)

echo.
echo ✅ Dependencies installed successfully!
echo.

REM Start development server
echo 🎯 Starting Expo development server...
echo.
echo 📱 Next steps:
echo    1. Install Expo Go on your phone (iOS/Android^)
echo    2. Scan the QR code that appears
echo    3. Or press 'i' for iOS Simulator, 'a' for Android Emulator
echo.
echo 🌌 Launching to interstellar space in 3... 2... 1...
echo.

call npm start

if errorlevel 1 (
  echo.
  echo ❌ Failed to start development server.
  echo    Try: npm start -- --clear
  pause
  exit /b 1
)

