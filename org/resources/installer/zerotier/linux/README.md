# ZeroTier Linux Binaries

## Required Files

Place the ZeroTier binaries in the following structure:

```
linux/
├── x64/
│   ├── zerotier-one
│   └── zerotier-cli
└── arm64/
    ├── zerotier-one
    └── zerotier-cli
```

## Download Binaries

### Option 1: From Official ZeroTier Release (Recommended)

Download from: https://www.zerotier.com/download/

Version: **1.14.2** (or later)

#### x64 (amd64):
```bash
# Download and extract
wget https://download.zerotier.com/dist/zerotier-one_1.14.2_amd64.deb
dpkg-deb -x zerotier-one_1.14.2_amd64.deb tmp/
cp tmp/usr/sbin/zerotier-one x64/
cp tmp/usr/sbin/zerotier-cli x64/
chmod +x x64/zerotier-*
```

#### arm64:
```bash
# Download and extract
wget https://download.zerotier.com/dist/zerotier-one_1.14.2_arm64.deb
dpkg-deb -x zerotier-one_1.14.2_arm64.deb tmp/
cp tmp/usr/sbin/zerotier-one arm64/
cp tmp/usr/sbin/zerotier-cli arm64/
chmod +x arm64/zerotier-*
```

### Option 2: From Package Manager

If you have ZeroTier installed via package manager:

```bash
# x64
cp /usr/sbin/zerotier-one x64/
cp /usr/sbin/zerotier-cli x64/

# For ARM, do this on an ARM system
cp /usr/sbin/zerotier-one arm64/
cp /usr/sbin/zerotier-cli arm64/
```

## Verification

After placing the binaries, verify they work:

```bash
# Test x64
./x64/zerotier-one -v
./x64/zerotier-cli -h

# Test arm64 (on ARM system)
./arm64/zerotier-one -v
./arm64/zerotier-cli -h
```

## Notes

- These binaries will be packaged with the Electron app
- They will be copied to `~/.local/lib/zima-remote/zerotier/` on first run
- The app will set capabilities using `setcap cap_net_admin,cap_net_raw=eip`
- A systemd user service will be created to manage the daemon
