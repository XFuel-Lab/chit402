#!/bin/bash

# Deploy Backend to VPS
# Auto-deploys xFuel backend listener to production VPS

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration (update these)
VPS_USER="${VPS_USER:-root}"
VPS_HOST="${VPS_HOST:-your-vps-ip}"
VPS_PORT="${VPS_PORT:-22}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/xfuel-protocol}"
GIT_BRANCH="${GIT_BRANCH:-main}"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}🚀 XFuel Backend Deployment${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Check if VPS_HOST is set
if [ "$VPS_HOST" = "your-vps-ip" ]; then
  echo -e "${YELLOW}⚠️  VPS_HOST not set${NC}"
  echo ""
  echo "Usage:"
  echo "  VPS_HOST=1.2.3.4 VPS_USER=ubuntu ./scripts/deploy-backend.sh"
  echo ""
  echo "Or set in .env:"
  echo "  VPS_HOST=1.2.3.4"
  echo "  VPS_USER=ubuntu"
  echo ""
  exit 1
fi

echo -e "${GREEN}ℹ️  Deployment Configuration:${NC}"
echo "   VPS: $VPS_USER@$VPS_HOST:$VPS_PORT"
echo "   Path: $DEPLOY_PATH"
echo "   Branch: $GIT_BRANCH"
echo ""

# Confirm deployment
read -p "Deploy to VPS? (y/N) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo -e "${YELLOW}Deployment cancelled${NC}"
  exit 0
fi

echo -e "${GREEN}📦 Step 1: Checking SSH connection...${NC}"
if ssh -p $VPS_PORT -o ConnectTimeout=5 $VPS_USER@$VPS_HOST "echo 'SSH OK'" > /dev/null 2>&1; then
  echo -e "${GREEN}✅ SSH connection successful${NC}"
else
  echo -e "${RED}❌ SSH connection failed${NC}"
  echo "   Check VPS_HOST, VPS_USER, and SSH keys"
  exit 1
fi
echo ""

echo -e "${GREEN}📦 Step 2: Preparing deployment directory...${NC}"
ssh -p $VPS_PORT $VPS_USER@$VPS_HOST << EOF
  set -e
  
  # Create directory if it doesn't exist
  if [ ! -d "$DEPLOY_PATH" ]; then
    echo "Creating $DEPLOY_PATH"
    mkdir -p $DEPLOY_PATH
  fi
  
  # Check if git repo exists
  if [ ! -d "$DEPLOY_PATH/.git" ]; then
    echo "Git repository not found - manual setup required"
    echo "Run on VPS:"
    echo "  cd $DEPLOY_PATH"
    echo "  git clone https://github.com/your-org/xfuel-protocol.git ."
    exit 1
  fi
  
  echo "✅ Deployment directory ready"
EOF

echo -e "${GREEN}✅ Deployment directory prepared${NC}"
echo ""

echo -e "${GREEN}📦 Step 3: Pulling latest code...${NC}"
ssh -p $VPS_PORT $VPS_USER@$VPS_HOST << EOF
  set -e
  cd $DEPLOY_PATH
  
  echo "Current branch: \$(git branch --show-current)"
  echo "Pulling latest changes..."
  git pull origin $GIT_BRANCH
  
  echo "✅ Code updated"
EOF

echo -e "${GREEN}✅ Latest code pulled${NC}"
echo ""

echo -e "${GREEN}📦 Step 4: Installing dependencies...${NC}"
ssh -p $VPS_PORT $VPS_USER@$VPS_HOST << EOF
  set -e
  cd $DEPLOY_PATH
  
  echo "Running npm install..."
  npm install --production
  
  echo "✅ Dependencies installed"
EOF

echo -e "${GREEN}✅ Dependencies installed${NC}"
echo ""

echo -e "${GREEN}📦 Step 5: Checking PM2...${NC}"
ssh -p $VPS_PORT $VPS_USER@$VPS_HOST << EOF
  set -e
  
  if ! command -v pm2 &> /dev/null; then
    echo "PM2 not found - installing..."
    npm install -g pm2
  else
    echo "PM2 version: \$(pm2 --version)"
  fi
  
  echo "✅ PM2 ready"
EOF

echo -e "${GREEN}✅ PM2 ready${NC}"
echo ""

echo -e "${GREEN}📦 Step 6: Starting/Restarting backend...${NC}"
ssh -p $VPS_PORT $VPS_USER@$VPS_HOST << EOF
  set -e
  cd $DEPLOY_PATH
  
  # Check if backend is already running
  if pm2 describe xfuel-backend > /dev/null 2>&1; then
    echo "Backend is running - restarting..."
    pm2 restart xfuel-backend
  else
    echo "Backend not running - starting..."
    pm2 start ecosystem.config.js --env production
  fi
  
  # Save PM2 config
  pm2 save
  
  echo "✅ Backend started"
EOF

echo -e "${GREEN}✅ Backend started${NC}"
echo ""

echo -e "${GREEN}📦 Step 7: Verifying deployment...${NC}"
ssh -p $VPS_PORT $VPS_USER@$VPS_HOST << EOF
  set -e
  cd $DEPLOY_PATH
  
  # Wait for backend to start
  sleep 3
  
  # Check PM2 status
  pm2 describe xfuel-backend
  
  echo ""
  echo "✅ Deployment verified"
EOF

echo -e "${GREEN}✅ Deployment verified${NC}"
echo ""

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✅ DEPLOYMENT COMPLETE${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Next steps:"
echo "  1. View logs: ssh $VPS_USER@$VPS_HOST 'pm2 logs xfuel-backend'"
echo "  2. Check status: ssh $VPS_USER@$VPS_HOST 'pm2 status'"
echo "  3. Monitor: ssh $VPS_USER@$VPS_HOST 'pm2 monit'"
echo ""
echo "Health check:"
echo "  curl http://$VPS_HOST:3000/health"
echo ""

