#!/bin/bash
################################################################################
# xfuel-protocol Persistence Mainnet Deployment Script
# 
# Purpose: Deploy ZKVerifier and ibcTFUEL Minter contracts to Persistence mainnet
# Prerequisites:
#   - persistenceCore CLI installed
#   - Deployer wallet mnemonic in PERSISTENCE_MNEMONIC env var
#   - Governance whitelisting approval obtained
# 
# Usage: ./scripts/deploy-persistence.sh [--testnet]
################################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
CHAIN_ID="core-1"
RPC_URL="https://rpc.core.persistence.one:443"
GAS_PRICES="0.025uxprt"
GAS_ADJUSTMENT="1.5"
DEPLOYER_KEY_NAME="xfuel-deployer"

# Check if testnet flag is set
if [[ "$1" == "--testnet" ]]; then
    CHAIN_ID="test-core-2"
    RPC_URL="https://rpc.testnet.persistence.one:443"
    echo -e "${YELLOW}⚠️  TESTNET MODE - Deploying to test-core-2${NC}"
    SKIP_GOVERNANCE_CHECK=true
else
    echo -e "${BLUE}🚀 MAINNET DEPLOYMENT - chain: ${CHAIN_ID}${NC}"
    SKIP_GOVERNANCE_CHECK=false
fi

# Deployment artifacts directory
ARTIFACTS_DIR="./deployment-artifacts"
mkdir -p "$ARTIFACTS_DIR"

################################################################################
# Pre-flight Checks
################################################################################

echo -e "\n${BLUE}📋 Running pre-flight checks...${NC}"

# Check if persistenceCore is installed
if ! command -v persistenceCore &> /dev/null; then
    echo -e "${RED}❌ persistenceCore CLI not found. Install from https://github.com/persistenceOne/persistenceCore${NC}"
    exit 1
fi
echo -e "${GREEN}✅ persistenceCore CLI found${NC}"

# Check if PERSISTENCE_MNEMONIC is set
if [ -z "$PERSISTENCE_MNEMONIC" ]; then
    echo -e "${RED}❌ PERSISTENCE_MNEMONIC environment variable not set${NC}"
    echo -e "${YELLOW}💡 Export your deployer mnemonic: export PERSISTENCE_MNEMONIC=\"your mnemonic here\"${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Deployer mnemonic loaded${NC}"

# Check if contract files exist
ZK_VERIFIER_WASM="./cosmwasm-contracts/zk-verifier/artifacts/zk_verifier.wasm"
MINTER_WASM="./cosmwasm-contracts/persistence-minter/artifacts/persistence_minter.wasm"

if [ ! -f "$ZK_VERIFIER_WASM" ]; then
    echo -e "${RED}❌ ZKVerifier WASM not found at $ZK_VERIFIER_WASM${NC}"
    echo -e "${YELLOW}💡 Build with: cd cosmwasm-contracts/zk-verifier && cargo wasm && cargo run-script optimize${NC}"
    exit 1
fi

if [ ! -f "$MINTER_WASM" ]; then
    echo -e "${RED}❌ Minter WASM not found at $MINTER_WASM${NC}"
    echo -e "${YELLOW}💡 Build with: cd cosmwasm-contracts/persistence-minter && cargo wasm && cargo run-script optimize${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Contract WASM files found${NC}"

# Check contract sizes
ZK_SIZE=$(stat -f%z "$ZK_VERIFIER_WASM" 2>/dev/null || stat -c%s "$ZK_VERIFIER_WASM" 2>/dev/null)
MINTER_SIZE=$(stat -f%z "$MINTER_WASM" 2>/dev/null || stat -c%s "$MINTER_WASM" 2>/dev/null)

echo -e "${BLUE}📦 ZKVerifier WASM size: $(numfmt --to=iec-i --suffix=B $ZK_SIZE)${NC}"
echo -e "${BLUE}📦 Minter WASM size: $(numfmt --to=iec-i --suffix=B $MINTER_SIZE)${NC}"

if [ $ZK_SIZE -gt 800000 ]; then
    echo -e "${YELLOW}⚠️  ZKVerifier WASM larger than 800KB - may need optimization${NC}"
fi

################################################################################
# Wallet Setup
################################################################################

echo -e "\n${BLUE}🔑 Setting up deployer wallet...${NC}"

# Import mnemonic (this won't fail if key already exists)
echo "$PERSISTENCE_MNEMONIC" | persistenceCore keys add "$DEPLOYER_KEY_NAME" --recover --keyring-backend test 2>/dev/null || true

# Get deployer address
DEPLOYER_ADDRESS=$(persistenceCore keys show "$DEPLOYER_KEY_NAME" -a --keyring-backend test)
echo -e "${GREEN}✅ Deployer address: ${DEPLOYER_ADDRESS}${NC}"

# Check balance
BALANCE=$(persistenceCore query bank balances "$DEPLOYER_ADDRESS" --node "$RPC_URL" --chain-id "$CHAIN_ID" -o json | jq -r '.balances[] | select(.denom=="uxprt") | .amount')

if [ -z "$BALANCE" ] || [ "$BALANCE" -lt 10000000 ]; then
    echo -e "${RED}❌ Insufficient balance: ${BALANCE} uxprt (need at least 10 XPRT)${NC}"
    exit 1
fi

BALANCE_XPRT=$(echo "scale=2; $BALANCE / 1000000" | bc)
echo -e "${GREEN}✅ Balance: ${BALANCE_XPRT} XPRT${NC}"

################################################################################
# Governance Whitelisting Verification (MAINNET ONLY)
################################################################################

if [ "$SKIP_GOVERNANCE_CHECK" = false ]; then
    echo -e "\n${YELLOW}⚠️  CRITICAL: Governance Whitelisting Check${NC}"
    echo -e "${YELLOW}────────────────────────────────────────────${NC}"
    echo -e "Before deploying to mainnet, you MUST have governance approval"
    echo -e "to whitelist the ZKVerifier contract for minting ibcTFUEL."
    echo -e ""
    echo -e "Required steps:"
    echo -e "  1. Submit governance proposal (docs/governance/PERSISTENCE_WHITELIST_PROPOSAL.md)"
    echo -e "  2. Wait for voting period (typically 7-14 days)"
    echo -e "  3. Ensure proposal passes with majority YES votes"
    echo -e ""
    read -p "Have you obtained governance approval? (yes/no): " APPROVAL_CONFIRMED
    
    if [[ "$APPROVAL_CONFIRMED" != "yes" ]]; then
        echo -e "${RED}❌ Deployment aborted. Obtain governance approval first.${NC}"
        echo -e "${YELLOW}💡 Use --testnet flag to deploy to testnet without approval${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ Proceeding with mainnet deployment${NC}"
fi

################################################################################
# Deploy ZKVerifier Contract
################################################################################

echo -e "\n${BLUE}📝 Storing ZKVerifier WASM...${NC}"

TX_HASH=$(persistenceCore tx wasm store "$ZK_VERIFIER_WASM" \
    --from "$DEPLOYER_KEY_NAME" \
    --chain-id "$CHAIN_ID" \
    --node "$RPC_URL" \
    --gas-prices "$GAS_PRICES" \
    --gas auto \
    --gas-adjustment "$GAS_ADJUSTMENT" \
    --keyring-backend test \
    --yes \
    -o json | jq -r '.txhash')

echo -e "${BLUE}⏳ Transaction submitted: ${TX_HASH}${NC}"
echo -e "${BLUE}⏳ Waiting for confirmation (20s)...${NC}"
sleep 20

# Get code ID
ZK_CODE_ID=$(persistenceCore query tx "$TX_HASH" --node "$RPC_URL" --chain-id "$CHAIN_ID" -o json | jq -r '.logs[0].events[] | select(.type=="store_code") | .attributes[] | select(.key=="code_id") | .value')

if [ -z "$ZK_CODE_ID" ]; then
    echo -e "${RED}❌ Failed to retrieve ZKVerifier code ID${NC}"
    exit 1
fi

echo -e "${GREEN}✅ ZKVerifier stored with code_id: ${ZK_CODE_ID}${NC}"

################################################################################
# Deploy Minter Contract
################################################################################

echo -e "\n${BLUE}📝 Storing Minter WASM...${NC}"

TX_HASH=$(persistenceCore tx wasm store "$MINTER_WASM" \
    --from "$DEPLOYER_KEY_NAME" \
    --chain-id "$CHAIN_ID" \
    --node "$RPC_URL" \
    --gas-prices "$GAS_PRICES" \
    --gas auto \
    --gas-adjustment "$GAS_ADJUSTMENT" \
    --keyring-backend test \
    --yes \
    -o json | jq -r '.txhash')

echo -e "${BLUE}⏳ Transaction submitted: ${TX_HASH}${NC}"
echo -e "${BLUE}⏳ Waiting for confirmation (20s)...${NC}"
sleep 20

# Get code ID
MINTER_CODE_ID=$(persistenceCore query tx "$TX_HASH" --node "$RPC_URL" --chain-id "$CHAIN_ID" -o json | jq -r '.logs[0].events[] | select(.type=="store_code") | .attributes[] | select(.key=="code_id") | .value')

if [ -z "$MINTER_CODE_ID" ]; then
    echo -e "${RED}❌ Failed to retrieve Minter code ID${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Minter stored with code_id: ${MINTER_CODE_ID}${NC}"

################################################################################
# Instantiate ZKVerifier Contract
################################################################################

echo -e "\n${BLUE}🏗️  Instantiating ZKVerifier...${NC}"

ZK_INIT_MSG=$(cat <<EOF
{
  "admin": "$DEPLOYER_ADDRESS",
  "sp1_vkey": "00000000000000000000000000000000",
  "max_mint_amount": "1000000"
}
EOF
)

TX_HASH=$(persistenceCore tx wasm instantiate "$ZK_CODE_ID" "$ZK_INIT_MSG" \
    --from "$DEPLOYER_KEY_NAME" \
    --label "xfuel-zkverifier-v1" \
    --admin "$DEPLOYER_ADDRESS" \
    --chain-id "$CHAIN_ID" \
    --node "$RPC_URL" \
    --gas-prices "$GAS_PRICES" \
    --gas auto \
    --gas-adjustment "$GAS_ADJUSTMENT" \
    --keyring-backend test \
    --yes \
    -o json | jq -r '.txhash')

echo -e "${BLUE}⏳ Transaction submitted: ${TX_HASH}${NC}"
echo -e "${BLUE}⏳ Waiting for confirmation (20s)...${NC}"
sleep 20

# Get contract address
ZK_CONTRACT_ADDRESS=$(persistenceCore query tx "$TX_HASH" --node "$RPC_URL" --chain-id "$CHAIN_ID" -o json | jq -r '.logs[0].events[] | select(.type=="instantiate") | .attributes[] | select(.key=="_contract_address") | .value')

if [ -z "$ZK_CONTRACT_ADDRESS" ]; then
    echo -e "${RED}❌ Failed to retrieve ZKVerifier contract address${NC}"
    exit 1
fi

echo -e "${GREEN}✅ ZKVerifier instantiated at: ${ZK_CONTRACT_ADDRESS}${NC}"

################################################################################
# Instantiate Minter Contract
################################################################################

echo -e "\n${BLUE}🏗️  Instantiating Minter (ibcTFUEL)...${NC}"

MINTER_INIT_MSG=$(cat <<EOF
{
  "name": "ibcTFUEL",
  "symbol": "ibcTFUEL",
  "decimals": 6,
  "initial_balances": [],
  "mint": {
    "minter": "$ZK_CONTRACT_ADDRESS",
    "cap": null
  },
  "marketing": {
    "project": "xfuel-protocol",
    "description": "TFUEL bridged from Theta Network via ZK proofs",
    "marketing": "$DEPLOYER_ADDRESS",
    "logo": {
      "url": "https://raw.githubusercontent.com/XFuel-Lab/xfuel-protocol/main/assets/logos/xf-logo.jpg"
    }
  }
}
EOF
)

TX_HASH=$(persistenceCore tx wasm instantiate "$MINTER_CODE_ID" "$MINTER_INIT_MSG" \
    --from "$DEPLOYER_KEY_NAME" \
    --label "ibcTFUEL-v1" \
    --admin "$DEPLOYER_ADDRESS" \
    --chain-id "$CHAIN_ID" \
    --node "$RPC_URL" \
    --gas-prices "$GAS_PRICES" \
    --gas auto \
    --gas-adjustment "$GAS_ADJUSTMENT" \
    --keyring-backend test \
    --yes \
    -o json | jq -r '.txhash')

echo -e "${BLUE}⏳ Transaction submitted: ${TX_HASH}${NC}"
echo -e "${BLUE}⏳ Waiting for confirmation (20s)...${NC}"
sleep 20

# Get contract address
MINTER_CONTRACT_ADDRESS=$(persistenceCore query tx "$TX_HASH" --node "$RPC_URL" --chain-id "$CHAIN_ID" -o json | jq -r '.logs[0].events[] | select(.type=="instantiate") | .attributes[] | select(.key=="_contract_address") | .value')

if [ -z "$MINTER_CONTRACT_ADDRESS" ]; then
    echo -e "${RED}❌ Failed to retrieve Minter contract address${NC}"
    exit 1
fi

echo -e "${GREEN}✅ ibcTFUEL Minter instantiated at: ${MINTER_CONTRACT_ADDRESS}${NC}"

################################################################################
# Save Deployment Info
################################################################################

echo -e "\n${BLUE}💾 Saving deployment information...${NC}"

DEPLOYMENT_FILE="$ARTIFACTS_DIR/persistence-deployment-$(date +%Y%m%d-%H%M%S).json"

cat > "$DEPLOYMENT_FILE" <<EOF
{
  "network": "$CHAIN_ID",
  "rpc": "$RPC_URL",
  "deployer": "$DEPLOYER_ADDRESS",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "contracts": {
    "zk_verifier": {
      "code_id": $ZK_CODE_ID,
      "address": "$ZK_CONTRACT_ADDRESS"
    },
    "minter": {
      "code_id": $MINTER_CODE_ID,
      "address": "$MINTER_CONTRACT_ADDRESS"
    }
  }
}
EOF

echo -e "${GREEN}✅ Deployment info saved to: ${DEPLOYMENT_FILE}${NC}"

# Append to .env file
echo -e "\n${BLUE}📝 Updating .env with contract addresses...${NC}"

ENV_FILE="./backend/theta-bridge/.env"
if [ ! -f "$ENV_FILE" ]; then
    echo -e "${YELLOW}⚠️  .env file not found, creating from example...${NC}"
    cp ./backend/theta-bridge/env.phase-c.example "$ENV_FILE"
fi

# Append contract addresses (don't overwrite existing file)
cat >> "$ENV_FILE" <<EOF

# Persistence Mainnet Deployment - $(date +%Y-%m-%d)
PERSISTENCE_ZK_VERIFIER_CONTRACT=${ZK_CONTRACT_ADDRESS}
PERSISTENCE_MINTER_CONTRACT=${MINTER_CONTRACT_ADDRESS}
PERSISTENCE_WHITELIST_APPROVED=true
EOF

echo -e "${GREEN}✅ Contract addresses added to .env${NC}"

################################################################################
# Deployment Summary
################################################################################

echo -e "\n${GREEN}════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ DEPLOYMENT COMPLETE${NC}"
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo -e ""
echo -e "${BLUE}Network:${NC} $CHAIN_ID"
echo -e "${BLUE}ZKVerifier:${NC} $ZK_CONTRACT_ADDRESS"
echo -e "${BLUE}ibcTFUEL Minter:${NC} $MINTER_CONTRACT_ADDRESS"
echo -e ""
echo -e "${YELLOW}Next Steps:${NC}"
echo -e "  1. Update backend/theta-bridge/.env with contract addresses (done)"
echo -e "  2. Set PERSISTENCE_WHITELIST_APPROVED=true in .env (done)"
echo -e "  3. Restart backend: cd backend/theta-bridge && npm run start"
echo -e "  4. Test with small deposit: 0.1 TFUEL"
echo -e "  5. Monitor logs for successful mint"
echo -e "  6. Update governance proposal with contract addresses"
echo -e ""
echo -e "${BLUE}Contract Verification:${NC}"
echo -e "  persistenceCore query wasm contract $ZK_CONTRACT_ADDRESS --node $RPC_URL"
echo -e "  persistenceCore query wasm contract $MINTER_CONTRACT_ADDRESS --node $RPC_URL"
echo -e ""
echo -e "${GREEN}🎉 Ready for Phase D - Mainnet Testing!${NC}"
