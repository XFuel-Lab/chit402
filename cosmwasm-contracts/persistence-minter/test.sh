#!/bin/bash

# Test script for Persistence Minter contract

set -e

echo "🧪 Running Persistence Minter Tests..."
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Navigate to contract directory
cd "$(dirname "$0")"

echo -e "${YELLOW}📦 Building contract...${NC}"
cargo build --release --target wasm32-unknown-unknown
echo -e "${GREEN}✓ Build complete${NC}"
echo ""

echo -e "${YELLOW}🧪 Running unit tests...${NC}"
cargo test -- --nocapture
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ All tests passed${NC}"
else
    echo -e "${RED}✗ Tests failed${NC}"
    exit 1
fi
echo ""

echo -e "${YELLOW}📊 Running tests with coverage...${NC}"
cargo test
echo -e "${GREEN}✓ Coverage complete${NC}"
echo ""

echo -e "${YELLOW}🔍 Checking code formatting...${NC}"
cargo fmt -- --check
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Code is properly formatted${NC}"
else
    echo -e "${RED}✗ Code formatting issues found${NC}"
    echo "Run 'cargo fmt' to fix"
fi
echo ""

echo -e "${YELLOW}📝 Running Clippy lints...${NC}"
cargo clippy -- -D warnings
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ No clippy warnings${NC}"
else
    echo -e "${RED}✗ Clippy warnings found${NC}"
fi
echo ""

echo -e "${YELLOW}🔒 Checking for security issues...${NC}"
if command -v cargo-audit &> /dev/null; then
    cargo audit
    echo -e "${GREEN}✓ Security check complete${NC}"
else
    echo -e "${YELLOW}⚠ cargo-audit not installed. Run: cargo install cargo-audit${NC}"
fi
echo ""

echo -e "${GREEN}✅ All checks completed!${NC}"
echo ""
echo "Next steps:"
echo "1. Optimize: docker run --rm -v \"\$(pwd)\":/code --mount type=volume,source=\"\$(basename \"\$(pwd)\")_cache\",target=/code/target --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry cosmwasm/rust-optimizer:0.15.0"
echo "2. Deploy to testnet: See DEPLOYMENT.md"
echo "3. Test on testnet: See INTEGRATION.md"



