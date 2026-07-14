#!/bin/bash
# Quick Redis Setup for WSL
# Run this in WSL to install and start Redis

echo "🔧 Installing Redis in WSL..."

# Update package list
sudo apt update

# Install Redis
sudo apt install redis-server -y

# Start Redis
sudo service redis-server start

# Check if Redis is running
redis-cli ping

echo ""
echo "✅ Redis installed and running!"
echo ""
echo "To check status: sudo service redis-server status"
echo "To stop: sudo service redis-server stop"
echo "To start: sudo service redis-server start"
echo ""
echo "Redis is now accessible at: localhost:6379"
