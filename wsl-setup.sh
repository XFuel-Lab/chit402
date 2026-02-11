#!/bin/bash
# XFuel Reverse Bridge - WSL Setup Script
set -e

echo "=========================================="
echo "Installing persistenced in WSL"
echo "=========================================="
echo ""

# Install dependencies
echo "Installing dependencies..."
sudo apt-get update -qq > /dev/null 2>&1
sudo apt-get install -y curl jq wget > /dev/null 2>&1

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "Installing AWS CLI..."
    sudo apt-get install -y awscli > /dev/null 2>&1
fi

# Download persistenced
echo "Downloading persistenced..."
cd ~
wget -q https://github.com/persistenceOne/persistenceCore/releases/download/v11.14.0/persistenceCore_11.14.0_Linux_x86_64.tar.gz
tar -xzf persistenceCore_11.14.0_Linux_x86_64.tar.gz
chmod +x persistenceCore
sudo mv persistenceCore /usr/local/bin/persistenced

# Create config directory
mkdir -p ~/.persistenceCore

# Verify
echo ""
echo "Verifying installation..."
persistenced version
echo ""
echo "✓ persistenced installed successfully!"
echo ""
echo "Next: Run the deployment script"
echo "  wsl bash deploy-persistence.sh"
