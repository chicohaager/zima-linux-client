# Pinning Guide - SMB Shares mit Credentials

## Übersicht

Der Zima Client unterstützt jetzt vollständiges Pinning von SMB-Freigaben mit Credentials:

- ✅ **ZeroTier-IP statt Hostname** - Funktioniert zuverlässig über ZT
- ✅ **Credentials-Support** - Username/Password beim Pinnen
- ✅ **Keyring-Integration** - Passwörter sicher im System-Keyring
- ✅ **Dual File Manager Support** - GNOME Files & KDE Dolphin

## Wie es funktioniert

### 1. Automatisches Discovery

Nach ZeroTier-Verbindung:
```typescript
// App joined ZeroTier network
// Gateway IP: 172.30.0.1
// Subnet: 172.30.0

// Automatic SMB Discovery startet:
scanSubnetForSMB("172.30.0")
  → TCP 445 scan auf allen IPs
  → Findet: [172.30.0.1, 172.30.0.5, ...]

// Für JEDE gefundene IP:
discoverShares("172.30.0.1", username, password)
  → smbclient -L 172.30.0.1 -U user%pass -g
  → Parst: Disk|Home-Storage|Comment
           Disk|ZimaOS-HD|Main drive
           Disk|nvme0n1|NVMe storage
```

### 2. URL-Format

**Ohne Credentials (Guest):**
```
smb://172.30.0.1/Home-Storage
```

**Mit Username (empfohlen):**
```
smb://Holgi@172.30.0.1/Home-Storage
```

**Wichtig:**
- ✅ Nutze **ZeroTier-IP** (z.B. `172.30.0.1`)
- ❌ Nicht: Hostname (`zimaos.local`) - funktioniert nicht über ZT

### 3. Credential-Handling

**Bookmark (in GTK/KDE gespeichert):**
```
smb://Holgi@172.30.0.1/Home-Storage Home-Storage
```

**Passwort:**
- Wird NICHT im Bookmark gespeichert (Sicherheit!)
- Wird in System-Keyring gecacht (via `gio mount`)

**Beim Pinnen:**
```typescript
// User gibt Credentials im Login-Dialog ein
username = "Holgi"
password = "geheim"

// Beim Klick auf "Pin":
await window.electron.smb.pinShare(share, { username, password })

// Backend macht:
1. Bookmark erstellen: smb://Holgi@172.30.0.1/Home-Storage
2. gio mount 'smb://Holgi:geheim@172.30.0.1/Home-Storage'
   → Passwort wird im Keyring gespeichert
```

### 4. Beim Öffnen im File Manager

**Erster Zugriff:**
- User öffnet Bookmark in Nautilus/Dolphin
- System prüft Keyring → Passwort gefunden ✓
- Mount erfolgt automatisch ohne erneute Eingabe

**Kein Keyring-Eintrag:**
- File Manager fragt nach Passwort
- User kann "Passwort speichern" wählen
- Nächstes Mal automatisch

## Code-Struktur

### PlacesManager (`src/main/smb/places.ts`)

```typescript
class PlacesManager {
  async pinShare(
    share: SMBShare,
    username?: string,
    password?: string
  ): Promise<void> {
    // 1. Build URL
    const url = username
      ? `smb://${encodeURIComponent(username)}@${share.host}/${share.name}`
      : `smb://${share.host}/${share.name}`;

    // 2. Add to file managers
    await this.addToGTKBookmarks(url, label);
    await this.addToKDEPlaces(url, label);

    // 3. Mount with credentials (caches in keyring)
    if (username && password) {
      await this.mountWithCredentials(host, share.name, username, password);
    }
  }

  private async mountWithCredentials(
    host: string,
    shareName: string,
    username: string,
    password: string
  ): Promise<void> {
    const url = `smb://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}/${shareName}`;
    await execAsync(`gio mount '${url}'`);
    // → Credentials now cached in keyring ✓
  }
}
```

### Discovery Flow (`src/main/ipc/handlers.ts`)

```typescript
// Automatic discovery nach ZT join
ipcMain.handle('device:discoverSMB', async (_, subnet, credentials?) => {
  // 1. TCP 445 scan
  const smbHosts = await networkManager.scanSubnetForSMB(subnet);
  // Returns: ["172.30.0.1", "172.30.0.5", ...]

  // 2. Query shares on EACH host
  for (const host of smbHosts) {
    const shares = await smbManager.discoverShares(
      host,
      credentials?.username,
      credentials?.password
    );
    // Returns: [
    //   { host: "172.30.0.1", name: "Home-Storage", ... },
    //   { host: "172.30.0.1", name: "ZimaOS-HD", ... }
    // ]

    devices.push({
      ipAddress: host,  // ← ZeroTier IP!
      shares
    });
  }
});
```

### UI Integration (`src/renderer/pages/Connect.tsx`)

```typescript
// Discovered devices anzeigen
{discoveredDevices.map((device) => (
  <div>
    <p>{device.ipAddress}</p> {/* 172.30.0.1 */}

    {device.shares.map((share) => (
      <button onClick={async () => {
        // Credentials aus Login-Dialog nutzen
        const credentials = (username && password)
          ? { username, password }
          : undefined;

        await window.electron.smb.pinShare(share, credentials);

        alert(`✓ Pinned: ${share.name}\n${
          credentials
            ? 'Credentials saved to keyring'
            : 'Guest access'
        }`);
      }}>
        Pin
      </button>
    ))}
  </div>
))}
```

## Beispiel-Workflow

### Szenario: Zuhause → Remote ZimaOS verbinden

```
1. User: Klickt "Connect via Remote ID"
   Input: a0cbf4b62a1234567 (ZeroTier Network ID)

2. App: Joined ZeroTier
   ✓ Connected to 172.30.0.0/24
   Gateway: 172.30.0.1

3. App: Automatic SMB Discovery
   TCP 445 Scan auf 172.30.0.0/24
   ✓ Found: 172.30.0.1, 172.30.0.5

4. App: Query shares on 172.30.0.1
   smbclient -L 172.30.0.1 -N -g
   ✓ Found shares:
     - Home-Storage
     - ZimaOS-HD
     - nvme0n1
     - Datenaustausch

5. User: Login Dialog
   Username: Holgi
   Password: ••••••••

6. App: Shows discovered devices
   📂 Zima Device (172.30.0.1)
   ├─ 📁 Home-Storage [Pin]
   ├─ 📁 ZimaOS-HD [Pin]
   ├─ 📁 nvme0n1 [Pin]
   └─ 📁 Datenaustausch [Pin]

7. User: Klickt "Pin" bei Home-Storage

8. App: Pinning
   ✓ Bookmark created: smb://Holgi@172.30.0.1/Home-Storage
   ✓ Mounted with gio
   ✓ Credentials cached in keyring

9. User: Öffnet Nautilus
   Sidebar → "Home-Storage" ← Bookmark erscheint!
   Klick → Mount automatisch (Credentials aus Keyring)
```

## Troubleshooting

### Bookmark erscheint nicht

**Check GTK Bookmarks:**
```bash
cat ~/.config/gtk-3.0/bookmarks
# Should show:
# smb://Holgi@172.30.0.1/Home-Storage Home-Storage
```

**Check KDE Places:**
```bash
cat ~/.local/share/user-places.xbel
# Should contain:
# <bookmark href="smb://Holgi@172.30.0.1/Home-Storage">
```

### Mount fragt nach Passwort

**Credentials nicht im Keyring:**
```bash
# Manually mount to cache credentials
gio mount 'smb://Holgi:password@172.30.0.1/Home-Storage'
```

**Keyring-Status prüfen:**
```bash
# Check if keyring daemon is running
ps aux | grep gnome-keyring

# Or for KDE:
ps aux | grep kwalletd
```

### Share nicht sichtbar

**1. Reachability:**
```bash
# Check if SMB port is open
nc -zv 172.30.0.1 445
```

**2. Authentication:**
```bash
# Test manually
smbclient -L 172.30.0.1 -U Holgi%password -g
```

**3. Share Config (auf ZimaOS):**
```ini
# /etc/samba/smb.conf
[Home-Storage]
    path = /DATA/Home-Storage
    browseable = yes
    guest ok = no
    valid users = Holgi
```

## Sicherheit

### Passwort-Speicherung

**Bookmark (unsicher):**
```
❌ smb://user:password@host/share  # Niemals so!
✅ smb://user@host/share            # Nur Username
```

**Keyring (sicher):**
```bash
# GNOME Keyring
~/.local/share/keyrings/login.keyring

# KDE Wallet
~/.local/share/kwalletd/kdewallet.kwl
```

**Encryption:**
- Keyring ist mit Login-Passwort verschlüsselt
- Passwörter im RAM nur während Mount
- Automatisches Unlock beim System-Login

### Best Practices

1. **Nie Passwort im Code hardcoden**
   ```typescript
   ❌ pinShare(share, { username: "Holgi", password: "geheim" })
   ✅ pinShare(share, credentials) // from user input
   ```

2. **Credentials nur über sichere Channels**
   ```typescript
   // IPC with contextIsolation=true ✓
   window.electron.smb.pinShare(share, credentials)
   ```

3. **Keyring statt localStorage**
   ```typescript
   ❌ localStorage.setItem('password', password)
   ✅ gio mount → System keyring
   ```

## Integration in andere Apps

### Andere Electron Apps

```typescript
import { PlacesManager } from './smb/places';

const places = new PlacesManager();

await places.pinShare(
  {
    host: '172.30.0.1',
    name: 'Home-Storage',
    displayName: 'My Storage',
    type: 'disk'
  },
  'Holgi',     // username
  'password'   // password - will be cached in keyring
);
```

### Shell Script

```bash
#!/bin/bash
# Pin a share with credentials

HOST="172.30.0.1"
SHARE="Home-Storage"
USER="Holgi"
PASS="password"

# 1. Add bookmark
echo "smb://$USER@$HOST/$SHARE $SHARE" >> ~/.config/gtk-3.0/bookmarks

# 2. Mount to cache credentials
gio mount "smb://$USER:$PASS@$HOST/$SHARE"

echo "✓ Pinned and mounted: $SHARE"
```

## Zusammenfassung

✅ **ZeroTier-IP wird automatisch verwendet** - Discovery gibt nur IPs zurück
✅ **Credentials werden sicher gehandhabt** - Keyring statt Bookmarks
✅ **Ein-Klick-Pinning** - Credentials aus Login-Dialog
✅ **Dual File Manager Support** - GTK + KDE
✅ **Automatic Mount** - gio cached Credentials
✅ **Alle Shares sichtbar** - Robustes Parsing mit -g Flag

**Workflow:**
1. ZeroTier verbinden
2. Automatic Discovery (TCP 445 scan + smbclient)
3. Login (Credentials eingeben)
4. Pin klicken → Bookmark + Keyring
5. File Manager öffnen → Share ist da!
