#!/bin/bash
set -e

# Post-installation script for Zima Linux Client .deb package
# This script runs as root during package installation

echo "Setting up Zima Client ZeroTier service..."

# Create zima-zerotier group if it doesn't exist
if ! getent group zima-zerotier >/dev/null 2>&1; then
    groupadd --system zima-zerotier
    echo "✓ Created zima-zerotier group"
fi

# Add all users to the group (so anyone can use the app)
# Get all regular users (UID >= 1000)
for user in $(getent passwd | awk -F: '$3 >= 1000 && $3 < 65534 { print $1 }'); do
    if ! groups "$user" | grep -q zima-zerotier; then
        usermod -a -G zima-zerotier "$user" 2>/dev/null || true
        echo "✓ Added $user to zima-zerotier group"
    fi
done

# Stop existing service if running (to avoid "busy" error when overwriting binaries)
if systemctl is-active --quiet zima-zerotier.service 2>/dev/null; then
    echo "Stopping existing ZeroTier service..."
    systemctl stop zima-zerotier.service || true
fi

# Create directory for binaries
mkdir -p /opt/zima-client/bin

# Copy binaries from AppImage resources to system location
# electron-builder extraResources are at /opt/ZimaOS Client/resources/
RESOURCE_DIR="/opt/ZimaOS Client/resources"

# Detect architecture
ARCH=$(uname -m)
if [ "$ARCH" = "x86_64" ]; then
    ZT_ARCH="x64"
elif [ "$ARCH" = "aarch64" ]; then
    ZT_ARCH="arm64"
else
    echo "Unsupported architecture: $ARCH"
    exit 1
fi

# Copy ZeroTier binaries
if [ -d "${RESOURCE_DIR}/bin/zerotier/${ZT_ARCH}" ]; then
    cp "${RESOURCE_DIR}/bin/zerotier/${ZT_ARCH}/zerotier-one" /opt/zima-client/bin/
    cp "${RESOURCE_DIR}/bin/zerotier/${ZT_ARCH}/zerotier-cli" /opt/zima-client/bin/
    chmod +x /opt/zima-client/bin/zerotier-*
    echo "✓ Copied ZeroTier binaries"
fi

# Copy and install systemd service
if [ -f "${RESOURCE_DIR}/resources/zima-zerotier.service" ]; then
    cp "${RESOURCE_DIR}/resources/zima-zerotier.service" /etc/systemd/system/
    
    # Reload systemd
    systemctl daemon-reload
    
    # Enable and start service
    systemctl enable zima-zerotier.service
    systemctl start zima-zerotier.service || true
    
    # Check if service started
    sleep 2
    if systemctl is-active --quiet zima-zerotier.service; then
        echo "✓ ZeroTier service started successfully"

        # Fix permissions on ZeroTier files
        sleep 1
        if [ -d "/var/lib/zima-zerotier" ]; then
            chown -R root:zima-zerotier /var/lib/zima-zerotier
            chmod -R 750 /var/lib/zima-zerotier
            if [ -f "/var/lib/zima-zerotier/authtoken.secret" ]; then
                chmod 640 /var/lib/zima-zerotier/authtoken.secret
            fi
            if [ -f "/var/lib/zima-zerotier/zerotier-one.port" ]; then
                chmod 640 /var/lib/zima-zerotier/zerotier-one.port
            fi
            echo "✓ Fixed permissions on ZeroTier files"
        fi
    else
        echo "⚠ ZeroTier service installation complete, but service failed to start"
        echo "  Check: systemctl status zima-zerotier.service"
    fi
fi

# Update desktop database
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database /usr/share/applications || true
    echo "✓ Desktop database updated"
fi

# Update icon cache
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -f -t /usr/share/icons/hicolor || true
    echo "✓ Icon cache updated"
fi

echo "✓ Zima Client installation complete!"
