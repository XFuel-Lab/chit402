#!/bin/bash

# =============================================================================
# XFuelLab ZK Pivot - Git Workflow Script
# =============================================================================
# This script creates a new branch 'zk-bridge' and pushes all ZK pivot changes
# including CosmWasm contracts, whitepaper v3.0, deployment scripts, and README
# =============================================================================

set -e  # Exit on error

echo "🚀 XFuelLab ZK Pivot - Git Workflow"
echo "===================================="
echo ""

# Step 1: Check git status
echo "📊 Checking current git status..."
git status --short
echo ""

# Step 2: Create and switch to zk-bridge branch
echo "🌿 Creating new branch 'zk-bridge'..."
git branch zk-bridge 2>/dev/null || echo "Branch 'zk-bridge' already exists"
git switch zk-bridge
echo "✅ Switched to branch 'zk-bridge'"
echo ""

# Step 3: Stage all files
echo "📦 Staging all changes..."
git add .
echo "✅ Files staged successfully"
echo ""

# Step 4: Show what will be committed
echo "📝 Files to be committed:"
git diff --cached --name-status | head -20
echo "   ... (showing first 20 files)"
echo ""

# Step 5: Commit with descriptive message
echo "💾 Committing changes..."
git commit -m "ZK pivot: Add CosmWasm contracts, whitepaper v3.0, deployment scripts

- Added ZK-SNARK verifier CosmWasm contract (cosmwasm/zk-verifier)
- Added IBC TFUEL minter CosmWasm contract (cosmwasm/ibc-tfuel-minter)
- Added compiled .wasm binaries for Persistence deployment
- Updated WHITEPAPER v3.0 with Ferrari hybrid tokenomics & ZK-SNARKs
- Added deployment/optimization scripts (scripts/)
- Updated README.md with ZK bridge architecture and live contract addresses
- Added VaultFactory deployment summary (0xB0a266...)
- Noted pre-audit status in documentation

Technical details:
- ZK proof verification in ~50ms constant time
- Sub-4s settlement: deposit (2s) + proof (1.5s) + verify (0.5s)
- IBC channel-190 integration for ibcTFUEL minting
- Hybrid revenue splits: 30% BBB, 30% LP, 25% veXF yields, 15% treasury
- Governance extras: quarterly opt-in votes with rXF bonuses

Pre-audit note: Minimal beta launch; full CertiK audit post-traction."

echo "✅ Committed successfully"
echo ""

# Step 6: Push to remote
echo "🚀 Pushing to origin/zk-bridge..."
git push origin zk-bridge
echo "✅ Pushed successfully"
echo ""

echo "✨ Done! Next steps:"
echo "   1. Go to GitHub repository"
echo "   2. Create Pull Request from 'zk-bridge' to 'main'"
echo "   3. Use the title/description from PR_GUIDE.md"
echo ""

