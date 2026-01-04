@echo off
REM Development run script for Theta-Persistence ZK Bridge (Windows)

echo Starting Theta-Persistence ZK Bridge in development mode...

REM Check if .env exists
if not exist .env (
    echo Error: .env file not found!
    echo Please copy env.example to .env and configure it.
    exit /b 1
)

REM Check if node_modules exists
if not exist node_modules (
    echo Installing dependencies...
    call npm install
)

REM Create logs directory
if not exist logs mkdir logs

REM Start the service
echo Starting service...
call npm run dev

