#!/bin/bash

# Build CosmWasm Contracts for Persistence
# Compiles and optimizes ZK verifier and ibcTFUEL minter

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}🔨 Building CosmWasm Contracts${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Create directories
mkdir -p artifacts
mkdir -p circuits

# Step 1: Build Circom Circuit
echo -e "${GREEN}📐 Step 1: Compiling Circom Circuit...${NC}"
if [ -f "circuits/deposit_verifier.circom" ]; then
  cd circuits
  
  # Compile circuit
  circom deposit_verifier.circom --r1cs --wasm --sym -o .
  
  # Generate witness calculator
  echo "✅ Circuit compiled"
  
  # Run trusted setup (Groth16)
  echo "Running Groth16 trusted setup..."
  snarkjs groth16 setup deposit_verifier.r1cs pot12_final.ptau circuit_0000.zkey
  
  # Generate verification key
  snarkjs zkey export verificationkey circuit_0000.zkey verification_key.json
  
  echo "✅ Verification key generated"
  cd ..
else
  echo -e "${YELLOW}⚠️  Circuit file not found - using mock verification key${NC}"
  
  # Create mock verification key for testing
  cat > circuits/verification_key.json << 'EOF'
{
  "protocol": "groth16",
  "curve": "bn128",
  "nPublic": 2,
  "vk_alpha_1": ["0x0", "0x0", "0x1"],
  "vk_beta_2": [["0x0", "0x0"], ["0x0", "0x0"], ["0x1", "0x0"]],
  "vk_gamma_2": [["0x0", "0x0"], ["0x0", "0x0"], ["0x1", "0x0"]],
  "vk_delta_2": [["0x0", "0x0"], ["0x0", "0x0"], ["0x1", "0x0"]],
  "vk_alphabeta_12": [],
  "IC": [
    ["0x0", "0x0", "0x1"],
    ["0x0", "0x0", "0x1"],
    ["0x0", "0x0", "0x1"]
  ]
}
EOF
  echo "✅ Mock verification key created"
fi
echo ""

# Step 2: Check for CosmWasm contracts
echo -e "${GREEN}📦 Step 2: Checking CosmWasm Contracts...${NC}"

# Check if cosmwasm-contracts directory exists
if [ ! -d "cosmwasm-contracts" ]; then
  echo -e "${YELLOW}⚠️  cosmwasm-contracts directory not found${NC}"
  echo "Creating mock contracts for demonstration..."
  
  mkdir -p cosmwasm-contracts/zk-verifier/src
  mkdir -p cosmwasm-contracts/ibctfuel-minter/src
  
  # Create basic mock contracts
  echo "Mock contracts created. In production, these would be full CosmWasm implementations."
  echo ""
fi

# Step 3: Build with CosmWasm Optimizer
echo -e "${GREEN}🔧 Step 3: Building with CosmWasm Optimizer...${NC}"

if command -v docker &> /dev/null; then
  echo "Using CosmWasm optimizer..."
  
  # Check if we have real contracts to build
  if [ -d "cosmwasm-contracts/zk-verifier/Cargo.toml" ]; then
    docker run --rm -v "$(pwd)/cosmwasm-contracts":/code \
      --mount type=volume,source="$(basename "$(pwd)")_cache",target=/code/target \
      --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
      cosmwasm/rust-optimizer:0.15.0 ./zk-verifier
    
    docker run --rm -v "$(pwd)/cosmwasm-contracts":/code \
      --mount type=volume,source="$(basename "$(pwd)")_cache",target=/code/target \
      --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
      cosmwasm/rust-optimizer:0.15.0 ./ibctfuel-minter
    
    # Move artifacts
    cp cosmwasm-contracts/artifacts/zk_verifier.wasm artifacts/
    cp cosmwasm-contracts/artifacts/ibctfuel_minter.wasm artifacts/
    
    echo "✅ Contracts optimized"
  else
    echo -e "${YELLOW}⚠️  No CosmWasm source found - creating placeholder artifacts${NC}"
    
    # Create placeholder wasm files
    echo "WASM placeholder for ZK Verifier" > artifacts/zk_verifier.wasm
    echo "WASM placeholder for ibcTFUEL Minter" > artifacts/ibctfuel_minter.wasm
    
    echo "⚠️  These are placeholder files for demonstration"
    echo "⚠️  In production, build real CosmWasm contracts"
  fi
else
  echo -e "${YELLOW}⚠️  Docker not found - skipping optimization${NC}"
  echo "Install Docker to optimize contracts for deployment"
fi
echo ""

# Step 4: Generate checksums
echo -e "${GREEN}🔐 Step 4: Generating Checksums...${NC}"

if [ -f "artifacts/zk_verifier.wasm" ]; then
  ZK_CHECKSUM=$(sha256sum artifacts/zk_verifier.wasm | awk '{print $1}')
  echo "ZK Verifier: $ZK_CHECKSUM"
fi

if [ -f "artifacts/ibctfuel_minter.wasm" ]; then
  MINTER_CHECKSUM=$(sha256sum artifacts/ibctfuel_minter.wasm | awk '{print $1}')
  echo "ibcTFUEL Minter: $MINTER_CHECKSUM"
fi

# Save checksums
cat > artifacts/checksums.txt << EOF
ZK Verifier: $ZK_CHECKSUM
ibcTFUEL Minter: $MINTER_CHECKSUM
EOF

echo "✅ Checksums saved"
echo ""

# Step 5: Summary
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✅ BUILD COMPLETE${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Artifacts ready:"
echo "  • artifacts/zk_verifier.wasm"
echo "  • artifacts/ibctfuel_minter.wasm"
echo "  • circuits/verification_key.json"
echo "  • artifacts/checksums.txt"
echo ""

if [ -f "artifacts/zk_verifier.wasm" ]; then
  ZK_SIZE=$(du -h artifacts/zk_verifier.wasm | awk '{print $1}')
  echo "ZK Verifier size: $ZK_SIZE"
fi

if [ -f "artifacts/ibctfuel_minter.wasm" ]; then
  MINTER_SIZE=$(du -h artifacts/ibctfuel_minter.wasm | awk '{print $1}')
  echo "ibcTFUEL Minter size: $MINTER_SIZE"
fi

echo ""
echo "Next steps:"
echo "  1. Deploy to Persistence: ./scripts/deploy-persistence-minter.sh"
echo "  2. Or review guide: STEP4_PERSISTENCE_DEPLOY_GUIDE.md"
echo ""

# Note about production
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}⚠️  IMPORTANT FOR PRODUCTION:${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "This script creates placeholder files for demonstration."
echo "Before mainnet deployment:"
echo ""
echo "1. Implement full CosmWasm contracts:"
echo "   - ZK verifier with Groth16 verification"
echo "   - CW20 token with mint/burn"
echo "   - Nonce tracking & replay protection"
echo ""
echo "2. Run comprehensive tests:"
echo "   - Unit tests (cargo test)"
echo "   - Integration tests"
echo "   - Testnet deployment"
echo ""
echo "3. Security audit:"
echo "   - Third-party code review"
echo "   - Fuzzing & formal verification"
echo "   - Bug bounty program"
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

