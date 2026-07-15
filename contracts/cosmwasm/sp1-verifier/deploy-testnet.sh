#!/usr/bin/env bash
#
# xfuel-zk-verifier — Cosmos Testnet Deployment Script
#
# Deploys the ZK verifier contract to Osmosis testnet or Akash testnet.
#
# Prerequisites:
#   - Rust toolchain with wasm32-unknown-unknown target
#   - Docker (for cosmwasm/optimizer)
#   - osmosisd or akash CLI installed
#   - Wallet with testnet tokens
#
# Usage:
#   ./deploy-testnet.sh osmosis   # Deploy to Osmosis testnet
#   ./deploy-testnet.sh akash     # Deploy to Akash testnet
#

set -euo pipefail

CHAIN="${1:-osmosis}"
CONTRACT_DIR="$(cd "$(dirname "$0")" && pwd)"
ARTIFACTS_DIR="${CONTRACT_DIR}/artifacts"

# ─── Chain Configuration ──────────────────────────────────────────────────────

case "$CHAIN" in
  osmosis)
    CLI="osmosisd"
    CHAIN_ID="osmo-test-5"
    NODE="https://rpc.testnet.osmosis.zone:443"
    GAS_PRICES="0.025uosmo"
    GAS_ADJUSTMENT="1.5"
    DENOM="uosmo"
    ;;
  akash)
    CLI="akash"
    CHAIN_ID="sandbox-01"
    NODE="https://rpc.sandbox-01.aksh.pw:443"
    GAS_PRICES="0.025uakt"
    GAS_ADJUSTMENT="1.5"
    DENOM="uakt"
    ;;
  *)
    echo "Usage: $0 {osmosis|akash}"
    exit 1
    ;;
esac

TXFLAGS="--chain-id $CHAIN_ID --node $NODE --gas-prices $GAS_PRICES --gas-adjustment $GAS_ADJUSTMENT --gas auto -y"

echo "═══════════════════════════════════════════════════════════════"
echo " XFuel ZK Verifier — Deploying to $CHAIN testnet ($CHAIN_ID)"
echo "═══════════════════════════════════════════════════════════════"

# ─── Step 1: Build & Optimize WASM ────────────────────────────────────────────

echo ""
echo "▸ Step 1: Building optimized WASM binary..."

cd "$CONTRACT_DIR"

ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then
  OPTIMIZER_IMAGE="cosmwasm/optimizer-arm64:0.16.0"
else
  OPTIMIZER_IMAGE="cosmwasm/optimizer:0.16.0"
fi

docker run --rm -v "$(pwd)":/code \
  --mount type=volume,source="$(basename "$(pwd)")_cache",target=/code/target \
  --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
  "$OPTIMIZER_IMAGE"

WASM_FILE=$(ls "${ARTIFACTS_DIR}/"*.wasm 2>/dev/null | head -n1)
if [ -z "$WASM_FILE" ]; then
  echo "ERROR: No .wasm file found in ${ARTIFACTS_DIR}"
  exit 1
fi
echo "  ✓ Built: $(basename "$WASM_FILE")"
echo "  ✓ Size: $(wc -c < "$WASM_FILE") bytes"

# ─── Step 2: Upload WASM to Chain ─────────────────────────────────────────────

echo ""
echo "▸ Step 2: Uploading WASM to $CHAIN testnet..."

UPLOAD_TX=$($CLI tx wasm store "$WASM_FILE" \
  --from deployer \
  $TXFLAGS \
  --output json | jq -r '.txhash')

echo "  ✓ Upload TX: $UPLOAD_TX"
echo "  ⏳ Waiting for confirmation..."
sleep 10

CODE_ID=$($CLI query tx "$UPLOAD_TX" --node "$NODE" --output json | \
  jq -r '.events[] | select(.type=="store_code") | .attributes[] | select(.key=="code_id") | .value')

echo "  ✓ Code ID: $CODE_ID"

# ─── Step 3: Instantiate Contract ─────────────────────────────────────────────

echo ""
echo "▸ Step 3: Instantiating xfuel-zk-verifier..."

DEPLOYER_ADDR=$($CLI keys show deployer -a)

INIT_MSG=$(cat <<EOF
{
  "admin": "$DEPLOYER_ADDR",
  "mock_mode": true
}
EOF
)

INIT_TX=$($CLI tx wasm instantiate "$CODE_ID" "$INIT_MSG" \
  --from deployer \
  --label "xfuel-zk-verifier-testnet" \
  --admin "$DEPLOYER_ADDR" \
  $TXFLAGS \
  --output json | jq -r '.txhash')

echo "  ✓ Instantiate TX: $INIT_TX"
sleep 10

CONTRACT_ADDR=$($CLI query wasm list-contract-by-code "$CODE_ID" \
  --node "$NODE" --output json | jq -r '.contracts[-1]')

echo "  ✓ Contract Address: $CONTRACT_ADDR"

# ─── Step 4: Register Test Circuit ────────────────────────────────────────────

echo ""
echo "▸ Step 4: Registering test circuit (ai_task)..."

REGISTER_MSG=$(cat <<EOF
{
  "register_circuit": {
    "circuit_id": "ai_task",
    "program_vkey": "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    "label": "AI Task Circuit (testnet)"
  }
}
EOF
)

$CLI tx wasm execute "$CONTRACT_ADDR" "$REGISTER_MSG" \
  --from deployer \
  $TXFLAGS \
  --output json > /dev/null

echo "  ✓ Circuit 'ai_task' registered"

# ─── Step 5: Verify Deployment ────────────────────────────────────────────────

echo ""
echo "▸ Step 5: Verifying deployment..."

CONFIG_QUERY='{"get_config":{}}'
CONFIG_RESULT=$($CLI query wasm contract-state smart "$CONTRACT_ADDR" "$CONFIG_QUERY" \
  --node "$NODE" --output json)

STATS_QUERY='{"get_stats":{}}'
STATS_RESULT=$($CLI query wasm contract-state smart "$CONTRACT_ADDR" "$STATS_QUERY" \
  --node "$NODE" --output json)

echo "  Config: $CONFIG_RESULT"
echo "  Stats:  $STATS_RESULT"

# ─── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo " Deployment Complete"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo " Chain:     $CHAIN testnet ($CHAIN_ID)"
echo " Code ID:   $CODE_ID"
echo " Contract:  $CONTRACT_ADDR"
echo " Mock Mode: true (set to false for production verification)"
echo ""
echo " Next steps:"
echo "   1. Fund the contract if needed"
echo "   2. Register production circuits with real SP1 program vkeys"
echo "   3. Set mock_mode to false when BN254 verification is ready"
echo "   4. Submit governance proposal for mainnet whitelisting"
echo ""
