# ZimaOS Linux Client - Implementierungsplan

## 🎯 Projektübersicht

Moderner Desktop-Client für ZimaOS mit integriertem ZeroTier und SMB-Management.

## 📋 Technologie-Stack

### Core
- **Framework:** Electron 28+
- **UI:** React 18 + TypeScript
- **Styling:** Tailwind CSS + shadcn/ui
- **State Management:** Zustand

### Integration
- **ZeroTier:** node-zerotier (gebundelt)
- **SMB:** samba-client (Node.js Bindings)
- **File Manager:** Native OS Integration

## 🏗️ Architektur

```
zima-linux-client/
├── src/
│   ├── main/              # Electron Main Process
│   │   ├── index.ts
│   │   ├── zerotier/
│   │   │   ├── manager.ts      # ZeroTier Lifecycle
│   │   │   ├── bundler.ts      # Binary Embedding
│   │   │   └── network.ts      # Network Management
│   │   ├── smb/
│   │   │   ├── manager.ts      # SMB Share Management
│   │   │   └── places.ts       # File Manager Integration
│   │   └── ipc/
│   │       └── handlers.ts     # IPC Communication
│   │
│   ├── renderer/          # React UI
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── Connect.tsx     # Connection Screen
│   │   │   ├── Devices.tsx     # Device Discovery
│   │   │   ├── Apps.tsx        # App Management
│   │   │   └── Backup.tsx      # Backup Interface
│   │   ├── components/
│   │   │   ├── DeviceCard.tsx
│   │   │   ├── AppGrid.tsx
│   │   │   └── StatusBar.tsx
│   │   └── hooks/
│   │       ├── useZeroTier.ts
│   │       └── useSMB.ts
│   │
│   ├── shared/            # Shared Types
│   │   ├── types.ts
│   │   └── constants.ts
│   │
├── resources/             # ZeroTier Binaries
│   ├── zerotier-one-x64
│   └── zerotier-cli-x64
│
└── package.json
```

## 🔧 Kernfunktionalität

### 1. ZeroTier Integration

#### Binary Embedding
```typescript
// src/main/zerotier/bundler.ts
export class ZeroTierBundler {
  private binaryPath: string;
  
  constructor() {
    // Extract bundled binary to temp location
    this.binaryPath = this.extractBinary();
  }
  
  private extractBinary(): string {
    const resourcePath = path.join(
      process.resourcesPath,
      'zerotier-one'
    );
    
    const tempPath = path.join(
      app.getPath('temp'),
      'zerotier-one'
    );
    
    fs.copyFileSync(resourcePath, tempPath);
    fs.chmodSync(tempPath, 0o755);
    
    return tempPath;
  }
}
```

#### Lifecycle Management
```typescript
// src/main/zerotier/manager.ts
export class ZeroTierManager {
  private process: ChildProcess | null = null;
  private bundler: ZeroTierBundler;
  
  async start(): Promise {
    const binary = this.bundler.getBinaryPath();
    
    this.process = spawn(binary, ['-d'], {
      detached: true,
      stdio: 'pipe'
    });
    
    await this.waitForReady();
  }
  
  async stop(): Promise {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }
  
  async joinNetwork(networkId: string): Promise {
    const cli = this.bundler.getCliPath();
    
    await execAsync(`${cli} join ${networkId}`);
    await this.waitForConnection(networkId);
  }
  
  async leaveNetwork(networkId: string): Promise {
    const cli = this.bundler.getCliPath();
    await execAsync(`${cli} leave ${networkId}`);
  }
  
  async getNetworks(): Promise {
    const cli = this.bundler.getCliPath();
    const output = await execAsync(`${cli} listnetworks -j`);
    
    return JSON.parse(output);
  }
}
```

### 2. SMB Places Integration

#### Places Manager
```typescript
// src/main/smb/places.ts
export class PlacesManager {
  private bookmarksFile: string;
  
  constructor() {
    // GTK bookmarks location
    this.bookmarksFile = path.join(
      os.homedir(),
      '.config/gtk-3.0/bookmarks'
    );
  }
  
  async pinShare(share: SMBShare): Promise {
    const url = `smb://${share.host}/${share.name}`;
    const label = share.displayName;
    
    // Read existing bookmarks
    let bookmarks = '';
    if (fs.existsSync(this.bookmarksFile)) {
      bookmarks = fs.readFileSync(this.bookmarksFile, 'utf-8');
    }
    
    // Add new bookmark if not exists
    const line = `${url} ${label}\n`;
    if (!bookmarks.includes(url)) {
      bookmarks += line;
      fs.writeFileSync(this.bookmarksFile, bookmarks);
    }
    
    // Also add to KDE places if exists
    await this.addToKDEPlaces(share);
  }
  
  async unpinShare(shareUrl: string): Promise {
    if (!fs.existsSync(this.bookmarksFile)) return;
    
    let bookmarks = fs.readFileSync(this.bookmarksFile, 'utf-8');
    const lines = bookmarks.split('\n');
    
    bookmarks = lines
      .filter(line => !line.includes(shareUrl))
      .join('\n');
    
    fs.writeFileSync(this.bookmarksFile, bookmarks);
    
    await this.removeFromKDEPlaces(shareUrl);
  }
  
  private async addToKDEPlaces(share: SMBShare): Promise {
    const placesFile = path.join(
      os.homedir(),
      '.local/share/user-places.xbel'
    );
    
    if (!fs.existsSync(placesFile)) return;
    
    // Parse and modify XBEL XML
    const xml = fs.readFileSync(placesFile, 'utf-8');
    // ... XML manipulation
  }
}
```

#### SMB Manager
```typescript
// src/main/smb/manager.ts
export class SMBManager {
  async discoverShares(host: string): Promise {
    const shares: SMBShare[] = [];
    
    try {
      const output = await execAsync(`smbclient -L ${host} -N`);
      
      // Parse shares from output
      const lines = output.split('\n');
      for (const line of lines) {
        if (line.includes('Disk')) {
          const match = line.match(/(\S+)\s+Disk/);
          if (match) {
            shares.push({
              host,
              name: match[1],
              displayName: `${host} - ${match[1]}`,
              type: 'disk'
            });
          }
        }
      }
    } catch (error) {
      console.error('Failed to discover shares:', error);
    }
    
    return shares;
  }
  
  async mountShare(share: SMBShare, mountPoint: string): Promise {
    await execAsync(
      `mount -t cifs //${share.host}/${share.name} ${mountPoint}`
    );
  }
}
```

### 3. UI Components (React)

#### Connection Screen
```typescript
// src/renderer/pages/Connect.tsx
export const ConnectPage: FC = () => {
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState([]);
  
  const handleScan = async () => {
    setScanning(true);
    
    // IPC call to main process
    const found = await window.electron.scanDevices();
    setDevices(found);
    
    setScanning(false);
  };
  
  const handleConnectRemote = () => {
    // Show Remote ID dialog
  };
  
  return (
    
      Remote access
      
        anytime, anywhere.
      
      
      {scanning ? (
        
      ) : (
        
      )}
      
      
        Scan Network
        
          Connect via Remote ID
        
      
    
  );
};
```

## 📦 Packaging

### electron-builder Config
```json
{
  "productName": "ZimaOS Client",
  "appId": "com.zimaos.linux.client",
  "files": [
    "dist/**/*",
    "resources/**/*"
  ],
  "extraResources": [
    {
      "from": "binaries/zerotier-one",
      "to": "zerotier-one",
      "filter": ["**/*"]
    }
  ],
  "linux": {
    "target": ["AppImage", "deb"],
    "category": "Network",
    "depends": [
      "libfuse2",
      "samba-client"
    ]
  }
}
```

## 🚀 Development Roadmap

### Phase 1: Core (2 Wochen)
- [ ] Electron Setup
- [ ] ZeroTier Binary Embedding
- [ ] Basic UI Framework
- [ ] Device Discovery

### Phase 2: Integration (2 Wochen)
- [ ] ZeroTier Lifecycle Management
- [ ] Network Join/Leave
- [ ] Connection Status
- [ ] Settings Persistence

### Phase 3: SMB (1 Woche)
- [ ] SMB Share Discovery
- [ ] Places Integration (GTK)
- [ ] Places Integration (KDE)
- [ ] Pin/Unpin UI

### Phase 4: Polish (1 Woche)
- [ ] UI Refinement
- [ ] Error Handling
- [ ] Auto-Update
- [ ] Documentation

## 🧪 Testing

```typescript
// Example test
describe('ZeroTierManager', () => {
  it('should join network successfully', async () => {
    const manager = new ZeroTierManager();
    await manager.start();
    
    await manager.joinNetwork('a0cbf4b62a1234567');
    
    const networks = await manager.getNetworks();
    expect(networks).toContainEqual(
      expect.objectContaining({
        id: 'a0cbf4b62a1234567',
        status: 'OK'
      })
    );
  });
});
```

## 📝 Notes

- ZeroTier binary muss für jede Platform separat gebundelt werden
- GTK bookmarks funktioniert für GNOME Files (Nautilus)
- KDE places benötigt XBEL-Format
- SMB-Authentifizierung über Keyring speichern
- Auto-Update über electron-updater implementieren
