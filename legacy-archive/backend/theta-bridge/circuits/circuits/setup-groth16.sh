#!/bin/bash
# XFuel Protocol - Groth16 Setup Script
# Generates trusted setup files for deposit proof circuit
# Date: January 6, 2026

set -e

echo "🔐 XFuel ZK-SNARK Circuit Setup"
echo "================================"
echo ""

# Check if circom is installed
if ! command -v circom &> /dev/null; then
    echo "❌ circom not found. Installing..."
    npm install -g circom@latest
fi

# Check if snarkjs is installed
if ! command -v snarkjs &> /dev/null; then
    echo "❌ snarkjs not found. Installing..."
    npm install -g snarkjs@latest
fi

echo "✅ Dependencies verified"
echo ""

# Create build directory
mkdir -p build

echo "📦 Step 1: Installing circuit dependencies..."
npm install

echo ""
echo "🔨 Step 2: Compiling circuit..."
circom deposit.circom --r1cs --wasm --sym --c -o build/
echo "✅ Circuit compiled"

echo ""
echo "📊 Circuit Info:"
snarkjs r1cs info build/deposit.r1cs

echo ""
echo "📥 Step 3: Downloading Powers of Tau (if not present)..."
if [ ! -f "powersOfTau28_hez_final_20.ptau" ]; then
    curl -o powersOfTau28_hez_final_20.ptau https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_20.ptau
    echo "✅ Powers of Tau downloaded"
else
    echo "✅ Powers of Tau already present"
fi

echo ""
echo "🔑 Step 4: Groth16 Setup Phase 1 (trusted setup)..."
snarkjs groth16 setup build/deposit.r1cs powersOfTau28_hez_final_20.ptau build/circuit_0000.zkey
echo "✅ Phase 1 complete"

echo ""
echo "🎲 Step 5: Contributing to ceremony (Phase 2)..."
echo "Enter your name for the ceremony (or press Enter for default):"
read -r CONTRIBUTOR_NAME
CONTRIBUTOR_NAME=${CONTRIBUTOR_NAME:-"XFuel Team"}

snarkjs zkey contribute build/circuit_0000.zkey build/circuit_0001.zkey \
    --name="$CONTRIBUTOR_NAME" \
    -e="$(date +%s)$(openssl rand -hex 32)"
echo "✅ Phase 2 contribution complete"

echo ""
echo "🎯 Step 6: Applying random beacon..."
snarkjs zkey beacon build/circuit_0001.zkey build/circuit_final.zkey \
    0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f 10
echo "✅ Beacon applied"

echo ""
echo "📤 Step 7: Exporting verification key..."
snarkjs zkey export verificationkey build/circuit_final.zkey build/verification_key.json
echo "✅ Verification key exported"

echo ""
echo "📝 Step 8: Generating Solidity verifier..."
snarkjs zkey export solidityverifier build/circuit_final.zkey ../../contracts/ZKVerifier.sol
echo "✅ Solidity verifier generated"

echo ""
echo "📋 Step 9: Copying artifacts to circuits directory..."
cp build/deposit_js/deposit.wasm circuit.wasm
cp build/circuit_final.zkey circuit_final.zkey
cp build/verification_key.json verification_key.json
echo "✅ Artifacts copied"

echo ""
echo "🎉 Setup Complete!"
echo "=================="
echo ""
echo "Generated files:"
echo "  ✓ circuit.wasm - Circuit WebAssembly"
echo "  ✓ circuit_final.zkey - Proving key"
echo "  ✓ verification_key.json - Verification key"
echo "  ✓ ../../contracts/ZKVerifier.sol - Solidity verifier"
echo ""
echo "Next steps:"
echo "  1. Test proof generation: npm run test:generate"
echo "  2. Deploy ZKVerifier.sol contract"
echo "  3. Update prover service configuration"
echo ""

