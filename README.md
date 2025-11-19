# ZimaOS Linux Client

Modern Desktop Client for ZimaOS with integrated ZeroTier and SMB management.

## Features

- **Network Discovery**: Automatically scan for ZimaOS devices on your local network
- **Remote Access**: Connect to ZimaOS devices remotely via ZeroTier
- **SMB Integration**: Discover and manage SMB shares
- **File Manager Integration**: Pin shares to GNOME Files (Nautilus) and KDE Plasma
- **Backup Management**: Create and manage automated backup jobs with progress tracking
- **Modern UI**: Built with React, TypeScript, and Tailwind CSS

## Prerequisites

- Node.js 18 or higher
- npm or yarn
- Linux with GNOME or KDE desktop environment
- `samba-client` package installed
- `libfuse2` for AppImage support

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd linux-client
```

2. Install dependencies:
```bash
npm install
```

3. Place ZeroTier binaries in the `bin/zerotier/x64/` directory:
```bash
mkdir -p bin/zerotier/x64
# Copy zerotier-one and zerotier-cli binaries here
```

## Development

Start the development server:
```bash
npm run dev
```

This will start both the Electron main process and the React renderer in development mode.

## Building

Build the application:
```bash
npm run build
```

Package for Linux:
```bash
npm run package:linux
```

This will create both AppImage and .deb packages in the `dist/` directory.

## Project Structure

```
linux-client/
├── src/
│   ├── main/              # Electron Main Process
│   │   ├── zerotier/     # ZeroTier management
│   │   ├── smb/          # SMB share management
│   │   ├── backup/       # Backup job management
│   │   └── ipc/          # IPC handlers
│   ├── renderer/          # React UI
│   │   ├── pages/        # Page components
│   │   ├── components/   # Reusable components
│   │   ├── hooks/        # React hooks
│   │   └── store/        # Zustand store
│   └── shared/            # Shared types and constants
├── bin/                   # ZeroTier binaries (not included in repo)
│   └── zerotier/
│       └── x64/
└── resources/             # App resources
```

## Architecture

### ZeroTier Integration
- Bundles ZeroTier binaries within the Electron app
- Manages ZeroTier lifecycle (start/stop)
- Handles network join/leave operations
- Provides network status monitoring

### SMB Management
- Discovers available SMB shares on devices
- Integrates with GTK bookmarks (GNOME Files)
- Integrates with KDE places (Dolphin)
- Pin/unpin shares to file manager sidebar

### Backup Management
- Create and manage backup jobs using rsync
- Monitor progress with speed and ETA information
- Case-insensitive SMB mount point detection
- Support for multiple backup destinations
- Persistent job configuration

### UI Components
- **Connect Page**: Network scanning and remote connection
- **Devices Page**: Display discovered ZimaOS devices
- **Apps Page**: Manage SMB shares and access
- **Backup Page**: Create and manage automated backups with rsync

## Configuration

### Environment Variables

Create a `.env` file in the project root:

```env
ZEROTIER_NETWORK_ID=your_network_id_here
NODE_ENV=development
```

### ZeroTier Network

To use remote access, you'll need a ZeroTier network ID. Get one from:
- Your ZimaOS device settings
- [ZeroTier Central](https://my.zerotier.com)

## Usage

1. **Scan Local Network**: Click "Scan Network" to discover ZimaOS devices on your local network
2. **Connect Remotely**: Click "Connect via Remote ID" and enter your ZeroTier network ID
3. **Access Shares**: Select a device to view and access its SMB shares
4. **Pin Shares**: Pin frequently used shares to your file manager sidebar

## Troubleshooting

### ZeroTier fails to start
- Ensure ZeroTier binaries are in the correct location
- Check that binaries have execute permissions (`chmod +x`)
- Try running with elevated permissions if needed

### SMB shares not appearing
- Ensure `samba-client` is installed: `sudo apt install samba-client`
- Check network connectivity to the device
- Verify SMB is enabled on the ZimaOS device

### Shares not pinning to file manager
- For GNOME: Ensure `~/.config/gtk-3.0/` directory exists
- For KDE: Ensure `~/.local/share/` directory exists
- Check file permissions on bookmark files

## Development Roadmap

### Phase 1: Core ✅
- [x] Electron Setup
- [x] ZeroTier Binary Embedding
- [x] Basic UI Framework
- [x] Device Discovery

### Phase 2: Integration ✅
- [x] ZeroTier Lifecycle Management
- [x] Network Join/Leave
- [x] Connection Status
- [x] Settings Persistence

### Phase 3: SMB ✅
- [x] SMB Share Discovery
- [x] Places Integration (GTK)
- [x] Places Integration (KDE)
- [x] Pin/Unpin UI

### Phase 4: Backup ✅
- [x] Backup Job Management
- [x] Rsync Integration
- [x] Progress Tracking
- [x] Speed and ETA Display

### Phase 5: Polish (Planned)
- [ ] UI Refinement
- [ ] Enhanced Error Handling
- [ ] Auto-Update
- [ ] Extended Documentation

## Technologies

- **Electron 28+**: Desktop application framework
- **React 18**: UI framework
- **TypeScript**: Type-safe development
- **Tailwind CSS**: Utility-first styling
- **Zustand**: State management
- **ZeroTier**: Network virtualization
- **SMB/CIFS**: Network file sharing

## Author

**Holger Kühn**

## License

MIT

## Support

For issues and questions, please use the GitHub issue tracker.
