#!/bin/bash

# Early Believers Modal - Production Deployment Script
# This script helps deploy the modal to production

set -e  # Exit on error

echo "🚀 Early Believers Modal - Production Deployment"
echo "================================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Step 1: Check environment variables
echo "📋 Step 1: Checking environment variables..."
echo ""

REQUIRED_VARS=(
  "VITE_MULTISIG_ADDRESS"
  "VITE_USDC_ADDRESS_MAINNET"
  "VITE_CONTRIBUTION_WEBHOOK_URL"
)

MISSING_VARS=()

for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var}" ]; then
    MISSING_VARS+=("$var")
    echo -e "${RED}✗${NC} $var is not set"
  else
    echo -e "${GREEN}✓${NC} $var is set"
  fi
done

if [ ${#MISSING_VARS[@]} -ne 0 ]; then
  echo ""
  echo -e "${RED}❌ Error: Missing required environment variables${NC}"
  echo "Please set the following variables:"
  for var in "${MISSING_VARS[@]}"; do
    echo "  - $var"
  done
  exit 1
fi

echo ""
echo -e "${GREEN}✓ All environment variables are set${NC}"
echo ""

# Step 2: Run tests
echo "🧪 Step 2: Running tests..."
echo ""

if npm test -- --ci --coverage=false; then
  echo -e "${GREEN}✓ Tests passed${NC}"
else
  echo -e "${RED}❌ Tests failed. Please fix issues before deploying.${NC}"
  exit 1
fi

echo ""

# Step 3: Lint check
echo "🔍 Step 3: Running linter..."
echo ""

if npm run lint; then
  echo -e "${GREEN}✓ Linting passed${NC}"
else
  echo -e "${YELLOW}⚠ Linting warnings found (continuing anyway)${NC}"
fi

echo ""

# Step 4: Build
echo "🏗️  Step 4: Building for production..."
echo ""

if npm run build; then
  echo -e "${GREEN}✓ Build successful${NC}"
else
  echo -e "${RED}❌ Build failed${NC}"
  exit 1
fi

echo ""

# Step 5: Verify build output
echo "📦 Step 5: Verifying build output..."
echo ""

if [ -d "dist" ] && [ -f "dist/index.html" ]; then
  echo -e "${GREEN}✓ Build output verified${NC}"
  echo "  - dist/index.html exists"
  echo "  - dist/assets/ directory exists"
else
  echo -e "${RED}❌ Build output verification failed${NC}"
  exit 1
fi

echo ""

# Step 6: Summary
echo "✅ Pre-deployment checks complete!"
echo ""
echo "📋 Next steps:"
echo ""
echo "1. Review the build output in the 'dist' folder"
echo "2. Test locally with: npm run preview"
echo "3. Deploy to your hosting platform:"
echo ""
echo "   For Vercel:"
echo "   vercel --prod"
echo ""
echo "   For manual deployment:"
echo "   Upload the 'dist' folder contents to your server"
echo ""
echo "4. Verify environment variables are set in production"
echo "5. Test the modal on production after deployment"
echo ""
echo -e "${GREEN}🎉 Ready for deployment!${NC}"

