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
    echo "Copying ZeroTier binaries for ${ZT_ARCH}..."
    cp "${RESOURCE_DIR}/bin/zerotier/${ZT_ARCH}/zerotier-one" /opt/zima-client/bin/
    cp "${RESOURCE_DIR}/bin/zerotier/${ZT_ARCH}/zerotier-cli" /opt/zima-client/bin/
    chmod +x /opt/zima-client/bin/zerotier-*

    # Verify binaries were copied
    if [ ! -f "/opt/zima-client/bin/zerotier-one" ]; then
        echo "✗ Error: Failed to copy zerotier-one binary"
        exit 1
    fi

    # Set Linux capabilities for network operations (belt-and-suspenders with systemd)
    if command -v setcap >/dev/null 2>&1; then
        setcap cap_net_admin,cap_net_raw,cap_net_bind_service=+eip /opt/zima-client/bin/zerotier-one 2>/dev/null || {
            echo "⚠ Warning: Could not set capabilities on zerotier-one"
            echo "  This is usually OK - systemd will provide capabilities via AmbientCapabilities"
        }
        # Verify capabilities were set
        if getcap /opt/zima-client/bin/zerotier-one 2>/dev/null | grep -q cap_net_admin; then
            echo "✓ Set network capabilities on zerotier-one"
        fi
    fi

    echo "✓ Copied ZeroTier binaries"
else
    echo "✗ Error: ZeroTier binaries not found at ${RESOURCE_DIR}/bin/zerotier/${ZT_ARCH}"
    exit 1
fi

# Ensure TUN device exists
if [ ! -e /dev/net/tun ]; then
    echo "TUN device not found, loading kernel module..."
    modprobe tun 2>/dev/null || {
        echo "⚠ Warning: Could not load TUN module"
        echo "  ZeroTier requires /dev/net/tun to create virtual network interfaces"
        echo "  You may need to run: sudo modprobe tun"
    }
fi

# Copy and install systemd service
if [ -f "${RESOURCE_DIR}/resources/zima-zerotier.service" ]; then
    echo "Installing systemd service..."
    cp "${RESOURCE_DIR}/resources/zima-zerotier.service" /etc/systemd/system/

    # Reload systemd
    systemctl daemon-reload

    # Enable service
    systemctl enable zima-zerotier.service

    # Try to start service
    echo "Starting ZeroTier service..."
    if systemctl start zima-zerotier.service; then
        # Wait for service to fully initialize
        sleep 3

        if systemctl is-active --quiet zima-zerotier.service; then
            echo "✓ ZeroTier service started successfully"

            # Fix permissions on ZeroTier files
            if [ -d "/var/lib/zima-zerotier" ]; then
                chown -R root:zima-zerotier /var/lib/zima-zerotier
                chmod 755 /var/lib/zima-zerotier
                # Make token and port files world-readable (they're not security-sensitive)
                # The security comes from the local-only API on 127.0.0.1
                if [ -f "/var/lib/zima-zerotier/authtoken.secret" ]; then
                    chmod 644 /var/lib/zima-zerotier/authtoken.secret
                fi
                if [ -f "/var/lib/zima-zerotier/zerotier-one.port" ]; then
                    chmod 644 /var/lib/zima-zerotier/zerotier-one.port
                fi
                echo "✓ Fixed permissions on ZeroTier files"
            fi
        else
            echo "⚠ ZeroTier service failed to stay running"
            echo "  Run this to see the error:"
            echo "    sudo journalctl -u zima-zerotier.service -n 50 --no-pager"
            echo "    sudo systemctl status zima-zerotier.service"
        fi
    else
        echo "✗ Failed to start ZeroTier service"
        echo ""
        echo "=== Service Status ==="
        systemctl status zima-zerotier.service --no-pager || true
        echo ""
        echo "=== Last 20 Log Lines ==="
        journalctl -u zima-zerotier.service -n 20 --no-pager || true
        echo ""
        echo "Common issues:"
        echo "  1. Missing /dev/net/tun: Run 'sudo modprobe tun'"
        echo "  2. Binary not found: Check /opt/zima-client/bin/zerotier-one exists"
        echo "  3. Missing capabilities: This should be OK, systemd provides them"
        echo ""
        echo "You can try to start it manually later:"
        echo "  sudo systemctl start zima-zerotier.service"
        echo "  sudo journalctl -u zima-zerotier.service -f"
    fi
fi

# Install icon to proper location
ICON_SOURCE="/opt/ZimaOS Client/resources/app.asar.unpacked/icon.png"
if [ -f "$ICON_SOURCE" ]; then
    mkdir -p /usr/share/icons/hicolor/256x256/apps
    cp "$ICON_SOURCE" /usr/share/icons/hicolor/256x256/apps/zima-linux-client.png
    echo "✓ Icon installed"
elif [ -f "/opt/ZimaOS Client/icon.png" ]; then
    mkdir -p /usr/share/icons/hicolor/256x256/apps
    cp "/opt/ZimaOS Client/icon.png" /usr/share/icons/hicolor/256x256/apps/zima-linux-client.png
    echo "✓ Icon installed"
fi

# Remove incorrectly placed icon if exists
if [ -f "/usr/share/icons/hicolor/0x0/apps/zima-linux-client.png" ]; then
    rm -f /usr/share/icons/hicolor/0x0/apps/zima-linux-client.png
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
echo ""
echo "================================================"
echo "IMPORTANT: If this is your first installation,"
echo "please LOG OUT and back in for group permissions"
echo "to take effect."
echo ""
echo "If you experience connection issues, run:"
echo "  bash /opt/ZimaOS\\ Client/resources/diagnose-zerotier.sh"
echo "================================================"
