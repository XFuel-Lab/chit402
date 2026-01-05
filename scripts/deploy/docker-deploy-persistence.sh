#!/bin/bash
set -e

echo "========================================================================"
echo "🚀 PERSISTENCE DEPLOYMENT (Multi-platform ARM64/AMD64)"
echo "========================================================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Verify architecture
echo "🔍 System Info:"
echo "  Platform: $(uname -m)"
persistenceCore version --long 2>/dev/null || persistenceCore version || echo "  persistenceCore: checking..."
echo ""

# Check environment variables
if [ -z "$KEPLR_MNEMONIC" ]; then
  echo -e "${RED}❌ KEPLR_MNEMONIC not set in .env.docker${NC}"
  exit 1
fi

# Import wallet
echo "🔐 Importing wallet..."
echo "$KEPLR_MNEMONIC" | persistenceCore keys add xfuel-deployer --recover --keyring-backend test 2>/dev/null || \
  echo "$KEPLR_MNEMONIC" | persistenceCore keys add xfuel-deployer --recover --keyring-backend test --output json 2>&1 | grep -q "override" || true

# Get address (try different account names for compatibility)
DEPLOYER_ADDR=$(persistenceCore keys show xfuel-deployer -a --keyring-backend test 2>/dev/null) || \
  DEPLOYER_ADDR=$(persistenceCore keys show deployer -a --keyring-backend test 2>/dev/null) || \
  DEPLOYER_ADDR=$(persistenceCore keys list --keyring-backend test --output json 2>/dev/null | jq -r '.[0].address')

if [ -z "$DEPLOYER_ADDR" ]; then
  echo -e "${RED}❌ Failed to get deployer address${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Wallet loaded: $DEPLOYER_ADDR${NC}"
echo ""

# Check balance
echo "💰 Checking balance..."
BALANCE_JSON=$(persistenceCore query bank balances $DEPLOYER_ADDR -o json 2>/dev/null || echo '{"balances":[]}')
BALANCE=$(echo $BALANCE_JSON | jq -r '.balances[0].amount // "0"')
BALANCE_XPRT=$(awk "BEGIN {printf \"%.6f\", $BALANCE / 1000000}")

echo "Balance: $BALANCE_XPRT XPRT ($BALANCE uxprt)"
echo ""

if [ "$BALANCE" -lt "200000" ]; then
  echo "⚠️  WARNING: Low balance. Recommended: 1+ XPRT"
  echo "Current: $BALANCE_XPRT XPRT"
  echo ""
  echo "Please fund your wallet: $DEPLOYER_ADDR"
  echo ""
  read -p "Continue anyway? (y/N) " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

echo "========================================================================"
echo "📦 BUILDING CONTRACTS"
echo "========================================================================"
echo ""

# Check for optimized contracts
if [ ! -f "/app/artifacts/zk_verifier.wasm" ] || [ ! -f "/app/artifacts/ibc_tfuel_minter.wasm" ]; then
  echo "⚠️  Optimized contracts not found in artifacts/"
  echo ""
  echo "Please run optimization first:"
  echo "  ./scripts/optimize-cosmwasm.sh"
  echo "  OR ./scripts/manual-optimize-wasm.sh"
  echo ""
  exit 1
fi

echo "✅ Using optimized contracts from artifacts/"
ls -lh /app/artifacts/*.wasm
echo ""

# Show sizes
ZK_SIZE=$(wc -c < /app/artifacts/zk_verifier.wasm)
MINTER_SIZE=$(wc -c < /app/artifacts/ibc_tfuel_minter.wasm)
echo "📦 Contract sizes:"
awk "BEGIN {printf \"  ZK Verifier:     %.2f KB\n\", $ZK_SIZE / 1024}"
awk "BEGIN {printf \"  ibcTFUEL Minter: %.2f KB\n\", $MINTER_SIZE / 1024}"
echo ""

echo "========================================================================"
echo "📤 STORING CODE ON PERSISTENCE"
echo "========================================================================"
echo ""

echo "🔐 Storing ZK Verifier contract..."
echo "  File: /app/artifacts/zk_verifier.wasm"
echo "  Gas: 1,500,000 (adjustment 1.8x)"
echo ""

ZK_STORE_RESULT=$(persistenceCore tx wasm store /app/artifacts/zk_verifier.wasm \
  --from xfuel-deployer \
  --gas 1500000 --gas-adjustment 1.8 \
  --gas-prices 0.025uxprt \
  --chain-id core-1 \
  --node https://rpc.core.persistence.one:443 \
  --keyring-backend test \
  --yes \
  --output json 2>&1) || ZK_STORE_RESULT=$(persistenceCore tx wasm store /app/artifacts/zk_verifier.wasm \
  --from deployer \
  --gas 1500000 --gas-adjustment 1.8 \
  --gas-prices 0.025uxprt \
  --chain-id core-1 \
  --node https://rpc.core.persistence.one:443 \
  --keyring-backend test \
  --yes \
  --output json 2>&1)

if [ $? -ne 0 ]; then
  echo "❌ Failed to store ZK Verifier"
  echo ""
  echo "Error details:"
  echo "$ZK_STORE_RESULT"
  echo ""
  echo "Possible causes:"
  echo "  - Contract too large (current: 166 KB)"
  echo "  - Insufficient gas (tried: 1,500,000)"
  echo "  - Network issues"
  echo ""
  exit 1
fi

# Extract code ID from transaction
ZK_TX_HASH=$(echo "$ZK_STORE_RESULT" | jq -r '.txhash // empty' 2>/dev/null)

if [ -z "$ZK_TX_HASH" ]; then
  echo -e "${YELLOW}⚠️  Could not extract TX hash from JSON response${NC}"
  echo "  Trying to parse from text output..."
  # Try to extract hash from non-JSON output (format: "txhash: ABC123...")
  ZK_TX_HASH=$(echo "$ZK_STORE_RESULT" | grep -oP '(?<=txhash: )[A-F0-9]{64}' | head -1)
  if [ -z "$ZK_TX_HASH" ]; then
    echo -e "${RED}❌ Failed to get transaction hash${NC}"
    echo "Raw response:"
    echo "$ZK_STORE_RESULT"
    exit 1
  fi
fi

echo -e "${GREEN}✅ Transaction submitted${NC}"
echo "  TX Hash: $ZK_TX_HASH"
echo "  Explorer: https://www.mintscan.io/persistence/tx/$ZK_TX_HASH"
echo ""
echo "⏳ Waiting 30 seconds for transaction confirmation..."
sleep 30

# Query transaction to get Code ID
echo "🔍 Querying transaction..."
ZK_TX_RESULT=$(persistenceCore query tx $ZK_TX_HASH --node https://rpc.core.persistence.one:443 --output json 2>/dev/null) || {
  echo -e "${YELLOW}⚠️  RPC query failed, checking Mintscan...${NC}"
  # Fallback to curl Mintscan API
  ZK_TX_RESULT=$(curl -s "https://lcd.core.persistence.one/cosmos/tx/v1beta1/txs/$ZK_TX_HASH" 2>/dev/null)
}
ZK_CODE_ID=$(echo "$ZK_TX_RESULT" | jq -r '.logs[0].events[] | select(.type=="store_code") | .attributes[] | select(.key=="code_id") | .value // empty' 2>/dev/null)

# Try alternative JSON paths if first attempt fails
if [ -z "$ZK_CODE_ID" ]; then
  ZK_CODE_ID=$(echo "$ZK_TX_RESULT" | jq -r '.tx_response.logs[0].events[] | select(.type=="store_code") | .attributes[] | select(.key=="code_id") | .value // empty' 2>/dev/null)
fi

# Try grep as last resort
if [ -z "$ZK_CODE_ID" ]; then
  ZK_CODE_ID=$(echo "$ZK_TX_RESULT" | grep -oP '"code_id":"?\K\d+' | head -1)
fi

if [ -z "$ZK_CODE_ID" ]; then
  echo -e "${RED}❌ Could not extract Code ID from transaction${NC}"
  echo ""
  echo "TX Result (first 500 chars):"
  echo "$ZK_TX_RESULT" | head -c 500
  echo ""
  echo -e "${YELLOW}Please check transaction manually:${NC}"
  echo "  https://www.mintscan.io/persistence/tx/$ZK_TX_HASH"
  echo ""
  echo "Then set the Code ID and continue:"
  echo "  export ZK_CODE_ID=<your_code_id>"
  echo ""
  exit 1
fi

echo -e "${GREEN}✅ ZK Verifier Code ID: $ZK_CODE_ID${NC}"
echo ""

echo ""
echo "🔐 Storing ibcTFUEL Minter contract..."
MINTER_STORE_RESULT=$(persistenceCore tx wasm store /app/artifacts/ibc_tfuel_minter.wasm \
  --from deployer \
  --gas 1500000 --gas-adjustment 1.8 \
  --gas-prices 0.025uxprt \
  --chain-id core-1 \
  --node https://rpc.core.persistence.one:443 \
  --keyring-backend test \
  --yes \
  --output json 2>&1)

if [ $? -ne 0 ]; then
  echo "❌ Failed to store Minter"
  echo ""
  echo "Error details:"
  echo "$MINTER_STORE_RESULT"
  echo ""
  echo "Possible causes:"
  echo "  - Contract too large (current: 194 KB)"
  echo "  - Insufficient gas (tried: 1,500,000)"
  echo "  - Network issues"
  echo ""
  exit 1
fi

MINTER_TX_HASH=$(echo "$MINTER_STORE_RESULT" | jq -r '.txhash')
echo "TX Hash: $MINTER_TX_HASH"
echo "Waiting for transaction confirmation..."
sleep 6

MINTER_TX_RESULT=$(persistenceCore query tx $MINTER_TX_HASH --node https://rpc.core.persistence.one:443 --output json)
MINTER_CODE_ID=$(echo "$MINTER_TX_RESULT" | jq -r '.logs[0].events[] | select(.type=="store_code") | .attributes[] | select(.key=="code_id") | .value')

echo "✅ ZK Verifier Code ID: $ZK_CODE_ID"
echo "✅ Minter Code ID: $MINTER_CODE_ID"
echo ""

echo "========================================================================"
echo "🎬 INSTANTIATING CONTRACTS"
echo "========================================================================"
echo ""

# Instantiate ZK Verifier
echo "🔐 Instantiating ZK Verifier..."
ZK_INIT_MSG='{"admin":"'$DEPLOYER_ADDR'","minter_contract":null}'

ZK_INIT_RESULT=$(persistenceCore tx wasm instantiate $ZK_CODE_ID "$ZK_INIT_MSG" \
  --from deployer \
  --label "xfuel-zk-verifier-v1" \
  --gas 500000 --gas-adjustment 1.8 \
  --gas-prices 0.025uxprt \
  --chain-id core-1 \
  --node https://rpc.core.persistence.one:443 \
  --keyring-backend test \
  --admin $DEPLOYER_ADDR \
  --yes \
  --output json 2>&1)

if [ $? -ne 0 ]; then
  echo "❌ Failed to instantiate ZK Verifier"
  echo "$ZK_INIT_RESULT"
  exit 1
fi

ZK_INIT_TX_HASH=$(echo "$ZK_INIT_RESULT" | jq -r '.txhash')
echo "TX Hash: $ZK_INIT_TX_HASH"
echo "Waiting for transaction confirmation..."
sleep 6

ZK_INIT_TX_RESULT=$(persistenceCore query tx $ZK_INIT_TX_HASH --node https://rpc.core.persistence.one:443 --output json)
ZK_ADDR=$(echo "$ZK_INIT_TX_RESULT" | jq -r '.logs[0].events[] | select(.type=="instantiate") | .attributes[] | select(.key=="_contract_address") | .value')

echo ""
echo "🪙 Instantiating ibcTFUEL Minter..."
MINTER_INIT_MSG='{"admin":"'$DEPLOYER_ADDR'","zk_verifier":"'$ZK_ADDR'","name":"Theta Fuel IBC","symbol":"ibcTFUEL","decimals":18,"initial_supply":"0","max_supply":"100000000000000000000"}'

MINTER_INIT_RESULT=$(persistenceCore tx wasm instantiate $MINTER_CODE_ID "$MINTER_INIT_MSG" \
  --from deployer \
  --label "xfuel-ibc-tfuel-minter-v1" \
  --gas 600000 --gas-adjustment 1.8 \
  --gas-prices 0.025uxprt \
  --chain-id core-1 \
  --node https://rpc.core.persistence.one:443 \
  --keyring-backend test \
  --admin $DEPLOYER_ADDR \
  --yes \
  --output json 2>&1)

if [ $? -ne 0 ]; then
  echo "❌ Failed to instantiate Minter"
  echo "$MINTER_INIT_RESULT"
  exit 1
fi

MINTER_INIT_TX_HASH=$(echo "$MINTER_INIT_RESULT" | jq -r '.txhash')
echo "TX Hash: $MINTER_INIT_TX_HASH"
echo "Waiting for transaction confirmation..."
sleep 6

MINTER_INIT_TX_RESULT=$(persistenceCore query tx $MINTER_INIT_TX_HASH --node https://rpc.core.persistence.one:443 --output json)
MINTER_ADDR=$(echo "$MINTER_INIT_TX_RESULT" | jq -r '.logs[0].events[] | select(.type=="instantiate") | .attributes[] | select(.key=="_contract_address") | .value')


echo "✅ ZK Verifier: $ZK_ADDR"
echo "✅ ibcTFUEL Minter: $MINTER_ADDR"
echo ""

echo "========================================================================"
echo "💾 SAVING CONFIGURATION"
echo "========================================================================"
echo ""

# Append to .env file
cat >> /app/.env << EOF

# Persistence Deployment (Docker - $(date))
PERSISTENCE_DEPLOYER=$DEPLOYER_ADDR
ZK_VERIFIER_CODE_ID=$ZK_CODE_ID
MINTER_CODE_ID=$MINTER_CODE_ID
ZK_VERIFIER_ADDRESS=$ZK_ADDR
IBCTFUEL_MINTER_ADDRESS=$MINTER_ADDR
EOF

echo "✅ Configuration saved to .env"
echo ""

echo "========================================================================"
echo "✅ DEPLOYMENT COMPLETE"
echo "========================================================================"
echo ""
echo "Deployed to: Persistence Mainnet (core-1)"
echo "Deployer: $DEPLOYER_ADDR"
echo ""
echo "📋 Addresses:"
echo "  ZK Verifier:    $ZK_ADDR"
echo "  ibcTFUEL Minter: $MINTER_ADDR"
echo ""
echo "🔗 Explorers:"
echo "  https://www.mintscan.io/persistence/account/$ZK_ADDR"
echo "  https://www.mintscan.io/persistence/account/$MINTER_ADDR"
echo ""
echo "📝 Next Steps:"
echo "  1. Test mint: docker-compose --profile test up test-persistence-mint"
echo "  2. Run E2E test: ./scripts/test-e2e-bridge.sh"
echo ""

