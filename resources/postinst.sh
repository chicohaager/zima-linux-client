#!/bin/bash
set -e

# Post-installation script for Zima Linux Client .deb package
# This script runs as root during package installation

echo "================================================"
echo "ZimaOS Client - Post-Installation Setup"
echo "================================================"
echo ""

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
echo ""

# Stop existing service if running
if systemctl is-active --quiet zima-zerotier.service 2>/dev/null; then
    echo "Stopping existing ZeroTier service..."
    systemctl stop zima-zerotier.service || true
fi

# =============================================================================
# ZeroTier Installation - Always use system ZeroTier for maximum compatibility
# =============================================================================

echo "Setting up ZeroTier..."

# Check if ZeroTier is already installed
if command -v zerotier-one >/dev/null 2>&1; then
    ZT_VERSION=$(zerotier-one -v 2>/dev/null || echo "unknown")
    echo "✓ ZeroTier already installed (version: $ZT_VERSION)"
else
    echo "ZeroTier not found. Installing from official repository..."
    echo ""

    # Detect if we have internet connectivity
    if ! ping -c 1 -W 2 google.com >/dev/null 2>&1 && ! ping -c 1 -W 2 8.8.8.8 >/dev/null 2>&1; then
        echo "⚠ No internet connection detected"
        echo ""
        echo "ZeroTier installation requires internet access."
        echo "Please connect to the internet and run:"
        echo "  sudo apt-get update && sudo apt-get install zerotier-one"
        echo ""
        echo "Or use the official install script:"
        echo "  curl -s https://install.zerotier.com | sudo bash"
        echo ""
        echo "Then restart the ZeroTier service:"
        echo "  sudo systemctl restart zima-zerotier.service"
        echo ""
        # Don't fail installation - user can install ZeroTier later
    else
        # Install ZeroTier using official script
        if curl -s https://install.zerotier.com | bash; then
            echo "✓ ZeroTier installed successfully"

            # Stop and disable the default system service (we use our own)
            systemctl stop zerotier-one 2>/dev/null || true
            systemctl disable zerotier-one 2>/dev/null || true
            echo "✓ Disabled default ZeroTier service (using custom zima-zerotier service)"
        else
            echo "✗ ZeroTier installation failed"
            echo ""
            echo "Please install manually:"
            echo "  curl -s https://install.zerotier.com | sudo bash"
            echo ""
            echo "Then restart the service:"
            echo "  sudo systemctl restart zima-zerotier.service"
            echo ""
        fi
    fi
fi
echo ""

# =============================================================================
# System Service Configuration
# =============================================================================

RESOURCE_DIR="/opt/ZimaOS Client/resources"

# Ensure TUN device exists
if [ ! -e /dev/net/tun ]; then
    echo "Loading TUN kernel module..."
    modprobe tun 2>/dev/null || {
        echo "⚠ Warning: Could not load TUN module"
        echo "  ZeroTier requires /dev/net/tun"
        echo "  Run: sudo modprobe tun"
        echo ""
    }
fi

# Install systemd service
if [ -f "${RESOURCE_DIR}/resources/zima-zerotier.service" ]; then
    echo "Installing systemd service..."
    cp "${RESOURCE_DIR}/resources/zima-zerotier.service" /etc/systemd/system/

    # Reload systemd
    systemctl daemon-reload

    # Enable service
    systemctl enable zima-zerotier.service
    echo "✓ Service enabled"
    echo ""

    # Try to start service
    echo "Starting ZeroTier service..."
    if systemctl start zima-zerotier.service; then
        # Wait for service to fully initialize
        sleep 3

        if systemctl is-active --quiet zima-zerotier.service; then
            echo "✓ ZeroTier service started successfully"
            echo ""

            # Fix permissions on ZeroTier files
            if [ -d "/var/lib/zima-zerotier" ]; then
                chown -R root:zima-zerotier /var/lib/zima-zerotier
                chmod 755 /var/lib/zima-zerotier

                # Make token and port files world-readable
                # Security: ZeroTier API only listens on 127.0.0.1
                if [ -f "/var/lib/zima-zerotier/authtoken.secret" ]; then
                    chmod 644 /var/lib/zima-zerotier/authtoken.secret
                fi
                if [ -f "/var/lib/zima-zerotier/zerotier-one.port" ]; then
                    chmod 644 /var/lib/zima-zerotier/zerotier-one.port
                fi
                echo "✓ Configured permissions"
            fi
        else
            echo "⚠ Service failed to stay running"
            echo ""
            echo "Check status with:"
            echo "  sudo systemctl status zima-zerotier.service"
            echo "  sudo journalctl -u zima-zerotier.service -n 50"
            echo ""
        fi
    else
        echo "✗ Failed to start service"
        echo ""
        systemctl status zima-zerotier.service --no-pager || true
        echo ""
        journalctl -u zima-zerotier.service -n 20 --no-pager || true
        echo ""
        echo "Troubleshooting:"
        echo "  1. Check if ZeroTier is installed: which zerotier-one"
        echo "  2. Check TUN device: ls -l /dev/net/tun"
        echo "  3. Try manual start: sudo systemctl start zima-zerotier.service"
        echo ""
    fi
fi

# =============================================================================
# Desktop Integration
# =============================================================================

echo "Setting up desktop integration..."

# Install icon
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

echo ""
echo "================================================"
echo "✓ Installation Complete!"
echo "================================================"
echo ""
echo "IMPORTANT:"
echo "  • Log out and back in for group permissions to take effect"
echo "  • First-time setup may take a moment while ZeroTier initializes"
echo ""
echo "Troubleshooting:"
echo "  • Run diagnostic: bash /opt/ZimaOS\\ Client/resources/diagnose-zerotier.sh"
echo "  • View logs: sudo journalctl -u zima-zerotier.service -f"
echo "  • Check service: sudo systemctl status zima-zerotier.service"
echo ""
echo "Documentation:"
echo "  • /opt/ZimaOS\\ Client/resources/TROUBLESHOOTING.md"
echo "  • /opt/ZimaOS\\ Client/resources/GLIBC_COMPATIBILITY.md"
echo ""
echo "================================================"
