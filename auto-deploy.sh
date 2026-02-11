#!/bin/bash
# XFuel Reverse Bridge - Complete Mainnet Deployment
# This script handles the entire deployment with minimal manual intervention

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
CHAIN_ID="core-1"
RPC_URL="https://rpc.persistence.one:443"
KEY_NAME="PERSISTENCE_DEPLOYER"
DEPLOYER_ADDRESS="persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx"
ADMIN_ADDRESS="persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e"
ARTIFACTS_DIR="/mnt/c/Users/seeha/xfuel-protocol/cosmwasm-contracts/artifacts"

# Deployment state file
STATE_FILE="$HOME/.xfuel-deployment-state.txt"

echo -e "${CYAN}==========================================${NC}"
echo -e "${CYAN}XFuel Reverse Bridge Mainnet Deployment${NC}"
echo -e "${CYAN}==========================================${NC}"
echo ""

# Function to save state
save_state() {
    echo "$1=$2" >> "$STATE_FILE"
}

# Function to load state
load_state() {
    if [ -f "$STATE_FILE" ]; then
        source "$STATE_FILE"
    fi
}

# Load previous state if exists
load_state

echo -e "${YELLOW}Configuration:${NC}"
echo "  Chain ID: $CHAIN_ID"
echo "  RPC: $RPC_URL"
echo "  Deployer: $DEPLOYER_ADDRESS"
echo "  Admin: $ADMIN_ADDRESS"
echo ""

# ============================================================================
# STEP 0: Prerequisites Check
# ============================================================================
echo -e "${CYAN}Step 0: Checking prerequisites...${NC}"

# Check persistenced
if ! command -v persistenced &> /dev/null; then
    echo -e "${RED}❌ persistenced not found${NC}"
    echo "Installing persistenced..."
    cd ~
    wget -q https://github.com/persistenceOne/persistenceCore/releases/download/v11.14.0/persistenceCore_11.14.0_Linux_x86_64.tar.gz
    tar -xzf persistenceCore_11.14.0_Linux_x86_64.tar.gz
    chmod +x persistenceCore
    sudo mv persistenceCore /usr/local/bin/persistenced
    echo -e "${GREEN}✓ persistenced installed${NC}"
fi

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI not found${NC}"
    echo "Installing AWS CLI..."
    sudo apt-get update -qq && sudo apt-get install -y awscli jq curl
    echo -e "${GREEN}✓ AWS CLI installed${NC}"
fi

# Check AWS credentials
echo "Checking AWS credentials..."
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    echo -e "${RED}❌ AWS credentials not configured${NC}"
    echo ""
    echo -e "${YELLOW}MANUAL ACTION REQUIRED:${NC}"
    echo "  Run: aws configure"
    echo "  Then run this script again"
    exit 1
fi
echo -e "${GREEN}✓ AWS credentials configured${NC}"
echo ""

# ============================================================================
# STEP 1: Import Key from AWS Secrets Manager
# ============================================================================
if [ -z "$KEY_IMPORTED" ]; then
    echo -e "${CYAN}Step 1: Importing PERSISTENCE_DEPLOYER key...${NC}"
    
    if persistenced keys show $KEY_NAME -a --keyring-backend file >/dev/null 2>&1; then
        EXISTING=$(persistenced keys show $KEY_NAME -a --keyring-backend file)
        if [ "$EXISTING" == "$DEPLOYER_ADDRESS" ]; then
            echo -e "${GREEN}✓ Key already exists: $EXISTING${NC}"
        else
            echo -e "${RED}❌ Key exists but address mismatch!${NC}"
            exit 1
        fi
    else
        echo "Retrieving mnemonic from AWS Secrets Manager..."
        MNEMONIC=$(aws secretsmanager get-secret-value \
            --secret-id "PERSISTENCE_DEPLOYER" \
            --query SecretString \
            --output text 2>&1)
        
        if [ $? -ne 0 ]; then
            echo -e "${RED}❌ Failed to retrieve secret${NC}"
            echo "$MNEMONIC"
            exit 1
        fi
        
        echo "$MNEMONIC" | persistenced keys add $KEY_NAME \
            --recover \
            --keyring-backend file
        
        MNEMONIC=""
        unset MNEMONIC
        
        DERIVED=$(persistenced keys show $KEY_NAME -a --keyring-backend file)
        echo -e "${GREEN}✓ Key imported: $DERIVED${NC}"
        
        if [ "$DERIVED" != "$DEPLOYER_ADDRESS" ]; then
            echo -e "${RED}❌ Address mismatch!${NC}"
            exit 1
        fi
    fi
    
    save_state "KEY_IMPORTED" "true"
    echo ""
fi

# ============================================================================
# STEP 2: Check Wallet Balance
# ============================================================================
echo -e "${CYAN}Step 2: Checking wallet balance...${NC}"
BALANCE=$(persistenced query bank balances $DEPLOYER_ADDRESS \
    --node $RPC_URL \
    --output json 2>/dev/null | jq -r '.balances[] | select(.denom=="uxprt") | .amount')

if [ -z "$BALANCE" ]; then
    echo -e "${RED}❌ No XPRT balance found!${NC}"
    exit 1
fi

BALANCE_XPRT=$((BALANCE / 1000000))
echo -e "${GREEN}✓ Balance: $BALANCE_XPRT XPRT${NC}"

if [ $BALANCE_XPRT -lt 5 ]; then
    echo -e "${YELLOW}⚠️  Warning: Balance is low${NC}"
fi
echo ""

# ============================================================================
# STEP 3: Verify WASM Files
# ============================================================================
if [ -z "$CHECKSUMS_VERIFIED" ]; then
    echo -e "${CYAN}Step 3: Verifying WASM files...${NC}"
    cd $ARTIFACTS_DIR
    
    if [ ! -f "persistence_minter.wasm" ] || [ ! -f "fee_collector.wasm" ]; then
        echo -e "${RED}❌ WASM files not found in $ARTIFACTS_DIR${NC}"
        exit 1
    fi
    
    MINTER_HASH=$(sha256sum persistence_minter.wasm | awk '{print $1}')
    FEE_HASH=$(sha256sum fee_collector.wasm | awk '{print $1}')
    
    EXPECTED_MINTER="516db0e88509afb90e3055b320691de68387ace97a9a34a72e5621ad3778b748"
    EXPECTED_FEE="7a370b84ea0ed94df29b2acd2804d73bc27fa1d5a325e2bdd76b3861438f5acd"
    
    if [ "$MINTER_HASH" == "$EXPECTED_MINTER" ] && [ "$FEE_HASH" == "$EXPECTED_FEE" ]; then
        echo -e "${GREEN}✓ All checksums verified${NC}"
        save_state "CHECKSUMS_VERIFIED" "true"
    else
        echo -e "${RED}❌ Checksum mismatch!${NC}"
        exit 1
    fi
    echo ""
fi

# ============================================================================
# STEP 4: Upload persistence_minter.wasm
# ============================================================================
if [ -z "$MINTER_CODE_ID" ]; then
    echo -e "${CYAN}Step 4: Uploading persistence_minter.wasm...${NC}"
    echo -e "${YELLOW}This will prompt for transaction approval${NC}"
    echo ""
    
    TX_HASH=$(persistenced tx wasm store persistence_minter.wasm \
        --from $KEY_NAME \
        --keyring-backend file \
        --chain-id $CHAIN_ID \
        --node $RPC_URL \
        --gas 3500000 \
        --gas-prices 0.025uxprt \
        --broadcast-mode sync \
        -y \
        --output json | jq -r '.txhash')
    
    echo "Transaction hash: $TX_HASH"
    echo "Waiting for confirmation..."
    sleep 8
    
    MINTER_CODE_ID=$(persistenced query tx $TX_HASH \
        --node $RPC_URL \
        --output json 2>/dev/null | jq -r '.logs[0].events[] | select(.type=="store_code") | .attributes[] | select(.key=="code_id") | .value')
    
    if [ -z "$MINTER_CODE_ID" ] || [ "$MINTER_CODE_ID" == "null" ]; then
        echo -e "${RED}❌ Failed to get code ID. TX: $TX_HASH${NC}"
        echo "Check transaction and run script again"
        exit 1
    fi
    
    echo -e "${GREEN}✓ Uploaded! Code ID: $MINTER_CODE_ID${NC}"
    save_state "MINTER_CODE_ID" "$MINTER_CODE_ID"
    save_state "MINTER_UPLOAD_TX" "$TX_HASH"
    echo ""
fi

# ============================================================================
# STEP 5: Upload fee_collector.wasm
# ============================================================================
if [ -z "$FEE_COLLECTOR_CODE_ID" ]; then
    echo -e "${CYAN}Step 5: Uploading fee_collector.wasm...${NC}"
    
    TX_HASH=$(persistenced tx wasm store fee_collector.wasm \
        --from $KEY_NAME \
        --keyring-backend file \
        --chain-id $CHAIN_ID \
        --node $RPC_URL \
        --gas 2500000 \
        --gas-prices 0.025uxprt \
        --broadcast-mode sync \
        -y \
        --output json | jq -r '.txhash')
    
    echo "Transaction hash: $TX_HASH"
    echo "Waiting for confirmation..."
    sleep 8
    
    FEE_COLLECTOR_CODE_ID=$(persistenced query tx $TX_HASH \
        --node $RPC_URL \
        --output json 2>/dev/null | jq -r '.logs[0].events[] | select(.type=="store_code") | .attributes[] | select(.key=="code_id") | .value')
    
    if [ -z "$FEE_COLLECTOR_CODE_ID" ] || [ "$FEE_COLLECTOR_CODE_ID" == "null" ]; then
        echo -e "${RED}❌ Failed to get code ID. TX: $TX_HASH${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✓ Uploaded! Code ID: $FEE_COLLECTOR_CODE_ID${NC}"
    save_state "FEE_COLLECTOR_CODE_ID" "$FEE_COLLECTOR_CODE_ID"
    save_state "FEE_COLLECTOR_UPLOAD_TX" "$TX_HASH"
    echo ""
fi

# ============================================================================
# DEPLOYMENT COMPLETE - Summary
# ============================================================================
echo -e "${CYAN}==========================================${NC}"
echo -e "${GREEN}✅ DEPLOYMENT PROGRESS${NC}"
echo -e "${CYAN}==========================================${NC}"
echo ""
echo "Completed Steps:"
echo -e "${GREEN}✓${NC} Key imported"
echo -e "${GREEN}✓${NC} Balance verified: $BALANCE_XPRT XPRT"
echo -e "${GREEN}✓${NC} WASM checksums verified"
echo -e "${GREEN}✓${NC} persistence_minter uploaded (Code ID: $MINTER_CODE_ID)"
echo -e "${GREEN}✓${NC} fee_collector uploaded (Code ID: $FEE_COLLECTOR_CODE_ID)"
echo ""
echo "Deployment state saved to: $STATE_FILE"
echo ""
echo -e "${YELLOW}Next: Contract instantiation (requires manual approval)${NC}"
echo "Run the continuation script or follow MAINNET_DEPLOYMENT_SCRIPT.md"
echo ""
