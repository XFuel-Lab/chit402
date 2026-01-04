#!/bin/bash

# Install Persistence Tools & Dependencies
# Installs everything needed for Step 4 deployment

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}🔧 Installing Persistence Tools${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Check OS
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
  OS="linux"
elif [[ "$OSTYPE" == "darwin"* ]]; then
  OS="macos"
else
  echo -e "${YELLOW}⚠️  Unsupported OS: $OSTYPE${NC}"
  exit 1
fi

# 1. Install Rust & Cargo
echo -e "${GREEN}📦 Step 1: Installing Rust...${NC}"
if command -v cargo &> /dev/null; then
  echo "✅ Rust already installed: $(rustc --version)"
else
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  source "$HOME/.cargo/env"
  echo "✅ Rust installed"
fi

# Add wasm target
rustup target add wasm32-unknown-unknown
echo "✅ wasm32 target added"
echo ""

# 2. Install CosmWasm Optimizer
echo -e "${GREEN}📦 Step 2: Installing CosmWasm Optimizer...${NC}"
if command -v docker &> /dev/null; then
  docker pull cosmwasm/rust-optimizer:0.15.0
  echo "✅ CosmWasm optimizer ready"
else
  echo -e "${YELLOW}⚠️  Docker not found - install Docker first${NC}"
  echo "Visit: https://docs.docker.com/get-docker/"
fi
echo ""

# 3. Install Circom & SnarkJS
echo -e "${GREEN}📦 Step 3: Installing Circom & SnarkJS...${NC}"
if command -v circom &> /dev/null; then
  echo "✅ Circom already installed: $(circom --version)"
else
  # Install circom from source
  git clone https://github.com/iden3/circom.git /tmp/circom
  cd /tmp/circom
  cargo build --release
  sudo cp target/release/circom /usr/local/bin/
  cd -
  rm -rf /tmp/circom
  echo "✅ Circom installed"
fi

# Install SnarkJS
if command -v snarkjs &> /dev/null; then
  echo "✅ SnarkJS already installed"
else
  npm install -g snarkjs
  echo "✅ SnarkJS installed"
fi
echo ""

# 4. Install Persistence CLI
echo -e "${GREEN}📦 Step 4: Installing Persistence CLI...${NC}"
if command -v persistenceCore &> /dev/null; then
  echo "✅ persistenceCore already installed: $(persistenceCore version)"
else
  # Download binary
  if [ "$OS" == "linux" ]; then
    curl -LO https://github.com/persistenceOne/persistenceCore/releases/download/v11.0.0/persistenceCore-v11.0.0-linux-amd64.tar.gz
    tar -xzf persistenceCore-v11.0.0-linux-amd64.tar.gz
    sudo mv persistenceCore /usr/local/bin/
    rm persistenceCore-v11.0.0-linux-amd64.tar.gz
  elif [ "$OS" == "macos" ]; then
    curl -LO https://github.com/persistenceOne/persistenceCore/releases/download/v11.0.0/persistenceCore-v11.0.0-darwin-amd64.tar.gz
    tar -xzf persistenceCore-v11.0.0-darwin-amd64.tar.gz
    sudo mv persistenceCore /usr/local/bin/
    rm persistenceCore-v11.0.0-darwin-amd64.tar.gz
  fi
  echo "✅ persistenceCore installed"
fi

# Configure CLI
persistenceCore config chain-id core-1
persistenceCore config node https://rpc.core.persistence.one:443
persistenceCore config keyring-backend os
echo "✅ persistenceCore configured"
echo ""

# 5. Install cargo-generate (for CosmWasm templates)
echo -e "${GREEN}📦 Step 5: Installing cargo-generate...${NC}"
if command -v cargo-generate &> /dev/null; then
  echo "✅ cargo-generate already installed"
else
  cargo install cargo-generate
  echo "✅ cargo-generate installed"
fi
echo ""

# 6. Download Powers of Tau (for Groth16 setup)
echo -e "${GREEN}📦 Step 6: Downloading Powers of Tau...${NC}"
if [ ! -f "circuits/pot12_final.ptau" ]; then
  mkdir -p circuits
  echo "Downloading pot12_final.ptau (37 MB)..."
  curl -L -o circuits/pot12_final.ptau \
    https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_12.ptau
  echo "✅ Powers of Tau downloaded"
else
  echo "✅ Powers of Tau already downloaded"
fi
echo ""

# 7. Verify installations
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✅ INSTALLATION COMPLETE${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Installed tools:"
echo "  • Rust: $(rustc --version)"
echo "  • Cargo: $(cargo --version)"
echo "  • Circom: $(circom --version 2>&1 || echo 'not found')"
echo "  • SnarkJS: $(snarkjs --version 2>&1 || echo 'not found')"
echo "  • persistenceCore: $(persistenceCore version)"
echo "  • Docker: $(docker --version 2>&1 || echo 'not found')"
echo ""
echo "Next steps:"
echo "  1. Build contracts: ./scripts/build-cosmwasm.sh"
echo "  2. Deploy: ./scripts/deploy-persistence-minter.sh"
echo ""

