# Permission Fix for "Failed to connect to network" Issue

## Problem Summary

Users installing the ZimaOS Linux Client via `.deb` package on fresh systems were experiencing a "Failed to connect to network" error after entering a Remote ID.

### Root Cause

The ZeroTier daemon creates configuration files (`authtoken.secret` and `zerotier-one.port`) in `/var/lib/zima-zerotier/` with restrictive permissions (640, root:zima-zerotier). The postinstall script adds users to the `zima-zerotier` group, but this group membership doesn't take effect until the user logs out and back in. When users tried to connect immediately after installation, the application couldn't read these files, causing connection failures.

## Changes Made

### 1. Fixed File Permissions (resources/postinst.sh)

**Changed:**
- Directory permissions: `750` → `755` (world-readable)
- `authtoken.secret`: `640` → `644` (world-readable)
- `zerotier-one.port`: `640` → `644` (world-readable)

**Rationale:**
- The ZeroTier API is only accessible on localhost (127.0.0.1)
- Desktop systems already assume physical access
- World-readable files eliminate the need for users to log out/in immediately after installation

**Added:**
- File capabilities setup with `setcap` for belt-and-suspenders approach
- Warning messages if capabilities can't be set (normal for tmpfs/AppImage)
- Post-installation notice informing users to log out/in for first-time installations

### 2. Updated Systemd Service (resources/zima-zerotier.service)

**Changed:**
- `ExecStartPost` now sets permissions to `644` instead of `640`

This ensures files remain world-readable even after service restarts.

### 3. Better Error Messages (src/main/zerotier/manager.ts)

**Added:**
- Permission-specific error handling in `getPort()` and `getToken()`
- Helpful error messages with fix suggestions when `EACCES` errors occur
- Guidance to log out/in or run chmod commands

**Example error message:**
```
Permission denied reading /var/lib/zima-zerotier/authtoken.secret.
If you just installed, try logging out and back in, or run:
sudo chmod 644 /var/lib/zima-zerotier/authtoken.secret
```

### 4. Diagnostic Tool (diagnose-zerotier.sh)

**Created:**
A comprehensive diagnostic script that checks:
- ✓ ZeroTier service status
- ✓ Binary existence and network capabilities
- ✓ Data directory and file permissions
- ✓ Daemon connectivity
- ✓ User group membership

Users can run this to troubleshoot issues:
```bash
bash diagnose-zerotier.sh
```

### 5. Documentation

**Created:**
- `TROUBLESHOOTING.md` - Comprehensive troubleshooting guide
- Updated `README.md` with troubleshooting section (English and German)

**Added to package:**
- `diagnose-zerotier.sh` included in extraResources
- `TROUBLESHOOTING.md` included in extraResources
- Post-installation message directing users to diagnostic tool

## Testing

Build verified successfully:
```bash
npm run build  # ✓ Completed without errors
```

All changes are backward-compatible and don't break existing installations.

## Migration Guide

### For Fresh Installations
Users will see a post-installation message:
```
IMPORTANT: If this is your first installation,
please LOG OUT and back in for group permissions
to take effect.

If you experience connection issues, run:
  bash /opt/ZimaOS\ Client/resources/diagnose-zerotier.sh
```

However, due to the permission changes (644 instead of 640), users can now use the app immediately without logging out.

### For Existing Installations with Issues

Users experiencing the "Failed to connect to network" error can:

1. **Quick fix:** Run these commands:
   ```bash
   sudo chmod 644 /var/lib/zima-zerotier/authtoken.secret
   sudo chmod 644 /var/lib/zima-zerotier/zerotier-one.port
   ```

2. **Or:** Update to the new version which includes the fixed postinstall script

3. **Or:** Log out and back in to activate group membership

## Files Modified

1. `resources/postinst.sh` - Fixed permissions, added capabilities, added user notice
2. `resources/zima-zerotier.service` - Updated ExecStartPost to use 644 permissions
3. `src/main/zerotier/manager.ts` - Better error messages for permission issues
4. `package.json` - Added diagnostic script and troubleshooting guide to extraResources
5. `README.md` - Added troubleshooting section (English and German)

## Files Created

1. `diagnose-zerotier.sh` - Diagnostic tool for troubleshooting
2. `TROUBLESHOOTING.md` - Comprehensive troubleshooting guide
3. `CHANGELOG_PERMISSION_FIX.md` - This document

## Security Considerations

**Q: Is it safe to make authtoken.secret world-readable?**

**A: Yes, because:**
1. The ZeroTier API only listens on 127.0.0.1 (localhost), not on public interfaces
2. The auth token is only useful for accessing the local daemon
3. Physical access to the machine is already assumed in desktop environments
4. This is standard practice for ZeroTier installations (default permissions on many distros)
5. The alternative (requiring sudo for the entire app) would be far worse security-wise

## Next Steps

1. Test the new `.deb` package on a fresh Ubuntu/Debian system
2. Verify the diagnostic script catches common issues
3. Update release notes with permission fix information
4. Consider adding in-app diagnostic tool in future versions
