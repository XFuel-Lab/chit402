@echo off
REM Build script for Persistence Minter contract (Windows)

echo Building Persistence Minter Contract...

REM Clean previous builds
echo Cleaning previous builds...
cargo clean

REM Build in release mode
echo Building Rust contract...
cargo build --release --target wasm32-unknown-unknown

REM Create artifacts directory
if not exist artifacts mkdir artifacts

REM Copy wasm file
echo Copying WASM artifact...
copy target\wasm32-unknown-unknown\release\persistence_minter.wasm artifacts\

echo Build complete!
echo WASM file: artifacts\persistence_minter.wasm
echo.
echo Next steps:
echo 1. Test: cargo test
echo 2. Optimize: Use Docker or WSL with cosmwasm/rust-optimizer
echo 3. Deploy: persistenceCore tx wasm store artifacts/persistence_minter.wasm



