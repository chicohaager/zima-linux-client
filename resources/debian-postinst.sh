#!/bin/bash
# Post-installation script for .deb package

set -e

APP_DIR="/opt/ZimaOS Client"
SERVICE_FILE="$APP_DIR/resources/zima-zerotier.service"
ZT_DATA_DIR="/var/lib/zima-zerotier"

echo "Configuring ZeroTier for ZimaOS Client..."

# Create ZeroTier data directory
mkdir -p "$ZT_DATA_DIR"
chmod 700 "$ZT_DATA_DIR"

# Install systemd service
if [ -f "$SERVICE_FILE" ]; then
    cp "$SERVICE_FILE" /etc/systemd/system/
    systemctl daemon-reload
    systemctl enable zima-zerotier.service
    systemctl start zima-zerotier.service
    echo "✓ ZeroTier service installed and started"
else
    echo "Warning: ZeroTier service file not found"
fi
