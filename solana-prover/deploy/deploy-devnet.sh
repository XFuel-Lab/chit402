#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────
# XFuel Solana Prover — Devnet Deployment Script
# ──────────────────────────────────────────────────────────────────
# Usage:
#   ./deploy-devnet.sh                  Full build + deploy + initialize
#   ./deploy-devnet.sh --skip-build     Deploy existing build
#   ./deploy-devnet.sh --init-only      Initialize already-deployed program
#
# Prerequisites:
#   - Rust toolchain (rustup)
#   - Solana CLI v2.1+ (solana, solana-keygen)
#   - cargo-build-sbf (installed via: cargo install solana-cargo-build-sbf)
#
# Environment variables (optional):
#   ADMIN_KEYPAIR   Path to admin keypair (default: ~/.config/solana/id.json)
#   MOCK_MODE       Set to "false" to disable mock mode (default: true)
# ──────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
KEYPAIR_PATH="$SCRIPT_DIR/program-keypair.json"
ADMIN_KEYPAIR="${ADMIN_KEYPAIR:-$HOME/.config/solana/id.json}"
MOCK_MODE="${MOCK_MODE:-true}"

echo "════════════════════════════════════════════════════════════"
echo "  XFuel Solana Prover — Devnet Deployment"
echo "════════════════════════════════════════════════════════════"

# ── Step 1: Configure Solana CLI for devnet ──────────────────────
echo ""
echo "[1/6] Configuring Solana CLI for devnet..."
solana config set --url https://api.devnet.solana.com
echo "  RPC: https://api.devnet.solana.com"

# ── Step 2: Ensure admin keypair exists ──────────────────────────
if [ ! -f "$ADMIN_KEYPAIR" ]; then
    echo ""
    echo "[2/6] Generating admin keypair..."
    solana-keygen new --outfile "$ADMIN_KEYPAIR" --no-passphrase
else
    echo ""
    echo "[2/6] Using existing admin keypair: $ADMIN_KEYPAIR"
fi
DEPLOYER=$(solana-keygen pubkey "$ADMIN_KEYPAIR")
echo "  Deployer: $DEPLOYER"

# ── Step 3: Generate program keypair ─────────────────────────────
if [ ! -f "$KEYPAIR_PATH" ]; then
    echo ""
    echo "[3/6] Generating program keypair..."
    solana-keygen new --outfile "$KEYPAIR_PATH" --no-passphrase
else
    echo ""
    echo "[3/6] Using existing program keypair: $KEYPAIR_PATH"
fi
PROGRAM_ID=$(solana-keygen pubkey "$KEYPAIR_PATH")
echo "  Program ID: $PROGRAM_ID"

# ── Step 4: Airdrop SOL ─────────────────────────────────────────
echo ""
echo "[4/6] Requesting devnet airdrop (5 SOL)..."
solana airdrop 5 "$DEPLOYER" --url https://api.devnet.solana.com || {
    echo "  Airdrop failed (rate limited). Checking existing balance..."
}
BALANCE=$(solana balance "$DEPLOYER" --url https://api.devnet.solana.com 2>/dev/null || echo "0 SOL")
echo "  Balance: $BALANCE"
sleep 2

# ── Step 5: Build ────────────────────────────────────────────────
if [ "${1:-}" != "--skip-build" ] && [ "${1:-}" != "--init-only" ]; then
    echo ""
    echo "[5/6] Building Solana program..."
    cd "$PROJECT_DIR"

    echo ""
    echo "  IMPORTANT: Update declare_id! in src/lib.rs with:"
    echo "    solana_program::declare_id!(\"$PROGRAM_ID\");"
    echo ""
    echo "  Building with cargo build-sbf..."
    cargo build-sbf

    echo "  Build complete: target/deploy/xfuel_solana_prover.so"
else
    echo ""
    echo "[5/6] Skipping build."
fi

# ── Step 6: Deploy ───────────────────────────────────────────────
if [ "${1:-}" != "--init-only" ]; then
    echo ""
    echo "[6/6] Deploying to devnet..."
    cd "$PROJECT_DIR"

    solana program deploy \
        target/deploy/xfuel_solana_prover.so \
        --program-id "$KEYPAIR_PATH" \
        --keypair "$ADMIN_KEYPAIR" \
        --url https://api.devnet.solana.com

    echo ""
    echo "  Deployment successful!"
else
    echo ""
    echo "[6/6] Skipping deploy."
fi

# ── Summary ──────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════"
echo "  Deployment Summary"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "  Network:     Solana Devnet"
echo "  Program ID:  $PROGRAM_ID"
echo "  Deployer:    $DEPLOYER"
echo "  Mock Mode:   $MOCK_MODE"
echo ""
echo "  Next steps:"
echo "    1. Update declare_id! in src/lib.rs with the Program ID above"
echo "    2. Rebuild: cargo build-sbf"
echo "    3. Redeploy: solana program deploy target/deploy/xfuel_solana_prover.so --program-id $KEYPAIR_PATH"
echo "    4. Initialize the verifier via client (TypeScript or solana CLI)"
echo ""
echo "  Explorer:"
echo "    https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"
echo ""
echo "════════════════════════════════════════════════════════════"
