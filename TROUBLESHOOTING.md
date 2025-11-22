# Troubleshooting Guide

## "Failed to connect to network" Error

If you're experiencing connection failures after installing the ZimaOS Client on a Linux system, this is likely due to permission issues accessing ZeroTier configuration files.

### Root Cause

When the application is installed via `.deb` package, it creates a system service that runs ZeroTier as root. The configuration files (`authtoken.secret` and `zerotier-one.port`) are created with restricted permissions that may prevent the application from reading them.

### Quick Fix

**Option 1: Log out and back in (Recommended)**

The installer adds your user to the `zima-zerotier` group, but this doesn't take effect until you log out and back in.

1. Save your work
2. Log out of your session
3. Log back in
4. Launch the application again

**Option 2: Fix permissions manually**

If logging out is not convenient, run these commands:

```bash
sudo chmod 644 /var/lib/zima-zerotier/authtoken.secret
sudo chmod 644 /var/lib/zima-zerotier/zerotier-one.port
```

### Diagnostic Tool

Run the included diagnostic script to identify the exact issue:

```bash
bash diagnose-zerotier.sh
```

This will check:
- ✓ ZeroTier service status
- ✓ Binary permissions and capabilities
- ✓ File permissions
- ✓ Group membership
- ✓ Daemon connectivity

### Technical Details

The ZimaOS Client uses ZeroTier to create secure network connections. The ZeroTier daemon:

1. Runs as a systemd service (`zima-zerotier.service`)
2. Creates configuration files in `/var/lib/zima-zerotier/`
3. Requires network capabilities (`CAP_NET_ADMIN`, `CAP_NET_RAW`) to create virtual network interfaces

**Why the permission issue occurs:**

- During installation, the postinstall script adds users to the `zima-zerotier` group
- Group membership changes don't take effect until the user logs out and back in
- Without proper group membership OR world-readable files, the application cannot read the auth token

**The fix:**

Version 0.9.6+ of the client makes these files world-readable (644) since:
- The ZeroTier API is only accessible on `127.0.0.1` (localhost)
- Physical access to the machine is already assumed
- Desktop users benefit from not having to log out/in

### Manual Service Management

Check service status:
```bash
systemctl status zima-zerotier.service
```

View service logs:
```bash
sudo journalctl -u zima-zerotier.service -f
```

Restart the service:
```bash
sudo systemctl restart zima-zerotier.service
```

### Still Having Issues?

1. Run the diagnostic script: `bash diagnose-zerotier.sh`
2. Check the service logs: `sudo journalctl -u zima-zerotier.service -n 100`
3. Verify the binary has capabilities: `getcap /opt/zima-client/bin/zerotier-one`
4. Open an issue on GitHub with the diagnostic output

### For Developers

When testing changes to the installation scripts:

1. Completely remove the old installation:
   ```bash
   sudo systemctl stop zima-zerotier.service
   sudo systemctl disable zima-zerotier.service
   sudo rm /etc/systemd/system/zima-zerotier.service
   sudo rm -rf /opt/zima-client
   sudo rm -rf /var/lib/zima-zerotier
   sudo systemctl daemon-reload
   ```

2. Rebuild and reinstall:
   ```bash
   npm run package:linux
   sudo dpkg -i dist/zima-linux-client_*.deb
   ```

3. Run diagnostics:
   ```bash
   bash diagnose-zerotier.sh
   ```
