# ZeroTier Setup Guide

This guide explains the one-time setup required for ZeroTier network capabilities.

## Why This Setup is Needed

ZeroTier needs to create virtual network interfaces (TUN/TAP devices) to connect to remote networks. On Linux, this requires special kernel capabilities: `CAP_NET_ADMIN` and `CAP_NET_RAW`.

## Automatic Setup Steps

When you run the app for the first time, it will automatically:

1. **Copy binaries to a proper filesystem location**
   - Source: `bin/zerotier/x64/zerotier-one` (bundled with app)
   - Destination: `~/.local/lib/zima-remote/zerotier/zerotier-one`
   - Reason: File capabilities require ext4 or similar filesystem (not AppImage/squashfs)

2. **Install systemd --user service**
   - Location: `~/.config/systemd/user/zima-zerotier.service`
   - Manages daemon lifecycle (start/stop/restart)
   - Includes `AmbientCapabilities=CAP_NET_ADMIN CAP_NET_RAW`

3. **Check for required capabilities**
   - If not set, displays setup instructions
   - Only needs to be done once

## One-Time Setup Command

When prompted, run this command in a terminal:

```bash
sudo setcap cap_net_admin,cap_net_raw=eip ~/.local/lib/zima-remote/zerotier/zerotier-one
```

### Verify It Worked

```bash
getcap ~/.local/lib/zima-remote/zerotier/zerotier-one
# Expected output: cap_net_admin,cap_net_raw=eip
```

### Daemon Flags

- `-d` = Daemon mode (fork to background)
- `-U` = Skip privilege check (required for user mode)
- Home directory is passed as positional argument (not a flag)

## Manual Verification Steps

### 1. Check TUN device exists
```bash
ls -l /dev/net/tun
# If not found, run: sudo modprobe tun
```

### 2. Check systemd service
```bash
systemctl --user status zima-zerotier.service
```

### 3. Check ZeroTier daemon
```bash
PORT=$(cat ~/.zima-zerotier/zerotier-one.port)
TOKEN=$(cat ~/.zima-zerotier/authtoken.secret)
~/.local/lib/zima-remote/zerotier/zerotier-cli -p"$PORT" -T"$TOKEN" info
# Should show: 200 info <node-id> <version> ONLINE
```

### 4. Join a network
```bash
PORT=$(cat ~/.zima-zerotier/zerotier-one.port)
TOKEN=$(cat ~/.zima-zerotier/authtoken.secret)
~/.local/lib/zima-remote/zerotier/zerotier-cli -p"$PORT" -T"$TOKEN" join <network-id>
```

### 5. Verify interface creation
```bash
ip link show | grep zt
# Should show: ztXXXXXXXX interface
```

### 6. List networks
```bash
PORT=$(cat ~/.zima-zerotier/zerotier-one.port)
TOKEN=$(cat ~/.zima-zerotier/authtoken.secret)
~/.local/lib/zima-remote/zerotier/zerotier-cli -p"$PORT" -T"$TOKEN" listnetworks
# Should show joined networks with status
```

## Troubleshooting

### "Operation not permitted" when joining network
- **Cause**: Capabilities not set on binary
- **Fix**: Run the `sudo setcap` command above

### No network interface created (ztXXXXXXXX)
- **Cause**: Daemon lacks kernel capabilities
- **Fix**: Ensure file capabilities are set with `=eip` flag (not `+eip`)

### Service fails to start
- **Check logs**: `journalctl --user -u zima-zerotier.service -f`
- **Common issues**:
  - Binary path incorrect
  - TUN device missing: `sudo modprobe tun`
  - Capabilities not set

### Network joins but no connectivity
- Check if you're authorized on the ZeroTier network controller
- Verify routes: `ip route | grep zt`
- Check firewall rules

## Service Management

```bash
# Start daemon
systemctl --user start zima-zerotier.service

# Stop daemon
systemctl --user stop zima-zerotier.service

# Restart daemon
systemctl --user restart zima-zerotier.service

# Check status
systemctl --user status zima-zerotier.service

# View logs
journalctl --user -u zima-zerotier.service -f

# Enable auto-start on login (optional)
systemctl --user enable zima-zerotier.service
```

## File Locations

| Item | Location |
|------|----------|
| Binaries | `~/.local/lib/zima-remote/zerotier/` |
| Service File | `~/.config/systemd/user/zima-zerotier.service` |
| ZeroTier Data | `~/.zima-zerotier/` |
| Network Configs | `~/.zima-zerotier/networks.d/` |
| Auth Token | `~/.zima-zerotier/authtoken.secret` |

## Security Notes

- Capabilities are only granted to the specific binary file
- The daemon runs as your user (not root)
- systemd --user manages the service lifecycle
- Data directory is in your home folder (isolated from system ZeroTier)
