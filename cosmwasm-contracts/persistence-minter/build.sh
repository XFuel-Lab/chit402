#!/bin/bash

# Build script for Persistence Minter contract

set -e

echo "🔨 Building Persistence Minter Contract..."

# Clean previous builds
echo "🧹 Cleaning previous builds..."
cargo clean

# Build in release mode
echo "🦀 Building Rust contract..."
cargo build --release --target wasm32-unknown-unknown

# Create artifacts directory
mkdir -p artifacts

# Copy wasm file
echo "📦 Copying WASM artifact..."
cp target/wasm32-unknown-unknown/release/persistence_minter.wasm artifacts/

echo "✅ Build complete!"
echo "📍 WASM file: artifacts/persistence_minter.wasm"
echo ""
echo "Next steps:"
echo "1. Optimize: docker run --rm -v \"\$(pwd)\":/code --mount type=volume,source=\"\$(basename \"\$(pwd)\")_cache\",target=/code/target --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry cosmwasm/rust-optimizer:0.15.0"
echo "2. Test: cargo test"
echo "3. Deploy: persistenceCore tx wasm store artifacts/persistence_minter.wasm"




