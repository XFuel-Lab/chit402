#!/bin/bash

# Production run script for Theta-Persistence ZK Bridge with PM2

echo "Starting Theta-Persistence ZK Bridge in production mode..."

# Check if .env exists
if [ ! -f .env ]; then
    echo "Error: .env file not found!"
    echo "Please copy env.example to .env and configure it."
    exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm ci --only=production
fi

# Create logs directory
mkdir -p logs

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo "PM2 not found. Installing globally..."
    npm install -g pm2
fi

# Start with PM2
echo "Starting service with PM2..."
pm2 start ecosystem.config.cjs

echo ""
echo "Service started! Available commands:"
echo "  pm2 logs theta-bridge    - View logs"
echo "  pm2 monit                - Monitor resources"
echo "  pm2 restart theta-bridge - Restart service"
echo "  pm2 stop theta-bridge    - Stop service"
echo ""

