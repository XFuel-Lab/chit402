#!/usr/bin/env bash

# ============================================================================
# SP1 PROVER - BENCHMARK RUNNER
# ============================================================================
# Runs local benchmarking script with 5 iterations per sample
# ============================================================================

set -e

echo "🔧 Building guest program..."
cd "$(dirname "$0")/../program"
cargo prove build

echo ""
echo "🔧 Building benchmark script..."
cd ../script
cargo build --release

echo ""
echo "🚀 Running benchmarks..."
cargo run --release

echo ""
echo "✅ Benchmark complete!"
