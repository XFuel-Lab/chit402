#!/bin/bash
# Quick persistenced installer - tries multiple methods

echo "Installing persistenced..."

# Method 1: Try common version formats
for version in "v16.0.1" "v16.0.0" "v15.0.0" "v11.17.0" "v11.16.0"; do
    for format in "persistenceCore_${version#v}_linux_amd64.tar.gz" "persistenceCore-${version}-linux-amd64.tar.gz" "persistenceCore_${version#v}_Linux_x86_64.tar.gz"; do
        url="https://github.com/persistenceOne/persistenceCore/releases/download/${version}/${format}"
        echo "Trying: $url"
        if wget -q "$url" 2>/dev/null; then
            echo "✓ Downloaded!"
            tar -xzf "$format" 2>/dev/null
            if [ -f "persistenceCore" ]; then
                chmod +x persistenceCore
                sudo mv persistenceCore /usr/local/bin/persistenced
                persistenced version
                echo "✓ persistenced installed successfully!"
                exit 0
            fi
        fi
    done
done

# Method 2: Build from source (if all else fails)
echo "Trying to install from Go..."
if command -v go &> /dev/null; then
    git clone https://github.com/persistenceOne/persistenceCore.git
    cd persistenceCore
    make install
    persistenced version
    exit 0
fi

echo "❌ Failed to install persistenced"
echo "Please install manually or provide the correct download URL"
exit 1
