#!/bin/bash
set -e

# Post-installation script for Zima Linux Client .deb package
# This script runs as root during package installation

echo "================================================"
echo "ZimaOS Client - Post-Installation Setup"
echo "================================================"
echo ""

# -----------------------------------------------------------------------------
# Helper: detect primary desktop user (for user service installation)
# -----------------------------------------------------------------------------
detect_primary_user() {
    # Prefer SUDO_USER when present
    if [ -n "$SUDO_USER" ] && [ "$SUDO_USER" != "root" ]; then
        echo "$SUDO_USER"
        return
    fi

    # Try logname
    if logname_user=$(logname 2>/dev/null); then
        if [ -n "$logname_user" ] && [ "$logname_user" != "root" ]; then
            echo "$logname_user"
            return
        fi
    fi

    # Fallback: first regular user UID >= 1000
    primary=$(getent passwd | awk -F: '$3 >= 1000 && $3 < 65534 { print $1; exit }')
    if [ -n "$primary" ]; then
        echo "$primary"
        return
    fi

    # nothing found
    echo ""
}

# =============================================================================
# Group setup
# =============================================================================

# Create zima-zerotier group if it doesn't exist
if ! getent group zima-zerotier >/dev/null 2>&1; then
    groupadd --system zima-zerotier
    echo "✓ Created zima-zerotier group"
fi

# Add all regular users (UID >= 1000) to the group
for user in $(getent passwd | awk -F: '$3 >= 1000 && $3 < 65534 { print $1 }'); do
    if ! id -nG "$user" 2>/dev/null | grep -qw "zima-zerotier"; then
        usermod -a -G zima-zerotier "$user" 2>/dev/null || true
        echo "✓ Added $user to zima-zerotier group"
    fi
done
echo ""

# =============================================================================
# Clean up legacy system-wide service (if present)
# =============================================================================

LEGACY_SERVICE="/etc/systemd/system/zima-zerotier.service"
if [ -f "$LEGACY_SERVICE" ]; then
    echo "Found legacy system-wide zima-zerotier.service – cleaning up..."
    systemctl disable --now zima-zerotier.service 2>/dev/null || true
    rm -f "$LEGACY_SERVICE"
    systemctl daemon-reload
    echo "✓ Removed legacy system-wide zima-zerotier.service"
    echo ""
fi

# =============================================================================
# ZeroTier / TUN setup (kernel side only)
# =============================================================================

# We do NOT install system-wide ZeroTier anymore.
# The ZimaOS Client ships its own ZeroTier binaries and runs them as a user service.

# Ensure TUN device exists
if [ ! -e /dev/net/tun ]; then
    echo "Loading TUN kernel module..."
    if modprobe tun 2>/dev/null; then
        echo "✓ TUN module loaded"
    else
        echo "⚠ Warning: Could not load TUN module"
        echo "  ZeroTier requires /dev/net/tun"
        echo "  Run: sudo modprobe tun"
        echo ""
    fi
fi

# =============================================================================
# Copy bundled ZeroTier binaries to user home
# =============================================================================

RESOURCE_DIR="/opt/ZimaOS Client/resources"
TARGET_USER="$(detect_primary_user)"

if [ -n "$TARGET_USER" ]; then
    USER_HOME=$(eval echo "~$TARGET_USER")
    ZT_TARGET_DIR="$USER_HOME/.local/lib/zima-remote/zerotier"

    echo "Installing ZeroTier binaries for user: $TARGET_USER"

    # Detect architecture
    ARCH=$(uname -m)
    if [ "$ARCH" = "x86_64" ]; then
        ZT_ARCH="x64"
    elif [ "$ARCH" = "aarch64" ]; then
        ZT_ARCH="arm64"
    else
        echo "⚠ Unsupported architecture: $ARCH"
        ZT_ARCH="x64"  # fallback
    fi

    ZT_SOURCE_DIR="${RESOURCE_DIR}/bin/zerotier/${ZT_ARCH}"

    if [ -d "$ZT_SOURCE_DIR" ] && [ -f "$ZT_SOURCE_DIR/zerotier-one" ]; then
        # Stop user service if running (to avoid "busy" errors during upgrade)
        if runuser -l "$TARGET_USER" -c 'systemctl --user is-active --quiet zima-zerotier.service 2>/dev/null'; then
            echo "Stopping existing ZeroTier service..."
            runuser -l "$TARGET_USER" -c 'systemctl --user stop zima-zerotier.service' || true
        fi

        # Create target directory
        runuser -l "$TARGET_USER" -c "mkdir -p '$ZT_TARGET_DIR'"

        # Copy binaries
        cp "$ZT_SOURCE_DIR/zerotier-one" "$ZT_TARGET_DIR/"
        cp "$ZT_SOURCE_DIR/zerotier-cli" "$ZT_TARGET_DIR/"

        # Set ownership and permissions
        chown -R "$TARGET_USER:$TARGET_USER" "$ZT_TARGET_DIR"
        chmod +x "$ZT_TARGET_DIR/zerotier-one"
        chmod +x "$ZT_TARGET_DIR/zerotier-cli"

        # Set capabilities (if possible)
        if command -v setcap >/dev/null 2>&1; then
            setcap cap_net_admin,cap_net_raw,cap_net_bind_service=+eip "$ZT_TARGET_DIR/zerotier-one" 2>/dev/null || {
                echo "⚠ Could not set capabilities (may require filesystem support)"
            }
        fi

        echo "✓ ZeroTier binaries installed to $ZT_TARGET_DIR"
    else
        echo "⚠ ZeroTier binaries not found at $ZT_SOURCE_DIR"
        echo "  The service may fail to start until binaries are manually installed."
    fi
    echo ""
fi

# =============================================================================
# Systemd user service configuration (bundled ZeroTier binaries)
# =============================================================================

# Service file may be shipped in different locations – check both
SERVICE_SOURCE=""
if [ -f "${RESOURCE_DIR}/zima-zerotier.service" ]; then
    SERVICE_SOURCE="${RESOURCE_DIR}/zima-zerotier.service"
elif [ -f "${RESOURCE_DIR}/resources/zima-zerotier.service" ]; then
    SERVICE_SOURCE="${RESOURCE_DIR}/resources/zima-zerotier.service"
fi

if [ -z "$SERVICE_SOURCE" ]; then
    echo "⚠ No zima-zerotier.service found in resources."
    echo "  Expected at:"
    echo "    ${RESOURCE_DIR}/zima-zerotier.service"
    echo "    or"
    echo "    ${RESOURCE_DIR}/resources/zima-zerotier.service"
    echo ""
    echo "You will need to install the systemd user service manually."
else
    echo "Installing systemd user service from:"
    echo "  $SERVICE_SOURCE"
    echo ""

    if [ -z "$TARGET_USER" ]; then
        echo "⚠ Could not detect a primary desktop user."
        echo "  Please install the user service manually for each user:"
        echo ""
        echo "    mkdir -p ~/.config/systemd/user"
        echo "    cp \"$SERVICE_SOURCE\" ~/.config/systemd/user/zima-zerotier.service"
        echo "    systemctl --user daemon-reload"
        echo "    systemctl --user enable --now zima-zerotier.service"
        echo ""
    else
        echo "Configuring user service for: $TARGET_USER"

        USER_HOME=$(eval echo "~$TARGET_USER")

        # Create systemd user dir
        runuser -l "$TARGET_USER" -c '
            mkdir -p ~/.config/systemd/user
        '

        # Copy service file
        cp "$SERVICE_SOURCE" "$USER_HOME/.config/systemd/user/zima-zerotier.service"
        chown "$TARGET_USER:$TARGET_USER" "$USER_HOME/.config/systemd/user/zima-zerotier.service"

        # Reload and enable the user service
        runuser -l "$TARGET_USER" -c '
            systemctl --user daemon-reload
            systemctl --user enable --now zima-zerotier.service || true
        '

        # Ensure user services run after reboot
        loginctl enable-linger "$TARGET_USER" 2>/dev/null || true

        echo "✓ User service zima-zerotier.service installed for $TARGET_USER"
        echo ""

        # Check if service is running
        if runuser -l "$TARGET_USER" -c 'systemctl --user is-active --quiet zima-zerotier.service'; then
            echo "✓ ZeroTier service is running"
        else
            echo "⚠ ZeroTier service failed to start"
            echo "  Check status: systemctl --user status zima-zerotier.service"
            echo "  View logs: journalctl --user -u zima-zerotier.service -n 50"
        fi
    fi
fi

# =============================================================================
# Desktop integration
# =============================================================================

echo ""
echo "Setting up desktop integration..."

# Install icon
ICON_SOURCE="${RESOURCE_DIR}/icon.png"
if [ -f "$ICON_SOURCE" ]; then
    mkdir -p /usr/share/icons/hicolor/256x256/apps
    cp "$ICON_SOURCE" /usr/share/icons/hicolor/256x256/apps/zima-linux-client.png
    echo "✓ Icon installed"
elif [ -f "${RESOURCE_DIR}/app.asar.unpacked/icon.png" ]; then
    mkdir -p /usr/share/icons/hicolor/256x256/apps
    cp "${RESOURCE_DIR}/app.asar.unpacked/icon.png" /usr/share/icons/hicolor/256x256/apps/zima-linux-client.png
    echo "✓ Icon installed from app.asar.unpacked"
elif [ -f "/opt/ZimaOS Client/icon.png" ]; then
    mkdir -p /usr/share/icons/hicolor/256x256/apps
    cp "/opt/ZimaOS Client/icon.png" /usr/share/icons/hicolor/256x256/apps/zima-linux-client.png
    echo "✓ Icon installed from /opt/ZimaOS Client/icon.png"
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
echo "  • ZeroTier runs as a user systemd service using bundled binaries"
echo "  • First-time setup may take a moment while ZeroTier initializes"
echo ""
echo "Troubleshooting:"
echo "  • Run diagnostic: bash /opt/ZimaOS\\ Client/resources/diagnose-zerotier.sh"
echo "  • View logs (user service):"
echo "      journalctl --user -u zima-zerotier.service -f"
echo "  • Check status:"
echo "      systemctl --user status zima-zerotier.service"
echo ""
echo "Documentation:"
echo "  • /opt/ZimaOS\\ Client/resources/TROUBLESHOOTING.md"
echo ""
echo "================================================"
