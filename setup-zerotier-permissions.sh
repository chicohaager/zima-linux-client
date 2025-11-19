#!/bin/bash

echo "=== ZeroTier Permission Setup ==="
echo ""
echo "This script will configure sudo to allow zerotier-cli to run without password."
echo "This is necessary because the daemon runs as root and creates root-owned files."
echo ""

# Check if running as root
if [ "$EUID" -eq 0 ]; then
   echo "Please run as normal user (this script will use sudo when needed)"
   exit 1
fi

ZT_DIR="/home/holgi/dev/linux-client/binaries/zerotier-one"
ZT_DAEMON="$ZT_DIR/zerotier-one"
ZT_CLI="$ZT_DIR/zerotier-cli"
SUDOERS_FILE="/etc/sudoers.d/zima-zerotier"

echo "Creating sudoers rules for zerotier daemon and CLI..."
echo ""
echo "This will add the following rules:"
echo "  $USER ALL=(ALL) NOPASSWD: $ZT_DAEMON"
echo "  $USER ALL=(ALL) NOPASSWD: $ZT_CLI"
echo ""

read -p "Continue? (y/N) " -n 1 -r
echo

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 1
fi

# Create sudoers file
echo "# Allow $USER to run ZeroTier daemon and CLI without password" | sudo tee "$SUDOERS_FILE" > /dev/null
echo "$USER ALL=(ALL) NOPASSWD: $ZT_DAEMON" | sudo tee -a "$SUDOERS_FILE" > /dev/null
echo "$USER ALL=(ALL) NOPASSWD: $ZT_CLI" | sudo tee -a "$SUDOERS_FILE" > /dev/null

# Set correct permissions
sudo chmod 0440 "$SUDOERS_FILE"

# Validate
if sudo visudo -c -f "$SUDOERS_FILE"; then
    echo ""
    echo "✓ Sudoers rules created successfully!"
    echo ""
    echo "Testing..."
    if sudo "$ZT_CLI" --version 2>&1 | grep -q "version"; then
        echo "✓ zerotier-cli can now run without password prompt"
        echo "✓ zerotier daemon can now run without password prompt"
    else
        echo "⚠ Could not verify (this is OK if daemon not running)"
    fi
else
    echo "✗ Invalid sudoers file, removing..."
    sudo rm -f "$SUDOERS_FILE"
    exit 1
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "To undo this setup later, run:"
echo "  sudo rm $SUDOERS_FILE"
