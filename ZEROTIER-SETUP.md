# ZeroTier Setup for ZimaOS Client

## ✅ Simple Approach (Recommended)

This app now uses **system ZeroTier** instead of a bundled daemon. This eliminates:
- Password prompts
- Permission issues
- pkexec complexity
- sudo configuration

## Quick Setup

### Option 1: Use Helper Script (Easiest)

```bash
cd /home/holgi/dev/linux-client
./use-system-zerotier.sh
```

This script will:
1. Check if system ZeroTier is installed
2. Start the ZeroTier service
3. Enable it to start on boot
4. Verify it's working

### Option 2: Manual Setup

1. **Install System ZeroTier** (if not already installed):
   ```bash
   curl -s https://install.zerotier.com | sudo bash
   ```

2. **Start and Enable the Service**:
   ```bash
   sudo systemctl start zerotier-one
   sudo systemctl enable zerotier-one
   ```

3. **Verify It's Running**:
   ```bash
   zerotier-cli info
   ```

   You should see output like:
   ```
   200 info xxxxxxxxxx 1.12.2 ONLINE
   ```

## Running the App

Once system ZeroTier is running:

```bash
npm run dev
```

The app will automatically detect and use system ZeroTier. **No password prompts!**

## Troubleshooting

### App says "System ZeroTier is not running"

Start the service:
```bash
sudo systemctl start zerotier-one
```

### App says "System ZeroTier is not installed"

Install it:
```bash
curl -s https://install.zerotier.com | sudo bash
```

### Check Service Status

```bash
systemctl status zerotier-one
```

### View Logs

```bash
journalctl -u zerotier-one -f
```

## Why This Approach?

**Before (Bundled Daemon)**:
- ❌ Required pkexec or sudo with NOPASSWD
- ❌ Infinite password prompts
- ❌ Permission issues with root-owned files
- ❌ Complex setup scripts

**Now (System ZeroTier)**:
- ✅ No password prompts
- ✅ Managed by systemd
- ✅ Standard Linux service
- ✅ Works out of the box

## Uninstalling

To remove system ZeroTier:
```bash
sudo apt remove zerotier-one
```
