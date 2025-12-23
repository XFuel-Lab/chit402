@echo off
echo ========================================
echo   XFUEL Protocol - Local Development
echo ========================================
echo.

REM Check if Node.js is installed
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo [1/3] Checking dependencies...
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Failed to install dependencies
        pause
        exit /b 1
    )
) else (
    echo Dependencies OK
)

echo.
echo [2/3] Starting Backend API Server (Port 3001)...
start "XFUEL Backend" cmd /k "title XFUEL Backend && npm run dev:backend"
timeout /t 3 /nobreak >nul

echo.
echo [3/3] Starting Frontend Dev Server (Port 5173)...
start "XFUEL Frontend" cmd /k "title XFUEL Frontend && npm run dev"

echo.
echo ========================================
echo   Servers Starting...
echo ========================================
echo.
echo Backend API:  http://localhost:3001
echo Frontend:     http://localhost:5173
echo.
echo Health Check: http://localhost:3001/health
echo.
echo ========================================
echo   Next Steps:
echo ========================================
echo 1. Wait for both servers to start (watch the windows)
echo 2. Open browser: http://localhost:5173
echo 3. Connect your Theta Wallet
echo 4. Try a swap!
echo.
echo Press any key to close this window...
echo (Servers will keep running in separate windows)
pause >nul

