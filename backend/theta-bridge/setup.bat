@echo off
echo ========================================
echo Theta-Persistence ZK Bridge Setup
echo ========================================
echo.

REM Step 1: Check Node.js
echo [1/5] Checking Node.js...
node --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js not found!
    echo Install from: https://nodejs.org/
    pause
    exit /b 1
)
node --version
echo.

REM Step 2: Check Dependencies
echo [2/5] Checking dependencies...
if not exist node_modules (
    echo Installing dependencies...
    call npm install --package-lock=false
    if %ERRORLEVEL% NEQ 0 (
        echo ERROR: Failed to install dependencies
        pause
        exit /b 1
    )
)
echo Dependencies OK
echo.

REM Step 3: Check Redis
echo [3/5] Checking Redis...
where redis-server >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo WARNING: Redis not found!
    echo.
    echo Redis is required for the bridge service.
    echo.
    echo Option 1 - Install Redis (Recommended):
    echo   winget install Redis.Redis.RedisInsight
    echo   Or download from: https://github.com/redis-windows/redis-windows/releases
    echo.
    echo Option 2 - Use Memurai (Redis alternative for Windows):
    echo   Download from: https://www.memurai.com/
    echo.
    echo After installing, run this script again.
    echo.
    pause
    exit /b 1
)
echo Redis found
echo.

REM Step 4: Check .env
echo [4/5] Checking configuration...
if not exist .env (
    echo Creating .env from template...
    copy env.example .env >nul
    echo.
    echo IMPORTANT: You need to configure .env file!
    echo.
    echo Required settings:
    echo   1. VAULT_FACTORY_ADDRESS - Deploy the contract first
    echo   2. RELAYER_PRIVATE_KEY - Your wallet private key for refunds
    echo.
    echo Press any key to open .env for editing...
    pause >nul
    notepad .env
)
echo Configuration file exists
echo.

REM Step 5: Validate .env
echo [5/5] Validating configuration...
findstr /C:"VAULT_FACTORY_ADDRESS=0x1234" .env >nul
if %ERRORLEVEL% EQU 0 (
    echo.
    echo ERROR: .env still has default values!
    echo.
    echo You need to:
    echo   1. Deploy VaultFactory contract first
    echo   2. Update VAULT_FACTORY_ADDRESS in .env
    echo   3. Add your RELAYER_PRIVATE_KEY
    echo.
    echo Opening .env for editing...
    notepad .env
    echo.
    echo After configuration, run this script again.
    pause
    exit /b 1
)
echo Configuration looks good
echo.

echo ========================================
echo Setup Complete!
echo ========================================
echo.
echo Next steps:
echo.
echo 1. Start Redis:
echo    redis-server
echo.
echo 2. In a new terminal, start the bridge:
echo    npm run dev
echo.
echo 3. Check health:
echo    curl http://localhost:3001/health
echo.
echo 4. Run E2E test:
echo    node test-e2e-quick.js
echo.
pause

