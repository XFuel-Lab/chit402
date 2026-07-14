#!/usr/bin/env bash
# scripts/build-sp1-prover.sh
#
# Build the SP1 zkVM prover (host + program).
#
# REQUIREMENTS:
#   - Linux or macOS (sp1-jit v6.0.2 uses std::os::fd — not available on Windows)
#   - Rust stable toolchain (cargo, rustup)
#   - For CUDA proving: CUDA 12.x drivers + nvidia-docker or native GPU
#   - For network proving: set SP1_PRIVATE_KEY env var
#
# USAGE:
#   ./scripts/build-sp1-prover.sh              # build only
#   SP1_PROVER=mock ./scripts/build-sp1-prover.sh --prove   # build + generate mock proof
#   SP1_PROVER=cuda ./scripts/build-sp1-prover.sh --prove   # build + generate GPU proof
#
# OUTPUT:
#   services/sp1-prover/host/target/release/prove   — prover binary
#   proof.bin                              — generated proof (if --prove flag set)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
PROVER_DIR="$ROOT_DIR/services/sp1-prover"

echo "=== XFuel SP1 Prover Build ==="
echo "Root:  $ROOT_DIR"
echo "Prover: $PROVER_DIR"
echo ""

# Check platform
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    echo "ERROR: sp1-jit v6.0.2 requires Linux or macOS (std::os::fd is not available on Windows)."
    echo "       Use WSL2 on Windows or run this in a Linux CI environment."
    exit 1
fi

# Check Rust
if ! command -v cargo &> /dev/null; then
    echo "ERROR: cargo not found. Install Rust: https://rustup.rs/"
    exit 1
fi

RUST_VERSION=$(rustc --version)
echo "Rust: $RUST_VERSION"

# Build the prover
cd "$PROVER_DIR"
echo ""
echo "--- Building services/sp1-prover/host (release) ---"
cargo build --release --bin prove

BINARY="$PROVER_DIR/host/target/release/prove"
echo ""
echo "✅ Build successful: $BINARY"

# Optionally generate a proof
if [[ "${1:-}" == "--prove" ]]; then
    echo ""
    echo "--- Generating proof (SP1_PROVER=${SP1_PROVER:-mock}) ---"

    export SP1_PROVER="${SP1_PROVER:-mock}"

    # Default test input: 1 TFUEL deposit proof
    TASK_ID="${TASK_ID:-0x$(openssl rand -hex 32)}"
    AMOUNT="${AMOUNT:-1000000000000000000}"   # 1 TFUEL in wei
    SENDER="${SENDER:-0x0000000000000000000000000000000000000001}"

    cd "$ROOT_DIR"
    "$BINARY" \
        --task-id "$TASK_ID" \
        --amount "$AMOUNT" \
        --sender "$SENDER" \
        --output proof.bin

    echo ""
    echo "✅ Proof generated: $ROOT_DIR/proof.bin ($(du -h proof.bin | cut -f1))"
    echo "   Task ID: $TASK_ID"
fi

echo ""
echo "Done."
