#!/bin/bash
# XFuel Reverse Bridge Mainnet Deployment - Pre-flight Checks
set -e

echo "=========================================="
echo "XFuel Reverse Bridge Pre-Flight Checks"
echo "=========================================="
echo ""

# Configuration
export CHAIN_ID="core-1"
export RPC_URL="https://rpc.persistence.one:443"
export KEY_NAME="PERSISTENCE_DEPLOYER"
export DEPLOYER_ADDRESS="persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx"
export ADMIN_ADDRESS="persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e"

# Step 1: Check AWS credentials
echo "Step 1: Checking AWS credentials..."
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    echo "❌ AWS credentials not configured"
    echo "Run: aws configure"
    exit 1
fi
echo "✓ AWS credentials configured"
echo ""

# Step 2: Import or verify key
echo "Step 2: Checking PERSISTENCE_DEPLOYER key..."
if persistenced keys show $KEY_NAME -a --keyring-backend file >/dev/null 2>&1; then
    EXISTING=$(persistenced keys show $KEY_NAME -a --keyring-backend file)
    if [ "$EXISTING" == "$DEPLOYER_ADDRESS" ]; then
        echo "✓ Key exists: $EXISTING"
    else
        echo "❌ ERROR: Key exists but address mismatch!"
        echo "  Expected: $DEPLOYER_ADDRESS"
        echo "  Found: $EXISTING"
        exit 1
    fi
else
    echo "Importing key from AWS Secrets Manager..."
    MNEMONIC=$(aws secretsmanager get-secret-value \
        --secret-id "PERSISTENCE_DEPLOYER" \
        --query SecretString \
        --output text 2>&1)
    
    if [ $? -ne 0 ]; then
        echo "❌ Failed to retrieve secret from AWS"
        echo "$MNEMONIC"
        exit 1
    fi
    
    echo "$MNEMONIC" | persistenced keys add $KEY_NAME \
        --recover \
        --keyring-backend file
    
    MNEMONIC=""
    unset MNEMONIC
    
    DERIVED=$(persistenced keys show $KEY_NAME -a --keyring-backend file)
    echo "✓ Key imported: $DERIVED"
    
    if [ "$DERIVED" != "$DEPLOYER_ADDRESS" ]; then
        echo "❌ ERROR: Address mismatch!"
        exit 1
    fi
fi
echo ""

# Step 3: Check balance
echo "Step 3: Checking wallet balance..."
BALANCE=$(persistenced query bank balances $DEPLOYER_ADDRESS \
    --node $RPC_URL \
    --output json 2>/dev/null | jq -r '.balances[] | select(.denom=="uxprt") | .amount')

if [ -z "$BALANCE" ]; then
    echo "❌ ERROR: No XPRT balance found!"
    exit 1
fi

BALANCE_XPRT=$((BALANCE / 1000000))
echo "  Balance: $BALANCE_XPRT XPRT"

if [ $BALANCE_XPRT -lt 5 ]; then
    echo "⚠️  WARNING: Balance is low (< 5 XPRT)"
fi
echo ""

# Step 4: Verify WASMs exist
echo "Step 4: Checking WASM files..."
cd /mnt/c/Users/seeha/xfuel-protocol/cosmwasm-contracts/artifacts

if [ ! -f "persistence_minter.wasm" ]; then
    echo "❌ ERROR: persistence_minter.wasm not found!"
    exit 1
fi

if [ ! -f "fee_collector.wasm" ]; then
    echo "❌ ERROR: fee_collector.wasm not found!"
    exit 1
fi

echo "✓ WASM files found"
echo ""

# Step 5: Verify checksums
echo "Step 5: Verifying checksums..."
MINTER_HASH=$(sha256sum persistence_minter.wasm | awk '{print $1}')
FEE_HASH=$(sha256sum fee_collector.wasm | awk '{print $1}')

EXPECTED_MINTER="516db0e88509afb90e3055b320691de68387ace97a9a34a72e5621ad3778b748"
EXPECTED_FEE="7a370b84ea0ed94df29b2acd2804d73bc27fa1d5a325e2bdd76b3861438f5acd"

echo "  persistence_minter.wasm:"
echo "    Actual:   $MINTER_HASH"
echo "    Expected: $EXPECTED_MINTER"
if [ "$MINTER_HASH" != "$EXPECTED_MINTER" ]; then
    echo "    ❌ Checksum mismatch!"
    exit 1
fi
echo "    ✓ Verified"
echo ""

echo "  fee_collector.wasm:"
echo "    Actual:   $FEE_HASH"
echo "    Expected: $EXPECTED_FEE"
if [ "$FEE_HASH" != "$EXPECTED_FEE" ]; then
    echo "    ❌ Checksum mismatch!"
    exit 1
fi
echo "    ✓ Verified"
echo ""

echo "=========================================="
echo "✅ PRE-FLIGHT CHECKS COMPLETE"
echo "=========================================="
echo ""
echo "Configuration:"
echo "  Chain ID: $CHAIN_ID"
echo "  RPC: $RPC_URL"
echo "  Deployer: $DEPLOYER_ADDRESS"
echo "  Admin: $ADMIN_ADDRESS"
echo "  Balance: $BALANCE_XPRT XPRT"
echo ""
echo "Ready to deploy to Persistence MAINNET!"
echo ""
echo "You are now ready to deploy."
echo "Follow the commands in MAINNET_DEPLOYMENT_SCRIPT.md"
echo "starting from Step 6 (Upload WASMs)"
echo ""
