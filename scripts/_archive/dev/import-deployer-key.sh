#!/bin/bash
# Secure Key Import Script for PERSISTENCE_DEPLOYER
# This script imports the mnemonic from AWS Secrets Manager

set -e

KEY_NAME="PERSISTENCE_DEPLOYER"
EXPECTED_ADDRESS="persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx"
SECRET_NAME="PERSISTENCE_DEPLOYER"

echo "=========================================="
echo "🔐 PERSISTENCE_DEPLOYER Key Import"
echo "=========================================="
echo ""

# Check if key already exists
if persistenced keys show $KEY_NAME -a --keyring-backend file >/dev/null 2>&1; then
    EXISTING=$(persistenced keys show $KEY_NAME -a --keyring-backend file)
    if [ "$EXISTING" == "$EXPECTED_ADDRESS" ]; then
        echo "✅ Key already exists with correct address"
        echo "   Address: $EXISTING"
        exit 0
    else
        echo "❌ ERROR: Key exists but address mismatch!"
        echo "   Expected: $EXPECTED_ADDRESS"
        echo "   Found: $EXISTING"
        exit 1
    fi
fi

# Retrieve mnemonic from AWS Secrets Manager
echo "📥 Retrieving mnemonic from AWS Secrets Manager..."
echo "   Secret: $SECRET_NAME"
echo ""

MNEMONIC=$(aws secretsmanager get-secret-value \
    --secret-id "$SECRET_NAME" \
    --query SecretString \
    --output text 2>&1)

if [ $? -ne 0 ]; then
    echo "❌ ERROR: Failed to retrieve secret from AWS"
    echo "$MNEMONIC"
    echo ""
    echo "Troubleshooting:"
    echo "  1. Check AWS CLI is configured: aws configure list"
    echo "  2. Check IAM permissions for Secrets Manager"
    echo "  3. Verify secret name: $SECRET_NAME"
    exit 1
fi

# Check if mnemonic is JSON format (uncomment if needed)
# MNEMONIC=$(echo "$MNEMONIC" | jq -r .mnemonic)

echo "📝 Importing key to persistenced keyring..."
echo "$MNEMONIC" | persistenced keys add $KEY_NAME \
    --recover \
    --keyring-backend file

# Clear from memory
MNEMONIC=""
unset MNEMONIC

echo ""
echo "✅ Key imported successfully"
echo ""

# Verify address
DERIVED=$(persistenced keys show $KEY_NAME -a --keyring-backend file)
echo "🔍 Verifying derived address..."
echo "   Derived:  $DERIVED"
echo "   Expected: $EXPECTED_ADDRESS"
echo ""

if [ "$DERIVED" != "$EXPECTED_ADDRESS" ]; then
    echo "❌ ERROR: Address verification failed!"
    echo ""
    echo "The imported mnemonic derives to a different address."
    echo "This could mean:"
    echo "  1. Wrong mnemonic in AWS Secrets Manager"
    echo "  2. Wrong derivation path"
    echo "  3. Wrong secret name"
    exit 1
fi

echo "✅ Address verified successfully!"
echo "🎉 PERSISTENCE_DEPLOYER is ready for deployment"
echo ""
echo "=========================================="
