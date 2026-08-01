# ZimaOS Client

Desktop client for ZimaOS on Linux — files, photos, apps and device management.

> **This is the `v2` branch: version 2.0.0-alpha.1, a rewrite.**
> It has been started on **exactly one machine** (Ubuntu 24.04, GNOME on Wayland, x86_64).
> Whether it starts on yours is an open question — that is what the current test round is for.
> The 0.9.x line lives on `main` and under [`legacy-0.9/`](legacy-0.9/); nothing was deleted.
>
> Testers: [`docs/TESTER.md`](docs/TESTER.md) · [`docs/TESTPROTOKOLL.md`](docs/TESTPROTOKOLL.md)
> What is built and what is measured: [`docs/V2-STATUS.md`](docs/V2-STATUS.md)

## English

### Overview

ZimaOS Client connects a Linux desktop to ZimaOS devices — over the local network, a direct IP
address, or a Remote ID. It browses files, shows the photo library, lists installed apps and
reports the device's state.

Every claim in this repository's documentation names the command or the measurement behind it.
Where something is unmeasured, it says so instead of sounding finished.

### What it does

**Getting in — three ways, side by side**

- **Scan the local network** — mDNS over `_zimaos._tcp` (port 80, TXT `os=ZimaOS`), implemented
  directly against the wire format, no third-party dependency.
- **Connect by IP address** — for devices the scan does not reach.
- **Connect by Remote ID** — the device's ZeroTier network ID. Joining the network, deriving the
  device address and probing it happens in one step; the ZeroTier part is machinery, not a step
  you perform by hand.

Every candidate address — discovered, typed or derived — goes through the same probe, and the
result carries a measured latency. A named reason comes back instead of an empty list, because
"empty" reads like "no device found".

**Once connected**

- **Files** — browse, search, create folders, upload and download, transfer tasks, trash with
  restore, pinned folders.
- **Photos** — gallery and folder grid, search, the device's indexing progress, and a foreground
  backup of local folders. It runs only while the window is open, says so on screen, and lists
  every skipped file with its reason.
- **Apps** — installed apps with their own icons, start and stop, open the web UI.
- **Device** — model and system info, CPU/memory utilisation, volumes, power actions.
- **Several devices** — a registry with priorities, switching, and forgetting a device including
  its session.
- **Import from 0.9** — reads the old client's configuration **read-only**. No secrets are
  migrated: moving a password between keyring backends without asking is a silent trust breach,
  so v2 asks for it once instead.

**Around all of that**

- **28 languages**, complete (280 keys each). Only `de_DE`, `en_US` and `en_GB` have been
  reviewed; the other 25 are machine-translated and marked "unreviewed" in the language menu.
- **Light, dark, or follow the system** — three states, not a two-way toggle, so "follow the
  system" stays reachable.
- **Two layouts, one information architecture**: a floating pill below 860 px, a labelled
  sidebar above it — two component trees, not one restyled.
- **Tailscale is detected, never operated.** If a tunnel is already running it is used. Nothing
  is started, stopped or reconfigured, and no DNS setting is touched.

### What it deliberately does not do

- **No background synchronisation.** Photo backup runs while the window is open, and stops with it.
- **No SMB/CIFS mounting and no scheduled backup jobs.** Both existed in the 0.9 line and are
  not part of this rewrite.
- **No automatic updates.** A new version arrives as a new package.
- **It does not take over your tunnel.** See Tailscale above.

### Installation

Packages are built for **x86_64 only**. There is no arm64 build, and no Flatpak.

**Debian, Ubuntu, Linux Mint, Pop!\_OS:**

```bash
sudo apt install ./zima-linux-client_2.0.0-alpha.1_amd64.deb
```

**Fedora, openSUSE, RHEL derivatives:**

```bash
sudo dnf install ./zima-linux-client-2.0.0-alpha.1.x86_64.rpm
```

**AppImage:**

```bash
chmod +x "ZimaOS Client-2.0.0-alpha.1.AppImage"
"./ZimaOS Client-2.0.0-alpha.1.AppImage"
```

More convenient, and it measures the result: [`scripts/install.sh`](scripts/install.sh) picks the
package matching your distribution, compares the checksum, installs it with the right tool and
then checks whether the application can actually start. `--check` inspects without changing
anything, `--repair` fixes what is fixable, `--uninstall` removes it.

Installation goes to `/opt/ZimaOS Client/`, with `/usr/bin/zima-linux-client` as the entry point.

### Requirements

- **x86_64 Linux** with a desktop session. On problematic DRM drivers the client relaunches
  itself under X11 — measured on `vmwgfx`, where Wayland ends in SIGSEGV.
- **`.deb` declares `libcap2-bin`** — `setcap` is needed by the post-install script.
- **The AppImage is type 2 and needs FUSE 2.** The test machine had `libfuse2t64` installed; a
  system without it is unmeasured.
- **ZeroTier ships with the package** (`/opt/ZimaOS Client/resources/zerotier/<arch>/`) and is
  granted `CAP_NET_ADMIN` during installation. Nothing is pulled in, an existing system-wide
  ZeroTier is left untouched, and the application itself never asks for a password.
- **A keyring is expected but not required.** Only the refresh token is stored, never the
  password. If the keyring falls back to plain text, the UI warns **before** anything is written.

### Building from source

Requires **Node.js 22 or newer** (`engines.node: >=22`).

```bash
git clone https://github.com/chicohaager/zima-linux-client.git
cd zima-linux-client
git checkout v2
npm install

npm run dev          # development mode
npm run dev:x11      # same, forced onto X11 (see below)
npm run build        # type-check + production build
```

`npm run dev` does **not** relaunch on X11 even on a problematic driver — that would kill the Vite
dev server, which is the parent process. It prints the reason and the command instead; `dev:x11`
is that command. Only argv works here, because Ozone picks its platform before any JavaScript runs.

**Packaging:**

```bash
npm run package:deb       # .deb          — no extra tooling needed
npm run package:tar       # .tar.gz       — no extra tooling needed
npm run package:appimage  # .AppImage     — no extra tooling needed
npm run package:rpm       # .rpm          — needs rpmbuild   (apt install rpm)
npm run package:pacman    # .pacman       — needs bsdtar     (apt install libarchive-tools)
npm run package:flatpak   # .flatpak      — needs flatpak-builder and an installed runtime
npm run package:linux     # every target at once — fails unless all tools are present
```

Five of the six were built on Ubuntu 24.04 on 2026-07-31 and their payload was started from a
directory named exactly `ZimaOS Client`. Flatpak was not built: the builder is present, but no
runtime is installed. The missing tools are named on failure, not swallowed.

### Verification

```bash
npm run verify          # type-check · lint · tests · build · build gate · i18n gate · privacy gate
npm test                # 188 tests in 20 files (2026-08-01)
npm run verify:build    # reads the BUILT files: preload is CJS, sandbox on, CSP without unsafe-eval
npm run verify:i18n     # completeness, unknown keys, placeholder drift, "English copy" detection
npm run verify:privacy  # no LAN addresses, user names or e-mail addresses in tracked files
npm run verify:live     # reads against a real device, with the same parsers the IPC handlers use
```

Check the exit code, not the output: `npm run verify | tail` discards the gate's return value.

`ZIMA_VERIFY_STARTUP=<report.json>` starts the built application, asks the **running engine** for
applied CSS rules and computed styles, looks for visible raw i18n keys, and writes a screenshot
plus a JSON report. `ZIMA_VERIFY_SCENARIO=tour` clicks through all four screens and counts what
was actually rendered.

### Architecture

Electron 43 · React 19 · Vite 7 · electron-vite 5 · Tailwind 4 · zod 4 · TanStack Query ·
zustand · i18next · electron-log · Vitest 3 · TypeScript 5.9.

- **A hard process boundary**: renderer with `sandbox: true`, `contextIsolation: true`,
  `nodeIntegration: false`, a CSP without `unsafe-eval`, and every window opening decided
  explicitly.
- **A typed IPC contract** (`src/shared/contract.ts`): one zod schema per channel, answers always
  wrapped as `{ok:true,value} | {ok:false,error}`. No generic `invoke(channel)`.
- **`Result<T,E>` instead of exceptions**, with error kinds kept apart: `refused` ≠ `timeout` ≠
  `dns` ≠ `unexpected-status`.
- **The preload is CJS and dependency-free** — a sandboxed preload cannot load ESM, and the most
  privileged boundary of the app should not carry a validation library.
- **Envelope handling lives in the application code**, because a wrong password is HTTP **400** on
  this API, and 400 means "invalid path" on the files API. Reading only the status code would tell
  the user the device rejected a path.

```
src/
├── main/            # Electron main process
│   ├── app/         # startup, platform resilience, verification tooling
│   ├── devices/     # registry, ordering, priorities
│   ├── discovery/   # mDNS, straight off the wire format
│   ├── ipc/         # handlers, one per domain
│   ├── legacy/      # read-only import of the 0.9 configuration
│   ├── media/       # icon fetching with an explicit URL policy
│   ├── secrets/     # keyring, refresh token only
│   ├── tailscale/   # detection, read-only
│   ├── transport/   # probe, strategies
│   ├── zerotier/    # own daemon via systemd --user
│   └── zima/        # endpoints, envelopes, auth, JWT
├── preload/         # the CJS bridge
├── renderer/src/    # React UI: features/, i18n/, shared/, styles/
└── shared/          # contract, channels, result, domain types
```

### Development

```bash
npm test              # run tests
npm run test:watch    # watch mode
npm run lint          # ESLint
npm run type-check    # tsc, both projects
npm run format        # prettier
```

### License

MIT License — see LICENSE.

### Author

Holger Kühn

---

## Deutsch

### Übersicht

Der ZimaOS Client verbindet einen Linux-Desktop mit ZimaOS-Geräten — über das lokale Netz, eine
IP-Adresse oder eine Remote-ID. Er durchsucht Dateien, zeigt die Fotobibliothek, listet
installierte Apps und meldet den Zustand des Geräts.

Jede Aussage in der Dokumentation dieses Zweigs nennt das Kommando oder den Messwert dahinter. Wo
etwas **nicht** gemessen ist, steht das ausdrücklich dabei, statt fertig zu klingen.

### Was er kann

**Hinein — drei Wege, gleichrangig**

- **Lokales Netzwerk durchsuchen** — mDNS über `_zimaos._tcp` (Port 80, TXT `os=ZimaOS`), direkt
  am Drahtformat umgesetzt, ohne Fremdabhängigkeit.
- **Über IP-Adresse verbinden** — für Geräte, die der Suchlauf nicht erreicht.
- **Über Remote-ID verbinden** — die ZeroTier-Netzwerk-ID des Geräts. Beitreten, Adresse ableiten
  und Erreichbarkeit belegen passiert in einem Schritt; der ZeroTier-Teil ist Mechanik und kein
  Handgriff des Nutzers.

Jede Kandidatenadresse — gefunden, getippt oder abgeleitet — geht durch dieselbe Probe, und das
Ergebnis trägt eine gemessene Laufzeit. Scheitert es, kommt ein **benannter Grund** zurück statt
einer leeren Liste: „leer" liest sich wie „kein Gerät gefunden".

**Nach dem Verbinden**

- **Dateien** — navigieren, suchen, Ordner anlegen, hoch- und herunterladen, Übertragungsaufgaben,
  Papierkorb mit Wiederherstellen, angeheftete Ordner.
- **Fotos** — Galerie und Ordnerraster, Suche, Indexfortschritt des Geräts sowie ein
  Vordergrund-Backup lokaler Ordner. Es läuft nur bei offenem Fenster, sagt das auf dem Bildschirm,
  und listet jede übersprungene Datei mit Grund.
- **Apps** — installierte Apps mit eigenem Symbol, starten und stoppen, Weboberfläche öffnen.
- **Gerät** — Modell und Systemdaten, CPU-/Speicherauslastung, Datenträger, Power-Aktionen.
- **Mehrere Geräte** — Registry mit Priorität, Umschalten und Entfernen samt Sitzung.
- **Übernahme aus 0.9** — liest die Konfiguration des alten Clients **nur lesend**. Geheimnisse
  werden nicht übernommen: ein Passwort ungefragt zwischen Schlüsselbunden zu verschieben ist ein
  stiller Vertrauensbruch, also fragt v2 einmal danach.

**Drumherum**

- **28 Sprachen**, vollständig (je 280 Schlüssel). Geprüft sind nur `de_DE`, `en_US` und `en_GB`;
  die anderen 25 sind maschinell übersetzt und stehen im Sprachmenü mit dem Hinweis „ungeprüft".
- **Hell, dunkel oder dem System folgen** — drei Zustände statt eines Umschalters, damit „dem
  System folgen" erreichbar bleibt.
- **Zwei Layouts, eine Informationsarchitektur**: schwebende Pill unter 860 px, beschriftete
  Seitenleiste darüber — zwei Komponentenbäume, nicht dasselbe anders gestylt.
- **Tailscale wird erkannt, nie betrieben.** Läuft ein Tunnel, wird er benutzt. Nichts wird
  gestartet, gestoppt oder umkonfiguriert, kein DNS angefasst.

### Was er bewusst nicht tut

- **Keine Hintergrund-Synchronisation.** Das Foto-Backup läuft bei offenem Fenster und endet mit ihm.
- **Kein SMB/CIFS-Einbinden, keine geplanten Backup-Jobs.** Beides gab es in der 0.9-Linie und ist
  nicht Teil dieses Rewrites.
- **Keine automatische Aktualisierung.** Eine neue Fassung kommt als neues Paket.
- **Er reißt den Tunnel nicht an sich.** Siehe Tailscale oben.

### Installation

Es gibt Pakete **nur für x86_64** — kein arm64, kein Flatpak.

**Debian, Ubuntu, Linux Mint, Pop!\_OS:**

```bash
sudo apt install ./zima-linux-client_2.0.0-alpha.1_amd64.deb
```

**Fedora, openSUSE, RHEL-Abkömmlinge:**

```bash
sudo dnf install ./zima-linux-client-2.0.0-alpha.1.x86_64.rpm
```

**AppImage:**

```bash
chmod +x "ZimaOS Client-2.0.0-alpha.1.AppImage"
"./ZimaOS Client-2.0.0-alpha.1.AppImage"
```

Bequemer und mit Nachmessung: [`scripts/install.sh`](scripts/install.sh) sucht das Paket, das zur
Distribution passt, vergleicht die Prüfsumme, installiert mit dem richtigen Werkzeug — und prüft
danach, ob die Anwendung überhaupt starten kann. `--check` sieht nur nach, `--repair` behebt, was
behebbar ist, `--uninstall` entfernt.

Installiert wird nach `/opt/ZimaOS Client/`, Einstiegspunkt ist `/usr/bin/zima-linux-client`.

### Anforderungen

- **x86_64-Linux** mit Desktop-Sitzung. Auf problematischen DRM-Treibern startet sich der Client
  selbst unter X11 neu — gemessen an `vmwgfx`, wo Wayland in einem SIGSEGV endet.
- **Das `.deb` deklariert `libcap2-bin`** — das Post-Install-Skript braucht `setcap`.
- **Die AppImage ist Typ 2 und braucht FUSE 2.** Auf der Testmaschine lag `libfuse2t64` vor; ein
  System ohne FUSE 2 ist ungemessen.
- **ZeroTier bringt das Paket selbst mit** (`/opt/ZimaOS Client/resources/zerotier/<arch>/`) und
  erteilt ihm bei der Installation `CAP_NET_ADMIN`. Es wird **nichts** nachinstalliert, ein
  vorhandenes System-ZeroTier bleibt unangetastet, und die Anwendung fragt **nie** nach einem
  Passwort.
- **Ein Schlüsselbund wird erwartet, aber nicht vorausgesetzt.** Gespeichert wird nur der
  Refresh-Token, nie das Passwort. Fällt der Schlüsselbund auf Klartext zurück, warnt die
  Oberfläche, **bevor** etwas geschrieben wird.

### Aus Quellcode erstellen

Braucht **Node.js 22 oder neuer** (`engines.node: >=22`).

```bash
git clone https://github.com/chicohaager/zima-linux-client.git
cd zima-linux-client
git checkout v2
npm install

npm run dev          # Entwicklungsmodus
npm run dev:x11      # dasselbe, erzwungen auf X11 (siehe unten)
npm run build        # Typprüfung + Produktionsbau
```

`npm run dev` startet auch auf einem problematischen Treiber **nicht** auf X11 neu — das würde den
Vite-Dev-Server erschlagen, der der Elternprozess ist. Stattdessen stehen Grund und Kommando auf
stderr; `dev:x11` ist dieses Kommando. Nur argv zählt, weil Ozone seine Plattform wählt, bevor
irgendein JavaScript läuft.

**Paketieren:**

```bash
npm run package:deb       # .deb          — ohne Zusatzwerkzeug
npm run package:tar       # .tar.gz       — ohne Zusatzwerkzeug
npm run package:appimage  # .AppImage     — ohne Zusatzwerkzeug
npm run package:rpm       # .rpm          — braucht rpmbuild  (apt install rpm)
npm run package:pacman    # .pacman       — braucht bsdtar    (apt install libarchive-tools)
npm run package:flatpak   # .flatpak      — braucht flatpak-builder und eine installierte Runtime
npm run package:linux     # alle Ziele auf einmal — scheitert, solange ein Werkzeug fehlt
```

Fünf der sechs sind am 2026-07-31 auf Ubuntu 24.04 gebaut worden, und ihre Nutzlast wurde aus
einem Verzeichnis namens exakt `ZimaOS Client` gestartet. Flatpak ist **nicht** gebaut: der Builder
liegt vor, aber keine Runtime. Fehlende Werkzeuge werden beim Namen genannt, nicht verschluckt.

### Verifikation

```bash
npm run verify          # Typprüfung · Lint · Tests · Build · Build-Gate · i18n-Gate · Privacy-Gate
npm test                # 188 Tests in 20 Dateien (2026-08-01)
npm run verify:build    # liest die GEBAUTEN Dateien: Preload CJS, Sandbox an, CSP ohne unsafe-eval
npm run verify:i18n     # Vollständigkeit, unbekannte Schlüssel, Platzhalter, „englische Kopie"
npm run verify:privacy  # keine LAN-Adressen, Benutzernamen oder E-Mail-Adressen im Bestand
npm run verify:live     # liest gegen ein echtes Gerät, mit denselben Parsern wie die IPC-Handler
```

Den Exit-Code prüfen, nicht die Ausgabe: `npm run verify | tail` wirft den Rückgabewert des Gates weg.

`ZIMA_VERIFY_STARTUP=<report.json>` startet die gebaute Anwendung, fragt die **laufende Engine**
nach angewandten CSS-Regeln und berechneten Stilwerten, sucht sichtbare rohe i18n-Schlüssel und
legt Screenshot plus JSON-Report ab. `ZIMA_VERIFY_SCENARIO=tour` klickt alle vier Bildschirme durch
und zählt, was tatsächlich gerendert wurde.

### Architektur

Electron 43 · React 19 · Vite 7 · electron-vite 5 · Tailwind 4 · zod 4 · TanStack Query ·
zustand · i18next · electron-log · Vitest 3 · TypeScript 5.9.

- **Harte Prozessgrenze**: Renderer mit `sandbox: true`, `contextIsolation: true`,
  `nodeIntegration: false`, CSP ohne `unsafe-eval`, jede Fensteröffnung ausdrücklich entschieden.
- **Typisierter IPC-Kontrakt** (`src/shared/contract.ts`): ein zod-Schema je Kanal, Antworten immer
  als Hülle `{ok:true,value} | {ok:false,error}`. Kein generisches `invoke(channel)`.
- **`Result<T,E>` statt Ausnahmen**, mit unterschiedenen Fehlerarten: `refused` ≠ `timeout` ≠
  `dns` ≠ `unexpected-status`.
- **Das Preload ist CJS und abhängigkeitsfrei** — ein sandboxed Preload kann kein ESM laden, und an
  die privilegierteste Grenze der App gehört keine Validierungsbibliothek.
- **Die Hüllen-Auswertung liegt im Anwendungscode**, weil ein falsches Passwort auf dieser API
  HTTP **400** ist — und 400 auf der Files-API „ungültiger Pfad" heißt. Wer nur den Status liest,
  erzählt dem Nutzer, das Gerät habe einen Pfad abgelehnt.

```
src/
├── main/            # Electron-Hauptprozess
│   ├── app/         # Start, Plattform-Resilienz, Verifikationswerkzeug
│   ├── devices/     # Registry, Reihenfolge, Priorität
│   ├── discovery/   # mDNS, direkt am Drahtformat
│   ├── ipc/         # Handler, einer je Domäne
│   ├── legacy/      # nur lesende Übernahme der 0.9-Konfiguration
│   ├── media/       # Icon-Abruf mit ausdrücklicher URL-Richtlinie
│   ├── secrets/     # Schlüsselbund, nur Refresh-Token
│   ├── tailscale/   # Erkennung, nur lesend
│   ├── transport/   # Probe, Strategien
│   ├── zerotier/    # eigener Daemon über systemd --user
│   └── zima/        # Endpunkte, Hüllen, Auth, JWT
├── preload/         # die CJS-Brücke
├── renderer/src/    # React-Oberfläche: features/, i18n/, shared/, styles/
└── shared/          # Kontrakt, Kanäle, Result, Domänentypen
```

### Entwicklung

```bash
npm test              # Tests ausführen
npm run test:watch    # Watch-Modus
npm run lint          # ESLint
npm run type-check    # tsc, beide Projekte
npm run format        # prettier
```

### Screenshots

Die Bilder der 0.9-Linie zeigten eine Oberfläche, die es in diesem Zweig nicht mehr gibt
(SMB-Freigaben, Backup-Jobs, Einstellungsdialog) — sie sind deshalb hier entfernt worden. Neue
kommen mit dem Release; die Screenshots der Verifikationsläufe zeigen echte Geräte und bleiben
außerhalb des Repositorys.

### Lizenz

MIT-Lizenz — siehe LICENSE.

### Autor

Holger Kühn

### Links

- **Homepage**: https://www.zimaspace.com
- **Repository**: https://github.com/chicohaager/zima-linux-client
- **Issues**: https://github.com/chicohaager/zima-linux-client/issues
- **Releases**: https://github.com/chicohaager/zima-linux-client/releases

---

## ☕ Support

If this project saves you time, you can buy me a coffee — it keeps the side projects going.

<!-- bmc-button -->
[![Buy Me A Coffee](https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20coffee&emoji=%E2%98%95&slug=holgi18114&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff)](https://buymeacoffee.com/holgi18114)

… or scan the code:

<a href="https://buymeacoffee.com/holgi18114"><img src=".github/bmc-qr.png" alt="Buy Me a Coffee QR code" width="160"></a>
