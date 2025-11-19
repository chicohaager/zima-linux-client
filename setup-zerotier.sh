#!/bin/bash
# Setup script for ZeroTier - run once with: sudo ./setup-zerotier.sh

set -e

if [ "$EUID" -ne 0 ]; then
  echo "Please run with sudo: sudo ./setup-zerotier.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZT_BIN="$SCRIPT_DIR/binaries/zerotier-one/zerotier-one"
ZT_HOME="$HOME/.config/zima-client/zerotier-one"

echo "Setting up bundled ZeroTier..."

# Create home directory if it doesn't exist
mkdir -p "$ZT_HOME"
chmod 700 "$ZT_HOME"

# Start the daemon in the background
echo "Starting ZeroTier daemon..."
"$ZT_BIN" -d"$ZT_HOME" &
ZT_PID=$!

echo "✓ ZeroTier daemon started (PID: $ZT_PID)"
echo ""
echo "To stop the daemon later, run: sudo kill $ZT_PID"
echo "The ZimaOS Client app can now connect to this daemon."
