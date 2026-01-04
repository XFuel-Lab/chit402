#!/bin/bash

################################################################################
# XFuelLab Hybrid Deploy Script - Ferrari Tokenomics
# 
# Automates Step 2: Theta Mainnet Deploy & Test
# - Pre-flight validation
# - Dry-run gas estimation
# - User confirmation
# - Actual deployment
# - Post-deployment verification
#
# Usage:
#   ./run-hybrid-deploy.sh              # Interactive mode (default)
#   ./run-hybrid-deploy.sh --auto       # Auto mode (skips confirmations)
#   ./run-hybrid-deploy.sh --dry-run    # Dry-run only
################################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
NETWORK="theta-mainnet"
SCRIPT_PATH="scripts/deploy-keystore.cjs"
MIN_BALANCE="0.5"  # Minimum TFUEL balance required

# Parse arguments
AUTO_MODE=false
DRY_RUN_ONLY=false
for arg in "$@"; do
  case $arg in
    --auto)
      AUTO_MODE=true
      shift
      ;;
    --dry-run)
      DRY_RUN_ONLY=true
      shift
      ;;
    --help)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --auto      Skip confirmation prompts"
      echo "  --dry-run   Run gas estimation only (no deployment)"
      echo "  --help      Show this help message"
      exit 0
      ;;
  esac
done

################################################################################
# Helper Functions
################################################################################

print_header() {
  echo ""
  echo -e "${BLUE}========================================${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}========================================${NC}"
  echo ""
}

print_success() {
  echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
  echo -e "${RED}❌ $1${NC}"
}

print_warning() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

print_info() {
  echo -e "${BLUE}ℹ️  $1${NC}"
}

confirm() {
  if [ "$AUTO_MODE" = true ]; then
    return 0
  fi
  
  echo -n -e "${YELLOW}$1 (y/n): ${NC}"
  read -r response
  case "$response" in
    [yY][eE][sS]|[yY]) 
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

################################################################################
# Pre-Flight Checks
################################################################################

print_header "XFuelLab Hybrid Deploy - Pre-Flight Checks"

# Check if we're in the correct directory
if [ ! -f "$SCRIPT_PATH" ]; then
  print_error "Deploy script not found: $SCRIPT_PATH"
  print_info "Make sure you're in the xfuel-protocol root directory"
  exit 1
fi
print_success "Deploy script found"

# Check if node_modules exist
if [ ! -d "node_modules" ]; then
  print_warning "node_modules not found"
  print_info "Running npm install..."
  npm install
fi
print_success "Dependencies installed"

# Check if .env.local exists
if [ ! -f ".env.local" ]; then
  print_error ".env.local not found"
  print_info "Create .env.local with DEPLOYER_MAINNET_KEYSTORE_PATH and other secrets"
  exit 1
fi
print_success ".env.local found"

# Check if keystore path is set
KEYSTORE_PATH=$(grep "DEPLOYER_MAINNET_KEYSTORE_PATH" .env.local | cut -d '=' -f2 | tr -d '"' | tr -d "'" | xargs)
if [ -z "$KEYSTORE_PATH" ]; then
  print_error "DEPLOYER_MAINNET_KEYSTORE_PATH not set in .env.local"
  exit 1
fi

# Check if keystore file exists
if [ ! -f "$KEYSTORE_PATH" ]; then
  print_error "Keystore file not found: $KEYSTORE_PATH"
  exit 1
fi
print_success "Keystore file found: $KEYSTORE_PATH"

# Check RevenueSplitter address
REV_SPLITTER=$(grep "REVSPLITTER_ADDRESS" .env.local | cut -d '=' -f2 | tr -d '"' | tr -d "'" | xargs || echo "")
if [ -z "$REV_SPLITTER" ]; then
  print_warning "REVSPLITTER_ADDRESS not set (will use default)"
else
  print_success "RevenueSplitter address: $REV_SPLITTER"
fi

# Check if Hardhat is available
if ! command -v npx &> /dev/null; then
  print_error "npx not found - install Node.js/npm"
  exit 1
fi
print_success "Hardhat CLI available"

################################################################################
# Dry-Run Gas Estimation
################################################################################

print_header "Step 1: Dry-Run Gas Estimation"

print_info "Running deployment simulation (no gas spent)..."
echo ""

if npx hardhat run "$SCRIPT_PATH" --network "$NETWORK" --dry-run; then
  print_success "Dry-run completed successfully"
else
  print_error "Dry-run failed"
  print_info "Check error messages above and fix issues before proceeding"
  exit 1
fi

# If dry-run only mode, exit here
if [ "$DRY_RUN_ONLY" = true ]; then
  print_header "Dry-Run Complete"
  print_info "Run without --dry-run flag to execute actual deployment"
  exit 0
fi

################################################################################
# User Confirmation
################################################################################

print_header "Step 2: Confirm Deployment"

echo "You are about to deploy VaultFactory to Theta Mainnet"
echo ""
echo "Network:     $NETWORK"
echo "Keystore:    $KEYSTORE_PATH"
echo "RevSplitter: ${REV_SPLITTER:-<default>}"
echo ""
print_warning "This will spend TFUEL for gas fees"
echo ""

if ! confirm "Proceed with deployment?"; then
  print_info "Deployment cancelled by user"
  exit 0
fi

################################################################################
# Actual Deployment
################################################################################

print_header "Step 3: Deploying to Theta Mainnet"

print_info "Executing deployment script..."
echo ""

if npx hardhat run "$SCRIPT_PATH" --network "$NETWORK"; then
  print_success "Deployment completed successfully!"
else
  print_error "Deployment failed"
  print_info "Check error messages above for details"
  exit 1
fi

################################################################################
# Post-Deployment Verification
################################################################################

print_header "Step 4: Post-Deployment Verification"

# Check if deployment info was saved
DEPLOYMENT_FILE="deployments/vaultfactory-361.json"
if [ -f "$DEPLOYMENT_FILE" ]; then
  print_success "Deployment info saved: $DEPLOYMENT_FILE"
  
  # Extract VaultFactory address
  VAULT_FACTORY_ADDR=$(grep -o '"vaultFactory": "[^"]*"' "$DEPLOYMENT_FILE" | cut -d '"' -f4)
  
  if [ -n "$VAULT_FACTORY_ADDR" ]; then
    print_success "VaultFactory deployed at: $VAULT_FACTORY_ADDR"
    
    echo ""
    print_info "Explorer link:"
    echo "https://explorer.thetatoken.org/address/$VAULT_FACTORY_ADDR"
    echo ""
  fi
else
  print_warning "Deployment info file not found"
fi

# Check if .env was updated
if grep -q "VITE_VAULT_FACTORY_ADDRESS" .env 2>/dev/null; then
  UPDATED_ADDR=$(grep "VITE_VAULT_FACTORY_ADDRESS" .env | cut -d '=' -f2)
  print_success ".env updated with: $UPDATED_ADDR"
else
  print_warning ".env not updated (may need manual update)"
fi

################################################################################
# Next Steps
################################################################################

print_header "Next Steps - Ferrari Hybrid Testing"

echo "✅ Deployment Complete!"
echo ""
echo "📋 Immediate Actions (within 1 hour):"
echo "  1. Verify contract on Theta Explorer"
echo "     - Compiler: 0.8.20"
echo "     - Optimization: Yes, 200 runs"
echo ""
echo "  2. Create test SubVault:"
echo "     npx hardhat console --network theta-mainnet"
echo "     > factory = await ethers.getContractAt('VaultFactory', '$VAULT_FACTORY_ADDR')"
echo "     > salt = ethers.keccak256(ethers.toUtf8Bytes('test-vault-1'))"
echo "     > tx = await factory.createVault(salt)"
echo ""
echo "  3. Test deposit (0.1 TFUEL):"
echo "     - Send from Theta Web Wallet to SubVault address"
echo "     - Verify 0.5% fee (0.0005 TFUEL) sent to RevSplitter"
echo "     - Check DepositReceived event on explorer"
echo ""
echo "  4. Monitor events:"
echo "     - Deposit: grossAmount, feeAmount, netAmount, yieldRecycleAmount (30%)"
echo "     - Unwrap: amount, netAmount (70%), yieldRecycleAmount (30%)"
echo ""
echo "📝 Documentation:"
echo "  See STEP2_THETA_DEPLOY_GUIDE.md for detailed testing instructions"
echo ""

################################################################################
# Save Deployment Log
################################################################################

LOG_FILE="deployment-log-$(date +%Y%m%d-%H%M%S).txt"
{
  echo "XFuelLab Hybrid Deployment Log"
  echo "==============================="
  echo "Date: $(date)"
  echo "Network: $NETWORK"
  echo "Keystore: $KEYSTORE_PATH"
  echo "VaultFactory: $VAULT_FACTORY_ADDR"
  echo ""
  echo "Deployment Details:"
  if [ -f "$DEPLOYMENT_FILE" ]; then
    cat "$DEPLOYMENT_FILE"
  fi
} > "$LOG_FILE"

print_success "Deployment log saved: $LOG_FILE"
echo ""

print_header "Deployment Complete 🚀"

exit 0

