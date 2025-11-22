# ZimaOS Client

Moderner Desktop-Client für ZimaOS mit integrierter ZeroTier- und SMB-Verwaltung.

## Übersicht

ZimaOS Client ist eine leistungsstarke Desktop-Anwendung für Linux und macOS, die nahtlose Konnektivität zu Ihren ZimaOS-Geräten bietet. Verbinden Sie sich mit Ihrem persönlichen Cloud-Speicher, greifen Sie auf Docker-Anwendungen zu und verwalten Sie automatisierte Backups - alles von einem nativen Desktop-Client aus.

## Funktionen

- **Remote-Konnektivität**: Verbindung zu ZimaOS-Geräten über lokales Netzwerk oder Remote-ID mit ZeroTier
- **SMB/CIFS-Integration**: Durchsuchen und Zugriff auf freigegebene Ordner mit automatischem Mounten
- **Docker-App-Verwaltung**: Anzeigen und Zugriff auf Ihre ZimaOS Docker-Anwendungen direkt vom Client aus
- **Automatisierte Backups**: Planen und Verwalten von automatisierten Backup-Jobs von lokalen Ordnern zu ZimaOS-Freigaben
- **Letzte Verbindungen**: Schnellzugriff auf zuvor verbundene Geräte
- **Netzwerk-Erkennung**: Automatische Erkennung von ZimaOS-Geräten in Ihrem lokalen Netzwerk
- **ZeroTier-Diagnose**: Integrierte Diagnosetools zur Fehlerbehebung bei Verbindungsproblemen
- **Einstellungsverwaltung**: Konfiguration von Sprache, Theme, ZeroTier-Optionen und Backup-Einstellungen
- **Dark Mode**: Vollständige Dark-Mode-Unterstützung mit System-Theme-Erkennung

## Installation

### Linux

Laden Sie die neueste Version von der [Releases-Seite](https://github.com/chicohaager/zima-linux-client/releases) herunter.

**AppImage:**
```bash
chmod +x ZimaOS\ Client-*.AppImage
./ZimaOS\ Client-*.AppImage
```

**Debian/Ubuntu (.deb):**
```bash
sudo dpkg -i zima-linux-client_*_amd64.deb
sudo apt-get install -f  # Abhängigkeiten installieren falls nötig
```

### macOS

Laden Sie die neueste macOS-Version von der [Releases-Seite](https://github.com/chicohaager/zima-linux-client/releases) herunter.

## Aus Quellcode erstellen

### Voraussetzungen

- Node.js 18 oder höher
- npm oder yarn
- Git

### Build-Schritte

```bash
# Repository klonen
git clone https://github.com/chicohaager/zima-linux-client.git
cd zima-linux-client

# Abhängigkeiten installieren
npm install

# Entwicklungsmodus
npm run dev

# Für Produktion erstellen
npm run build

# Für Ihre Plattform paketieren
npm run package:linux  # Linux (AppImage + DEB)
npm run package:mac    # macOS
```

## Anforderungen

- **Linux**: libfuse2, smbclient
- **ZeroTier**: Wird automatisch bei der Paketinstallation installiert

## Verwendung

1. **Starten Sie die Anwendung**
2. **Verbinden Sie sich mit Ihrem ZimaOS**:
   - Verwenden Sie "Scan Local Network", um Geräte in Ihrem lokalen Netzwerk zu finden
   - Verwenden Sie "Connect via Remote ID", um sich remote über ZeroTier zu verbinden
3. **Greifen Sie auf Ihre Freigaben zu**: Durchsuchen und mounten Sie SMB-Freigaben von entdeckten Geräten
4. **Verwalten Sie Apps**: Anzeigen und Zugriff auf Ihre Docker-Anwendungen
5. **Richten Sie Backups ein**: Erstellen Sie geplante Backup-Jobs zum Schutz Ihrer Daten
6. **Öffnen Sie Einstellungen**: Klicken Sie auf das Zahnrad-Symbol oben rechts, um Sprache, Theme, ZeroTier und Backup-Optionen zu konfigurieren

## Fehlerbehebung

**Verbindungsprobleme?**

Die App enthält integrierte Diagnosetools zur Fehlerbehebung bei ZeroTier-Verbindungen:

1. **Einstellungen öffnen** (Zahnrad-Symbol oben rechts)
2. Zum Tab **ZeroTier** navigieren
3. **Diagnose ausführen** klicken, um zu prüfen:
   - ZeroTier-Binary-Existenz und -Berechtigungen
   - Service-Status
   - Netzwerkkonnektivität
   - Port-Verfügbarkeit
   - Systemkonfiguration

**Häufige Lösungen:**
- **Abmelden und wieder anmelden** nach der Installation (Gruppenberechtigungen erfordern einen neuen Login)
- ZeroTier-Service prüfen: `sudo systemctl status zima-zerotier.service`
- Diagnoseergebnisse in Einstellungen > ZeroTier > Diagnostics überprüfen

## Projektstruktur

```
zima-linux-client/
├── src/
│   ├── main/              # Electron Main Process
│   │   ├── index.ts       # App-Einstiegspunkt
│   │   ├── ipc/           # IPC-Handler
│   │   ├── zerotier/      # ZeroTier-Verwaltung
│   │   ├── smb/           # SMB-Integration
│   │   ├── backup/        # Backup-System
│   │   └── utils/         # Hilfsfunktionen
│   ├── renderer/          # React UI
│   │   ├── App.tsx        # Hauptkomponente
│   │   ├── pages/         # Seiten (Connect, Apps, Backup, Settings)
│   │   ├── components/    # UI-Komponenten
│   │   └── store/         # Zustand-Management
│   ├── shared/            # Gemeinsame Typen
│   └── main/
│       └── preload.ts     # IPC-Bridge
├── bin/zerotier/          # ZeroTier-Binaries
├── resources/             # App-Ressourcen
└── package.json
```

## Technologie-Stack

- **Electron**: Desktop-App-Framework
- **React**: UI-Framework
- **TypeScript**: Typsicherheit
- **Tailwind CSS**: Styling
- **Zustand**: State-Management
- **Winston**: Logging
- **i18next**: Internationalisierung
- **Sentry**: Fehler-Tracking
- **Jest**: Testing

## Entwicklung

```bash
# Tests ausführen
npm test

# Tests im Watch-Modus ausführen
npm run test:watch

# Test-Abdeckung prüfen
npm run test:coverage

# Code-Linting
npm run lint

# Typ-Prüfung
npm run type-check
```

## Lizenz

MIT-Lizenz - siehe LICENSE-Datei für Details

## Autor

Holger Kühn

## Links

- **Homepage**: https://www.zimaspace.com
- **Repository**: https://github.com/chicohaager/zima-linux-client
- **Issues**: https://github.com/chicohaager/zima-linux-client/issues
- **Releases**: https://github.com/chicohaager/zima-linux-client/releases
