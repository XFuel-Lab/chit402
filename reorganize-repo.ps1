# XFuel Repository Reorganization Script
# Run from project root

Write-Host "🚀 Starting XFuel Repository Reorganization..." -ForegroundColor Cyan
Write-Host ""

# Ensure directories exist
$dirs = @("docs\guides", "docs\troubleshooting")
foreach ($dir in $dirs) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        Write-Host "✅ Created $dir" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "📦 Moving files to docs/guides/..." -ForegroundColor Yellow

# Move to docs/guides/
$guidesFiles = @(
    "QUICK_START.md",
    "QUICK_START_GOVERNANCE_LP.md",
    "QUICK_DEPLOY.md",
    "QUICK_REFERENCE.md",
    "QUICK_VALIDATION.md",
    "QUICKSTART_PERSISTENCE_MINTER.md",
    "DOCKER_QUICK_START.md",
    "CYPRESS_QUICK_START.md",
    "E2E_QUICK_START.md",
    "IBC_QUICK_START.md",
    "STEP2_QUICK_START.md",
    "STEP3_QUICK_START.md",
    "STEP4_QUICK_START.md",
    "STEP5_QUICK_START.md",
    "STEP2_THETA_DEPLOY_GUIDE.md",
    "STEP3_BACKEND_INTEGRATION_GUIDE.md",
    "STEP4_PERSISTENCE_DEPLOY_GUIDE.md",
    "STEP5_E2E_BRIDGE_TEST_GUIDE.md",
    "STEP2_LIVE_TESTING_GUIDE.md",
    "STEP2_INDEX.md",
    "START_HERE.md",
    "START_HERE_COSMWASM_OPTIMIZATION.md",
    "LOCAL_DEV_SETUP.md",
    "ENV_SETUP.md",
    "ENV_SETUP_GUIDE.md",
    "ENV_LOCAL_REFERENCE.md",
    "COSMOS_LST_STAKING_GUIDE.md",
    "CYPRESS_TESTING_GUIDE.md",
    "PHASE3_INTEGRATION_GUIDE.md",
    "E2E_TESTING_DEPLOYMENT_GUIDE.md",
    "DEPLOY_E2E_MANUAL_SAFE.md",
    "DEPLOY_GUIDE_SIMPLE.md",
    "DEPLOYMENT_READY.md",
    "DEPLOYMENT_READINESS.md",
    "READY_TO_DEPLOY.md",
    "READY_TO_PUSH.md",
    "DOCKER_DEPLOYMENT_GUIDE.md",
    "DOCKER_README.md",
    "DOCKER_SETUP_COMPLETE.md",
    "DOCKER_FIX_GUIDE.md",
    "COSMWASM_OPTIMIZATION_INDEX.md",
    "COSMWASM_OPTIMIZATION_QUICKSTART.md",
    "COSMWASM_OPTIMIZATION_QUICKREF.md",
    "COSMWASM_OPTIMIZATION_WORKFLOW.md",
    "COSMWASM_OPTIMIZATION_DEBUG_GUIDE.md",
    "SYSTEM_OVERVIEW.md",
    "VISUAL_OVERVIEW.md",
    "COMPONENT_REFERENCE.md",
    "EARLY_BELIEVERS_SETUP.md",
    "EDGE_NODE_SIGNERS_SETUP.md",
    "MANUAL_QR_FLOW_IMPLEMENTATION.md",
    "MANUAL_QR_FLOW_TEST_GUIDE.md",
    "THETA_BRIDGE_README.md",
    "WALLET_CONNECTION_CONSOLIDATION.md",
    "WALLET_CONSOLIDATION_FIX.md",
    "WALLETCONNECT_VERIFICATION_TEST.md",
    "TESTING_DEPLOYMENT_PLAN.md",
    "TESTNET_DEPLOYMENT_PLAN.md",
    "MAINNET_ROLLOUT_PLAN.md",
    "LAUNCH_PLAN_NEXT_STEPS.md",
    "PRODUCTION_DEPLOYMENT_EARLY_BELIEVERS.md",
    "PRODUCTION_READY_CHECKLIST.md",
    "PRODUCTION_POLISH_CHECKLIST.md",
    "EARLY_BELIEVERS_SETUP.md"
)

$movedGuides = 0
foreach ($file in $guidesFiles) {
    if (Test-Path $file) {
        Move-Item $file "docs\guides\" -Force
        $movedGuides++
    }
}
Write-Host "✅ Moved $movedGuides guide files" -ForegroundColor Green

Write-Host ""
Write-Host "📦 Moving files to docs/overhaul/..." -ForegroundColor Yellow

# Move to docs/overhaul/
$overhaulFiles = @(
    "ZK_BRIDGE_DELIVERY_SUMMARY.md",
    "ZK_BRIDGE_QUICK_REFERENCE.md",
    "ZK_PIVOT_DEPLOYMENT_SUMMARY.md",
    "ZK_PIVOT_ONE_PAGE.md",
    "PROJECT_COMPLETION_SUMMARY.md",
    "DELIVERY_COMPLETE.md",
    "STEP2_DELIVERY_COMPLETE.md",
    "STEP2_DEPLOYMENT_SYSTEM_SUMMARY.md",
    "STEP2_BACKUP_TESTING_SUMMARY.md",
    "STEP3_COMPLETION_SUMMARY.md",
    "STEP4_COMPLETION_SUMMARY.md",
    "E2E_DEPLOYMENT_SUMMARY.md",
    "FINAL_DEPLOYMENT_SUMMARY.md",
    "PHASE3_DEPLOYMENT_SUMMARY.md",
    "PHASE3_DEPLOYMENT_VERIFICATION.md",
    "IMPLEMENTATION_SUMMARY.md",
    "IMPLEMENTATION_DIFFS.md",
    "INTEGRATION_SUMMARY.md",
    "HYBRID_FLOW_DELIVERY.md",
    "HYBRID_FLOW_OUTPUT.md",
    "REVSPLITTER_DELIVERY.md",
    "PERSISTENCE_MINTER_DELIVERY.md",
    "IBC_IMPLEMENTATION_SUMMARY.md",
    "STRIDE_IMPLEMENTATION_SUMMARY.md",
    "VAULTFACTORY_IMPLEMENTATION_SUMMARY.md",
    "COSMWASM_CONTRACTS_COMPLETE.md",
    "COSMWASM_OPTIMIZATION_SUMMARY.md",
    "STEP2_DEPLOYMENT_FLOW_DIAGRAM.md",
    "GOVERNANCE_UPDATE_SUMMARY.md",
    "GOVERNANCE_LP_VISUAL_SUMMARY.md",
    "GOVERNANCE_LP_COMPONENTS_REFERENCE.md",
    "GOVERNANCE_LP_FLYWHEEL_UPDATE.md",
    "GOVERNANCE_DEPLOYMENT_OPTIONS.md",
    "ADDRESS_UPDATE_SUMMARY.md",
    "COMPLETE_DEPLOYMENT_SOLUTION.md",
    "COMPLETE_PACKAGE.md",
    "ENVIRONMENT_CONFIG_SUMMARY.md",
    "MAINNET_SECURITY_UPGRADE_SUCCESS.md",
    "MAINNET_ROUTER_VERIFICATION_SUMMARY.md",
    "MAINNET_SWAP_ENHANCEMENTS.md",
    "NUCLEAR_BYPASS_DEPLOYMENT_SUMMARY.md",
    "DEPLOYMENT_STATUS.md",
    "DEPLOYMENT_PROGRESS.md",
    "FINAL_STATUS_VERIFICATION.md",
    "FRESH_INSTALL_VERIFICATION.md",
    "VALIDATION_CHECKLIST.md",
    "ROUTER_VERIFICATION.md",
    "ROUTER_CONFIGURATION.md",
    "PERSISTENCE_CONTRACTS.md",
    "PERSISTENCE_MINTER_INDEX.md",
    "PERSISTENCE_MINTER_CHECKLIST.md",
    "PERSISTENCE_MINTER_ARCHITECTURE.md",
    "REVSPLITTER_HYBRID_README.md",
    "REVSPLITTER_V2_QUICK_REF.md",
    "REVSPLITTER_V2_SUMMARY.md",
    "TESTING_SUMMARY.md",
    "TESTS_PASSING_SUMMARY.md",
    "TESTING_SWAP_EXECUTION.md",
    "PERFORMANCE_IMPROVEMENTS_SUMMARY.md",
    "PERFORMANCE_README.md",
    "JEST_CI_FIX_SUMMARY.md",
    "MOBILE_PACKAGE_INSTALLATION.md"
)

$movedOverhaul = 0
foreach ($file in $overhaulFiles) {
    if (Test-Path $file) {
        Move-Item $file "docs\overhaul\" -Force
        $movedOverhaul++
    }
}
Write-Host "✅ Moved $movedOverhaul overhaul files" -ForegroundColor Green

Write-Host ""
Write-Host "📦 Moving files to docs/troubleshooting/..." -ForegroundColor Yellow

# Move to docs/troubleshooting/
$troubleshootFiles = @(
    "MAINTENANCE_MODE.md",
    "MAINTENANCE_MODE_QUICK.md",
    "MAINTENANCE_TROUBLESHOOT.md",
    "MAINTENANCE_VISUAL_GUIDE.md",
    "MAINTENANCE_CODE_SNIPPETS.md",
    "MAINTENANCE_FIX_APPLIED.md",
    "MAINTENANCE_IMPLEMENTATION_SUMMARY.md",
    "BLACK_SCREEN_BUG_FIX.md",
    "CACHE_FIX.md",
    "INSTANT_OUTPUT_FIX.md",
    "RETRY_LOGIC_FIX.md",
    "ROUTER_CONFIG_FIX.md",
    "SECURITY_FIX_TX_ORIGIN.md",
    "DEPLOYMENT_GUIDE_SECURITY_FIX.md",
    "TEST_FIXES_APPLIED.md",
    "TEST_FIXES_COMPLETE.md",
    "HYBRID_FLOW_TEST_FIXES.md",
    "TX_STATUS_TROUBLESHOOTING.md",
    "TROUBLESHOOT_OVERLAY.md",
    "VERCEL_DEBUG.md",
    "THETA_WALLET_FIX_v5.3.0.md",
    "THETA_WALLET_ID_FIX.md",
    "THETA_WALLET_KNOWN_ISSUE.md",
    "THETA_WALLET_LAG_DIAGNOSIS.md",
    "THETA_WALLET_V5.3.0_DEEP_DIVE.md",
    "THETA_WALLET_CONNECTION_ROOT_CAUSE.md",
    "KEPLR_USERADDRESS_FIX.md",
    "METAMASK_CONFIRMATION_LOOP_FIX.md",
    "LIVE_APP_FIXES_DEC_26.md",
    "GIT_BRANCH_CONFLICT_ANALYSIS.md",
    "GIT_WORKFLOW_QUICK_REF.md",
    "MERGE_TO_MAIN.md",
    "CROSSCHAIN_SWAP_OPTIMIZATION.md",
    "check-vercel-deployments.md"
)

$movedTroubleshoot = 0
foreach ($file in $troubleshootFiles) {
    if (Test-Path $file) {
        Move-Item $file "docs\troubleshooting\" -Force
        $movedTroubleshoot++
    }
}
Write-Host "✅ Moved $movedTroubleshoot troubleshooting files" -ForegroundColor Green

Write-Host ""
Write-Host "🗑️  Deleting superseded/temporary files..." -ForegroundColor Yellow

# Delete superseded files
$deleteFiles = @(
    "WHITEPAPER_POLISH_INDEX.md",
    "WHITEPAPER_POLISH_ONE_PAGE.md",
    "WHITEPAPER_POLISH_PR_GUIDE.md",
    "WHITEPAPER_POLISH_SUMMARY.txt",
    "README_WHITEPAPER_SECTION.md",
    "README_ZK_BRIDGE_SECTION.md",
    "polish-whitepaper.bat",
    "polish-whitepaper.sh",
    "CLEANUP_COMPLETE.md",
    "POST_OVERHAUL_CLEANUP_SUMMARY.md",
    "FILES_CREATED_SUMMARY.txt",
    "optimization-results.txt",
    "test-output.log",
    "test-output.txt",
    "frontend.txt",
    "scripts.txt",
    "dummy",
    "NewApp.tsx",
    "START_HERE_E2E.txt",
    "START_HERE_SAFE.txt",
    "zk-pivot-push.bat",
    "zk-pivot-push.sh",
    "generate-whitepaper-pdf.bat",
    "generate-whitepaper-pdf.sh",
    "INDEX.md",
    "NEXT_STEPS.md",
    "RECOMMENDATION.md",
    "OPTION1_COMPLETE.md",
    "PR_DESCRIPTION.md",
    "PR_FIX_VEXF.md",
    "PR_GUIDE.md",
    "PRE_COMMIT_REVIEW.md",
    "RESTRUCTURE_SUMMARY.md"
)

$deleted = 0
foreach ($file in $deleteFiles) {
    if (Test-Path $file) {
        Remove-Item $file -Force
        $deleted++
    }
}
Write-Host "✅ Deleted $deleted superseded files" -ForegroundColor Green

Write-Host ""
Write-Host "📊 Reorganization Summary:" -ForegroundColor Cyan
Write-Host "  Moved to docs/guides/: $movedGuides files" -ForegroundColor White
Write-Host "  Moved to docs/overhaul/: $movedOverhaul files" -ForegroundColor White
Write-Host "  Moved to docs/troubleshooting/: $movedTroubleshoot files" -ForegroundColor White
Write-Host "  Deleted: $deleted files" -ForegroundColor White
Write-Host ""
Write-Host "✅ Repository reorganization complete!" -ForegroundColor Green
Write-Host ""
Write-Host "📝 Next steps:" -ForegroundColor Yellow
Write-Host "  1. Update docs/README.md with new structure"
Write-Host "  2. Update root README.md with new links"
Write-Host "  3. Verify all links work"
Write-Host "  4. Commit changes"

