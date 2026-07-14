#!/bin/bash
# Quick test script for CosmWasm contracts

echo "🧪 Testing ZK Verifier..."
cd cosmwasm/zk-verifier
cargo test --release
cd ../..

echo ""
echo "✅ All tests passed!"

