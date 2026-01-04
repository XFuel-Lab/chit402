#!/bin/bash

# =============================================================================
# Whitepaper Polish Script - Canonical v3.0
# =============================================================================
# This script cleans up old whitepaper versions and establishes v3.0 as canonical
# =============================================================================

set -e  # Exit on error

echo "📄 Whitepaper Polish - Canonical v3.0"
echo "======================================"
echo ""

# Step 1: Create and switch to polish-whitepaper branch
echo "🌿 Creating branch 'polish-whitepaper'..."
git switch -c polish-whitepaper 2>/dev/null || git switch polish-whitepaper
echo "✅ On branch 'polish-whitepaper'"
echo ""

# Step 2: Delete old whitepaper versions
echo "🗑️  Removing old whitepaper versions..."

# Delete root-level whitepaper summary files (keep only canonical)
rm -f WHITEPAPER_V3_CHART_ADDITIONS.md
rm -f WHITEPAPER_V3_REFINEMENTS_SUMMARY.md
rm -f WHITEPAPER_V3_BEFORE_AFTER.md
rm -f WHITEPAPER_V3_FERRARI_DELIVERY.md
rm -f WHITEPAPER_OVERHAUL_COMPLETE.md
rm -f QUICK_REFERENCE_WHITEPAPER.md

# Delete old docs whitepaper files
rm -f docs/whitepaper.md
rm -f docs/WHITEPAPER_MASTER_INDEX.md
rm -f docs/WHITEPAPER_V2_SUMMARY.md

# Delete legacy whitepaper directory contents (except ZK Bridge whitepaper which is complementary)
rm -f docs/whitepaper/whitepaper-content.md
rm -f docs/whitepaper/XFUEL-Whitepaper-Medium.md
rm -f docs/whitepaper/XFUEL-ZK-Bridge-Whitepaper.html
rm -f docs/whitepaper/XFUEL-ZK-Bridge-Whitepaper.pdf
rm -f docs/whitepaper/whitepaper-preview.html
rm -f docs/whitepaper/*.mjs
rm -f docs/whitepaper/styles.css
rm -f docs/whitepaper/FINAL_VERSION_SUMMARY.md
rm -f docs/whitepaper/GENERATION_SUMMARY.md
rm -f docs/whitepaper/PUBLISHING_GUIDE.md
rm -f docs/whitepaper/QUICKSTART.md
rm -f docs/whitepaper/README.md

echo "✅ Old versions removed"
echo ""

# Step 3: Rename v3 to canonical WHITEPAPER.md
echo "📝 Renaming v3 to canonical WHITEPAPER.md..."
git mv docs/XFUEL-Hybrid-Tokenomics-Whitepaper-v3.md docs/WHITEPAPER.md
echo "✅ Renamed to docs/WHITEPAPER.md"
echo ""

# Step 4: Stage all deletions
echo "📦 Staging all changes..."
git add -A
echo "✅ Changes staged"
echo ""

# Step 5: Show what will be committed
echo "📝 Files to be committed:"
git status --short | head -30
echo "   ... (showing first 30 changes)"
echo ""

# Step 6: Commit
echo "💾 Committing changes..."
git commit -m "Polish whitepaper to v3.0 canonical, delete old versions

- Renamed XFUEL-Hybrid-Tokenomics-Whitepaper-v3.md to WHITEPAPER.md
- Deleted old whitepaper versions (V1, V2 summaries, legacy PDFs)
- Removed whitepaper generation scripts and intermediate files
- Kept ZK Bridge whitepaper as complementary technical doc
- Cleaned up root-level whitepaper summary files

v3.0 is now the single canonical whitepaper with:
- Ferrari hybrid tokenomics (30/70 recycle, 30/30/25/15 splits)
- veXF governance extras (NFTs, rXF bonuses, quarterly votes)
- ZK-SNARK bridge architecture
- Live contract addresses (VaultFactory: 0xB0a266...)
- Pre-audit status clearly noted

This establishes a clean documentation structure for production launch."

echo "✅ Committed successfully"
echo ""

# Step 7: Push to remote
echo "🚀 Pushing to origin/polish-whitepaper..."
git push origin polish-whitepaper
echo "✅ Pushed successfully"
echo ""

echo "✨ Done! Next steps:"
echo "   1. Update README.md with 'Latest Whitepaper v3.0' section"
echo "   2. Go to GitHub and create Pull Request"
echo "   3. Use PR template from WHITEPAPER_POLISH_PR_GUIDE.md"
echo ""

