@echo off
REM XFuel Protocol - Groth16 Setup Script (Windows)
REM Generates trusted setup files for deposit proof circuit
REM Date: January 6, 2026

echo.
echo 🔐 XFuel ZK-SNARK Circuit Setup
echo ================================
echo.

REM Check if circom is installed
where circom >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ circom not found. Installing...
    call npm install -g circom@latest
)

REM Check if snarkjs is installed
where snarkjs >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ snarkjs not found. Installing...
    call npm install -g snarkjs@latest
)

echo ✅ Dependencies verified
echo.

REM Create build directory
if not exist "build" mkdir build

echo 📦 Step 1: Installing circuit dependencies...
call npm install

echo.
echo 🔨 Step 2: Compiling circuit...
call circom deposit.circom --r1cs --wasm --sym --c -o build/
echo ✅ Circuit compiled

echo.
echo 📊 Circuit Info:
call snarkjs r1cs info build/deposit.r1cs

echo.
echo 📥 Step 3: Downloading Powers of Tau (if not present)...
if not exist "powersOfTau28_hez_final_20.ptau" (
    curl -o powersOfTau28_hez_final_20.ptau https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_20.ptau
    echo ✅ Powers of Tau downloaded
) else (
    echo ✅ Powers of Tau already present
)

echo.
echo 🔑 Step 4: Groth16 Setup Phase 1 (trusted setup)...
call snarkjs groth16 setup build/deposit.r1cs powersOfTau28_hez_final_20.ptau build/circuit_0000.zkey
echo ✅ Phase 1 complete

echo.
echo 🎲 Step 5: Contributing to ceremony (Phase 2)...
call snarkjs zkey contribute build/circuit_0000.zkey build/circuit_0001.zkey --name="XFuel Team" -e="random entropy"
echo ✅ Phase 2 contribution complete

echo.
echo 🎯 Step 6: Applying random beacon...
call snarkjs zkey beacon build/circuit_0001.zkey build/circuit_final.zkey 0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f 10
echo ✅ Beacon applied

echo.
echo 📤 Step 7: Exporting verification key...
call snarkjs zkey export verificationkey build/circuit_final.zkey build/verification_key.json
echo ✅ Verification key exported

echo.
echo 📝 Step 8: Generating Solidity verifier...
call snarkjs zkey export solidityverifier build/circuit_final.zkey ..\..\contracts\ZKVerifier.sol
echo ✅ Solidity verifier generated

echo.
echo 📋 Step 9: Copying artifacts to circuits directory...
copy build\deposit_js\deposit.wasm circuit.wasm
copy build\circuit_final.zkey circuit_final.zkey
copy build\verification_key.json verification_key.json
echo ✅ Artifacts copied

echo.
echo 🎉 Setup Complete!
echo ==================
echo.
echo Generated files:
echo   ✓ circuit.wasm - Circuit WebAssembly
echo   ✓ circuit_final.zkey - Proving key
echo   ✓ verification_key.json - Verification key
echo   ✓ ..\..\contracts\ZKVerifier.sol - Solidity verifier
echo.
echo Next steps:
echo   1. Test proof generation: npm run test:generate
echo   2. Deploy ZKVerifier.sol contract
echo   3. Update prover service configuration
echo.
pause

