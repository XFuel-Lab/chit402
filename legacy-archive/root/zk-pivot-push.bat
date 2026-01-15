@echo off
REM =============================================================================
REM XFuelLab ZK Pivot - Git Workflow Script (Windows)
REM =============================================================================
REM This script creates a new branch 'zk-bridge' and pushes all ZK pivot changes
REM including CosmWasm contracts, whitepaper v3.0, deployment scripts, and README
REM =============================================================================

echo.
echo 🚀 XFuelLab ZK Pivot - Git Workflow
echo ====================================
echo.

REM Step 1: Check git status
echo 📊 Checking current git status...
git status --short
echo.

REM Step 2: Create and switch to zk-bridge branch
echo 🌿 Creating new branch 'zk-bridge'...
git branch zk-bridge 2>nul || echo Branch 'zk-bridge' already exists
git switch zk-bridge
if errorlevel 1 (
    echo ❌ Failed to switch to branch 'zk-bridge'
    exit /b 1
)
echo ✅ Switched to branch 'zk-bridge'
echo.

REM Step 3: Stage all files
echo 📦 Staging all changes...
git add .
if errorlevel 1 (
    echo ❌ Failed to stage files
    exit /b 1
)
echo ✅ Files staged successfully
echo.

REM Step 4: Show what will be committed
echo 📝 Files to be committed:
git diff --cached --name-status | head -20
echo    ... (showing first 20 files)
echo.

REM Step 5: Commit with descriptive message
echo 💾 Committing changes...
git commit -m "ZK pivot: Add CosmWasm contracts, whitepaper v3.0, deployment scripts" -m "" -m "- Added ZK-SNARK verifier CosmWasm contract (cosmwasm/zk-verifier)" -m "- Added IBC TFUEL minter CosmWasm contract (cosmwasm/ibc-tfuel-minter)" -m "- Added compiled .wasm binaries for Persistence deployment" -m "- Updated WHITEPAPER v3.0 with Ferrari hybrid tokenomics & ZK-SNARKs" -m "- Added deployment/optimization scripts (scripts/)" -m "- Updated README.md with ZK bridge architecture and live contract addresses" -m "- Added VaultFactory deployment summary (0xB0a266...)" -m "- Noted pre-audit status in documentation" -m "" -m "Technical details:" -m "- ZK proof verification in ~50ms constant time" -m "- Sub-4s settlement: deposit (2s) + proof (1.5s) + verify (0.5s)" -m "- IBC channel-190 integration for ibcTFUEL minting" -m "- Hybrid revenue splits: 30%% BBB, 30%% LP, 25%% veXF yields, 15%% treasury" -m "- Governance extras: quarterly opt-in votes with rXF bonuses" -m "" -m "Pre-audit note: Minimal beta launch; full CertiK audit post-traction."

if errorlevel 1 (
    echo ❌ Failed to commit changes
    exit /b 1
)
echo ✅ Committed successfully
echo.

REM Step 6: Push to remote
echo 🚀 Pushing to origin/zk-bridge...
git push origin zk-bridge
if errorlevel 1 (
    echo ❌ Failed to push to remote
    exit /b 1
)
echo ✅ Pushed successfully
echo.

echo ✨ Done! Next steps:
echo    1. Go to GitHub repository
echo    2. Create Pull Request from 'zk-bridge' to 'main'
echo    3. Use the title/description from PR_GUIDE.md
echo.
pause

