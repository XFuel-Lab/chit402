#!/bin/bash
set -e

echo "🔨 Building SP1 Deposit Proof System"
echo ""

# Check if Rust is installed
if ! command -v cargo &> /dev/null; then
    echo "❌ Rust is not installed. Please install from https://rustup.rs/"
    exit 1
fi

# Check if SP1 is installed
if ! command -v cargo-prove &> /dev/null; then
    echo "⚠️  SP1 not found. Installing..."
    curl -L https://sp1.succinct.xyz | bash
    source ~/.bashrc
    sp1up
fi

# Build guest program
echo "📦 Building guest program (zkVM)..."
cd program
cargo build --target riscv32im-succinct-zkvm-elf --release
cd ..

echo ""
echo "📦 Building host program..."
cd host

# Check if CUDA is available
if command -v nvcc &> /dev/null; then
    echo "🎮 CUDA detected, building with GPU support..."
    cargo build --release --features cuda
else
    echo "💻 Building with CPU support..."
    cargo build --release
fi

cd ..

echo ""
echo "✅ Build complete!"
echo ""
echo "Usage:"
echo "  ./host/target/release/prove prove --input test-data/example.json"
echo "  ./host/target/release/prove serve --port 8080"
