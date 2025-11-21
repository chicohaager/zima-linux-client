#!/bin/bash
# Fix ZimaOS Client icon installation

set -e

echo "Fixing ZimaOS Client icon..."

# Install icon to proper system location
sudo mkdir -p /usr/share/icons/hicolor/256x256/apps
sudo cp icon.png /usr/share/icons/hicolor/256x256/apps/zima-linux-client.png
echo "✓ Icon copied to system location"

# Also create common sizes if ImageMagick is available
if command -v convert >/dev/null 2>&1; then
    echo "Creating additional icon sizes..."
    for size in 16 22 24 32 48 64 128 512; do
        sudo mkdir -p "/usr/share/icons/hicolor/${size}x${size}/apps"
        sudo convert icon.png -resize ${size}x${size} "/usr/share/icons/hicolor/${size}x${size}/apps/zima-linux-client.png"
        echo "✓ Created ${size}x${size} icon"
    done
fi

# Update icon cache
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    sudo gtk-update-icon-cache -f -t /usr/share/icons/hicolor
    echo "✓ Icon cache updated"
fi

# Also update for user directory (if app is installed there)
if [ -d "$HOME/.local/share/icons/hicolor" ]; then
    mkdir -p "$HOME/.local/share/icons/hicolor/256x256/apps"
    cp icon.png "$HOME/.local/share/icons/hicolor/256x256/apps/zima-linux-client.png"
    if command -v gtk-update-icon-cache >/dev/null 2>&1; then
        gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor"
    fi
    echo "✓ User icon cache updated"
fi

# Remove the incorrectly placed icon
if [ -f "/usr/share/icons/hicolor/0x0/apps/zima-linux-client.png" ]; then
    sudo rm -f /usr/share/icons/hicolor/0x0/apps/zima-linux-client.png
    echo "✓ Removed incorrectly placed icon"
fi

echo ""
echo "✅ Icon fixed! Please log out and log back in, or restart your desktop environment to see the changes."
echo ""
echo "If the icon still doesn't appear, try running:"
echo "  killall plasmashell && plasmashell &  # For KDE Plasma"
echo "  Or just restart your computer."
