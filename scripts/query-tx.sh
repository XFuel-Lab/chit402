#!/bin/bash
TX_HASH=$1
echo "Querying transaction: $TX_HASH"
echo ""

RESULT=$(persistenceCore query tx $TX_HASH --node https://rpc.core.persistence.one:443 --output json)

echo "Status Code:" 
echo "$RESULT" | jq -r '.code'

echo ""
echo "Gas Used:"
echo "$RESULT" | jq -r '.gas_used'

echo ""
echo "Code ID:"
echo "$RESULT" | jq -r '.logs[0].events[] | select(.type=="store_code") | .attributes[] | select(.key=="code_id") | .value'


