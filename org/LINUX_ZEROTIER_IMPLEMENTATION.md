# ZeroTier Linux Implementation - Complete Guide

## 🎉 Status: FULLY IMPLEMENTED

All ZeroTier Linux integration is complete and ready for testing.

## 📦 What Was Implemented

### 1. ZeroTier Linux Binaries ✅

**Location:** `resources/installer/zerotier/linux/x64/`
- `zerotier-one` (11MB) - Version 1.16.0
- `zerotier-cli` (11MB) - Version 1.16.0

**Binary paths are bundled with the Electron app** via `asarUnpack` in electron-builder config.

### 2. Backend: Linux Service Manager ✅

**File:** `src/main/utils/zerotier/service.ts`

**New Linux-specific methods:**
- `linuxCheckInstallation()` - Checks binaries + systemd service existence
- `linuxCheckRunning()` - Uses `systemctl --user is-active`
- `linuxGetAuthToken()` - Reads `~/.zima-zerotier/authtoken.secret`
- `linuxInstall()` - Complete installation with systemd setup
- `linuxStart()` / `linuxStop()` - Service control via systemctl
- `linuxUninstall()` - Complete cleanup
- `checkCapabilities()` - Checks if `cap_net_admin,cap_net_raw` are set
- `getSetcapCommand()` - Returns the setcap command for UI display

**IPC Handlers registered:**
- `zts:checkCapabilities`
- `zts:getSetcapCommand`

### 3. Preload API ✅

**Files:** `src/preload/index.ts` + `index.d.ts`

Exposes fully typed ZeroTier API to renderer:
```typescript
window.api.zerotier.checkCapabilities(): Promise<boolean>
window.api.zerotier.getSetcapCommand(): Promise<string>
// ... + all other ZeroTier methods
```

### 4. Frontend: Pinia Store ✅

**File:** `src/renderer/src/store/zerotier.ts`

**New state:**
```typescript
hasCapabilities: Ref<boolean>
setcapCommand: Ref<string>
needsCapabilities: ComputedRef<boolean> // Linux && installed && !hasCapabilities
```

**New methods:**
```typescript
checkCapabilities(callback?: CallbackHook)
getSetcapCommand(callback?: CallbackHook)
```

### 5. UI: Linux Setup Dialog Component ✅

**File:** `src/renderer/src/components/ZeroTierLinuxSetup.vue`

**Features:**
- Modal dialog with clear setup workflow
- Displays `sudo setcap ...` command
- Copy to clipboard button
- Open Terminal button (tries gnome-terminal, konsole, etc.)
- "Check Again" button to re-verify capabilities
- "Skip for now" option
- Dark mode support
- Info icon with explanation

### 6. UI Integration ✅

**File:** `src/renderer/src/windows/Initialization/Initializing.vue`

**Changes:**
- Import `ZeroTierLinuxSetup` component
- Added `needsLinuxSetup` computed property
- Added `handleLinuxSetupRetry()` and `handleLinuxSetupSkip()` handlers
- Modified `InitForZeroTier()` to check capabilities after installation on Linux
- Added dialog to template

### 7. i18n Translations ✅

**Files:**
- `resources/locales/en_US.json` (English)
- `resources/locales/zh_CN.json` (Chinese)

**New translation keys:**
- `zerotierSetupRequired`
- `zerotierSetupDescription`
- `runThisCommand`
- `copy`
- `oneTimeSetup`
- `zerotierCapabilitiesExplanation`
- `skipForNow`
- `openTerminal`
- `checkAgain`

## 🚀 Installation Flow

```
App Start (Linux)
    ↓
ZeroTier Installed?
    ↓ No
Install ZeroTier
    - Copy binaries to ~/.local/lib/zima-remote/zerotier/
    - Create systemd service at ~/.config/systemd/user/zima-zerotier.service
    - Enable service with systemctl --user enable
    ↓
Check Capabilities
    ↓ Not Set
Show Linux Setup Dialog
    ┌──────────────────────────────────────┐
    │ ZeroTier Setup Required              │
    │                                      │
    │ Run this command:                    │
    │ sudo setcap cap_net_admin,...        │
    │                                      │
    │ [Copy] [Open Terminal] [Check Again] │
    └──────────────────────────────────────┘
    ↓ User runs command
Check Again
    ↓ Capabilities Set
Start ZeroTier Service
    ↓
Get Auth Token
    ↓
✅ Ready!
```

## 🧪 Testing Steps

### Prerequisites
1. Install dependencies:
   ```bash
   cd $HOME/dev/linux-client/linux-client/org
   pnpm install
   ```

### Development Mode
```bash
pnpm run dev
```

### Production Build
```bash
pnpm run build:linux
./dist/Zima-*.AppImage
```

### Test Checklist
- [ ] App starts on Linux
- [ ] ZeroTier installation triggers automatically
- [ ] Binaries copied to `~/.local/lib/zima-remote/zerotier/`
- [ ] Systemd service file created at `~/.config/systemd/user/zima-zerotier.service`
- [ ] Capability check detects missing capabilities
- [ ] Linux Setup Dialog appears
- [ ] Command displays correctly in dialog
- [ ] Copy button works
- [ ] Terminal opens (if gnome-terminal/konsole available)
- [ ] After running setcap command, "Check Again" detects capabilities
- [ ] Service starts automatically after capabilities are set
- [ ] ZeroTier daemon runs in user space
- [ ] Can join ZeroTier networks

### Manual Verification Commands

```bash
# Check if binaries exist
ls -lh ~/.local/lib/zima-remote/zerotier/

# Check capabilities
getcap ~/.local/lib/zima-remote/zerotier/zerotier-one
# Expected: cap_net_admin,cap_net_raw=eip

# Check systemd service
systemctl --user status zima-zerotier.service

# Check ZeroTier status
PORT=$(cat ~/.zima-zerotier/zerotier-one.port)
TOKEN=$(cat ~/.zima-zerotier/authtoken.secret)
~/.local/lib/zima-remote/zerotier/zerotier-cli -p"$PORT" -T"$TOKEN" info

# Check for ZeroTier interface
ip link | grep zt
```

## 📝 Architecture Details

### Systemd User Service

**Location:** `~/.config/systemd/user/zima-zerotier.service`

```ini
[Unit]
Description=ZeroTier for Zima Remote Client (user)
After=network-online.target

[Service]
Type=forking
ExecStart=/home/user/.local/lib/zima-remote/zerotier/zerotier-one -d -U /home/user/.zima-zerotier
ExecStop=/home/user/.local/lib/zima-remote/zerotier/zerotier-cli -D /home/user/.zima-zerotier shutdown
Restart=always
NoNewPrivileges=false

[Install]
WantedBy=default.target
```

**Key points:**
- Runs as user (systemd --user)
- `Type=forking` because daemon uses `-d` flag
- `-U` flag skips root privilege check
- Restarts automatically on failure
- No `AmbientCapabilities` (not supported in --user mode)
- Capabilities set via `setcap` on binary file

### File Locations

| File | Location |
|------|----------|
| Binaries | `~/.local/lib/zima-remote/zerotier/zerotier-{one,cli}` |
| Home Directory | `~/.zima-zerotier/` |
| Auth Token | `~/.zima-zerotier/authtoken.secret` |
| Port File | `~/.zima-zerotier/zerotier-one.port` |
| Service File | `~/.config/systemd/user/zima-zerotier.service` |
| Network Configs | `~/.zima-zerotier/networks.d/` |

### Security Model

**User-space operation:**
- No root required for daemon
- Runs with user permissions
- File capabilities grant network access
- Isolated from system ZeroTier (if installed)

**One-time setup:**
```bash
sudo setcap cap_net_admin,cap_net_raw=eip ~/.local/lib/zima-remote/zerotier/zerotier-one
```

This grants the binary (not the user or process) the ability to:
- `cap_net_admin` - Configure network interfaces
- `cap_net_raw` - Use RAW and PACKET sockets

## 🐛 Troubleshooting

### Issue: "must be run as root (uid 0)"
**Cause:** `-U` flag not used  
**Solution:** Check service file has `-U` flag in ExecStart

### Issue: "authtoken.secret could not be written"
**Cause:** Wrong file ownership  
**Solution:**
```bash
sudo chown -R $USER:$USER ~/.zima-zerotier
chmod 700 ~/.zima-zerotier
```

### Issue: Service status shows "inactive (dead)"
**Cause:** Capabilities not set  
**Solution:** Run the setcap command shown in the dialog

### Issue: No zt* interface visible
**Cause:** Not joined to network or not approved  
**Solution:** 
1. Join network via CLI or GUI
2. Approve in ZeroTier Central

### Issue: CLI shows only help text
**Cause:** Not connecting to daemon  
**Solution:** Verify port and token files exist:
```bash
cat ~/.zima-zerotier/zerotier-one.port
cat ~/.zima-zerotier/authtoken.secret
```

## 📚 References

- [ZeroTier Documentation](https://docs.zerotier.com/)
- [systemd User Services](https://www.freedesktop.org/software/systemd/man/systemd.service.html)
- [Linux Capabilities](https://man7.org/linux/man-pages/man7/capabilities.7.html)

## ✅ Implementation Complete

All features are implemented and ready for testing. The integration follows the specifications in:
- `Linux Zima Client – Two Technical Points.pdf`
- `ZeroTier_Zima_Client_Setup_README.md`

No further code changes are required. Only testing and potential bug fixes remain.
