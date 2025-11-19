#!/bin/bash

echo "ZimaOS Linux Client - Setup Script"
echo "===================================="
echo ""

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed"
    echo "Please install Node.js 18 or higher from https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "Error: Node.js version must be 18 or higher"
    echo "Current version: $(node -v)"
    exit 1
fi

echo "✓ Node.js $(node -v) found"

# Check for npm
if ! command -v npm &> /dev/null; then
    echo "Error: npm is not installed"
    exit 1
fi

echo "✓ npm $(npm -v) found"

# Check for samba-client
if ! command -v smbclient &> /dev/null; then
    echo "Warning: smbclient is not installed"
    echo "Install it with: sudo apt install samba-client"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    echo "✓ smbclient found"
fi

# Install dependencies
echo ""
echo "Installing dependencies..."
npm install

if [ $? -eq 0 ]; then
    echo ""
    echo "✓ Setup complete!"
    echo ""
    echo "Next steps:"
    echo "1. Place ZeroTier binaries in binaries/zerotier-one/"
    echo "   - zerotier-one"
    echo "   - zerotier-cli"
    echo ""
    echo "2. Run the development server:"
    echo "   npm run dev"
    echo ""
    echo "3. Build for production:"
    echo "   npm run package:linux"
    echo ""
else
    echo "Error: Failed to install dependencies"
    exit 1
fi
