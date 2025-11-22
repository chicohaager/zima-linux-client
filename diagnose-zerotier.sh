#!/bin/bash

# Diagnostic script for ZimaOS Client ZeroTier issues
# Run this script if you're experiencing "Failed to connect to network" errors

echo "================================================"
echo "ZimaOS Client - ZeroTier Diagnostic Tool"
echo "================================================"
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

error() {
    echo -e "${RED}✗${NC} $1"
}

success() {
    echo -e "${GREEN}✓${NC} $1"
}

warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

# Check 1: Service status
echo "1. Checking ZeroTier service status..."
if systemctl is-active --quiet zima-zerotier.service; then
    success "Service is running"
else
    error "Service is NOT running"
    echo "   Try: sudo systemctl start zima-zerotier.service"
    echo "   View logs: sudo journalctl -u zima-zerotier.service -n 50"
fi
echo ""

# Check 2: Binary exists and has capabilities
echo "2. Checking ZeroTier binary..."
if [ -f "/opt/zima-client/bin/zerotier-one" ]; then
    success "Binary found at /opt/zima-client/bin/zerotier-one"

    # Check capabilities
    if command -v getcap >/dev/null 2>&1; then
        CAPS=$(getcap /opt/zima-client/bin/zerotier-one 2>/dev/null)
        if echo "$CAPS" | grep -q "cap_net_admin"; then
            success "Binary has required capabilities: $CAPS"
        else
            warning "Binary missing network capabilities"
            echo "   Fix: sudo setcap cap_net_admin,cap_net_raw,cap_net_bind_service=+eip /opt/zima-client/bin/zerotier-one"
        fi
    fi
else
    error "Binary not found"
fi
echo ""

# Check 3: Data directory and files
echo "3. Checking ZeroTier data directory..."
if [ -d "/var/lib/zima-zerotier" ]; then
    success "Data directory exists"

    # Check directory permissions
    DIR_PERMS=$(stat -c "%a" /var/lib/zima-zerotier)
    if [ "$DIR_PERMS" = "755" ] || [ "$DIR_PERMS" = "750" ]; then
        success "Directory permissions: $DIR_PERMS"
    else
        warning "Unexpected directory permissions: $DIR_PERMS"
    fi

    # Check authtoken.secret
    if [ -f "/var/lib/zima-zerotier/authtoken.secret" ]; then
        TOKEN_PERMS=$(stat -c "%a" /var/lib/zima-zerotier/authtoken.secret)
        if [ "$TOKEN_PERMS" = "644" ]; then
            success "authtoken.secret permissions: $TOKEN_PERMS (readable)"

            # Try to read it
            if cat /var/lib/zima-zerotier/authtoken.secret >/dev/null 2>&1; then
                success "You can read authtoken.secret"
            else
                error "Cannot read authtoken.secret (permission denied)"
                echo "   Fix: sudo chmod 644 /var/lib/zima-zerotier/authtoken.secret"
            fi
        elif [ "$TOKEN_PERMS" = "640" ]; then
            warning "authtoken.secret permissions: $TOKEN_PERMS (requires group membership)"

            # Check if user is in zima-zerotier group
            if groups | grep -q zima-zerotier; then
                success "You are in zima-zerotier group"
                warning "If you just added the group, LOG OUT AND BACK IN for it to take effect"
            else
                error "You are NOT in zima-zerotier group"
                echo "   Fix: sudo usermod -a -G zima-zerotier $USER"
                echo "   Then LOG OUT and back in"
            fi
        else
            warning "Unexpected authtoken.secret permissions: $TOKEN_PERMS"
            echo "   Fix: sudo chmod 644 /var/lib/zima-zerotier/authtoken.secret"
        fi
    else
        error "authtoken.secret not found (daemon may not have started)"
    fi

    # Check zerotier-one.port
    if [ -f "/var/lib/zima-zerotier/zerotier-one.port" ]; then
        PORT_PERMS=$(stat -c "%a" /var/lib/zima-zerotier/zerotier-one.port)
        if [ "$PORT_PERMS" = "644" ]; then
            success "zerotier-one.port permissions: $PORT_PERMS (readable)"
        elif [ "$PORT_PERMS" = "640" ]; then
            warning "zerotier-one.port permissions: $PORT_PERMS (may require group membership)"
            echo "   Fix: sudo chmod 644 /var/lib/zima-zerotier/zerotier-one.port"
        else
            warning "Unexpected zerotier-one.port permissions: $PORT_PERMS"
        fi
    else
        error "zerotier-one.port not found (daemon may not have started)"
    fi
else
    error "Data directory /var/lib/zima-zerotier not found"
fi
echo ""

# Check 4: Try to connect to ZeroTier daemon
echo "4. Testing ZeroTier daemon connectivity..."
if [ -f "/opt/zima-client/bin/zerotier-cli" ] && [ -f "/var/lib/zima-zerotier/zerotier-one.port" ] && [ -f "/var/lib/zima-zerotier/authtoken.secret" ]; then
    PORT=$(cat /var/lib/zima-zerotier/zerotier-one.port 2>/dev/null)
    TOKEN=$(cat /var/lib/zima-zerotier/authtoken.secret 2>/dev/null)

    if [ -n "$PORT" ] && [ -n "$TOKEN" ]; then
        if /opt/zima-client/bin/zerotier-cli -p"$PORT" -T"$TOKEN" info >/dev/null 2>&1; then
            success "Successfully connected to ZeroTier daemon"
            /opt/zima-client/bin/zerotier-cli -p"$PORT" -T"$TOKEN" info
        else
            error "Cannot connect to ZeroTier daemon"
            echo "   The daemon may not be running or responding"
        fi
    else
        error "Cannot read port or token files"
    fi
else
    warning "Skipping connectivity test (missing files)"
fi
echo ""

# Check 5: User groups
echo "5. Checking user groups..."
if groups | grep -q zima-zerotier; then
    success "You are in zima-zerotier group"
else
    warning "You are NOT in zima-zerotier group"
    echo "   This is OK if authtoken.secret is world-readable (644)"
    echo "   To add yourself: sudo usermod -a -G zima-zerotier $USER"
    echo "   Then LOG OUT and back in"
fi
echo ""

echo "================================================"
echo "Diagnostic complete!"
echo ""
echo "Common fixes:"
echo "1. If service not running:"
echo "   sudo systemctl start zima-zerotier.service"
echo ""
echo "2. If permission denied errors:"
echo "   sudo chmod 644 /var/lib/zima-zerotier/authtoken.secret"
echo "   sudo chmod 644 /var/lib/zima-zerotier/zerotier-one.port"
echo ""
echo "3. If you just installed, LOG OUT and back in"
echo ""
echo "4. View service logs:"
echo "   sudo journalctl -u zima-zerotier.service -f"
echo "================================================"
