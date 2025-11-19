#!/bin/bash

echo "=== Stopping ZeroTier Daemon ==="
echo ""

# Find ZeroTier processes
PIDS=$(pgrep -f "zerotier-one")

if [ -z "$PIDS" ]; then
    echo "✓ No ZeroTier daemon is running"
    exit 0
fi

echo "Found ZeroTier daemon(s):"
pgrep -af "zerotier-one"
echo ""

echo "Stopping daemon(s) (requires sudo)..."
sudo pkill -f "zerotier-one"

sleep 2

# Check if still running
if pgrep -f "zerotier-one" > /dev/null; then
    echo "⚠ Daemon still running, force killing..."
    sudo pkill -9 -f "zerotier-one"
    sleep 1
fi

if pgrep -f "zerotier-one" > /dev/null; then
    echo "✗ Failed to stop daemon"
    exit 1
else
    echo "✓ Daemon stopped successfully"
fi

echo ""
echo "Cleaning up old data directory..."
sudo rm -rf ~/.config/zima-client/zerotier-one
echo "✓ Clean slate ready for new daemon"
