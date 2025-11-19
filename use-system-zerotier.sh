#!/bin/bash

echo "=== Using System ZeroTier ==="
echo ""
echo "This is the SIMPLEST and RECOMMENDED approach."
echo "We'll use the system-installed ZeroTier instead of the bundled version."
echo ""

# Check if system ZeroTier is installed
if ! which zerotier-cli > /dev/null 2>&1; then
    echo "✗ System ZeroTier is not installed"
    echo ""
    echo "Install it with:"
    echo "  curl -s https://install.zerotier.com | sudo bash"
    echo ""
    exit 1
fi

echo "✓ System ZeroTier is installed"
echo ""

# Start the service
echo "Starting ZeroTier service..."
sudo systemctl start zerotier-one

# Enable it to start on boot
echo "Enabling ZeroTier to start on boot..."
sudo systemctl enable zerotier-one

# Check status
echo ""
echo "Status:"
sudo systemctl status zerotier-one --no-pager | head -10

echo ""
echo "Testing CLI..."
if zerotier-cli info; then
    echo ""
    echo "✓ System ZeroTier is working!"
    echo ""
    echo "The app will automatically use system ZeroTier."
    echo "No password prompts, no permission issues, no complexity."
else
    echo "✗ ZeroTier CLI not responding"
    exit 1
fi
