#!/bin/bash
set -e

echo "🚀 SP1 Prover Starting..."
echo "================================"

# Check if we have an ARN to fetch from AWS Secrets Manager
if [[ "$SP1_PRIVATE_KEY_ARN" == arn:aws:secretsmanager* ]]; then
    echo "🔐 Loading SP1 key from AWS Secrets Manager..."
    echo "   ARN: ${SP1_PRIVATE_KEY_ARN:0:50}..."
    echo "   Region: ${AWS_REGION:-us-east-1}"
    
    # Fetch secret using AWS CLI
    SECRET_VALUE=$(aws secretsmanager get-secret-value \
        --secret-id "$SP1_PRIVATE_KEY_ARN" \
        --query 'SecretString' \
        --output text \
        --region "${AWS_REGION:-us-east-1}" 2>&1)
    
    if [ $? -eq 0 ]; then
        # Handle JSON format ({"key": "value"} or {"sp1_private_key": "value"})
        if echo "$SECRET_VALUE" | jq -e . > /dev/null 2>&1; then
            # Try common key names
            EXTRACTED_KEY=$(echo "$SECRET_VALUE" | jq -r '
                .sp1_private_key // 
                .SP1_PRIVATE_KEY // 
                .private_key // 
                .key // 
                .value // 
                .password // 
                .
            ')
            if [ "$EXTRACTED_KEY" != "null" ] && [ -n "$EXTRACTED_KEY" ]; then
                SP1_PRIVATE_KEY="$EXTRACTED_KEY"
            else
                SP1_PRIVATE_KEY="$SECRET_VALUE"
            fi
        else
            # Plain text value
            SP1_PRIVATE_KEY="$SECRET_VALUE"
        fi
        
        export SP1_PRIVATE_KEY
        echo "✅ SP1 key loaded successfully from AWS"
    else
        echo "⚠️  Failed to fetch from AWS: $SECRET_VALUE"
        echo "   Falling back to environment variable..."
    fi
elif [ -n "$SP1_PRIVATE_KEY_ARN" ]; then
    # It's set but not an ARN - use as direct value
    echo "🔑 Using SP1_PRIVATE_KEY_ARN as direct value"
    export SP1_PRIVATE_KEY="$SP1_PRIVATE_KEY_ARN"
fi

# Check what mode we're running in
if [ -n "$SP1_PRIVATE_KEY" ]; then
    # SP1 SDK expects NETWORK_PRIVATE_KEY
    export NETWORK_PRIVATE_KEY="$SP1_PRIVATE_KEY"
    echo "🌐 SP1 Network mode enabled (<1s proving)"
    echo "   Key format: ${SP1_PRIVATE_KEY:0:6}...${SP1_PRIVATE_KEY: -4} (${#SP1_PRIVATE_KEY} chars)"
else
    echo "⚠️  No SP1 key - using local mock mode (~170s proving)"
fi

echo "================================"
echo "Starting prover server on port 8080..."

# Start the prover
exec /app/target/release/prove serve --port 8080
