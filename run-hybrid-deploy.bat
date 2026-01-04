@echo off
REM ############################################################################
REM XFuelLab Hybrid Deploy Script - Ferrari Tokenomics (Windows)
REM 
REM Automates Step 2: Theta Mainnet Deploy & Test
REM - Pre-flight validation
REM - Dry-run gas estimation
REM - User confirmation
REM - Actual deployment
REM - Post-deployment verification
REM
REM Usage:
REM   run-hybrid-deploy.bat              Interactive mode (default)
REM   run-hybrid-deploy.bat --auto       Auto mode (skips confirmations)
REM   run-hybrid-deploy.bat --dry-run    Dry-run only
REM ############################################################################

setlocal enabledelayedexpansion

REM Configuration
set "NETWORK=theta-mainnet"
set "SCRIPT_PATH=scripts\deploy-keystore.cjs"
set "MIN_BALANCE=0.5"

REM Parse arguments
set "AUTO_MODE=false"
set "DRY_RUN_ONLY=false"

:parse_args
if "%~1"=="" goto :done_parsing
if /i "%~1"=="--auto" (
    set "AUTO_MODE=true"
    shift
    goto :parse_args
)
if /i "%~1"=="--dry-run" (
    set "DRY_RUN_ONLY=true"
    shift
    goto :parse_args
)
if /i "%~1"=="--help" (
    echo Usage: %~nx0 [OPTIONS]
    echo.
    echo Options:
    echo   --auto      Skip confirmation prompts
    echo   --dry-run   Run gas estimation only (no deployment^)
    echo   --help      Show this help message
    exit /b 0
)
shift
goto :parse_args
:done_parsing

REM ############################################################################
REM Pre-Flight Checks
REM ############################################################################

echo.
echo ========================================
echo XFuelLab Hybrid Deploy - Pre-Flight Checks
echo ========================================
echo.

REM Check if deploy script exists
if not exist "%SCRIPT_PATH%" (
    echo [31m[ERROR] Deploy script not found: %SCRIPT_PATH%[0m
    echo [34m[INFO] Make sure you're in the xfuel-protocol root directory[0m
    exit /b 1
)
echo [32m[OK] Deploy script found[0m

REM Check if node_modules exist
if not exist "node_modules" (
    echo [33m[WARNING] node_modules not found[0m
    echo [34m[INFO] Running npm install...[0m
    call npm install
    if errorlevel 1 (
        echo [31m[ERROR] npm install failed[0m
        exit /b 1
    )
)
echo [32m[OK] Dependencies installed[0m

REM Check if .env.local exists
if not exist ".env.local" (
    echo [31m[ERROR] .env.local not found[0m
    echo [34m[INFO] Create .env.local with DEPLOYER_MAINNET_KEYSTORE_PATH and other secrets[0m
    exit /b 1
)
echo [32m[OK] .env.local found[0m

REM Check if keystore path is set (basic check)
findstr /C:"DEPLOYER_MAINNET_KEYSTORE_PATH" .env.local >nul 2>&1
if errorlevel 1 (
    echo [31m[ERROR] DEPLOYER_MAINNET_KEYSTORE_PATH not set in .env.local[0m
    exit /b 1
)
echo [32m[OK] Keystore configuration found[0m

REM Check if npx is available
where npx >nul 2>&1
if errorlevel 1 (
    echo [31m[ERROR] npx not found - install Node.js/npm[0m
    exit /b 1
)
echo [32m[OK] Hardhat CLI available[0m

REM ############################################################################
REM Dry-Run Gas Estimation
REM ############################################################################

echo.
echo ========================================
echo Step 1: Dry-Run Gas Estimation
echo ========================================
echo.

echo [34m[INFO] Running deployment simulation (no gas spent^)...[0m
echo.

call npx hardhat run "%SCRIPT_PATH%" --network %NETWORK% --dry-run
if errorlevel 1 (
    echo.
    echo [31m[ERROR] Dry-run failed[0m
    echo [34m[INFO] Check error messages above and fix issues before proceeding[0m
    exit /b 1
)

echo.
echo [32m[OK] Dry-run completed successfully[0m

REM If dry-run only mode, exit here
if "%DRY_RUN_ONLY%"=="true" (
    echo.
    echo ========================================
    echo Dry-Run Complete
    echo ========================================
    echo.
    echo [34m[INFO] Run without --dry-run flag to execute actual deployment[0m
    exit /b 0
)

REM ############################################################################
REM User Confirmation
REM ############################################################################

echo.
echo ========================================
echo Step 2: Confirm Deployment
echo ========================================
echo.

echo You are about to deploy VaultFactory to Theta Mainnet
echo.
echo Network:     %NETWORK%
echo Script:      %SCRIPT_PATH%
echo.
echo [33m[WARNING] This will spend TFUEL for gas fees[0m
echo.

if "%AUTO_MODE%"=="false" (
    set /p "CONFIRM=Proceed with deployment? (y/n): "
    if /i not "!CONFIRM!"=="y" (
        echo.
        echo [34m[INFO] Deployment cancelled by user[0m
        exit /b 0
    )
)

REM ############################################################################
REM Actual Deployment
REM ############################################################################

echo.
echo ========================================
echo Step 3: Deploying to Theta Mainnet
echo ========================================
echo.

echo [34m[INFO] Executing deployment script...[0m
echo.

call npx hardhat run "%SCRIPT_PATH%" --network %NETWORK%
if errorlevel 1 (
    echo.
    echo [31m[ERROR] Deployment failed[0m
    echo [34m[INFO] Check error messages above for details[0m
    exit /b 1
)

echo.
echo [32m[OK] Deployment completed successfully![0m

REM ############################################################################
REM Post-Deployment Verification
REM ############################################################################

echo.
echo ========================================
echo Step 4: Post-Deployment Verification
echo ========================================
echo.

REM Check if deployment info was saved
set "DEPLOYMENT_FILE=deployments\vaultfactory-361.json"
if exist "%DEPLOYMENT_FILE%" (
    echo [32m[OK] Deployment info saved: %DEPLOYMENT_FILE%[0m
    
    REM Extract VaultFactory address (simple grep for Windows)
    for /f "tokens=2 delims=:," %%a in ('findstr /C:"vaultFactory" "%DEPLOYMENT_FILE%"') do (
        set "VAULT_FACTORY_ADDR=%%a"
        set "VAULT_FACTORY_ADDR=!VAULT_FACTORY_ADDR:"=!"
        set "VAULT_FACTORY_ADDR=!VAULT_FACTORY_ADDR: =!"
    )
    
    if defined VAULT_FACTORY_ADDR (
        echo [32m[OK] VaultFactory deployed at: !VAULT_FACTORY_ADDR![0m
        echo.
        echo [34m[INFO] Explorer link:[0m
        echo https://explorer.thetatoken.org/address/!VAULT_FACTORY_ADDR!
        echo.
    )
) else (
    echo [33m[WARNING] Deployment info file not found[0m
)

REM Check if .env was updated
if exist ".env" (
    findstr /C:"VITE_VAULT_FACTORY_ADDRESS" .env >nul 2>&1
    if not errorlevel 1 (
        echo [32m[OK] .env updated with VaultFactory address[0m
    ) else (
        echo [33m[WARNING] .env not updated (may need manual update^)[0m
    )
)

REM ############################################################################
REM Next Steps
REM ############################################################################

echo.
echo ========================================
echo Next Steps - Ferrari Hybrid Testing
echo ========================================
echo.

echo [32mDeployment Complete![0m
echo.
echo [34m[NEXT] Immediate Actions (within 1 hour^):[0m
echo   1. Verify contract on Theta Explorer
echo      - Compiler: 0.8.20
echo      - Optimization: Yes, 200 runs
echo.
echo   2. Create test SubVault:
echo      npx hardhat console --network theta-mainnet
echo      ^> factory = await ethers.getContractAt('VaultFactory', 'ADDR'^)
echo      ^> salt = ethers.keccak256(ethers.toUtf8Bytes('test-vault-1'^)^)
echo      ^> tx = await factory.createVault(salt^)
echo.
echo   3. Test deposit (0.1 TFUEL^):
echo      - Send from Theta Web Wallet to SubVault address
echo      - Verify 0.5%% fee (0.0005 TFUEL^) sent to RevSplitter
echo      - Check DepositReceived event on explorer
echo.
echo   4. Monitor events:
echo      - Deposit: grossAmount, feeAmount, netAmount, yieldRecycleAmount (30%%^)
echo      - Unwrap: amount, netAmount (70%%^), yieldRecycleAmount (30%%^)
echo.
echo [34m[DOCS] See STEP2_THETA_DEPLOY_GUIDE.md for detailed testing instructions[0m
echo.

REM ############################################################################
REM Save Deployment Log
REM ############################################################################

set "LOG_FILE=deployment-log-%date:~-4,4%%date:~-10,2%%date:~-7,2%-%time:~0,2%%time:~3,2%%time:~6,2%.txt"
set "LOG_FILE=%LOG_FILE: =0%"

(
    echo XFuelLab Hybrid Deployment Log
    echo ===============================
    echo Date: %date% %time%
    echo Network: %NETWORK%
    echo VaultFactory: %VAULT_FACTORY_ADDR%
    echo.
    echo Deployment Details:
    if exist "%DEPLOYMENT_FILE%" type "%DEPLOYMENT_FILE%"
) > "%LOG_FILE%"

echo [32m[OK] Deployment log saved: %LOG_FILE%[0m
echo.

echo ========================================
echo Deployment Complete
echo ========================================
echo.

endlocal
exit /b 0

