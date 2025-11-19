# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Electron-based desktop client for ZimaOS, providing network discovery, ZeroTier-based remote access, SMB share management, and integration with Linux file managers (GNOME Files/Nautilus and KDE Dolphin).

## Development Commands

```bash
# Development (starts all processes concurrently)
npm run dev

# Build production version
npm run build

# Build and package for Linux (creates AppImage and .deb)
npm run package:linux

# Linting
npm run lint

# Type checking
npm run type-check

# Start already-built app
npm start
```

## Architecture

### Electron Process Model

**Main Process** (`src/main/index.ts`):
- Creates BrowserWindow with context isolation enabled
- Initializes IPCHandlers singleton which registers all IPC channels
- Handles app lifecycle (startup, shutdown, cleanup)

**Renderer Process** (`src/renderer/`):
- React 18 app with TypeScript
- Zustand for state management (single store at `src/renderer/store/index.ts`)
- Tailwind CSS for styling
- Communicates with main process via `window.electron` API exposed in preload script

**Preload Script** (`src/main/preload.ts`):
- Bridges renderer and main process using `contextBridge`
- Exposes typed IPC API as `window.electron`

### IPC Communication Pattern

All IPC handlers are registered in `src/main/ipc/handlers.ts` in the `IPCHandlers` class. The pattern:

1. Main process: `ipcMain.handle('channel:name', async (event, ...args) => { ... })`
2. Preload: Expose via `contextBridge.exposeInMainWorld('electron', { ... })`
3. Renderer: Call via `window.electron.module.method()`

Available IPC channels are typed in `src/shared/types.ts` under `IPCChannels`.

### ZeroTier Integration

**IMPORTANT**: The application uses **bundled ZeroTier binaries** packaged with the app:

- **Binaries location**: `bin/zerotier/<arch>/` where `<arch>` is `x64` or `arm64`
- **Development**: Binaries in project root `bin/zerotier/x64/` (or `arm64/`)
- **Production**: Binaries in `process.resourcesPath/bin/zerotier/<arch>/`
- **Data directory**: `~/.zima-zerotier` (separate from system ZeroTier)
- **No system dependency**: Does NOT require `zerotier-one` package to be installed
- **Full lifecycle control**: App manages ZeroTier daemon via systemd --user service
- **User-space execution**: Runs as current user via systemd --user with granted capabilities
- **Daemon flags**: `-p9993` (port), `-U` (skip privilege check), home dir as positional arg
- **Service management**: systemd --user service manages daemon lifecycle (minimal service, no capability directives)
- **Auto-installation**: Service file is automatically installed to `~/.config/systemd/user/` on first run
- **One-time setup**: Requires `setcap` command once to grant file capabilities (instructions shown on first run)
- **File capabilities**: Binary capabilities set with `setcap` (systemd --user cannot grant capabilities)

ZeroTier Manager (`src/main/zerotier/manager.ts`):
- **installUserService()**: Automatically installs systemd --user service with capabilities on first run
- **start()**: Starts ZeroTier via `systemctl --user start zima-zerotier.service`
- **stop()**: Stops ZeroTier via `systemctl --user stop zima-zerotier.service`
- **restart()**: Restarts ZeroTier via `systemctl --user restart zima-zerotier.service`
- **joinNetwork()**: Uses bundled CLI with `-D<path>` flag to join networks
- **leaveNetwork()**: Uses bundled CLI to leave networks
- **getNetworks()**: Lists joined networks via CLI in JSON format
- **getStatus()**: Checks daemon status via CLI
- Polls for network connection status with timeout
- Returns gateway IP from route information for device scanning (typically `.1` of subnet)

**Systemd User Service**:
```bash
# Service file: ~/.config/systemd/user/zima-zerotier.service
systemctl --user start zima-zerotier.service   # Start daemon
systemctl --user stop zima-zerotier.service    # Stop daemon
systemctl --user status zima-zerotier.service  # Check status
```

**Direct Daemon Command** (used by systemd service):
```bash
zerotier-one -d -U ~/.zima-zerotier
```

Flags:
- `-d` = Daemon mode (fork to background, required for `Type=forking` in systemd)
- `-U` = Skip privilege check (required for user mode without root)
- Home directory is positional argument (not a flag)

**CLI Command Pattern**:
```bash
PORT=$(cat ~/.zima-zerotier/zerotier-one.port)
TOKEN=$(cat ~/.zima-zerotier/authtoken.secret)
zerotier-cli -p"$PORT" -T"$TOKEN" <command>
```

**Key Points**:
- CLI communicates with daemon via port and auth token (not home directory flag)
- Port file: `~/.zima-zerotier/zerotier-one.port`
- Token file: `~/.zima-zerotier/authtoken.secret`
- Daemon runs via systemd --user with file capabilities set via `setcap`
- **One-time setup**: Run `sudo setcap cap_net_admin,cap_net_raw=eip <binary>` once (instructions shown on first run)
- Service type: `Type=forking` (because `-d` flag makes daemon fork to background)
- Service persists after app closes (background connectivity)
- **No AmbientCapabilities**: systemd --user cannot grant capabilities - relies on file capabilities only

**First-Time Setup**:

The app automatically:
1. Copies ZeroTier binaries to `~/.local/lib/zima-remote/zerotier/` (needed for file capabilities on ext4)
2. Installs systemd --user service to `~/.config/systemd/user/zima-zerotier.service`
3. Checks if capabilities are set on the copied binary

If capabilities are not set, the app will display:
```
=== ZeroTier Setup Required ===
ZeroTier needs network capabilities for creating virtual interfaces.
This is a ONE-TIME setup.

Please run this command in a terminal:

sudo setcap cap_net_admin,cap_net_raw=eip ~/.local/lib/zima-remote/zerotier/zerotier-one

Then restart the application.
===============================
```

After running the command once, the daemon will have the necessary capabilities to create TUN/TAP interfaces.

### SMB Share Management

SMB Manager (`src/main/smb/manager.ts`):
- Uses `smbclient` system command to discover shares
- Parses `smbclient -L` output to list available shares

Places Manager (`src/main/smb/places.ts`):
- Integrates SMB shares into Linux file managers
- **GNOME**: Writes to `~/.config/gtk-3.0/bookmarks` (GTK bookmarks format)
- **KDE**: Writes to `~/.local/share/user-places.xbel` (XML format)
- Pin/unpin operations modify these files directly

### State Management

Single Zustand store (`src/renderer/store/index.ts`) contains:
- Connection status (local/ZeroTier)
- Discovered devices list
- Selected device (for Apps page)
- Pinned SMB shares
- UI state (scanning, loading, errors)
- Current view/navigation

State is modified via setter functions, not direct mutations.

### Device Discovery and Apps

**Device Discovery Flow**:
1. Scan local network subnets for active hosts (via `ping` or similar)
2. For each host, attempt SMB discovery
3. Classify as 'local' or 'remote' based on IP range (ZeroTier typically uses `10.147.x.x`, `172.25.x.x`, etc.)

**App Discovery** (`src/renderer/pages/Apps.tsx`):
1. First, attempt ZimaOS API calls if `authToken` is available on the device:
   - `/v2/app_management/compose` - Docker apps (current working endpoint)
   - Fallback endpoints: `/v2/app_management/myapps`, `/v1/app/list`, `/api/container/list`
2. Parse response to extract app metadata (title, icon, port mappings)
3. Build web UI URLs using device IP and port map
4. If API fails, fall back to SMB share discovery + manual "ZimaOS" dashboard link

**Opening Apps** (`src/main/ipc/handlers.ts:298`):
- Uses `electron.shell.openExternal()` to open URLs in system browser
- Supports `http://`, `smb://` protocols
- URLs with hash fragments (e.g., `#/files`) are passed as-is

**Known Issue**: Files app currently opens `http://${deviceIP}/` instead of `http://${deviceIP}/modules/icewhale_files/#/files`. The redirect to dashboard is intentional in the current code to let users navigate from there.

### Type System

All shared types are in `src/shared/types.ts`:
- `ZimaDevice`: Represents discovered devices (includes optional `authToken` for API access)
- `ZeroTierNetwork`: ZeroTier network details with routes
- `SMBShare`: SMB share information
- `IPCChannels`: Union type of all IPC channel names

Use the `@shared/types` path alias for imports.

## Important Patterns

### Error Handling in IPC

All IPC handlers return `{ success: boolean, data?: any, error?: string }`:

```typescript
try {
  const result = await someOperation();
  return { success: true, data: result };
} catch (error: any) {
  return { success: false, error: error.message };
}
```

### Authentication with ZimaOS API

Devices can have an optional `authToken` field (`ZimaDevice.authToken`). When present:
- Include as `Authorization` header in fetch requests
- Token format is typically a bearer token from ZimaOS login

### Path Aliases

Webpack is configured with path aliases:
- `@main/*` → `src/main/*`
- `@renderer/*` → `src/renderer/*`
- `@shared/*` → `src/shared/*`

## Common Development Tasks

### Adding a New IPC Channel

1. Add channel name to `IPCChannels` type in `src/shared/types.ts`
2. Implement handler in `src/main/ipc/handlers.ts` (`registerHandlers` method)
3. Expose in preload script (`src/main/preload.ts`)
4. Call from renderer via `window.electron.*`

### Adding a New Page

1. Create component in `src/renderer/pages/`
2. Add route to `currentView` type in store (`src/renderer/store/index.ts`)
3. Add navigation in `src/renderer/components/Navigation.tsx`
4. Add route handling in `src/renderer/App.tsx`

### Debugging

- Development mode automatically opens DevTools
- Check `console.log` statements in both main process (terminal) and renderer (DevTools)
- IPC calls are logged in both processes for debugging

## ZimaOS API Integration

Current working endpoints:
- `GET /v2/app_management/compose` - List Docker apps (requires auth token)

Response format:
```json
{
  "data": {
    "app-id": {
      "store_info": {
        "title": { "en_us": "App Name" },
        "icon": "http://...",
        "port_map": "8080",
        "scheme": "http"
      },
      "compose": { ... },
      "status": "running"
    }
  }
}
```

## File Manager Integration Caveats

- GTK bookmarks require exact format: `smb://host/share ShareName`
- KDE places use XML with unique IDs and bookmarks elements
- Both require write access to user config directories
- Changes are not automatically reloaded by file managers (may need restart)
