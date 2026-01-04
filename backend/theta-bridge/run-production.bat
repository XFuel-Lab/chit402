@echo off
REM Production run script for Theta-Persistence ZK Bridge with PM2 (Windows)

echo Starting Theta-Persistence ZK Bridge in production mode...

REM Check if .env exists
if not exist .env (
    echo Error: .env file not found!
    echo Please copy env.example to .env and configure it.
    exit /b 1
)

REM Install dependencies if needed
if not exist node_modules (
    echo Installing dependencies...
    call npm ci --only=production
)

REM Create logs directory
if not exist logs mkdir logs

REM Check if PM2 is installed
where pm2 >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo PM2 not found. Installing globally...
    call npm install -g pm2
)

REM Start with PM2
echo Starting service with PM2...
call pm2 start ecosystem.config.cjs

echo.
echo Service started! Available commands:
echo   pm2 logs theta-bridge    - View logs
echo   pm2 monit                - Monitor resources
echo   pm2 restart theta-bridge - Restart service
echo   pm2 stop theta-bridge    - Stop service
echo.

