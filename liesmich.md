# ZimaOS Client

Desktop-Client für ZimaOS unter Linux — Dateien, Fotos, Apps und Geräteverwaltung, mit ZeroTier
eingebaut und Tailscale genutzt, wenn es ohnehin schon läuft.

> **Das hier ist der Zweig `v2`: Fassung 2.0.0-alpha.4, ein Rewrite.**
> Das zuletzt **veröffentlichte** Paket ist
> [`v2.0.0-alpha.4`](https://github.com/chicohaager/zima-linux-client/releases/tag/v2.0.0-alpha.4).
> Das installierte Paket ist auf **neun Distributionen** gestartet worden (Ubuntu 22.04, 24.04
> und 26.04 LTS, Debian 12 und 13, Fedora 41 und 44, Arch, openSUSE Tumbleweed) — in Containern,
> unter Xvfb, nur x86_64.
> Auf einem **echten Desktop** ist er auf zwei Maschinen benutzt worden: Ubuntu 24.04 (GNOME auf
> Wayland) und **Zorin OS 18**, wo alpha.4 von Hand durchgegangen wurde — der Client startete ohne
> Sitzung und griff von sich aus nach nichts, **Verbinden** stellte die Sitzung aus dem
> gespeicherten Token ohne Passwortabfrage her, und Dateien, Fotos und Apps liefen über ZeroTier
> wie über Tailscale.
> Dazu kommt ein **Fremdbericht** (2026-08-11, ZimaSpace-Forum): ein Tester hat alpha.4 aus dem
> `.rpm` auf einer **Fedora-KDE-Plasma-Arbeitsstation** installiert und rund 15 Minuten benutzt —
> Start und angemeldeter Gerätezugriff liefen, gemeldet wurde eine Meldung im Fotos-Reiter
> ([V2-STATUS](docs/V2-STATUS.md#fremdbericht-fedora-kde)).
> Ein Forenbeitrag ist kein Messprotokoll: Fedora-Fassung, Sitzungsart, SELinux-Modus und
> Schlüsselbund stehen nicht darin.
> Was das **nicht** abdeckt: openSUSE und Arch auf echter Hardware, auf Fedora alles, was der
> Bericht nicht nennt — und damit weiterhin Wayland auf einem einzigen gemessenen Treiber, SELinux
> und jeden Schlüsselbund außer dem von GNOME.
> Die 0.9.x-Linie liegt auf `main` und unter [`legacy-0.9/`](legacy-0.9/); gelöscht wurde nichts.
>
> Was gebaut und was gemessen ist: [`docs/V2-STATUS.md`](docs/V2-STATUS.md)
> English version of this file: [`README.md`](README.md)
> Testerinnen und Tester bekommen ihre Hinweise und das Protokollformular direkt — die beiden
> Dateien liegen nicht in diesem Repository.

## Übersicht

Der ZimaOS Client verbindet einen Linux-Desktop mit ZimaOS-Geräten — über das lokale Netz, eine
IP-Adresse oder eine Remote-ID. Er durchsucht Dateien, zeigt die Fotobibliothek, listet
installierte Apps und meldet den Zustand des Geräts.

Jede Aussage in der Dokumentation dieses Zweigs nennt das Kommando oder den Messwert dahinter. Wo
etwas **nicht** gemessen ist, steht das ausdrücklich dabei, statt fertig zu klingen.

## Was er kann

### Hinein — drei Wege, gleichrangig

- **Lokales Netzwerk durchsuchen** — mDNS über `_zimaos._tcp` (Port 80, TXT `os=ZimaOS`), direkt
  am Drahtformat umgesetzt, ohne Fremdabhängigkeit.
- **Über IP-Adresse verbinden** — für Geräte, die der Suchlauf nicht erreicht.
- **Über Remote-ID verbinden** — die ZeroTier-Netzwerk-ID des Geräts. Beitreten, Adresse ableiten
  und Erreichbarkeit belegen passiert in einem Schritt; der ZeroTier-Teil ist Mechanik und kein
  Handgriff des Nutzers.

Jede Kandidatenadresse — gefunden, getippt oder abgeleitet — geht durch dieselbe Probe, und das
Ergebnis trägt eine gemessene Laufzeit. Scheitert es, kommt ein **benannter Grund** zurück statt
einer leeren Liste: „leer" liest sich wie „kein Gerät gefunden".

### Nach dem Verbinden

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

### Drumherum

- **28 Sprachen**, 292 Schlüssel in der Referenz. `en_US` und `de_DE` sind vollständig, die
  übrigen 26 stehen bei 287 — die fünf `apps.window.*`-Texte vom 2026-08-15 gibt es bislang nur
  in diesen beiden, sonst fällt die Oberfläche dort auf Englisch zurück; das i18n-Tor erlaubt das
  und **berichtet** es, statt es zu verdecken. Geprüft sind nur `de_DE`, `en_US` und `en_GB`;
  die anderen 25 sind maschinell übersetzt und stehen im Sprachmenü mit dem Hinweis „ungeprüft".
- **Hell, dunkel oder dem System folgen** — drei Zustände statt eines Umschalters, damit „dem
  System folgen" erreichbar bleibt.
- **Zwei Layouts, eine Informationsarchitektur**: schwebende Pill unter 860 px, beschriftete
  Seitenleiste darüber — zwei Komponentenbäume, nicht dasselbe anders gestylt.
- **Tailscale wird erkannt, nie betrieben.** Läuft ein Tunnel, wird er benutzt. Nichts wird
  gestartet, gestoppt oder umkonfiguriert, kein DNS angefasst.

## Was er bewusst nicht tut

- **Keine Hintergrund-Synchronisation.** Das Foto-Backup läuft bei offenem Fenster und endet mit ihm.
- **Kein SMB/CIFS-Einbinden, keine geplanten Backup-Jobs.** Beides gab es in der 0.9-Linie und ist
  nicht Teil dieses Rewrites.
- **Keine automatische Aktualisierung.** Eine neue Fassung kommt als neues Paket.
- **Er reißt den Tunnel nicht an sich.** Siehe Tailscale oben.
- **Er verbindet nicht von selbst.** Ein gespeichertes Gerät wird erreicht, wenn du auf
  **Verbinden** drückst, und vorher nicht — beim Start greift nichts nach einem Tunnel. Ein
  ZeroTier-Beitritt kostet einen Netzwerk-Beitritt, der das DNS der Maschine übernehmen kann,
  und eine gespeicherte Tailscale-Adresse zu benutzen setzt voraus, dass du diese Verbindung
  gerade oben haben willst. In welchem Netz du bist, entscheidest du.

## Installation

Ausgeliefert wird **nur x86_64** — kein arm64, kein Flatpak.

Ein arm64-`.deb` lässt sich bauen, installiert sauber auf aarch64, und das mitgelieferte
ZeroTier läuft dort (1.14.2, samt der Rechte, die das Post-Install erteilt). Es fehlt genau das
Entscheidende: Niemand hat die Anwendung auf arm64 **starten** sehen. Unter Emulation ist das
nicht zu zeigen — Chromiums Zygote scheitert in `qemu-user` an `clone` —, es braucht also echte
Hardware.

**Das ist entschieden, keine offene Aufgabe** (2026-08-15): arm64 bleibt unveröffentlicht, und
es arbeitet auch niemand darauf hin. Sollte je eine aarch64-Maschine danebenstehen, sind drei
der vier Fragen bereits beantwortet und nur der Start wäre noch zu zeigen.

Die Pakete liegen im
[**Pre-Release v2.0.0-alpha.4**](https://github.com/chicohaager/zima-linux-client/releases/tag/v2.0.0-alpha.4).
Hol dir den Installer, die Prüfsummen und das eine Paket für deine Distribution:

```bash
cd ~/Downloads
B=https://github.com/chicohaager/zima-linux-client/releases/download/v2.0.0-alpha.4

wget $B/install.sh $B/SHA256SUMS-2.0.0-alpha.4.txt          # immer diese beiden

wget $B/zima-linux-client_2.0.0-alpha.4_amd64.deb           # Debian, Ubuntu, Zorin, Mint, Pop!_OS
wget $B/zima-linux-client-2.0.0-alpha.4.x86_64.rpm          # Fedora, openSUSE, RHEL-Abkömmlinge
wget $B/zima-linux-client-2.0.0-alpha.4.pacman              # Arch, Manjaro

chmod +x install.sh && sudo ./install.sh
```

[`install.sh`](scripts/install.sh) vergleicht die Prüfsumme, sucht das Paket, das zur Distribution
passt, installiert mit dem richtigen Werkzeug — und **misst** danach, ob die Anwendung starten
kann: Registrierung, Ablage, Chromiums Sandkasten, `CAP_NET_ADMIN` für das mitgelieferte ZeroTier,
AppArmor-Profil. Gestartet wird nichts: eine Prüfung, die ein Fenster öffnet, ist keine Prüfung.
`--check` sieht nur nach und braucht kein sudo, `--repair` behebt, was behebbar ist, `--uninstall`
entfernt.

Von Hand stattdessen:

```bash
sha256sum -c SHA256SUMS-2.0.0-alpha.4.txt   # OK für die Datei, die du geladen hast

# Debian, Ubuntu, Zorin, Linux Mint, Pop!_OS — apt braucht einen absoluten Pfad oder ein ./
sudo apt install ~/Downloads/zima-linux-client_2.0.0-alpha.4_amd64.deb

# Fedora
sudo dnf install ./zima-linux-client-2.0.0-alpha.4.x86_64.rpm

# openSUSE — das Paket ist unsigniert, daher die zwei Schalter
sudo zypper --no-gpg-checks install --allow-unsigned-rpm ./zima-linux-client-2.0.0-alpha.4.x86_64.rpm

# Arch, Manjaro
sudo pacman -U ./zima-linux-client-2.0.0-alpha.4.pacman
```

**AppImage** — nichts wird installiert, keine der obigen Rechte wird gesetzt. GitHub ersetzt das
Leerzeichen im Dateinamen durch einen Punkt, sie kommt also so an:

```bash
chmod +x ZimaOS.Client-2.0.0-alpha.4.AppImage
./ZimaOS.Client-2.0.0-alpha.4.AppImage
```

Installiert wird nach `/opt/ZimaOS Client/`, Einstiegspunkt ist `/usr/bin/zima-linux-client`.

## Anforderungen

- **x86_64-Linux** mit Desktop-Sitzung. Auf problematischen DRM-Treibern startet sich der Client
  selbst unter X11 neu — gemessen an `vmwgfx`, wo Wayland in einem SIGSEGV endet.
- **Das `.deb` deklariert zwölf Abhängigkeiten** — die neun, die electron-builder per Default
  einträgt, dazu `libasound2t64 | libasound2` und `libgbm1` (Electron 43 braucht beide, die
  Standardliste nennt keine davon) und `libcap2-bin` für das `setcap` des Post-Install-Skripts.
- **Die AppImage ist Typ 2 und braucht FUSE 2.** Auf der Testmaschine lag `libfuse2t64` vor; ein
  System ohne FUSE 2 ist ungemessen.
- **ZeroTier bringt das Paket selbst mit** (`/opt/ZimaOS Client/resources/zerotier/<arch>/`) und
  erteilt ihm bei der Installation `CAP_NET_ADMIN`. Es wird **nichts** nachinstalliert, ein
  vorhandenes System-ZeroTier bleibt unangetastet, und die Anwendung fragt **nie** nach einem
  Passwort.
- **Ein Schlüsselbund wird erwartet, aber nicht vorausgesetzt.** Gespeichert wird nur der
  Refresh-Token, nie das Passwort. Fällt der Schlüsselbund auf Klartext zurück, warnt die
  Oberfläche, **bevor** etwas geschrieben wird.

## Aus Quellcode erstellen

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

### Paketieren

```bash
npm run package:deb       # .deb          — ohne Zusatzwerkzeug
npm run package:tar       # .tar.gz       — ohne Zusatzwerkzeug
npm run package:appimage  # .AppImage     — ohne Zusatzwerkzeug
npm run package:rpm       # .rpm          — braucht rpmbuild  (apt install rpm)
npm run package:pacman    # .pacman       — braucht bsdtar    (apt install libarchive-tools)
npm run package:flatpak   # .flatpak      — braucht flatpak-builder UND eine installierte Runtime
npm run package:linux     # die fünf Ziele oben auf einmal — Flatpak gehört nicht dazu
```

Die fünf sind auf Ubuntu 24.04 gebaut worden. Fehlende Werkzeuge werden beim Namen genannt, nicht
verschluckt.

deb, rpm und pacman werden von `scripts/distro-matrix.sh` auf **neun Distributionen installiert
und gestartet** — Ubuntu 22.04, 24.04 und 26.04 LTS, Debian 12 und 13, Fedora 41 und 44, Arch und
openSUSE Tumbleweed. Jede Zeile installiert das echte Artefakt in den echten Pfad
(`/opt/ZimaOS Client/`, Leerzeichen inklusive), startet es als gewöhnlicher Benutzer **mit
eingeschaltetem Sandkasten** und nimmt den Startbericht der App selbst als Beleg. Alle neun:
`ok=true`, 51 CSS-Regeln angewandt, kein roher Übersetzungsschlüssel auf dem Schirm, kein
Konsolenfehler.

Die jeweils neueste Ausgabe jeder Familie hat seit dem 2026-08-15 eine eigene Zeile. Vorher hörte
die Matrix bei Ubuntu 24.04, Debian 12 und Fedora 41 auf — allesamt abgelöst —, maß also
Distributionen, die niemand mehr neu installiert. Die meisten Desktops draußen sind Derivate
(Mint, Pop!_OS, Zorin, PikaOS); sie erben ihre Bibliotheken von einer Basis, deshalb deckt man sie
ab, indem man die **Basis**-Zeilen aktuell hält. Dort fällt auch ein Abhängigkeitsfehler auf:
`Depends: libasound2` löste überall auf und zog auf Ubuntu 24.04 statt der echten Bibliothek eine
OSS-Attrappe — sauber installiert, beim Start tot. Das sieht nur eine Zeile, die die App
**startet**.

**Flatpak steht mit Absicht nicht in der Standard-Zielliste.** Bis zum 2026-08-09 stand es darin,
und dort hat es Schaden angerichtet: `npm run package:linux` brach **an** Flatpak ab — nach
AppImage und tar.gz, vor deb, rpm und pacman. Zurück blieb ein `dist/`, das wie ein fertiger Bau
aussah und genau die drei Pakete nicht enthielt, die die Distro-Matrix braucht. Gelingen kann es
hier aus zwei Gründen nicht: es ist kein Flatpak-Remote eingerichtet, und electron-builder zielt
per Default auf die Runtime `20.08`, die von Flathub zurückgezogen wurde. `npm run package:flatpak`
bleibt für den Tag, an dem beides erledigt ist.

## Verifikation

```bash
npm run verify          # Typprüfung · Lint · Tests · Build · Build-Gate · i18n-Gate · Privacy-Gate
npm test                # 292 Tests in 34 Dateien (2026-08-11)
npm run test:e2e        # 5 End-to-End-Abläufe im echten Fenster, gegen das aufgezeichnete Gerät
npm run screenshots     # die Bilder unten, aus dem aktuellen Build
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

## Architektur

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

### Projektstruktur

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

## Entwicklung

```bash
npm test              # Tests ausführen
npm run test:watch    # Watch-Modus
npm run lint          # ESLint
npm run type-check    # tsc, beide Projekte
npm run format        # prettier
```

## Screenshots

Alle Bilder in [`docs/img/`](docs/img/) stammen aus dem echten Build, aufgenommen mit
`npm run screenshots` gegen dasselbe aufgezeichnete Gerät, das auch die End-to-End-Suite abspielt.
Nichts ist gestellt und nichts nachbearbeitet. Die Bildstrecke mit Bildunterschriften steht in der
[README](README.md#screenshots).

| Bild | Was darauf zu sehen ist |
| --- | --- |
| [`01-connect.png`](docs/img/01-connect.png) | Die drei Wege hinein, gleichrangig nebeneinander |
| [`02-device.png`](docs/img/02-device.png) | Gerätebildschirm, helles Thema |
| [`03-files.png`](docs/img/03-files.png) | Dateien: Volumes, Pfadleiste, Suche, Liste |
| [`04-photos.png`](docs/img/04-photos.png) | Fotos: Indexfortschritt, Suche, Sicherung im Vordergrund |
| [`05-apps.png`](docs/img/05-apps.png) | Apps mit eigenen Symbolen, Port und Zustand |
| [`06-dark.png`](docs/img/06-dark.png) | Derselbe Gerätebildschirm im dunklen Thema |
| [`07-narrow.png`](docs/img/07-narrow.png) | Schmales Fenster: Navigation als schwebende Pille |

Drei Dinge, die dabei zu wissen sind:

- **Das Gerät ist eine Aufzeichnung** (`e2e/fixtures/zimaos-session.json`, gewaschen von
  `e2e/scrub-fixture.mjs`): Datei- und Ordnernamen sind vollständig ersetzt, Adressen, E-Mail-
  Adressen und Tokens umgeschrieben. Deshalb heißen die Ordner `Ordner-1` und die Apps `App 223` —
  diese Bilder *können* niemandes echte Dateien zeigen, weil das einzige beteiligte Gerät keine hat.
- **Der rote Kasten stimmt, und er handelt vom Aufnahme-Rechner, nicht vom Programm.** Dort gibt es
  keinen Schlüsselbund, also würde Electron Zugangsdaten mit einem fest eingebauten Passwort
  ablegen — und der Client sagt das **vor** dem ersten Schreiben, statt still zu speichern. Auf
  einem Desktop mit funktionierendem Schlüsselbund steht an derselben Stelle „Zugangsdaten sind
  durch … geschützt".
- **Die Aufnahme läuft mit leerem Heimatverzeichnis und ohne Tailscale im PATH**, und ein Wächter
  weigert sich, ein Bild zu schreiben, auf dem eine andere Adresse als die abgespielte, ein Tailnet
  oder ein Heimatpfad steht. Das ist keine Gewohnheit des Nachschauens, sondern
  [`scripts/screenshot-guard.mjs`](scripts/screenshot-guard.mjs) mit eigenen Tests.

Der erste Lauf dieses Skripts hatte genau das nötig gemacht: er schrieb das echte Tailnet des
Autors ins erste Bild, samt drei Rechnernamen und ihren Adressen, und die Kachel „Vom alten Client
übernehmen" zeigte drei echte Pfade aus `~/.config`. Die Aufzeichnung deckt, was das **Gerät**
antwortet — nicht, was sonst noch auf demselben Bildschirm steht.

## Lizenz

MIT-Lizenz — siehe LICENSE.

## Autor

Holger Kühn

## Links

- **Homepage**: https://www.zimaspace.com
- **Repository**: https://github.com/chicohaager/zima-linux-client
- **Issues**: https://github.com/chicohaager/zima-linux-client/issues
- **Releases**: https://github.com/chicohaager/zima-linux-client/releases
