@echo off
REM =============================================================================
REM Whitepaper Polish Script - Canonical v3.0 (Windows)
REM =============================================================================
REM This script cleans up old whitepaper versions and establishes v3.0 as canonical
REM =============================================================================

echo.
echo 📄 Whitepaper Polish - Canonical v3.0
echo ======================================
echo.

REM Step 1: Create and switch to polish-whitepaper branch
echo 🌿 Creating branch 'polish-whitepaper'...
git switch -c polish-whitepaper 2>nul || git switch polish-whitepaper
if errorlevel 1 (
    echo ❌ Failed to switch to branch
    exit /b 1
)
echo ✅ On branch 'polish-whitepaper'
echo.

REM Step 2: Delete old whitepaper versions
echo 🗑️  Removing old whitepaper versions...

REM Delete root-level files
if exist WHITEPAPER_V3_CHART_ADDITIONS.md del WHITEPAPER_V3_CHART_ADDITIONS.md
if exist WHITEPAPER_V3_REFINEMENTS_SUMMARY.md del WHITEPAPER_V3_REFINEMENTS_SUMMARY.md
if exist WHITEPAPER_V3_BEFORE_AFTER.md del WHITEPAPER_V3_BEFORE_AFTER.md
if exist WHITEPAPER_V3_FERRARI_DELIVERY.md del WHITEPAPER_V3_FERRARI_DELIVERY.md
if exist WHITEPAPER_OVERHAUL_COMPLETE.md del WHITEPAPER_OVERHAUL_COMPLETE.md
if exist QUICK_REFERENCE_WHITEPAPER.md del QUICK_REFERENCE_WHITEPAPER.md

REM Delete docs files
if exist docs\whitepaper.md del docs\whitepaper.md
if exist docs\WHITEPAPER_MASTER_INDEX.md del docs\WHITEPAPER_MASTER_INDEX.md
if exist docs\WHITEPAPER_V2_SUMMARY.md del docs\WHITEPAPER_V2_SUMMARY.md

REM Delete whitepaper directory files
if exist docs\whitepaper\whitepaper-content.md del docs\whitepaper\whitepaper-content.md
if exist docs\whitepaper\XFUEL-Whitepaper-Medium.md del docs\whitepaper\XFUEL-Whitepaper-Medium.md
if exist docs\whitepaper\XFUEL-ZK-Bridge-Whitepaper.html del docs\whitepaper\XFUEL-ZK-Bridge-Whitepaper.html
if exist docs\whitepaper\XFUEL-ZK-Bridge-Whitepaper.pdf del docs\whitepaper\XFUEL-ZK-Bridge-Whitepaper.pdf
if exist docs\whitepaper\whitepaper-preview.html del docs\whitepaper\whitepaper-preview.html
if exist docs\whitepaper\*.mjs del docs\whitepaper\*.mjs
if exist docs\whitepaper\styles.css del docs\whitepaper\styles.css
if exist docs\whitepaper\FINAL_VERSION_SUMMARY.md del docs\whitepaper\FINAL_VERSION_SUMMARY.md
if exist docs\whitepaper\GENERATION_SUMMARY.md del docs\whitepaper\GENERATION_SUMMARY.md
if exist docs\whitepaper\PUBLISHING_GUIDE.md del docs\whitepaper\PUBLISHING_GUIDE.md
if exist docs\whitepaper\QUICKSTART.md del docs\whitepaper\QUICKSTART.md
if exist docs\whitepaper\README.md del docs\whitepaper\README.md

echo ✅ Old versions removed
echo.

REM Step 3: Rename v3 to canonical
echo 📝 Renaming v3 to canonical WHITEPAPER.md...
git mv docs\XFUEL-Hybrid-Tokenomics-Whitepaper-v3.md docs\WHITEPAPER.md
if errorlevel 1 (
    echo ❌ Failed to rename file
    exit /b 1
)
echo ✅ Renamed to docs\WHITEPAPER.md
echo.

REM Step 4: Stage all changes
echo 📦 Staging all changes...
git add -A
if errorlevel 1 (
    echo ❌ Failed to stage changes
    exit /b 1
)
echo ✅ Changes staged
echo.

REM Step 5: Show what will be committed
echo 📝 Files to be committed:
git status --short
echo.

REM Step 6: Commit
echo 💾 Committing changes...
git commit -m "Polish whitepaper to v3.0 canonical, delete old versions" -m "" -m "- Renamed XFUEL-Hybrid-Tokenomics-Whitepaper-v3.md to WHITEPAPER.md" -m "- Deleted old whitepaper versions (V1, V2 summaries, legacy PDFs)" -m "- Removed whitepaper generation scripts and intermediate files" -m "- Kept ZK Bridge whitepaper as complementary technical doc" -m "- Cleaned up root-level whitepaper summary files" -m "" -m "v3.0 is now the single canonical whitepaper with:" -m "- Ferrari hybrid tokenomics (30/70 recycle, 30/30/25/15 splits)" -m "- veXF governance extras (NFTs, rXF bonuses, quarterly votes)" -m "- ZK-SNARK bridge architecture" -m "- Live contract addresses (VaultFactory: 0xB0a266...)" -m "- Pre-audit status clearly noted" -m "" -m "This establishes a clean documentation structure for production launch."

if errorlevel 1 (
    echo ❌ Failed to commit
    exit /b 1
)
echo ✅ Committed successfully
echo.

REM Step 7: Push
echo 🚀 Pushing to origin/polish-whitepaper...
git push origin polish-whitepaper
if errorlevel 1 (
    echo ❌ Failed to push
    exit /b 1
)
echo ✅ Pushed successfully
echo.

echo ✨ Done! Next steps:
echo    1. Update README.md with 'Latest Whitepaper v3.0' section
echo    2. Go to GitHub and create Pull Request
echo    3. Use PR template from WHITEPAPER_POLISH_PR_GUIDE.md
echo.
pause

