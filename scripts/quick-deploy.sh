#!/bin/bash
# Quick deployment script (no Docker rebuild needed)
# Run directly with existing container or local persistenceCore

set -e

echo "========================================================================"
echo "🚀 QUICK PERSISTENCE DEPLOYMENT (Using existing container)"
echo "========================================================================"
echo ""

# Use existing container
CONTAINER_ID=$(docker ps -q -f name=persistence-deployer)

if [ -z "$CONTAINER_ID" ]; then
  echo "📦 Starting persistence-deployer container..."
  docker-compose --profile deploy up -d persistence-deployer
  sleep 5
  CONTAINER_ID=$(docker ps -q -f name=persistence-deployer)
fi

if [ -z "$CONTAINER_ID" ]; then
  echo "❌ Could not start container"
  echo "Try: docker-compose --profile deploy up -d persistence-deployer"
  exit 1
fi

echo "✅ Using container: $CONTAINER_ID"
echo ""

# Execute deployment in container
echo "🚀 Running deployment..."
docker exec -it $CONTAINER_ID /app/scripts/docker-deploy-persistence.sh

echo ""
echo "========================================================================"
echo "✅ Deployment script executed"
echo "========================================================================"

