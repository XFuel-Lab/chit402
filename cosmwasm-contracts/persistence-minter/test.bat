@echo off
REM Test script for Persistence Minter contract (Windows)

echo Running Persistence Minter Tests...
echo.

echo Building contract...
cargo build --release --target wasm32-unknown-unknown
if %errorlevel% neq 0 (
    echo Build failed!
    exit /b %errorlevel%
)
echo Build complete
echo.

echo Running unit tests...
cargo test -- --nocapture
if %errorlevel% neq 0 (
    echo Tests failed!
    exit /b %errorlevel%
)
echo All tests passed
echo.

echo Checking code formatting...
cargo fmt -- --check
if %errorlevel% neq 0 (
    echo Code formatting issues found. Run 'cargo fmt' to fix
)
echo.

echo Running Clippy lints...
cargo clippy -- -D warnings
if %errorlevel% neq 0 (
    echo Clippy warnings found
)
echo.

echo All checks completed!
echo.
echo Next steps:
echo 1. Optimize: Use Docker or WSL with cosmwasm/rust-optimizer
echo 2. Deploy to testnet: See DEPLOYMENT.md
echo 3. Test on testnet: See INTEGRATION.md



