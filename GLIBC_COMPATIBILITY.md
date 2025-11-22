# GLIBC Compatibility Issue

## Problem

The bundled ZeroTier binaries require newer glibc versions that may not be available on older Linux distributions:

**Required:**
- `GLIBC_2.38` or `GLIBC_2.39`
- `GLIBCXX_3.4.32`

**Error message:**
```
/opt/zima-client/bin/zerotier-one: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.39' not found
/opt/zima-client/bin/zerotier-one: /lib/x86_64-linux-gnu/libstdc++.so.6: version `GLIBCXX_3.4.32' not found
```

This affects:
- ✗ Linux Mint 21.x (glibc 2.35)
- ✗ Ubuntu 22.04 (glibc 2.35)
- ✗ Debian 11 (glibc 2.31)
- ✓ Ubuntu 24.04+ (glibc 2.39)
- ✓ Fedora 40+ (glibc 2.39)

## Workaround: Use System ZeroTier

Instead of the bundled binaries, install and use the system's ZeroTier:

### Step 1: Install System ZeroTier

```bash
curl -s https://install.zerotier.com | sudo bash
```

### Step 2: Replace Bundled Binaries

```bash
# Copy system binaries to app location
sudo cp /usr/sbin/zerotier-one /opt/zima-client/bin/
sudo cp /usr/sbin/zerotier-cli /opt/zima-client/bin/
sudo chmod +x /opt/zima-client/bin/zerotier-*

# Set capabilities
sudo setcap cap_net_admin,cap_net_raw,cap_net_bind_service=+eip /opt/zima-client/bin/zerotier-one
```

### Step 3: Start the Service

```bash
# Stop system ZeroTier (we use our own service)
sudo systemctl stop zerotier-one
sudo systemctl disable zerotier-one

# Start our service
sudo systemctl start zima-zerotier.service
sudo systemctl status zima-zerotier.service
```

### Step 4: Verify

```bash
bash /opt/ZimaOS\ Client/resources/diagnose-zerotier.sh
```

You should now see:
- ✓ Service is running
- ✓ ZeroTier daemon connectivity works

## Long-term Solution

We need to rebuild the bundled binaries for better compatibility. Two options:

### Option 1: Download from Older Ubuntu Release

Download ZeroTier binaries from Ubuntu 20.04 or 22.04:

```bash
# Download Ubuntu 22.04 version (glibc 2.35)
cd bin/zerotier/x64/
wget http://archive.ubuntu.com/ubuntu/pool/universe/z/zerotier-one/zerotier-one_1.10.6_amd64.deb
dpkg-deb -x zerotier-one_1.10.6_amd64.deb tmp/
cp tmp/usr/sbin/zerotier-one ./
cp tmp/usr/sbin/zerotier-cli ./
chmod +x zerotier-*
rm -rf tmp/ zerotier-one_1.10.6_amd64.deb
```

### Option 2: Build Statically Linked Binaries

Build ZeroTier from source with static linking:

```bash
git clone https://github.com/zerotier/ZeroTierOne.git
cd ZeroTierOne
make one STATIC=1
# Copy zerotier-one and zerotier-cli to bin/zerotier/x64/
```

### Option 3: Implement Fallback Logic

Modify the app to automatically fall back to system ZeroTier if bundled binaries fail.

## For Developers

When packaging the app:

1. **Check glibc version of bundled binaries:**
   ```bash
   ldd bin/zerotier/x64/zerotier-one
   strings bin/zerotier/x64/zerotier-one | grep GLIBC
   ```

2. **Target Ubuntu 20.04 (glibc 2.31) or 22.04 (glibc 2.35)** for maximum compatibility

3. **Test on multiple distributions:**
   - Ubuntu 20.04, 22.04, 24.04
   - Debian 11, 12
   - Linux Mint 21.x
   - Fedora 39, 40

## Automated Check

Add to postinst.sh to detect this issue:

```bash
# Test if binary works
if ! /opt/zima-client/bin/zerotier-one -v 2>&1 | grep -q "version"; then
    echo "⚠ Bundled ZeroTier binary incompatible with this system"
    echo "  Installing from system package instead..."
    # Install system ZeroTier automatically
fi
```
