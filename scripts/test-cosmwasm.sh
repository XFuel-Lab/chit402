#!/bin/bash
# Quick test script for CosmWasm contracts

echo "🧪 Testing ZK Verifier..."
cd cosmwasm/zk-verifier
cargo test --release
echo ""

echo "🧪 Testing ibcTFUEL Minter..."
cd ../ibc-tfuel-minter
cargo test --release
cd ../..

echo ""
echo "✅ All tests passed!"

