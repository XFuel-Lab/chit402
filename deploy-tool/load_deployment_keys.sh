#!/bin/bash
set -e

# ============================================================================
# XFuel Protocol - AWS Secrets Manager Key Loader (Bash Version)
# ============================================================================
# 
# Retrieves SP1_PRIVATE_KEY and PERSISTENCE_DEPLOYER mnemonic from AWS
# 
# Usage:
#   source load_deployment_keys.sh
#   # Keys will be available as $SP1_PRIVATE_KEY and $PERSISTENCE_MNEMONIC
# 
# Prerequisites:
#   - AWS CLI installed and configured
#   - AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY set
#   - Read access to secrets in AWS Secrets Manager

echo "🔐 Loading deployment keys from AWS Secrets Manager..."
echo ""

# Configuration
AWS_REGION=${AWS_REGION:-us-east-1}
AWS_ACCOUNT_ID=${AWS_ACCOUNT_ID:-"REPLACE_WITH_YOUR_ACCOUNT_ID"}

# ARNs
SP1_KEY_ARN="arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:SP1_PRIVATE_KEY"
PERSISTENCE_MNEMONIC_ARN="arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:PERSISTENCE_DEPLOYER"

# Retrieve SP1_PRIVATE_KEY
echo "📥 Retrieving SP1_PRIVATE_KEY..."
export SP1_PRIVATE_KEY=$(aws secretsmanager get-secret-value \
  --secret-id "$SP1_KEY_ARN" \
  --query SecretString \
  --output text 2>/dev/null)

if [ -z "$SP1_PRIVATE_KEY" ]; then
  echo "❌ Failed to retrieve SP1_PRIVATE_KEY"
  echo "   ARN: $SP1_KEY_ARN"
  echo "   Check AWS credentials and ARN format"
  exit 1
fi

echo "✅ SP1_PRIVATE_KEY loaded (${SP1_PRIVATE_KEY:0:16}...)"

# Retrieve PERSISTENCE_DEPLOYER mnemonic
echo ""
echo "📥 Retrieving PERSISTENCE_DEPLOYER mnemonic..."
export PERSISTENCE_MNEMONIC=$(aws secretsmanager get-secret-value \
  --secret-id "$PERSISTENCE_MNEMONIC_ARN" \
  --query SecretString \
  --output text 2>/dev/null)

if [ -z "$PERSISTENCE_MNEMONIC" ]; then
  echo "❌ Failed to retrieve PERSISTENCE_DEPLOYER"
  echo "   ARN: $PERSISTENCE_MNEMONIC_ARN"
  echo "   Check AWS credentials and ARN format"
  exit 1
fi

WORD_COUNT=$(echo "$PERSISTENCE_MNEMONIC" | wc -w | tr -d ' ')
PREVIEW=$(echo "$PERSISTENCE_MNEMONIC" | awk '{print $1, $2, $3, "..."}')
echo "✅ PERSISTENCE_MNEMONIC loaded ($WORD_COUNT words)"
echo "   Preview: $PREVIEW"

echo ""
echo "✅ All deployment keys loaded successfully!"
echo ""
echo "📝 Keys are now available as environment variables:"
echo "   \$SP1_PRIVATE_KEY"
echo "   \$PERSISTENCE_MNEMONIC"
echo ""
echo "🔧 Import deployer key to persistenced:"
echo "   echo \"\$PERSISTENCE_MNEMONIC\" | persistenced keys add deployer --recover"
echo ""
echo "🚀 Ready for deployment!"
