# 🛰️ ZeroTier unter Linux – Integration im Zima Remote Client (User Mode)

Dieses Dokument beschreibt Schritt für Schritt, wie man den **ZeroTier-Daemon**
für den **Zima Remote Client** unter Linux korrekt im **Benutzerkontext** betreibt –
**ohne Root**, aber mit allen benötigten Netzwerk-Capabilities.

---

## 🧩 Ziel

- ZeroTier läuft vollständig im User-Space  
- Kein Root-Service nötig  
- Automatischer Start per `systemd --user`  
- Verwaltung per `zerotier-cli`  
- Integration in Electron-App / Zima Remote Client

---

## ⚙️ Voraussetzungen

| Paket | Beschreibung |
|-------|---------------|
| `libcap2-bin` | für `setcap` |
| `systemd --user` | User Services aktiv |
| `/dev/net/tun` | vorhanden und beschreibbar |

Prüfen:
```bash
ls -l /dev/net/tun
# Erwartet: crw-rw-rw- 1 root root 10, 200 ...
```

---

## 🧠 Installation & Einrichtung

### 1. ZeroTier-Binaries bereitstellen

```bash
mkdir -p ~/.local/lib/zima-remote/zerotier
cp -f resources/zerotier/zerotier-one ~/.local/lib/zima-remote/zerotier/
cp -f resources/zerotier/zerotier-cli ~/.local/lib/zima-remote/zerotier/
chmod +x ~/.local/lib/zima-remote/zerotier/zerotier-{one,cli}
```

### 2. Netzwerk-Capabilities vergeben

```bash
sudo setcap cap_net_admin,cap_net_raw=eip ~/.local/lib/zima-remote/zerotier/zerotier-one
getcap ~/.local/lib/zima-remote/zerotier/zerotier-one
# → cap_net_admin,cap_net_raw=eip
```

### 3. ZT-Home vorbereiten

```bash
mkdir -p ~/.zima-zerotier
chown -R "$USER":"$USER" ~/.zima-zerotier
chmod 700 ~/.zima-zerotier
```

### 4. Test-Start im Vordergrund

```bash
~/.local/lib/zima-remote/zerotier/zerotier-one -U ~/.zima-zerotier
# erwartet: "Starting Control Plane..." → Strg + C beenden
```

> `-U` = **Skip privilege check** – nötig, da kein Root benutzt wird.

---

## 🧩 systemd-Integration (User Mode)

`~/.config/systemd/user/zima-zerotier.service`:

```ini
[Unit]
Description=ZeroTier for Zima Remote Client (user)
After=network-online.target

[Service]
Type=forking
ExecStart=%h/.local/lib/zima-remote/zerotier/zerotier-one -d -U %h/.zima-zerotier
ExecStop=%h/.local/lib/zima-remote/zerotier/zerotier-cli -D %h/.zima-zerotier shutdown
Restart=always
NoNewPrivileges=false

[Install]
WantedBy=default.target
```

### Aktivieren & starten

```bash
systemctl --user daemon-reload
systemctl --user enable --now zima-zerotier.service
systemctl --user status zima-zerotier.service --no-pager
```

Erwartet: `active (running)`

---

## 🧩 ZeroTier-CLI benutzen

```bash
PORT=$(cat ~/.zima-zerotier/zerotier-one.port)
TOKEN=$(cat ~/.zima-zerotier/authtoken.secret)
~/.local/lib/zima-remote/zerotier/zerotier-cli -p"$PORT" -T"$TOKEN" info
~/.local/lib/zima-remote/zerotier/zerotier-cli -p"$PORT" -T"$TOKEN" join <NETWORK_ID>
~/.local/lib/zima-remote/zerotier/zerotier-cli -p"$PORT" -T"$TOKEN" listnetworks
ip link | grep -E 'zt[0-9a-f]'
```

---

## 🧰 Fehlerbehebung

| Problem | Ursache | Lösung |
|----------|----------|--------|
| `must be run as root (uid 0)` | Root-Check aktiv | `-U` verwenden |
| `authtoken.secret could not be written` | falscher Besitzer | `sudo chown -R $USER:$USER ~/.zima-zerotier` |
| `status=218/CAPABILITIES` | User-Unit enthält Cap-Direktiven | Entferne `AmbientCapabilities` & `CapabilityBoundingSet` |
| Dienst „inactive (dead)“ | falscher Typ / kein `-d` | `Type=forking`, `ExecStart` mit `-d` |
| CLI zeigt nur Hilfe | keine Verbindung zum Daemon | `-p$(cat portfile)` & `-T$(cat authtoken.secret)` |
| kein `zt*`-Interface | kein Join oder nicht freigegeben | Netzwerk joinen & in Controller approven |

---

## 💡 Integration in Electron-App

```ts
spawn(ztBin, ['-d', '-U', ztHome], { stdio: 'ignore' });
```

> Nicht `-H`; das Home-Verzeichnis wird **positional** übergeben.

---

## ✅ Endzustand

| Element | Status |
|----------|--------|
| Binary | `~/.local/lib/zima-remote/zerotier/zerotier-one` mit Caps |
| Dienst | `systemd --user` → `active (running)` |
| Portfile | `~/.zima-zerotier/zerotier-one.port` vorhanden |
| Token | `~/.zima-zerotier/authtoken.secret` (600) |
| CLI | kommuniziert mit Daemon (200 info …) |
| Interface | `ztXXXXXXXX` sichtbar |
| App-Integration | über `spawn(…, ['-d', '-U', ztHome])` |

---

**Damit ist dein ZeroTier-Daemon vollständig als User-Service eingerichtet und kontrollierbar – ohne Root, mit Capabilities, funktionsfähig für deinen Zima Remote Client.**
