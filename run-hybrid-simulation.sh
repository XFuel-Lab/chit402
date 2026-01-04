#!/bin/bash

# Hybrid Flow Simulation Runner
# Quick script to run the complete hybrid tokenomics simulation

echo "========================================"
echo "xFuel Hybrid Flow Simulation"
echo "========================================"
echo ""

# Color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing dependencies...${NC}"
    npm install
fi

# Menu
echo "Select simulation mode:"
echo "  1) Run simulation script (quick demo)"
echo "  2) Run full test suite (comprehensive)"
echo "  3) Run with gas reporting"
echo "  4) Run specific test (deposit flow)"
echo "  5) Run specific test (burn/unwrap flow)"
echo "  6) Run with mainnet forking (slower)"
echo ""
read -p "Enter choice [1-6]: " choice

case $choice in
    1)
        echo -e "${GREEN}Running simulation script...${NC}"
        npx hardhat run scripts/simulate-hybrid-flow.cjs --network hardhat
        ;;
    2)
        echo -e "${GREEN}Running full test suite...${NC}"
        npx hardhat test test/HybridFlow.Integration.test.cjs
        ;;
    3)
        echo -e "${GREEN}Running tests with gas reporting...${NC}"
        REPORT_GAS=true npx hardhat test test/HybridFlow.Integration.test.cjs
        ;;
    4)
        echo -e "${GREEN}Running deposit flow tests...${NC}"
        npx hardhat test test/HybridFlow.Integration.test.cjs --grep "Vault Creation & Deposits"
        ;;
    5)
        echo -e "${GREEN}Running burn/unwrap flow tests...${NC}"
        npx hardhat test test/HybridFlow.Integration.test.cjs --grep "UnwrapFromBurn"
        ;;
    6)
        echo -e "${YELLOW}Enabling mainnet forking...${NC}"
        echo -e "${YELLOW}Note: This requires network access and will be slower${NC}"
        
        # Temporarily enable forking in config
        sed -i.bak 's/enabled: false/enabled: true/g' hardhat.config.cjs
        
        npx hardhat run scripts/simulate-hybrid-flow.cjs --network hardhat
        
        # Restore original config
        mv hardhat.config.cjs.bak hardhat.config.cjs
        
        echo -e "${GREEN}Forking disabled (config restored)${NC}"
        ;;
    *)
        echo -e "${RED}Invalid choice. Please run again and select 1-6.${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "${GREEN}========================================"
echo "Simulation Complete!"
echo "========================================${NC}"
echo ""
echo "For more options, see: docs/HYBRID_FLOW_SIMULATION.md"



