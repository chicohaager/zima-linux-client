# ZimaOS Client

Desktop-Client für ZimaOS unter Linux — Dateien, Fotos, Apps und Geräteverwaltung, mit
eingebautem ZeroTier und Tailscale, wenn es schon da ist.

> **Branch `v2` · Version 2.0.1 · aktuelles Release
> [`v2.0.1`](https://github.com/chicohaager/zima-linux-client/releases/tag/v2.0.1) (2026-08-31)**
> — eine Neuentwicklung des Clients. Die 0.9.x-Linie lebt auf `main` und unter
> [`legacy-0.9/`](legacy-0.9/); nichts wurde gelöscht.
>
> Was gebaut und was gemessen ist, mit dem Kommando hinter jeder Aussage:
> [`docs/V2-STATUS.md`](docs/V2-STATUS.md). English version of this file:
> [`README.md`](README.md).

Jede Aussage in der Dokumentation dieses Repositories nennt das Kommando oder die Messung dahinter.
Wo etwas ungemessen ist, steht das da — statt fertig zu klingen.

---

## Screenshots

Aufgenommen aus dem aktuellen Build mit `npm run screenshots` am 2026-09-17, gegen das
aufgezeichnete Gerät, das auch die End-to-End-Suite abspielt. Nichts ist gestellt und nichts
retuschiert — siehe [Zu diesen Bildern](#zu-diesen-bildern).

**Drei Wege hinein, gleichrangig** — Netz durchsuchen, Adresse eintippen oder eine Remote ID.

![Der Gerätebildschirm vor der Anmeldung: lokales Netzwerk durchsuchen, per IP-Adresse verbinden, per Remote ID verbinden](docs/img/01-connect.png)

**Gerät** — wer angemeldet ist, welcher Weg benutzt wird, wie lange die Sitzung gilt, und was
das Gerät kann.

![Der Gerätebildschirm: angemeldet über eine direkte IP, Sitzungsgültigkeit, erkannte Fähigkeiten, Modell und Systeminfo](docs/img/02-device.png)

**Dateien** — Volumes, Brotkrumen, Suche, Upload und Download, Papierkorb mit Wiederherstellen.

![Der Dateibildschirm mit Volumes, Brotkrumen, Suche, Werkzeugleiste und Ordnerliste](docs/img/03-files.png)

**Fotos** — die Bibliothek, der Indexierungsfortschritt des Geräts und eine Vordergrund-Sicherung
lokaler Ordner, die auf dem Bildschirm sagt, dass sie nur bei offenem Fenster läuft.

![Der Fotobildschirm: 104 von 104 indexiert, ein Suchfeld, das Foto-Backup-Panel und das Vorschaubild-Raster](docs/img/04-photos.png)

Die einfarbigen Kacheln sind kein Darstellungsfehler: das aufgezeichnete Gerät liefert
Platzhalter-Bytes, weil ein Fixture mit echten Fotos jemandes echte Fotos enthielte.

**Apps** — was installiert ist, mit eigenem Icon, Port und Zustand.

![Der App-Bildschirm mit App-Karten, jede mit Icon, Laufzustand, Port, Öffnen- und Stopp-Bedienelementen](docs/img/05-apps.png)

**Dunkles Thema** — hell, dunkel oder dem System folgen: drei Zustände, damit „dem System folgen"
erreichbar bleibt.

![Derselbe Gerätebildschirm im dunklen Thema](docs/img/06-dark.png)

**Schmales Fenster** — eine schwebende Pille unter 860 px, eine beschriftete Seitenleiste darüber.
Zwei Komponentenbäume, nicht einer umgestylt.

![Der Dateibildschirm in einem schmalen Fenster, mit der Navigation als schwebender Pille am unteren Rand](docs/img/07-narrow.png)

### Zu diesen Bildern

- **Das Gerät ist eine Aufzeichnung**, `e2e/fixtures/zimaos-session.json`, gewaschen von
  `e2e/scrub-fixture.mjs`: Datei- und Ordnernamen sind komplett ersetzt, Adressen,
  E-Mail-Adressen und Tokens umgeschrieben. Deshalb heißen die Ordner `Ordner-1` und die Apps
  `App 223` — diese Bilder können niemandes echte Dateien zeigen, weil das einzige beteiligte
  Gerät keine hat.
- **Die Aufnahme läuft mit leerem Home-Verzeichnis und ohne Tailscale im `PATH`**, und ein
  Wächter verweigert jedes Bild, das eine andere Adresse als die abgespielte, ein Tailnet oder
  einen Home-Pfad zeigt — [`scripts/screenshot-guard.mjs`](scripts/screenshot-guard.mjs), mit
  eigenen Tests.
- **Die Aufnahmemaschine hat keinen Schlüsselbund.** Der Client sagt das, bevor irgendetwas
  gespeichert wird, und fragt, was zu tun ist; die Bilder zeigen den Zustand nach der Antwort
  „jedes Mal fragen". Auf einem Desktop mit funktionierendem Schlüsselbund kommt die Frage nie.

---

## Was er kann

**Hinein — drei Wege, gleichrangig**

- **Lokales Netzwerk durchsuchen** — mDNS über `_zimaos._tcp`, direkt gegen das Drahtformat
  implementiert, ohne Fremdabhängigkeit.
- **Per IP-Adresse verbinden** — für Geräte, die die Suche nicht erreicht.
- **Per Remote ID verbinden** — die ZeroTier-Netzwerk-ID des Geräts. Netzwerk beitreten,
  Geräteadresse ableiten und anklopfen passiert in einem Schritt. Wer den WebUI-Port des Geräts
  von 80 wegverlegt hat, trägt ihn neben der Remote ID ein — über den Tunnel gibt es kein mDNS,
  aus dem er zu lesen wäre.

Das Schema wird nie aus dem Port geraten: ein Gerät auf Port 443 wird zuerst als reines HTTP
angesprochen, und nur die eigene Antwort des Geräts, dass der Port TLS spricht, schaltet auf
HTTPS um. Jede Kandidatenadresse geht durch dieselbe Sonde, und statt einer leeren Liste kommt
ein benannter Grund zurück.

**Nach dem Verbinden**

- **Dateien** — durchsuchen, suchen, Ordner anlegen, hoch- und herunterladen,
  Übertragungsaufgaben, Papierkorb mit Wiederherstellen, angeheftete Ordner.
- **Fotos** — Galerie und Ordnerraster, Suche, der Indexierungsfortschritt des Geräts und eine
  Vordergrund-Sicherung lokaler Ordner, die jede übersprungene Datei mit Grund auflistet.
- **Apps** — installierte Apps mit eigenen Icons, starten und stoppen, im Client oder im Browser
  öffnen.
- **Gerät** — Modell und Systeminfo, CPU-/Speicherauslastung, Volumes, Energieaktionen.
- **Mehrere Geräte** — ein Register mit Prioritäten, Wechsel und Vergessen eines Geräts samt
  Sitzung. Ein Gerät, das an einer Adresse auftaucht, die niemand gespeichert hat, wird erkannt
  und angeboten: „Ist das dein Gerät?"
- **Übernahme aus 0.9** — liest die Konfiguration des alten Clients nur lesend. Keine Geheimnisse
  werden übernommen; v2 fragt das Passwort stattdessen einmal ab.

**Drumherum**

- **28 Sprachen**, 295 Schlüssel. `en_US` und `de_DE` sind vollständig; die übrigen 26 stehen
  bei 290 und fallen für den Rest auf Englisch zurück, was das i18n-Tor berichtet statt versteckt.
  Nur `de_DE`, `en_US` und `en_GB` sind durchgesehen; die anderen sind maschinell übersetzt und im
  Sprachmenü als „ungeprüft" markiert.
- **ZeroTier wird mitgeliefert**, als eigenes Binary unter
  `/opt/ZimaOS Client/resources/zerotier/<arch>/`, bei der Installation mit `CAP_NET_ADMIN`
  ausgestattet. Nichts wird heruntergeladen, ein systemweites ZeroTier bleibt unangetastet.
- **Tailscale wird erkannt, nie betrieben.** Läuft ein Tunnel, wird er benutzt. Nichts wird
  gestartet, gestoppt oder umkonfiguriert, keine DNS-Einstellung angefasst.
- **Gespeichert wird nur das Refresh-Token, nie das Passwort** — im Schlüsselbund des Systems.
  Ohne Schlüsselbund fragt der Client, bevor er etwas schreibt, statt mit Electrons fest
  eingebautem Ersatzpasswort zu speichern.

## Was er bewusst nicht tut

- **Keine Hintergrund-Synchronisation.** Die Fotosicherung läuft bei offenem Fenster und endet mit
  ihm.
- **Kein SMB/CIFS-Einhängen und keine geplanten Sicherungsaufträge.** Beides gab es in der
  0.9-Linie; beides ist nicht Teil dieser Neuentwicklung.
- **Keine automatischen Updates.** Eine neue Version kommt als neues Paket.
- **Er übernimmt deinen Tunnel nicht**, und **er verbindet sich nicht von selbst**: ein
  gespeichertes Gerät wird erreicht, wenn du **Verbinden** drückst, nicht beim Start. In welchem
  Netz du bist, ist deine Entscheidung.

## Installation

Pakete gibt es **nur für x86_64** — kein arm64, kein Flatpak. (Ein arm64-`.deb` baut und
installiert, aber niemand hat die Anwendung auf arm64 starten sehen — unter Emulation lässt sich
das nicht zeigen. Das ist eine getroffene Entscheidung, keine offene Aufgabe.)

Die Pakete liegen im
[**Release v2.0.1**](https://github.com/chicohaager/zima-linux-client/releases/tag/v2.0.1).
Installer, Prüfsummen und das eine Paket für deine Distribution holen:

```bash
cd ~/Downloads
B=https://github.com/chicohaager/zima-linux-client/releases/download/v2.0.1

wget $B/install.sh $B/SHA256SUMS-2.0.1.txt          # immer diese beiden

wget $B/zima-linux-client_2.0.1_amd64.deb           # Debian, Ubuntu, Zorin, Mint, Pop!_OS
wget $B/zima-linux-client-2.0.1.x86_64.rpm          # Fedora, openSUSE, RHEL-Abkömmlinge
wget $B/zima-linux-client-2.0.1.pacman              # Arch, Manjaro

chmod +x install.sh && sudo ./install.sh
```

[`install.sh`](scripts/install.sh) vergleicht die Prüfsumme, wählt das zur Distribution
passende Paket, installiert es mit dem richtigen Werkzeug und **misst** danach, ob die Anwendung
starten kann — Registrierung, Ablageort, Chromiums Sandkasten, `CAP_NET_ADMIN` für das
mitgelieferte ZeroTier, AppArmor-Profil. Es startet nichts. `--check` prüft ohne Änderung und
braucht kein sudo, `--repair` behebt, was behebbar ist, `--uninstall` entfernt.

Von Hand stattdessen:

```bash
sha256sum -c SHA256SUMS-2.0.1.txt   # OK für die heruntergeladene Datei

# Debian, Ubuntu, Zorin, Linux Mint, Pop!_OS — apt braucht einen absoluten Pfad oder ./
sudo apt install ~/Downloads/zima-linux-client_2.0.1_amd64.deb

# Fedora
sudo dnf install ./zima-linux-client-2.0.1.x86_64.rpm

# openSUSE — das Paket ist unsigniert, daher die zwei Flags
sudo zypper --no-gpg-checks install --allow-unsigned-rpm ./zima-linux-client-2.0.1.x86_64.rpm

# Arch, Manjaro
sudo pacman -U ./zima-linux-client-2.0.1.pacman
```

**AppImage** — nichts wird installiert, keine der Rechte oben werden gesetzt. GitHub ersetzt das
Leerzeichen im Dateinamen durch einen Punkt, heruntergeladen heißt sie also:

```bash
chmod +x ZimaOS.Client-2.0.1.AppImage
./ZimaOS.Client-2.0.1.AppImage
```

Installiert wird nach `/opt/ZimaOS Client/`, mit `/usr/bin/zima-linux-client` als Einstieg.

## Anforderungen

- **x86_64-Linux** mit Desktop-Sitzung. Auf problematischen DRM-Treibern startet sich der Client
  unter X11 neu — gemessen auf `vmwgfx`, wo Wayland in SIGSEGV endet.
- **Das `.deb` deklariert zwölf Abhängigkeiten** — die neun, die electron-builder von sich aus
  nennt, plus `libasound2t64 | libasound2` und `libgbm1`, plus `libcap2-bin` für das `setcap` des
  Post-Install-Skripts.
- **Die AppImage ist Typ 2 und braucht FUSE 2** (`libfuse2t64` auf Ubuntu 24.04).
- **Ein Schlüsselbund wird erwartet, aber nicht verlangt** — siehe oben.

Die deb-, rpm- und pacman-Pakete von 2.0.0 wurden am 2026-08-15 von
[`scripts/distro-matrix.sh`](scripts/distro-matrix.sh) **auf neun Distributionen installiert und
gestartet** — Ubuntu 22.04, 24.04 und 26.04 LTS, Debian 12 und 13, Fedora 41 und 44, Arch und
openSUSE Tumbleweed — jeweils im echten Pfad, als gewöhnlicher Benutzer, mit Sandkasten. Auf
echten Desktops: Ubuntu 24.04 (GNOME auf Wayland), Zorin OS 18 und drei Fremdberichte (Fedora KDE,
PikaOS, Ubuntu), dokumentiert in [`docs/V2-STATUS.md`](docs/V2-STATUS.md).

## Aus Quellcode erstellen

Braucht **Node.js 22 oder neuer**.

```bash
git clone https://github.com/chicohaager/zima-linux-client.git
cd zima-linux-client
git checkout v2
npm install

npm run dev               # Entwicklungsmodus
npm run dev:x11           # dasselbe, erzwungen auf X11
npm run build             # Typprüfung + Produktions-Build

npm run package:deb       # .deb      — kein zusätzliches Werkzeug nötig
npm run package:rpm       # .rpm      — braucht rpmbuild   (apt install rpm)
npm run package:pacman    # .pacman   — braucht bsdtar     (apt install libarchive-tools)
npm run package:appimage  # .AppImage
npm run package:tar       # .tar.gz
npm run package:linux     # die fünf oben auf einmal
```

## Verifikation

```bash
npm run verify          # Typprüfung · Lint · Tests · Build · Build-Tor · i18n-Tor · Privacy-Tor
npm test                # 360 Tests in 45 Dateien (2026-09-17)
npm run test:e2e        # 5 End-to-End-Abläufe im echten Fenster, gegen das aufgezeichnete Gerät
npm run screenshots     # die Bilder oben, aus dem aktuellen Build
npm run verify:build    # liest die GEBAUTEN Dateien: Preload ist CJS, Sandkasten an, CSP ohne unsafe-eval
npm run verify:i18n     # Vollständigkeit, unbekannte Schlüssel, Platzhalter-Drift, „englische Kopie"
npm run verify:privacy  # keine LAN-Adressen, Benutzernamen oder E-Mail-Adressen in verfolgten Dateien
npm run verify:live     # liest gegen ein echtes Gerät, mit denselben Parsern wie die IPC-Handler
npm run verify:release  # sind die dist/-Artefakte der Build dieses Commits? — plus offene Issues/PRs
```

Den Exit-Code prüfen, nicht die Ausgabe: `npm run verify | tail` verwirft den Rückgabewert des Tors.

## Architektur

Electron 43 · React 19 · Vite 7 · electron-vite 5 · Tailwind 4 · zod 4 · TanStack Query ·
zustand · i18next · electron-log · Vitest 3 · TypeScript 5.9.

- **Eine harte Prozessgrenze**: Renderer mit `sandbox: true`, `contextIsolation: true`,
  `nodeIntegration: false`, CSP ohne `unsafe-eval`, jedes Fensteröffnen ausdrücklich entschieden.
- **Ein typisierter IPC-Vertrag** (`src/shared/contract.ts`): ein zod-Schema je Kanal, Antworten
  immer als `{ok:true,value} | {ok:false,error}`.
- **`Result<T,E>` statt Ausnahmen**, mit getrennten Fehlerarten: `refused` ≠ `timeout` ≠ `dns` ≠
  `unexpected-status`.
- **Der Preload ist CJS und abhängigkeitsfrei** — ein sandboxter Preload kann kein ESM laden.

```
src/
├── main/            # Electron-Hauptprozess: devices, discovery (mDNS), ipc, legacy-Import,
│                    # media, secrets, tailscale (nur lesend), transport, zerotier, zima (API)
├── preload/         # die CJS-Brücke
├── renderer/src/    # React-Oberfläche: features/, i18n/, shared/, styles/
└── shared/          # Vertrag, Kanäle, Result, Domänentypen
```

## Lizenz

MIT-Lizenz — siehe LICENSE.

## Autor

Holger Kühn

## Links

- **Repository**: https://github.com/chicohaager/zima-linux-client
- **Issues**: https://github.com/chicohaager/zima-linux-client/issues
- **Releases**: https://github.com/chicohaager/zima-linux-client/releases
- **ZimaOS**: https://www.zimaspace.com

---

## ☕ Unterstützung

Wenn dir dieses Projekt Zeit spart, kannst du mir einen Kaffee ausgeben — das hält die
Nebenprojekte am Laufen.

<!-- bmc-button -->
[![Buy Me A Coffee](https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20coffee&emoji=%E2%98%95&slug=holgi18114&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff)](https://buymeacoffee.com/holgi18114)

… oder den Code scannen:

<a href="https://buymeacoffee.com/holgi18114"><img src=".github/bmc-qr.png" alt="Buy-Me-a-Coffee-QR-Code" width="160"></a>
