#!/bin/bash
set -e

echo "🧪 Running SP1 Deposit Proof Tests"
echo ""

# Test guest program
echo "Testing guest program..."
cd program
cargo test --release
cd ..

# Test host program
echo ""
echo "Testing host program..."
cd host
cargo test --release
cd ..

# Integration test with example data
echo ""
echo "Running integration test..."
if [ -f "test-data/example.json" ]; then
    ./host/target/release/prove prove --input test-data/example.json --output test-data/output.json
    echo "✅ Integration test passed!"
else
    echo "⚠️  test-data/example.json not found, skipping integration test"
fi

echo ""
echo "✅ All tests passed!"
