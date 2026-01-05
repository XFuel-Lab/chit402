#!/bin/bash
set -e

echo "========================================================================"
echo "🏛️  PERSISTENCE DEPLOYMENT VIA GOVERNANCE PROPOSAL"
echo "========================================================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Check environment variables
if [ -z "$KEPLR_MNEMONIC" ]; then
  echo -e "${RED}❌ KEPLR_MNEMONIC not set in .env.docker${NC}"
  exit 1
fi

# Import wallet
echo "🔐 Importing wallet..."
echo "$KEPLR_MNEMONIC" | persistenceCore keys add xfuel-deployer --recover --keyring-backend test 2>/dev/null || \
  echo "$KEPLR_MNEMONIC" | persistenceCore keys add deployer --recover --keyring-backend test 2>/dev/null || true

# Get address
DEPLOYER_ADDR=$(persistenceCore keys show xfuel-deployer -a --keyring-backend test 2>/dev/null) || \
  DEPLOYER_ADDR=$(persistenceCore keys show deployer -a --keyring-backend test 2>/dev/null)

if [ -z "$DEPLOYER_ADDR" ]; then
  echo -e "${RED}❌ Failed to get deployer address${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Wallet loaded: $DEPLOYER_ADDR${NC}"
echo ""

# Check balance
echo "💰 Checking balance..."
BALANCE_JSON=$(persistenceCore query bank balances $DEPLOYER_ADDR --node https://rpc.core.persistence.one:443 -o json 2>/dev/null || echo '{"balances":[]}')
BALANCE=$(echo $BALANCE_JSON | jq -r '.balances[0].amount // "0"')
BALANCE_XPRT=$(awk "BEGIN {printf \"%.6f\", $BALANCE / 1000000}")

echo "Balance: $BALANCE_XPRT XPRT ($BALANCE uxprt)"
echo ""

if [ "$BALANCE" -lt "1000000" ]; then
  echo -e "${YELLOW}⚠️  WARNING: Low balance. Need at least 1 XPRT for proposals${NC}"
  echo "Current: $BALANCE_XPRT XPRT"
  echo ""
fi

# Check for optimized contracts
if [ ! -f "/app/artifacts/zk_verifier.wasm" ] || [ ! -f "/app/artifacts/ibc_tfuel_minter.wasm" ]; then
  echo -e "${RED}❌ Optimized contracts not found in artifacts/${NC}"
  exit 1
fi

echo "✅ Using optimized contracts from artifacts/"
ls -lh /app/artifacts/*.wasm
echo ""

ZK_SIZE=$(wc -c < /app/artifacts/zk_verifier.wasm)
MINTER_SIZE=$(wc -c < /app/artifacts/ibc_tfuel_minter.wasm)
echo "📦 Contract sizes:"
awk "BEGIN {printf \"  ZK Verifier:     %.2f KB\n\", $ZK_SIZE / 1024}"
awk "BEGIN {printf \"  ibcTFUEL Minter: %.2f KB\n\", $MINTER_SIZE / 1024}"
echo ""

echo "========================================================================"
echo "🏛️  SUBMITTING GOVERNANCE PROPOSALS"
echo "========================================================================"
echo ""

# Submit proposal for ZK Verifier
echo "📝 Creating governance proposal for ZK Verifier..."

ZK_PROPOSAL_JSON='{
  "title": "Store XFuel ZK Verifier Contract",
  "description": "Proposal to store the XFuel ZK Verifier smart contract (166KB optimized) for cross-chain bridge with zero-knowledge proof verification. This contract enables secure TFUEL bridging from Theta to Persistence.",
  "run_as": "'$DEPLOYER_ADDR'",
  "wasm_byte_code": "'$(base64 -w 0 /app/artifacts/zk_verifier.wasm)'",
  "instantiate_permission": {
    "permission": "Everybody"
  },
  "source": "https://github.com/xfuel-protocol",
  "builder": "cosmwasm/optimizer:0.16.0"
}'

echo "$ZK_PROPOSAL_JSON" > /tmp/zk_proposal.json

echo "🚀 Submitting ZK Verifier governance proposal..."
ZK_PROPOSAL_RESULT=$(persistenceCore tx gov submit-proposal wasm-store \
  /app/artifacts/zk_verifier.wasm \
  --title "Store XFuel ZK Verifier Contract" \
  --description "Proposal to store the XFuel ZK Verifier smart contract (166KB optimized) for cross-chain bridge with zero-knowledge proof verification" \
  --run-as $DEPLOYER_ADDR \
  --instantiate-everybody true \
  --deposit 1000000uxprt \
  --from xfuel-deployer \
  --gas 2000000 \
  --gas-adjustment 2.0 \
  --gas-prices 0.025uxprt \
  --chain-id core-1 \
  --node https://rpc.core.persistence.one:443 \
  --keyring-backend test \
  --yes \
  --output json 2>&1) || \
ZK_PROPOSAL_RESULT=$(persistenceCore tx gov submit-proposal wasm-store \
  /app/artifacts/zk_verifier.wasm \
  --title "Store XFuel ZK Verifier Contract" \
  --description "Proposal to store XFuel ZK Verifier for bridge" \
  --run-as $DEPLOYER_ADDR \
  --instantiate-everybody true \
  --deposit 1000000uxprt \
  --from deployer \
  --gas 2000000 \
  --gas-adjustment 2.0 \
  --gas-prices 0.025uxprt \
  --chain-id core-1 \
  --node https://rpc.core.persistence.one:443 \
  --keyring-backend test \
  --yes \
  --output json 2>&1)

# Extract TX hash
ZK_PROPOSAL_TX=$(echo "$ZK_PROPOSAL_RESULT" | jq -r '.txhash // empty' 2>/dev/null)
if [ -z "$ZK_PROPOSAL_TX" ]; then
  ZK_PROPOSAL_TX=$(echo "$ZK_PROPOSAL_RESULT" | grep -oP '(?<=txhash: )[A-F0-9]{64}' | head -1)
fi

if [ -z "$ZK_PROPOSAL_TX" ]; then
  echo -e "${RED}❌ Failed to submit ZK Verifier proposal${NC}"
  echo "Error:"
  echo "$ZK_PROPOSAL_RESULT"
  exit 1
fi

echo -e "${GREEN}✅ ZK Verifier proposal submitted${NC}"
echo "  TX Hash: $ZK_PROPOSAL_TX"
echo "  Explorer: https://www.mintscan.io/persistence/tx/$ZK_PROPOSAL_TX"
echo ""
echo "⏳ Waiting 15 seconds for proposal to be created..."
sleep 15

# Query proposal ID
echo "🔍 Querying proposal ID..."
ZK_PROPOSAL_ID=$(persistenceCore query gov proposals --node https://rpc.core.persistence.one:443 --output json 2>/dev/null | \
  jq -r '.proposals | sort_by(.id | tonumber) | .[-1].id' 2>/dev/null)

if [ -z "$ZK_PROPOSAL_ID" ] || [ "$ZK_PROPOSAL_ID" = "null" ]; then
  echo -e "${YELLOW}⚠️  Could not auto-detect proposal ID${NC}"
  echo "Please check manually:"
  echo "  https://www.mintscan.io/persistence/proposals"
  echo ""
  read -p "Enter ZK Verifier Proposal ID: " ZK_PROPOSAL_ID
fi

echo -e "${GREEN}✅ ZK Verifier Proposal ID: $ZK_PROPOSAL_ID${NC}"
echo ""

# Vote on proposal
echo "🗳️  Voting YES on ZK Verifier proposal..."
ZK_VOTE_RESULT=$(persistenceCore tx gov vote $ZK_PROPOSAL_ID yes \
  --from xfuel-deployer \
  --gas 300000 \
  --gas-prices 0.025uxprt \
  --chain-id core-1 \
  --node https://rpc.core.persistence.one:443 \
  --keyring-backend test \
  --yes \
  --output json 2>&1) || \
ZK_VOTE_RESULT=$(persistenceCore tx gov vote $ZK_PROPOSAL_ID yes \
  --from deployer \
  --gas 300000 \
  --gas-prices 0.025uxprt \
  --chain-id core-1 \
  --node https://rpc.core.persistence.one:443 \
  --keyring-backend test \
  --yes \
  --output json 2>&1)

echo -e "${GREEN}✅ Vote submitted${NC}"
echo ""

# Repeat for Minter
echo "========================================================================"
echo "📝 Creating governance proposal for ibcTFUEL Minter..."
echo "========================================================================"
echo ""

MINTER_PROPOSAL_RESULT=$(persistenceCore tx gov submit-proposal wasm-store \
  /app/artifacts/ibc_tfuel_minter.wasm \
  --title "Store XFuel ibcTFUEL Minter Contract" \
  --description "Proposal to store the XFuel ibcTFUEL Minter contract (194KB optimized) for CW20 token minting with pause/cap controls" \
  --run-as $DEPLOYER_ADDR \
  --instantiate-everybody true \
  --deposit 1000000uxprt \
  --from xfuel-deployer \
  --gas 2000000 \
  --gas-adjustment 2.0 \
  --gas-prices 0.025uxprt \
  --chain-id core-1 \
  --node https://rpc.core.persistence.one:443 \
  --keyring-backend test \
  --yes \
  --output json 2>&1) || \
MINTER_PROPOSAL_RESULT=$(persistenceCore tx gov submit-proposal wasm-store \
  /app/artifacts/ibc_tfuel_minter.wasm \
  --title "Store XFuel ibcTFUEL Minter Contract" \
  --description "Proposal to store ibcTFUEL Minter for CW20 token" \
  --run-as $DEPLOYER_ADDR \
  --instantiate-everybody true \
  --deposit 1000000uxprt \
  --from deployer \
  --gas 2000000 \
  --gas-adjustment 2.0 \
  --gas-prices 0.025uxprt \
  --chain-id core-1 \
  --node https://rpc.core.persistence.one:443 \
  --keyring-backend test \
  --yes \
  --output json 2>&1)

MINTER_PROPOSAL_TX=$(echo "$MINTER_PROPOSAL_RESULT" | jq -r '.txhash // empty' 2>/dev/null)
if [ -z "$MINTER_PROPOSAL_TX" ]; then
  MINTER_PROPOSAL_TX=$(echo "$MINTER_PROPOSAL_RESULT" | grep -oP '(?<=txhash: )[A-F0-9]{64}' | head -1)
fi

echo -e "${GREEN}✅ Minter proposal submitted${NC}"
echo "  TX Hash: $MINTER_PROPOSAL_TX"
echo ""
echo "⏳ Waiting 15 seconds..."
sleep 15

MINTER_PROPOSAL_ID=$(persistenceCore query gov proposals --node https://rpc.core.persistence.one:443 --output json 2>/dev/null | \
  jq -r '.proposals | sort_by(.id | tonumber) | .[-1].id' 2>/dev/null)

echo -e "${GREEN}✅ Minter Proposal ID: $MINTER_PROPOSAL_ID${NC}"
echo ""

# Vote on minter proposal
echo "🗳️  Voting YES on Minter proposal..."
persistenceCore tx gov vote $MINTER_PROPOSAL_ID yes \
  --from xfuel-deployer \
  --gas 300000 \
  --gas-prices 0.025uxprt \
  --chain-id core-1 \
  --node https://rpc.core.persistence.one:443 \
  --keyring-backend test \
  --yes || \
persistenceCore tx gov vote $MINTER_PROPOSAL_ID yes \
  --from deployer \
  --gas 300000 \
  --gas-prices 0.025uxprt \
  --chain-id core-1 \
  --node https://rpc.core.persistence.one:443 \
  --keyring-backend test \
  --yes

echo -e "${GREEN}✅ Vote submitted${NC}"
echo ""

echo "========================================================================"
echo "⏰ WAITING FOR VOTING PERIOD"
echo "========================================================================"
echo ""
echo -e "${YELLOW}Governance proposals require a voting period (usually 3-7 days)${NC}"
echo ""
echo "📋 Your Proposals:"
echo "  ZK Verifier Proposal: #$ZK_PROPOSAL_ID"
echo "    https://www.mintscan.io/persistence/proposals/$ZK_PROPOSAL_ID"
echo ""
echo "  Minter Proposal: #$MINTER_PROPOSAL_ID"
echo "    https://www.mintscan.io/persistence/proposals/$MINTER_PROPOSAL_ID"
echo ""
echo "📝 Next Steps:"
echo "  1. Share proposals with community for voting"
echo "  2. Wait for voting period to complete"
echo "  3. After proposals pass, code will be stored automatically"
echo "  4. Check proposal status: persistenceCore query gov proposal <ID>"
echo "  5. After passing, instantiate contracts with obtained code_id"
echo ""
echo "💡 Tip: For faster deployment, consider:"
echo "  - Using testnet first (no governance required)"
echo "  - Requesting wasm upload permissions from chain governance"
echo "  - Using a permissioned deployment address"
echo ""

# Save proposal IDs
cat >> /app/.env << EOF

# Governance Proposals ($(date))
ZK_VERIFIER_PROPOSAL_ID=$ZK_PROPOSAL_ID
MINTER_PROPOSAL_ID=$MINTER_PROPOSAL_ID
ZK_VERIFIER_PROPOSAL_TX=$ZK_PROPOSAL_TX
MINTER_PROPOSAL_TX=$MINTER_PROPOSAL_TX
EOF

echo "✅ Proposal IDs saved to .env"
echo ""

