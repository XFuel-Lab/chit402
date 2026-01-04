@echo off
REM Hybrid Flow Simulation Runner (Windows)
REM Quick script to run the complete hybrid tokenomics simulation

echo ========================================
echo xFuel Hybrid Flow Simulation
echo ========================================
echo.

REM Check if node_modules exists
if not exist "node_modules\" (
    echo Installing dependencies...
    call npm install
)

REM Menu
echo Select simulation mode:
echo   1) Run simulation script (quick demo)
echo   2) Run full test suite (comprehensive)
echo   3) Run with gas reporting
echo   4) Run specific test (deposit flow)
echo   5) Run specific test (burn/unwrap flow)
echo   6) Run with mainnet forking (slower)
echo.
set /p choice="Enter choice [1-6]: "

if "%choice%"=="1" (
    echo Running simulation script...
    call npx hardhat run scripts/simulate-hybrid-flow.cjs --network hardhat
) else if "%choice%"=="2" (
    echo Running full test suite...
    call npx hardhat test test/HybridFlow.Integration.test.cjs
) else if "%choice%"=="3" (
    echo Running tests with gas reporting...
    set REPORT_GAS=true
    call npx hardhat test test/HybridFlow.Integration.test.cjs
) else if "%choice%"=="4" (
    echo Running deposit flow tests...
    call npx hardhat test test/HybridFlow.Integration.test.cjs --grep "Vault Creation & Deposits"
) else if "%choice%"=="5" (
    echo Running burn/unwrap flow tests...
    call npx hardhat test test/HybridFlow.Integration.test.cjs --grep "UnwrapFromBurn"
) else if "%choice%"=="6" (
    echo Enabling mainnet forking...
    echo Note: This requires network access and will be slower
    
    REM Temporarily enable forking in config
    powershell -Command "(gc hardhat.config.cjs) -replace 'enabled: false', 'enabled: true' | Out-File -encoding ASCII hardhat.config.cjs.tmp"
    move /y hardhat.config.cjs.tmp hardhat.config.cjs
    
    call npx hardhat run scripts/simulate-hybrid-flow.cjs --network hardhat
    
    REM Restore original config
    powershell -Command "(gc hardhat.config.cjs) -replace 'enabled: true', 'enabled: false' | Out-File -encoding ASCII hardhat.config.cjs.tmp"
    move /y hardhat.config.cjs.tmp hardhat.config.cjs
    
    echo Forking disabled (config restored)
) else (
    echo Invalid choice. Please run again and select 1-6.
    exit /b 1
)

echo.
echo ========================================
echo Simulation Complete!
echo ========================================
echo.
echo For more options, see: docs\HYBRID_FLOW_SIMULATION.md

pause



