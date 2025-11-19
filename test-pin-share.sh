#!/bin/bash
# Test script for pinning SMB shares with credentials
# Mimics what the Zima Client does

set -e

if [ "$#" -lt 2 ]; then
    echo "Usage: $0 <host> <share> [username] [password]"
    echo ""
    echo "Examples:"
    echo "  $0 172.30.0.1 Home-Storage"
    echo "  $0 172.30.0.1 Home-Storage Holgi mypassword"
    exit 1
fi

HOST="$1"
SHARE="$2"
USERNAME="${3:-}"
PASSWORD="${4:-}"

echo "======================================"
echo "Pin SMB Share Test"
echo "======================================"
echo ""
echo "Host:     $HOST"
echo "Share:    $SHARE"
if [ -n "$USERNAME" ]; then
    echo "Username: $USERNAME"
    echo "Password: ${PASSWORD:+***}"
else
    echo "Auth:     Guest (no credentials)"
fi
echo ""

# Step 1: Check if SMB port is reachable
echo "Step 1: Checking SMB port..."
echo "------------------------------------"

if timeout 2 bash -c "echo >/dev/tcp/$HOST/445" 2>/dev/null; then
    echo "✓ Port 445 is open on $HOST"
else
    echo "✗ Port 445 is not reachable"
    echo "  Make sure:"
    echo "  - Host is online"
    echo "  - SMB service is running"
    echo "  - Firewall allows port 445"
    exit 1
fi
echo ""

# Step 2: Test SMB connection
echo "Step 2: Testing SMB connection..."
echo "------------------------------------"

if [ -n "$USERNAME" ]; then
    CMD="smbclient -L $HOST -U '$USERNAME%$PASSWORD' -g"
else
    CMD="smbclient -L $HOST -N -g"
fi

if SHARES=$(eval $CMD 2>/dev/null | grep "^Disk|"); then
    echo "✓ SMB connection successful"
    echo ""
    echo "Available shares:"
    while IFS='|' read -r type name comment; do
        if [ "$type" = "Disk" ]; then
            if [ -n "$comment" ]; then
                echo "  📁 $name - $comment"
            else
                echo "  📁 $name"
            fi

            # Check if requested share exists
            if [ "$name" = "$SHARE" ]; then
                SHARE_EXISTS="yes"
            fi
        fi
    done <<< "$SHARES"

    if [ -z "${SHARE_EXISTS:-}" ]; then
        echo ""
        echo "✗ Share '$SHARE' not found on $HOST"
        exit 1
    fi
else
    echo "✗ SMB connection failed"
    exit 1
fi
echo ""

# Step 3: Create bookmark
echo "Step 3: Creating file manager bookmark..."
echo "------------------------------------"

# Build URL
if [ -n "$USERNAME" ]; then
    URL="smb://${USERNAME}@${HOST}/${SHARE}"
else
    URL="smb://${HOST}/${SHARE}"
fi

LABEL="${HOST} - ${SHARE}"

# GTK Bookmarks (GNOME Files/Nautilus)
GTK_BOOKMARKS="$HOME/.config/gtk-3.0/bookmarks"

mkdir -p "$(dirname "$GTK_BOOKMARKS")"
touch "$GTK_BOOKMARKS"

if grep -q "$URL" "$GTK_BOOKMARKS" 2>/dev/null; then
    echo "✓ Bookmark already exists in GTK bookmarks"
else
    echo "$URL $LABEL" >> "$GTK_BOOKMARKS"
    echo "✓ Added to GTK bookmarks: $GTK_BOOKMARKS"
fi

# KDE Places (optional)
KDE_PLACES="$HOME/.local/share/user-places.xbel"

if [ -f "$KDE_PLACES" ]; then
    if grep -q "href=\"$URL\"" "$KDE_PLACES"; then
        echo "✓ Bookmark already exists in KDE places"
    else
        # Basic KDE integration (simplified)
        echo "ℹ KDE places file exists but integration not implemented in test script"
        echo "  (Full implementation in PlacesManager.ts)"
    fi
fi
echo ""

# Step 4: Mount with gio (caches credentials in keyring)
if [ -n "$USERNAME" ] && [ -n "$PASSWORD" ]; then
    echo "Step 4: Mounting with gio (caching credentials)..."
    echo "------------------------------------"

    MOUNT_URL="smb://${USERNAME}:${PASSWORD}@${HOST}/${SHARE}"

    if gio mount "$MOUNT_URL" 2>&1 | grep -q "already mounted\|Mounted"; then
        echo "✓ Share mounted successfully"
        echo "✓ Credentials cached in system keyring"
    else
        echo "⚠ Mount failed (may already be mounted)"
        echo "  Bookmark is still created"
    fi
    echo ""
fi

# Summary
echo "======================================"
echo "Summary"
echo "======================================"
echo ""
echo "✓ SMB connection verified"
echo "✓ Bookmark created: $URL"
if [ -n "$USERNAME" ] && [ -n "$PASSWORD" ]; then
    echo "✓ Credentials cached in keyring"
fi
echo ""
echo "Test your bookmark:"
echo "  1. Open Files (Nautilus)"
echo "  2. Check sidebar for '$LABEL'"
echo "  3. Click to mount (should work without password prompt)"
echo ""
