# 🛰️ Zima Remote Client for Linux

Ein moderner Linux-Client zur direkten Verbindung mit ZimaOS über eine **Remote-ID**,  
inklusive vollständiger ZeroTier-Integration und SMB-„Places“-Pinning im Dateimanager.

---

## 📋 Übersicht

| Komponente | Beschreibung |
|-------------|---------------|
| 🧠 **Core** | Electron + TypeScript App |
| 🔗 **ZeroTier** | vollständig gebündelt & steuerbar (start / stop / join / leave / update) |
| 🗂️ **SMB-Integration** | Mount & Pin von SMB-Shares in Dateimanager-„Places“ |
| 🧩 **Remote-ID** | Authentifizierung und Netz-Provisionierung über ZimaOS-API |
| 🧑‍💻 **Platform** | Linux (x64, ARM64 getestet) |
| 💡 **Lizenz** | MIT (open source friendly) |

---

## 🚀 Funktionen

### 1. ZimaOS Remote-ID-Verbindung
- Benutzer gibt eine **Remote-ID** ein, die vom ZimaOS Dashboard generiert wird.  
- Der Client löst diese ID über die ZimaOS API ein:
  - erhält ZeroTier-Network-ID und Access-Token  
  - optional SMB-Freigaben und Standort-Infos  
- Der Client startet ZeroTier im User-Space und tritt automatisch dem Netz bei.

### 2. ZeroTier Lifecycle Control
- ZeroTier läuft im eigenen App-Verzeichnis (`~/.zima-zerotier`)
- GUI und IPC-Befehle:
  - Start / Stop  
  - Join / Leave Network  
  - Upgrade ZeroTier-Binärdateien  
  - Statusanzeige (`listnetworks`)

### 3. SMB-Integration & Places-Pinning
- SMB-Freigaben werden per `gio mount smb://…` eingehängt (ohne root).  
- Optional kann über Polkit/Helper ein systemweiter CIFS-Mount erfolgen.  
- Die App pinnt SMB-Shares in die „Places“ des Dateimanagers:
  - **GNOME/Xfce:** `~/.config/gtk-3.0/bookmarks` & `gtk-4.0/bookmarks`
  - **KDE/Dolphin:** `~/.local/share/user-places.xbel`

### 4. System-Integration
- optionaler Helper-Dienst (`zima-remote-helper.service`) für root-Aktionen  
- PolicyKit-Regeln (`com.zima.remote.policy`) für autorisierte Operationen  
- App-Autostart möglich (z. B. per .desktop-Datei)

---

## 🧱 Projektstruktur

```text
zima-remote-client/
├── app/
│   ├── main/          # Electron Main Process
│   ├── preload/       # IPC Bridge
│   ├── renderer/      # UI (React, optional)
│   └── common/        # Shared Modules
│       ├── zerotier.ts      # Lifecycle & CLI control
│       ├── remote.ts        # Remote-ID Claim
│       ├── smb.ts           # GIO Mount
│       ├── places-gtk.ts    # GNOME/Xfce bookmarks
│       └── places-kde.ts    # KDE user-places.xbel patcher
├── resources/
│   ├── zerotier/            # zerotier-one & zerotier-cli binaries
│   ├── polkit/
│   ├── systemd/
│   └── icons/
├── scripts/
│   └── helper_stub.sh
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🧩 Installation & Build

### Voraussetzungen
- Node.js ≥ 20  
- npm oder pnpm  
- Linux Desktop (GNOME, KDE, Xfce getestet)

### Setup

```bash
git clone https://github.com/youruser/zima-remote-client.git
cd zima-remote-client
npm install
```

### Entwicklungs-Start

```bash
npm run dev
```

### Build

```bash
npm run build
npm start
```

*(Für AppImage/deb/rpm später electron-builder hinzufügen.)*

---

## ⚙️ Konfiguration

### ZimaOS-API
Definiere die Umgebungsvariable `ZIMA_BASE_URL` oder bearbeite `app/common/remote.ts`:

```typescript
const BASE = process.env.ZIMA_BASE_URL || "https://zimaos.local";
```

Der ZimaOS-Endpoint muss folgende Antwort liefern:

```json
{
  "ztNetworkId": "8056c2e21c000001",
  "smbShares": [
    { "url": "smb://zimaos.local/share1", "name": "Home Share" }
  ],
  "siteName": "My ZimaOS",
  "token": "optional-short-lived"
}
```

---

## 🔐 Sicherheit

| Bereich | Umsetzung |
|----------|------------|
| ZeroTier | im User-Space, getrennt von Systeminstanz |
| SMB-Mount | über GIO (`gio mount`) ohne root |
| Credentials | via libsecret / KWallet (geplant) |
| Root-Helper | optional, via PolicyKit autorisierbar |
| Netzwerke | kurzlebige JWTs oder mTLS für Remote-Claim-API |

---

## 🧠 Beispiel-Ablauf (Remote-Connect)

```typescript
async function connectWithRemoteId(remoteId: string) {
  await startZeroTier();
  const claim = await claimRemoteId(remoteId);
  await joinNetwork(claim.ztNetworkId);
  // warten bis IP zugewiesen ist …
  for (const s of claim.smbShares) {
    await mountSmb(s.url);
    await pinGnome(s.url, s.name);
    await pinKde(s.url, s.name);
  }
}
```

---

## 🧩 Places-Management

### GNOME/Xfce
- Datei: `~/.config/gtk-3.0/bookmarks`  
- Format: `smb://host/share  Name`

### KDE
- Datei: `~/.local/share/user-places.xbel`  
- XML-Patch über `fast-xml-parser`

---

## ⚡ ZeroTier Kommandos (intern)

| Aktion | CLI-Befehl |
|---------|-------------|
| Start | `zerotier-one -d -p9993 -H ~/.zima-zerotier` |
| Stop | `zerotier-cli -D ~/.zima-zerotier shutdown` |
| Join | `zerotier-cli -D ~/.zima-zerotier join <network>` |
| Leave | `zerotier-cli -D ~/.zima-zerotier leave <network>` |
| Status | `zerotier-cli -D ~/.zima-zerotier listnetworks` |

---

## 🧰 Helper & PolicyKit (Option A)

**Service** `/etc/systemd/system/zima-remote-helper.service`  
```ini
[Unit]
Description=Zima Remote Helper
After=network-online.target

[Service]
ExecStart=/opt/zima-remote/helper --socket /run/zima-remote.sock
Restart=on-failure
```

**Policy** `/usr/share/polkit-1/actions/com.zima.remote.policy`  
```xml
<action id="com.zima.remote.mgmt">
  <description>Zima Remote privileged ops</description>
  <defaults>
    <allow_active>auth_admin_keep</allow_active>
  </defaults>
</action>
```

---

## 💻 Systemd-freie Variante (Option B)
- ZeroTier nur im User-Space  
- SMB Mounts über GIO  
- Keine Root-Aktionen → keine PolicyKit-Dateien notwendig  
- App kann autonom laufen und nach dem Beenden Netzwerk verlassen  

---

## 🧪 Smoke-Tests

1️⃣ App starten → ZeroTier startet  
2️⃣ Remote-ID eingeben → Claim OK  
3️⃣ ZT join → Ping zu ZimaOS  
4️⃣ SMB Mount + Pin → Dateimanager-„Places“ prüfen  
5️⃣ Unpin → Eintrag verschwindet  
6️⃣ ZT stop → Daemon beendet  

---

## 🛠️ Nächste Ausbaustufen
- React-GUI (Onboarding, Netzwerkstatus, Shares)  
- ZT-Status-Polling & Visualisierung  
- Keyring-Integration für SMB-Creds  
- Updater für ZT-Binaries & App-Version  
- In-App Diagnose (Log-Viewer, Ping-Test)  

---

## 🧑‍💻 Entwickler-Setup (Schnellstart)

```bash
# im Projektverzeichnis
npm install
npm run dev

# für Production
npm run build
npm start
```

---

## 📦 Distribution (Zukunft)
- electron-builder für AppImage, .deb und .rpm  
- Signierte ZT-Binaries (`resources/zerotier/`)  
- SHA256-Validierung vor Upgrade  

---

## 🧾 Lizenz
MIT License © 2025 Holger Kuehn / ZimaOS Community

---

## 📚 Referenzen
- 📄 **Linux Zima Client – Two Technical Points** (Projektanforderungen)  
  - ZeroTier Integration & Control  
  - Places Area Pinning in File Manager  
- ZeroTier SDK: <https://www.zerotier.com/download/>  
- Electron: <https://www.electronjs.org/>  
- GNOME GIO: <https://developer.gnome.org/gio/>  
- KDE Places Specification: <https://specifications.freedesktop.org/>  

---

**🟢 Ergebnis:**  
Dieses Projekt erfüllt beide technischen Punkte aus dem ZimaOS-Pflichtenheft:  
1️⃣ ZeroTier Integration & Control (bündelbar & steuerbar)  
2️⃣ „Places“-Pinning von SMB-Freigaben über eine grafische Schnittstelle.
