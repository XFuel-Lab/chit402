#!/bin/bash

# Check Persistence transaction status on Mintscan
TX_HASH="27D668D3ECE0C271EE313A3AB4E9A48DC26B0606D922D13B8370EF826C2F0ECB"

echo "========================================================================"
echo "🔍 CHECKING TRANSACTION STATUS"
echo "========================================================================"
echo ""
echo "TX Hash: $TX_HASH"
echo ""

# Check via Mintscan API
echo "Checking Mintscan..."
curl -s "https://api-core-mainnet.mintscan.io/v1/txs/$TX_HASH" | jq '.'

echo ""
echo "Explorer link:"
echo "https://www.mintscan.io/persistence/tx/$TX_HASH"
echo ""

