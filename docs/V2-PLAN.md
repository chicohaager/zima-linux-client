# ZimaOS Linux Client v2 — Refactoring-Plan

**Stand:** 2026-07-30 · **Zielversion:** 2.0.0 · **Status:** Entwurf zur Freigabe

Ziel: ein Linux-Client mit **denselben Kernfunktionen wie der Zima Client für Android/iOS**
und einer erkennbar verwandten Oberfläche — lauffähig auf möglichst vielen Linux-Derivaten.

> **Lesehinweis zur Beweislage.** Jede technische Aussage in diesem Dokument ist entweder
> gemessen (dann steht dabei *woran*) oder als **Annahme** gekennzeichnet. Endpunkte, Versionen
> und Paketziele wurden an zwei ZimaOS-Hosts (beide `VERSION="v1.7.0"`, `BOARD="ZimaCube"`) bzw.
> an den echten Upstream-Paketen abgelesen, nicht aus Erinnerung geschrieben.
> Was ich nicht belegen konnte, steht in § 14 „Offene Punkte" — nicht plausibel gefüllt.

---

## 1. Bestandsaufnahme — warum „outdated" zutrifft

Gemessen am geklonten Repo (`git log`: 52 Commits, letzter 2026-07-26, `package.json`-Version 0.9.23):

| Baustein | im Repo | aktuell verfügbar | Delta |
| --- | --- | --- | --- |
| Electron | `^28.2.0` | `43.2.0` | 15 Major-Versionen; 28.x ist außerhalb des Support-Fensters |
| React | `^18.2.0` | `19.2.8` | 1 Major |
| Bundler | webpack 5 + 3 Configs | Vite `8.1.5` / electron-vite `5.0.0` | Build-Kette komplett ersetzbar |
| Tailwind | `^3.4.1` | `4.3.3` | 1 Major (neue Engine, CSS-first Config) |
| Tests | Jest `^30` | Vitest (Vite-nativ) | Doppelte Toolchain vermeidbar |
| electron-builder | `^24.9.1` | `26.15.3` | 2 Major |
| Credential-Store | `keytar ^7.9.0` | — | **unmaintained**: `atom/node-keytar` ist auf GitHub *archived*, letzter Push **2022-12-12** |
| Sprachen | 2 (`de.json`, `en.json`) | Ziel 29 | 27 fehlen |

**Codegröße:** 10 518 Zeilen TS/TSX. Die drei größten Dateien (`Backup.tsx` 945,
`backup/manager.ts` 943, `ipc/handlers.ts` 838) sind God-Modules — Hauptursache dafür, dass
Features nicht ohne Seiteneffekte wachsen können.

**Funktionaler Abstand zum Mobile-Client:** es fehlen **Photos**, **File Hub** (Suche, Preview,
Dateiaktionen), **Multi-Device-Management** (Priorität, Restart/Shutdown/Remove) und der
Offline-Cache für Apps. Vorhanden sind Connect/ZeroTier, SMB-Mounts, Apps-Liste, Backup-Jobs.

### 1.1 Drei konkrete Fehlerbilder, die der Rewrite mit-erledigt

1. **Stiller Default beim Netzwerkscan.** `src/main/zerotier/network.ts:147`:
   `async scanLocalNetwork(subnet: string = '192.168.1')`. Schlägt die Subnetz-Ermittlung fehl,
   wird stumm ein fremdes Subnetz gescannt und „keine Geräte gefunden" gemeldet — ein falsches
   Negativ, das wie ein Netzwerkproblem aussieht. → v2: **kein Default**, laut scheitern mit dem
   Namen des Interfaces, das nicht ermittelbar war.
2. **Pauschale Startflags.** Das `.desktop`-File wird beim Install mit
   `--no-sandbox --disable-gpu` gepatcht (Commit `22ddb3c`) — für *alle* Nutzer, auch die, deren
   System beides nicht braucht. → v2: Flags erst nach gemessenem Bedarf, pro Distro dokumentiert
   (§ 4.3).
3. **31 MB vendored Binaries** (`bin/zerotier/{x64,arm64}/zerotier-one`) im Git; `.git` ist
   48 MB. → v2: Bezug zur Buildzeit mit Prüfsumme, plus Vorrang für ein systemseitig
   installiertes `zerotier-one` (§ 7.3).

**Privatdaten-Prüfung des Repos** (Projektregel „Weitergebbares enthält keine privaten Daten"):
ein `grep` über RFC-1918-Adressbereiche, Maintainer-Kennungen und private Domains liefert
21 Treffer — **alle unkritisch**: generische Beispiele (`192.168.1.100`), ZeroTier-Bereich
`10.147.14.x`, Test-Fixtures, der öffentliche BuyMeACoffee-Slug und die bewusst öffentliche
Maintainer-Adresse. Keine private Adresse und kein Host aus einem echten Heimnetz im Repo.
Diese Prüfung wird in v2 als CI-Gate verdrahtet (Suchmuster im CI-Skript, nicht in der Doku).

---

## 2. Feature-Parität — Soll-Matrix

Quelle der Anforderung: die von dir genannte Funktionsliste des Zima Client (Android/iOS teilen
laut Release-Notes dieselben Kernfunktionen). Der offizielle Client existiert für
macOS/Windows/Android/iOS — **nicht für Linux**; diese Lücke füllt dieses Projekt.

| # | Feature (Mobile) | v2-Umsetzung Linux | ZimaOS-Schnittstelle (gemessen) |
| --- | --- | --- | --- |
| 1 | Neues UI + Dark Mode | Design-System aus den ZimaOS-Tokens, System-/Manuell-Theme | — (§ 8) |
| 2 | Photos: Browsing **(Pflicht)** | Galerie-Grid, Facetten, Suche, Detail-Viewer | `/v2/photos/gallery/stream`, `/gallery/facets`, `/search`, `/thumbnail`, `/progress` |
| 3 | Photos: Vordergrund-Backup **(Pflicht)** | Upload-Queue nur bei offenem Fenster, kein Daemon | Files-Upload (§ 6.3) |
| 4 | File Hub: Suche | Serverseitige Suche mit Pfad-Scope | `/v2_1/files/file/search` |
| 5 | File Hub: Preview | Bild/Video-Poster/Text/PDF | `/thumbnail`, `/file/video/generate/image`, `/file/download` |
| 6 | File Hub: Dateiaktionen | Kopieren, Verschieben, Duplizieren, Entpacken, Löschen, Umbenennen, Teilen, Pin | `/task/{copy,cut,duplicate,decompress,import,migrate,retry}`, `/task/{id}`, `/trash`, `/share/link`, `/pin` |
| 7 | Verbindung: lokaler Scan | Discovery + Subnetz-Probe, gemessene Erreichbarkeit | § 6.2 |
| 8 | Verbindung: Direct IP | Host/Port-Eingabe mit Validierung | `/v1/users/login` |
| 9 | Verbindung: Remote ID | ZeroTier-Join, dann ZT-Adresse | `/v1/zt/info`, `/v1/zt/status` + lokaler `zerotier-one` |
| 10 | Multi-Device: Switching | Geräte-Registry, Umschalten ohne Neustart | § 7.1 |
| 11 | Multi-Device: Priorität | Sortierbare Adress-/Strategie-Priorität pro Gerät | § 6.2 |
| 12 | Multi-Device: Restart/Shutdown | Zwei Aktionen mit Bestätigungsdialog | `setSystemState("restart")` / `setSystemState("off")` → `/v2/zimaos/sys/state/{state}` |
| 13 | Multi-Device: Remove | Gerät + Credentials entfernen | lokal |
| 14 | Apps: Web App | App-WebUI im Client öffnen (eigenes Fenster) oder extern | `/v2/app_management/myapps`, `/v1/apps` |
| 15 | Apps: Liste | Kacheln mit Status, Icon, Port | dito |
| 16 | Apps: Offline-Cache | Letzte Liste + Icons lokal, sichtbar als „Stand von …" | lokal (§ 7.4) |
| 17 | 29 Sprachen | 28 belegt, 1 offen | § 9 |
| 18 | Sub-Account-Login | Login mit Nicht-Admin-Konto | `/v1/users/login` (Rolle aus JWT) |

Zusätzlich **erhalten** (Linux-Alleinstellung, im Mobile-Client nicht vorhanden):
SMB/CIFS-Mounts in den Dateimanager, geplante Backup-Jobs, ZeroTier-Diagnose.

---

## 3. Stack-Entscheidung

**Gewählt: Electron 43 + React 19 + TypeScript + Vite 8 (electron-vite) + Tailwind 4.**

### 3.1 Warum Electron und nicht Tauri

Der Ausschlag ist deine Vorgabe „lauffähig auf möglichst allen Linux-Derivaten":

* Electron **bringt Chromium mit**. Laut `README.md` des Tags `v43.2.0`: gebaut auf Ubuntu 22.04,
  verifiziert auf *„Ubuntu 18.04 and newer, Fedora 32 and newer, Debian 10 and newer"*. Ein
  Artefakt, viele Distros.
* Tauri rendert über das **systemseitige** `webkit2gtk` (4.0 vs. 4.1 je Distro-Generation). Die
  Abdeckung hängt damit an einer Bibliothek, die der Nutzer nicht kontrolliert — genau der
  Portabilitätsrisiko-Typ, den du ausschließen willst. *(Annahme: kein eigener Messwert, aber
  eine Eigenschaft der Architektur, nicht der Version.)*
* Der vorhandene Code ist TypeScript/React; ZeroTier-Bundling, SMB-Mounts, Sanitizer und Logger
  sind übernehmbar. Ein Sprachwechsel würde ~10 kLOC Erfahrungswerte wegwerfen.

Preis: Artefaktgröße (~100 MB je Paket) und glibc-Bindung (kein musl/Alpine). Beides akzeptiert
und in § 4 dokumentiert.

### 3.2 Abhängigkeiten (Zielstand, Versionen am 2026-07-30 von npm abgelesen)

| Zweck | Paket | Version |
| --- | --- | --- |
| Runtime | `electron` | 43.2.0 |
| UI | `react` / `react-dom` | 19.2.8 |
| Build | `electron-vite` / `vite` | 5.0.0 / 8.1.5 |
| Packaging | `electron-builder` | 26.15.3 |
| Styling | `tailwindcss` | 4.3.3 |
| Client-State | `zustand` | 5.x |
| Server-State/Cache | `@tanstack/react-query` | 5.x — liefert Retry, Stale-Handling und den Offline-Cache für Apps/Files |
| Schema/Kontrakt | `zod` | 4.x — ein Schema für IPC **und** API-Antworten |
| i18n | `i18next` + `react-i18next` | vorhanden, bleibt |
| Unit-Tests | `vitest` + `@testing-library/react` | ersetzt Jest |
| E2E | `@playwright/test` | Electron-Support, deutsche Locale |
| Lint | `eslint` 9 (flat) + `prettier` | ersetzt `.eslintrc.json` |

**Entfällt:** `keytar` (archiviert, s. § 1) → Electron-eigenes `safeStorage` (§ 10.2).
Nebeneffekt: eine Native-Dependency weniger, also ein Portabilitätsrisiko weniger.

---

## 4. Linux-Abdeckung — Paket-Matrix

**Belegte Zielformate.** Abgelesen an `app-builder-lib@26.15.3`,
`out/options/linuxOptions.d.ts:31`: *„Target package type: list of `AppImage`, `flatpak`, `snap`,
`deb`, `rpm`, `freebsd`, `pacman`, `p5p`, `apk`, `7z`, `zip`, `tar.xz`, `tar.lz`, `tar.gz`,
`tar.bz2`, `dir`."*

| Format | deckt ab | Priorität |
| --- | --- | --- |
| **Flatpak** | jede Distro mit Flatpak, inkl. unveränderliche Systeme (Silverblue, SteamOS, Bazzite) — die eigentliche Antwort auf „alle Derivate" | **P0** |
| **AppImage** | ältere/exotische Systeme ohne Paketquelle | **P0** |
| **deb** | Debian/Ubuntu/Mint/Pop/Zorin/MX | **P0** |
| **rpm** | Fedora/RHEL/openSUSE | **P0** |
| **pacman** | Arch/Manjaro/EndeavourOS | P1 |
| **tar.gz** | Fallback für alles Übrige, auch ohne Root | P1 |
| **snap** | Ubuntu-Store-Nutzer | P2 (optional) |
| AUR-`PKGBUILD` | Arch-Idiomatik (baut aus dem tar.gz) | P2 |

**Architekturen:** `x64` und `arm64` für alle P0-Formate (der Alt-Build liefert
`extraResources` nur für `bin/zerotier/x64` — arm64-Binary liegt im Repo, wird aber nicht
mitverpackt; in v2 behoben).

### 4.1 Was „lauffähig" heißen muss

Ein grüner Build ist **kein** Beleg für Lauffähigkeit. Akzeptanzkriterium:
**das Artefakt startet und rendert** — geprüft je Distro in einem Container mit Xvfb, mit einem
Screenshot und dem Renderer-Konsolenlog als Beleg (§ 11.4). Distro-Matrix: Ubuntu 22.04/24.04,
Debian 12/13, Fedora 41/42, Arch (rolling), openSUSE Tumbleweed — plus ein Flatpak-Run auf
Fedora Silverblue.

### 4.2 Wayland / X11

Ein `--ozone-platform-hint=auto` als Standard-Argument, damit unter Wayland nativ und unter X11
per XWayland gerendert wird. Beleg pro Session-Typ: `WAYLAND_DISPLAY` gesetzt/ungesetzt, dazu
Screenshot. Kein pauschales Erzwingen.

### 4.3 Sandbox, GPU und Wayland — gemessen, nicht pauschal

Der Alt-Client patcht `--no-sandbox --disable-gpu` in die `.desktop`-Datei — für alle Nutzer.
**Gemessen am 2026-07-30 hätte das den echten Fehler nicht behoben.**

Auf einer GNOME-**Wayland**-Sitzung mit virtueller **VMware-SVGA-II**-GPU stirbt Electron 43.2.0
vor dem ersten Bild mit **SIGSEGV** im GPU-Prozess (Log: `Preferred drm_render_node not found,
picking vmwgfx`). Sechs Varianten durchgemessen:

| Start | Ergebnis |
| --- | --- |
| ohne Flags | SIGSEGV |
| `--disable-gpu` | SIGSEGV |
| `--no-sandbox` | SIGSEGV |
| `--disable-gpu-compositing` | SIGSEGV |
| `--ozone-platform-hint=auto` | SIGSEGV |
| **`--ozone-platform=x11`** | **startet und rendert** |

Es ist also der **Wayland/Ozone-Pfad**, nicht GPU und nicht Sandbox — die beiden Alt-Flags zielen
auf die falsche Ursache. **Geltungsbereich der Messung:** eine VM mit virtueller GPU. Ob echte
Hardware betroffen ist, ist **nicht** gemessen; deshalb wird X11 **nicht** pauschal erzwungen.

**Umsetzung (`src/main/app/resilientPlatform.ts`), dreistufig:**

1. **Treiber vorab lesen.** Ist der DRM-Treiber von `card0` einer der bekannten virtuellen
   (`vmwgfx` gemessen; `vboxvideo`, `qxl` vorsorglich, als solche gekennzeichnet) **und** läuft
   Wayland → sofort auf X11 neu starten. Damit stürzt auch der **erste** Start nicht ab.
2. **Sonst: Absturz einmal erkennen.** Ein Sentinel markiert „Start begonnen, erstes Bild nie
   erreicht". Wird er beim nächsten Start gefunden, gilt Wayland auf dieser Maschine als defekt.
3. **Urteil merken**, je Electron-Version — sonst würde **jeder** Kaltstart einmal abstürzen.
   Das war die erste Fassung dieses Codes und war messbar falsch. Nach einem Electron-Upgrade
   bekommt Wayland wieder eine Chance.

🔴 **Ein technischer Fund, der Zeit spart:** `app.commandLine.appendSwitch('ozone-platform','x11')`
**wirkt nicht**. Das Log meldete `forcedX11: true` und der Prozess stürzte trotzdem ab — Ozone liest
`argv` beim Prozessstart, lange vor dem ersten JavaScript. Die Plattform lässt sich nur über einen
**Neustart mit dem Flag in argv** wechseln (`app.relaunch`). Auch das ist gemessen, nicht vermutet.

Jeder Fallback wird **geloggt** und ist im UI anzeigbar; ein stiller Fallback würde den Defekt
verstecken statt ihn harmlos zu machen. Belegter Endstand: zwei Kaltstarts hintereinander, ohne
jedes Flag, **beide gestartet**, `failures: []`.

Der AppImage-Sandbox-Fall (fehlende User-Namespaces bzw. FUSE2) wird in der Installationsanleitung
mit `--appimage-extract-and-run` bzw. dem Flatpak-Weg beantwortet, nicht durch pauschales
Abschalten der Sandbox.

---

## 5. Architektur

Feature-Sliced, mit strikter Prozess-Grenze. Renderer hat **kein** Node-Integration,
alles Privilegierte liegt im Main-Prozess hinter einem typisierten IPC-Kontrakt.

```
src/
  shared/                     # von main, preload UND renderer importierbar
    contract/                 # zod-Schemas je IPC-Kanal  ← einzige Wahrheit für Payloads
    domain/                   # reine Typen: Device, ZimaFile, Photo, AppTile, Capability
    result.ts                 # Result<T,E> — Fehler sind Werte, kein stilles catch

  main/
    app/                      # Lifecycle, Fenster, Single-Instance, Deep-Links
    ipc/                      # Handler-Registrierung: ein Modul je Feature, dünn
    zima/
      client.ts               # HTTP-Client: Basis-URL, Auth-Header, Retry, Timeouts
      auth.ts                 # Login, Refresh, Token-Lebenszyklus
      capabilities.ts         # Routentabelle → Capability-Set  (§ 6.1)
      files.ts photos.ts apps.ts system.ts users.ts
      endpoints.ts            # Pfad-Konstanten, jede mit Verifikations-Kommentar
    transport/
      strategy.ts             # LAN | DirectIP | RemoteID, priorisiert, gemessen
      probe.ts                # Erreichbarkeit messen: refused ≠ timeout ≠ ok
    discovery/                # Netzwerk-Discovery + Subnetz-Probe
    zerotier/                 # Prozess-Lifecycle (übernommen, entschlackt)
    secrets/                  # safeStorage + Backend-Warnung  (§ 10.2)
    transfer/                 # Upload-/Download-Queue: Fortschritt, Abbruch, Resume
    smb/  backup/  updater/  logging/

  preload/                    # contextBridge, nur die Kanäle aus shared/contract

  renderer/
    app/                      # Router, Provider, Theme, ErrorBoundary
    features/
      connect/ devices/ photos/ files/ apps/ settings/
    shared/ui/                # Design-System-Komponenten
    shared/lib/
    i18n/locales/*.json       # 28 Sprachen
```

**Regeln, die Reviews durchsetzen (ESLint-Boundaries):**

* `renderer/**` darf `main/**` nicht importieren und umgekehrt — nur `shared/**`.
* Ein Feature importiert **nicht** aus einem anderen Feature; Gemeinsames wandert nach `shared`.
* Kein `any` (`@typescript-eslint/no-explicit-any: error`), `strict: true`, `noUncheckedIndexedAccess`.
* **Kein stiller Fehler:** ESLint-Regel gegen leere `catch`-Blöcke und gegen
  `catch { return [] }`. Jeder Fehlerpfad liefert ein `Result.err` mit Ursache, wird geloggt und
  im UI sichtbar (Projektregel „Fehler laut machen").
* Dateiobergrenze 300 Zeilen als Lint-Warnung — gegen die Rückkehr der God-Modules.

**IPC-Kontrakt.** Ein Kanal = ein zod-Schema für Request und Response, in `shared/contract`.
Main validiert Eingaben, Renderer parst Antworten. Ein Tippfehler im Kanalnamen ist damit ein
Compile-Fehler, kein Laufzeit-Rätsel.

---

## 6. ZimaOS-Anbindung

### 6.1 Kein hartverdrahteter Port, kein geratener Endpunkt

Zwei Regeln aus der Wissensbasis, die die Architektur bestimmen:

* **Dienstports sind flüchtig** (KB § 38). ZimaOS-Dienste lassen sich vom Kernel einen Port
  geben und melden ihn beim Gateway an. Der Client spricht deshalb **ausschließlich** über das
  Gateway (`http://<host>/…`), niemals über einen Backend-Port.
* **Die Fläche wird gemessen, nicht geraten.** Grundlage sind die Gateway-Routentabelle
  (`GET /v1/gateway/routes`, keine Auth nötig) und die Pfade, die die **Weboberfläche selbst**
  benutzt — abgelesen aus ihrem JS-Bundle. Damit geht der Client durch dieselbe Tür wie der
  Nutzer.

**Gemessen (2026-07-30, zwei Hosts, beide v1.7.0):** 35 bzw. 38 registrierte Routen.
Relevant: `/v1/users`, `/v1/sys`, `/v1/zt`, `/v1/apps`, `/v2/app_management`, `/v2/zimaos`,
`/v2/dashboard`, `/v2/local_storage`, `/v2/backup`, `/v2_1/files`, `/v2/share`, `/v2/trash`,
`/v2/pin`, `/v2/folder`, `/v2/filedrop`, `/v3/app_store`, `/.well-known/jwks.json`.

🔴 **Befund mit Folgen für den Plan: Photos ist optional.** `/v2/photos` war auf **einem** der
beiden Hosts registriert, auf dem anderen **nicht** — bei identischer OS-Version. Auf dem Host
ohne Route existiert `/usr/bin/zimaos-photos` nicht (`systemctl is-enabled zimaos-photos` →
`not-found`). Konsequenz: **Capability-Detection ist Pflicht.** Beim Verbinden liest der Client
die Routentabelle und leitet daraus ein `Capabilities`-Set ab. Fehlt Photos, zeigt der Client
einen erklärten Zustand („Photos-Modul auf diesem Gerät nicht registriert") — **keine leere
Galerie**, denn eine leere Galerie sieht aus wie „keine Fotos" und schickt den Nutzer auf die
falsche Fährte.

`endpoints.ts` trägt zu jeder Konstante einen Kommentar der Form
`// verifiziert 2026-07-30, v1.7.0, GET → 200` — und ein Skript (§ 11.3) prüft diese Behauptungen
gegen ein echtes Gerät nach.

### 6.2 Verbindungsstrategien

Drei Wege, gemeinsame Schnittstelle, **priorisiert und gemessen**:

1. **Lokaler Scan** — mDNS/DNS-SD, dann Kandidaten-Probe. **Gemessen (2026-07-30, beide Seiten):**
   ZimaOS betreibt `avahi-daemon` (Port 5353 gebunden) und kündigt über
   `/etc/avahi/services/zimaos.service` den Servicetyp **`_zimaos._tcp` auf Port 80** an, mit
   `<name replace-wildcards="yes">%h</name>` (Instanzname = Hostname) und dem TXT-Record
   **`os=ZimaOS`**. Gegenprobe von der Netzseite (rohe PTR-Abfrage auf `224.0.0.251:5353` nach
   `_zimaos._tcp.local`): **2 Antworten**, Instanzen `ZimaOS` und `ZimaOS-2`, SRV-Port `0x0050`
   = 80, TXT `os=ZimaOS`. Die Konfigurationsdatei allein wäre kein Beleg gewesen — deshalb beide
   Messungen. Nebenbei angekündigt: `_smb._tcp`, `_sftp-ssh._tcp`, `_ssh._tcp`, `_device-info._tcp`
   (nutzbar, um die SMB-Fähigkeit ohne Login zu erkennen).
   Fallback, wenn mDNS im Netz geblockt ist: Probe des ermittelten /24 mit begrenzter
   Parallelität — **ohne** Default-Subnetz (§ 1.1).
2. **Direct IP** — Host (+ optional Port), Validierung, sofortige Probe.
3. **Remote ID** — ZeroTier-Netz beitreten, danach die ZT-Adresse des Geräts ansprechen.
   Serverseitig lesbar über `/v1/zt/info` und `/v1/zt/status`.

**Probe-Semantik (Projektregel „Erreichbarkeit messen, nicht ableiten"):** Ein Kandidat gilt erst
als erreichbar, wenn eine HTTP-Antwort **von der Seite kommt, über die die Aussage gilt**.
`ECONNREFUSED`, `ETIMEDOUT` und `HTTP != 2xx/4xx` sind drei **verschiedene** Ergebnisse und
werden dem Nutzer unterschieden angezeigt („Port zu" ≠ „keine Antwort" ≠ „falscher Dienst").
Ein Bind-Zustand oder ein Ping ist kein Beleg.

Die Auswahl unter mehreren erreichbaren Adressen erfolgt nach **gemessener Latenz**, in der vom
Nutzer gesetzten Prioritätsreihenfolge als Tiebreak — und wird im Statusbereich mit Weg und
Messwert angezeigt („LAN · 3 ms" / „Remote ID · 68 ms").

### 6.3 Auth

`POST /v1/users/login {"username","password"}` → `data.token.access_token` /
`refresh_token`. Gemessene Eigenschaften (KB § 21.1 / § 24): ES256-JWT, kein `kid`,
Verifikationsschlüssel unter `/.well-known/jwks.json`; **`iss` unterscheidet die Typen** —
`casaos` (~3 h) vs. `refresh` (~7 Tage), mit demselben Schlüssel signiert. Der Client behandelt
sie getrennt und schickt **nie** den Refresh-Token als Session. Erneuern über
`/v1/users/refresh` (im Web-Bundle 17× belegt), proaktiv vor Ablauf, mit Single-Flight, damit
paralleles Nachladen nicht mehrere Refreshes auslöst.

### 6.4 Eigener API-Client statt SDK

Die offiziellen `@icewhale/*`-OpenAPI-SDKs sind **nicht installierbar** (KB § 25.1: npm-Token
ungültig, Registry antwortet für „privat" wie für „gibt es nicht"), und das einzige
Files-SDK auf npm ist ein Fremd-Fork. Deshalb ein eigener, schmaler, typisierter Client gegen
die gemessene Fläche — mit `zod`-Parsing der Antworten, damit eine Feldumbenennung serverseitig
als lauter Fehler auffällt und nicht als „leere Liste".

---

## 7. Feature-Design

### 7.1 Devices — Registry und Umschalten

Ein `Device` ist: `id` (stabil, aus `/v1/sys`-Kennung abgeleitet), Anzeigename, Liste von
Zugangswegen mit Priorität, Referenz auf die Credentials im Keyring, letzter Kontakt, gemessene
Capabilities. Umschalten wechselt den aktiven Kontext, ohne die App neu zu starten; laufende
Übertragungen werden sichtbar abgebrochen oder gehalten — nie stumm verworfen.
Restart/Shutdown mit Bestätigungsdialog, der den **Gerätenamen** wiederholt; „Remove" löscht
Gerät **und** Credentials und sagt das vorher.

### 7.2 File Hub

Navigation über `/v2_1/files/file` (Verzeichnis), Suche über `/file/search` mit Pfad-Scope,
Vorschau über `/thumbnail` (Bilder), `/file/video/generate/image` (Video-Poster) und
`/file/download` (Text/PDF im eigenen Viewer). Dateiaktionen laufen serverseitig als **Tasks**
(`/task/copy`, `/task/cut`, `/task/duplicate`, `/task/decompress`, `/task/retry`) und werden
über `/task/{id}` verfolgt — mit echtem Fortschritt im UI statt eines Spinners ohne Ende.
Teilen über `/share/link` und `/share/list`, Papierkorb über `/trash`, `/trash/stats`,
`/trash/empty`, Favoriten über `/pin`. Uploads über `/file/upload` bzw. `/file/uploadV2` mit
`/file/upload_info`.

Zwei bekannte Server-Eigenheiten, die der Client abfangen muss, statt sie als eigenen Fehler
darzustellen: Pfade unterhalb von `AppData` können mit `400 invalid path` antworten (KB § 23 —
gemessene Regression der Files-API), und Task-Endpunkte sind asynchron. Beides bekommt eine
verständliche Meldung mit Herkunft („Server lehnt diesen Pfad ab (400)"), keinen Retry-Loop.

### 7.3 Photos

**Browsing:** `/v2/photos/gallery/stream` (Paginierung, Gruppierung), `/gallery/facets`
(Filter), `/v2/photos/search` (Body **nur** `{"query":"…"}` — zusätzliche Felder auf oberster
Ebene ergeben `400`, gemessen), `/v2/photos/thumbnail`, `/v2/photos/progress` (Indexstand).
Der Client zeigt den Indexstand offen an, weil die Textsuche ohne fertigen Embedding-Index nur
token-exakt trifft (KB) — sonst wirkt „0 Treffer" wie ein Client-Fehler.

**Vordergrund-Backup, ausdrücklich kein Hintergrund-Sync:** der Nutzer wählt lokale Ordner und
ein Zielverzeichnis; die Queue läuft **nur bei offenem Fenster** und sagt das im UI. Eigenschaften:
Wiederaufnahme nach Abbruch, Duplikaterkennung über (relativer Pfad, Größe, mtime) mit
Hash-Bestätigung im Zweifel, paralleler Upload mit Begrenzung, Ergebnisprotokoll mit *jeder*
übersprungenen Datei und dem Grund. Kein „fertig", solange eine Datei ungeklärt ist.

### 7.3.1 Photos ist Pflicht — auch auf Geräten ohne das Photos-Modul

Vorgabe: **Photos ist kein optionaler Bereich.** Das kollidiert scheinbar mit dem Messbefund aus
§ 6.1 (`/v2/photos` fehlt auf einem der beiden v1.7.0-Hosts). Auflösung durch Trennung der
Funktion in zwei Hälften mit **unterschiedlicher** Abhängigkeit:

| Hälfte | braucht | Verfügbarkeit |
| --- | --- | --- |
| **Backup** (lokale Fotos → Gerät) | nur die **Files**-API (`/file/upload`, `/file/uploadV2`) | **immer** — auf jedem ZimaOS-Gerät |
| **Bibliothek** (semantische Suche, Facetten, Memories, Index-Stand) | `/v2/photos` | nur mit Modul |
| **Browsen/Vorschau** (Raster, Detailansicht) | Files-API + `/v2_1/files/thumbnail` | **immer** |

Damit ist der Photos-Bereich auf **jedem** Gerät voll benutzbar: Das Raster wird notfalls aus
einem Ordner über die Files-API gebaut und mit `/thumbnail` bebildert — dieselbe Optik, dieselbe
Bedienung. Fehlt das Modul, entfallen ausschließlich **Suche und Facetten**; an dieser Stelle
steht dann ein benannter Hinweis („semantische Suche braucht das Photos-Modul") neben einer
funktionierenden Namens-/Ordnerfilterung.

**Kein leerer Zustand ohne Erklärung, aber auch kein toter Tab** — das ist der Unterschied zur
vorigen Planfassung, in der Photos bei fehlendem Modul komplett ausgefallen wäre.
Die Capability-Erkennung bleibt technisch erhalten; sie entscheidet jetzt über *einzelne
Funktionen*, nicht über den ganzen Bereich. Das Fixture aus § 11.1 prüft **beide** Varianten und
verlangt, dass Raster und Backup in **beiden** funktionieren.

### 7.4 Apps

Liste aus `/v2/app_management/myapps` und `/v1/apps`, Kacheln mit Status, Icon und WebUI-Link.
„Web App" öffnet die App-Oberfläche in einem eigenen Fenster mit eigener Session-Partition
(kein `nodeIntegration`), alternativ im Systembrowser — konfigurierbar.
**Offline-Cache:** letzte erfolgreiche Liste plus Icons auf Platte, beim Start sofort angezeigt
**mit Altersangabe** („Stand: heute 09:14"), im Hintergrund aktualisiert. Ein Cache ist ein
Ersatzsignal (Projektregel) — deshalb nie als aktueller Zustand ausgeben, sondern datiert.
Icon-Fallback: neutraler Platzhalter mit App-Initial; **kein** fremdes Logo als Notnagel
(ZimaOS-KB-Lektion „Box.com-Logo auf der Immich-Kachel").

### 7.5 Settings

Sprache (28), Theme (System/Hell/Dunkel), Startverhalten, Verbindungsprioritäten,
ZeroTier-Optionen und -Diagnose, SMB-Mount-Verhalten, Backup-Jobs, Update-Kanal,
Log-Ansicht mit „Ordner öffnen", sowie **Sicherheitsstatus des Keyrings** (§ 10.2).

---

## 8. Design-System und Dark Mode

### 8.0 Referenz: die vier Screens des Mobile-Clients (angesehen 2026-07-30)

Grundlage sind die fünf Store-Screenshots des Zima Client (App-Store-Listing, Version 1.5.5) in
860 × 1864 px — **angesehen**, nicht aus einer Beschreibung übernommen. Vier zeigen die App:

**Gemeinsames Gerüst (auf allen vier identisch):**
* Sehr helle, fast weiße Fläche; Inhalte in **weißen Karten** mit großem Radius (~16–20 px) und
  weichem, tiefliegenden Schatten. Viel Weißraum, keine Trennlinien außer in Listen.
* **Schwebende Pill-Navigation unten**, mittig, mit **drei** Icons — Ordner (Files), Bild (Photos),
  Raster (Apps). Aktiver Tab: gefüllte, abgerundete Fläche hinter dem Icon.
* **Rechts daneben, optisch abgesetzt: ein runder Button mit blauem „Z"** — das ist das
  Gerät/Dashboard. Also **vier** Ziele, aber drei davon in der Pill und das Gerät als eigener Knopf.
* Titel groß und links („Files", „Photos"), rechts ein **runder `⋯`-Knopf** für Kontextaktionen.
* Akzent: Blau. Semantik: Grün (Status/Temperatur), Orange (Ordner-Icons).

**Screen 1 — Gerät/Dashboard:** Kopf mit rundem Konto-Avatar, Kontoname und Rolle darunter
(„Local owner account"). Darunter der **Gerätename** groß + `⋯`. Dann ein **großes Produktbild
des Geräts** — dafür ist der gemessene Endpunkt `/v2/zimaos/device/image` da. Darunter eine
**Verbindungs-Pill** über die ganze Breite: grünes WLAN-Icon, „LAN", rechts die Adresse.
Abschnitt „Status" mit **2-spaltigen Kennzahl-Karten**: CPU (Modell, Watt, Prozent mit
gepunktetem Ring-Gauge) und CPU-Temperatur (große grüne Zahl auf grünem Verlauf).

**Screen 2 — Files:** Pill-**Suchfeld** direkt unter dem Titel. Darunter **einklappbare
Abschnitte** mit Chevron: „⭐ Starred" als **3-spaltiges Raster** großer Ordner-Icons (Verlauf
orange, Stern-Badge) mit Name, Datum, Größe — und „Storage" als Liste: Volume-Icon, Name,
Badge „System", „35 % used" mit gepunktetem Balken.

**Screen 3 — Photos:** unter dem Titel eine **Fortschritts-Pill**: Spinner, „55243 items…",
rechts „52 mins remaining" + Chevron zum Aufklappen. Darunter ein **dichtes 5-spaltiges
Raster** randlos bis zum Rand, minimale Abstände.

**Screen 4 — App/Web App:** oben eine Pill mit App-Icon und -Name, rechts `⋯` und `✕`. Dazwischen
die **eingebettete App-Oberfläche** randlos. Unten ein **Bottom-Sheet**: App-Icon, Name, Version,
„● Running" in Grün — darunter eine **Adresszeile** mit ‹ › , URL und Link-/Reload-Icons.

**Konsequenzen für v2:** die Informationsarchitektur wird übernommen (drei Bereiche + Gerät),
ebenso die Kartenoptik, die Fortschritts-Pill, die einklappbaren Abschnitte und das
App-Fenster mit Adresszeile und Statuszeile. Am Desktop wird die Pill-Navigation bei breitem
Fenster zur Seitenleiste mit denselben vier Zielen (§ 8, Layout-Leitlinie).

⚠️ **Die Screenshots werden nicht ins Repo übernommen** — es sind fremde Marketing-Assets
(IceWhale/Apple). Referenziert wird die Store-Seite; im Repo entstehen eigene Screenshots aus der
eigenen App.


Damit die Verwandtschaft zum Mobile-Client nicht Behauptung bleibt, werden die Design-Tokens
der **ZimaOS-Oberfläche selbst** übernommen. Aus deren CSS abgelesen (v1.7.0): oklch-Farbraum,
`--radius: .5rem`, `--primary: .537 .257 262.466` (Blau), vollständige `.dark`-Variante,
Utility-CSS in Tailwind-Semantik. Das ist ein shadcn/ui-artiger Tokensatz — direkt in eine
Tailwind-4-Theme-Konfiguration übertragbar.

Layout-Leitlinie: die mobile Struktur des Zima Client (Kachel-Dashboard, Bottom-Tab-Leiste)
wird für Desktop **adaptiv** — schmales Fenster: Bottom-Tabs wie heute; breites Fenster:
Seitenleiste mit denselben Bereichen. Gleiche Informationsarchitektur, desktopgerechte
Ergonomie. Dark Mode folgt `prefers-color-scheme` mit manueller Übersteuerung, und die
Umschaltung muss **beide** Richtungen gewinnen (kein einseitiges `@media`-Override).

Barrierefreiheit: Fokusreihenfolge, sichtbarer Fokusring, Tastaturbedienung des File Hub,
Kontrast ≥ 4.5:1 — als Playwright-Prüfung, nicht als Vorsatz. Das vorhandene
`utils/accessibility.ts` und `FocusTrap.tsx` gehen in das Design-System ein.

---

## 9. Internationalisierung

**Gemessen:** die ZimaOS-Weboberfläche v1.7.0 führt **28** Locales:
`ca_ES, cs_CZ, da_DK, de_DE, el_GR, en_GB, en_US, es_ES, fr_FR, ga_IE, hr_HR, hu_HU, it_IT,
ja_JP, ko_KR, ml_IN, nb_NO, nl_NL, pl_PL, pt_BR, pt_PT, ro_RO, ru_RU, sk_SK, sv_SE, tr_TR,
zh_CN, zh_TW` (27 Sprach-Chunks + `en_US` inline). Der App Store listet für den iOS-Client
26 Sprachen (Portugiesisch einmal, kein `en_GB`).

**Der Zima Client nennt 29.** Welche Sprache die 29. ist, kann ich mit den Quellen, die ich
geprüft habe, **nicht** belegen — siehe § 14. Umsetzung: die 28 belegten Locales als
Dateien anlegen, `en_US` als Fallback; der 29. Platz bleibt offen, bis die Liste gemessen ist.

Technisch: `de_DE` und `en_US` vollständig gepflegt; die übrigen mit Übersetzungen und einem
CI-Gate, das (a) fehlende Schlüssel gegen `en_US` und (b) **rohe i18n-Keys im gerenderten UI**
findet — Letzteres als Playwright-Assertion, weil eine vollständige JSON-Datei nicht beweist,
dass der Text auch ankommt (Projektregel „geparst ist nicht angewendet").

---

## 10. Sicherheit

### 10.1 Prozessgrenzen

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` im Renderer;
`webSecurity` aktiv; Content-Security-Policy ohne `unsafe-eval`; jede externe Navigation über
`setWindowOpenHandler` explizit erlaubt oder abgewiesen. App-WebUIs laufen in einer eigenen
Session-Partition, damit ein App-Cookie nicht die Client-Session sieht.
Alle Shell-Aufrufe (SMB-Mount, ZeroTier-CLI) über Argument-Arrays statt Shell-Strings; der
vorhandene `sanitize.ts` samt Tests wird übernommen und erweitert.

### 10.2 Credentials — und ein Fallback, der laut sein muss

`keytar` fällt weg (archiviert). Ersatz: Electrons `safeStorage`. **Wichtige gemessene
Eigenschaft** (Electron-Doku v43.2.0, `safe-storage.md`): unter Linux nutzt es
`gnome-libsecret`, `kwallet`, `kwallet5` oder `kwallet6` — und wenn **kein** Secret-Store
vorhanden ist, werden Daten *„unprotected as they are encrypted via hardcoded plaintext
password"* gespeichert. `getSelectedStorageBackend()` liefert dann `basic_text`.

Das ist genau der Fall, der still schiefgeht. Deshalb Pflicht in v2:
beim Start `getSelectedStorageBackend()` auslesen und bei `basic_text` (oder `unknown`)
**sichtbar im UI warnen** — mit Angabe des fehlenden Backends und der Wahl „trotzdem speichern"
oder „Passwort jedes Mal abfragen". Kein Speichern von Zugangsdaten unter der Annahme, sie seien
verschlüsselt, ohne das geprüft zu haben.

### 10.3 Transport

HTTP im LAN ist die Realität von ZimaOS (Gateway auf Port 80). Der Client zeigt den
Verbindungsweg und dessen Vertraulichkeit an (LAN unverschlüsselt / ZeroTier verschlüsselt),
statt ein Schloss-Symbol zu behaupten, das nicht stimmt. Selbstsignierte Zertifikate werden
nicht stillschweigend akzeptiert.

---

## 11. Test- und Verifikationsstrategie

Die Regel im Haus lautet: „fertig" nur mit Beleg, und **jede Zusicherung nennt die Prüfung, die
sie deckt**. Vier Ebenen, jede mit eigenem Zweck:

### 11.1 Unit (Vitest)
Domänenlogik ohne Netz: Pfad-Normalisierung, Retry/Backoff, Token-Lebenszyklus (inkl.
`iss`-Unterscheidung), Dedupe-Entscheidung im Backup, Capability-Parsing, Fehlerabbildung.
**Fixtures müssen die Vielfalt enthalten, an der Produktion zerbricht** (KB-Lektion
`fixtures build a simpler world`): das Capability-Fixture enthält **beide** gemessenen
Routen-Varianten — mit und ohne `/v2/photos` — und eine Zusicherung wird rot, wenn diese
Vielfalt verschwindet.

### 11.2 Vertrag (aufgezeichnet)
Antworten eines echten Geräts werden als Fixtures aufgezeichnet; der `zod`-Parser läuft dagegen.
Ändert der Server ein Feld, bricht der Test — statt dass das UI leer bleibt.

### 11.3 Live-Beleg (`npm run verify:live -- --host <zimaos-host>`)
Ein Skript, das **jeden** Endpunkt aus `endpoints.ts` gegen ein echtes Gerät fährt und
`METHODE PFAD → STATUS BYTES` ausgibt. Das ist das Werkzeug gegen erfundene Endpunkte: der
Verifikations-Kommentar im Code muss durch einen Lauf gedeckt sein. Läuft **nicht** in CI
(braucht ein Gerät), sondern vor jedem Release, und die Ausgabe wird ans Release gehängt.

### 11.4 E2E im echten Fenster (Playwright, Locale `de_DE`)
Gegen die gebaute App, mit echtem Gerät oder Mock-Server. Muss-Flows:
Login → Dashboard, Gerät hinzufügen/wechseln, Datei suchen → Preview → kopieren,
Foto-Backup mit 3 Dateien inkl. Abbruch und Wiederaufnahme, App-WebUI öffnen,
Sprache wechseln, Theme wechseln. Assertions auf das **gerenderte** Ergebnis und den Payload —
nicht auf HTTP 200 — plus die globale Prüfung „kein roher i18n-Key sichtbar".

### 11.5 Distro-Matrix (CI)
Bauen **und starten**: je Zieldistro Container, Artefakt installieren, unter Xvfb starten,
Screenshot + Konsolenlog als Artefakt speichern. Ein Build, der nicht startet, ist rot.
Zusätzlich das Privatdaten-Gate aus § 1 und `npm audit` als Bericht.

---

## 12. Phasenplan

Jede Phase endet mit einem **Beleg**, nicht mit einem Gefühl. Reihenfolge so gewählt, dass die
riskanten Unbekannten früh fallen.

| Phase | Inhalt | Definition of Done (Beleg) |
| --- | --- | --- |
| **0 — Messen** | Discovery-Mechanismus am Gerät ermitteln; `verify:live` als erstes Werkzeug bauen; jeden Endpunkt aus § 6 mit Methode und Status belegen; 29. Sprache klären | Ausgabe von `verify:live` gegen zwei Geräte im Repo abgelegt; offene Punkte benannt |
| **1 — Fundament** | Neues Gerüst (electron-vite, TS strict, ESLint-Boundaries, Vitest, Playwright), `shared/contract`, Logging, CI-Skelett | `npm run type-check`, `lint`, `test` grün; leere App startet auf 2 Distros mit Screenshot |
| **2 — Verbinden** | Auth + Refresh, Capabilities, Transport-Strategien mit Probe-Semantik, Geräte-Registry, `safeStorage` samt Backend-Warnung | E2E: Login und Gerätewechsel in `de_DE`; Screenshot der Warnung bei `basic_text` |
| **3 — Design-System** | Tokens aus ZimaOS, Komponenten, adaptives Layout, Dark Mode, i18n-Gerüst mit 28 Locales | Screenshots hell/dunkel, schmal/breit; Playwright: kein roher i18n-Key |
| **4 — File Hub** | Navigation, Suche, Preview, Aktionen als Tasks, Papierkorb, Teilen, Upload/Download-Queue | E2E-Flow Suche→Preview→Kopieren mit Task-Fortschritt; Fehlerfall `400 invalid path` sichtbar |
| **5 — Photos** | Galerie, Facetten, Suche, Detail-Viewer, Vordergrund-Backup mit Resume und Protokoll | E2E-Backup 3 Dateien inkl. Abbruch; Verhalten ohne `/v2/photos` als Screenshot |
| **6 — Apps & System** | App-Liste, Web-App-Fenster, Offline-Cache mit Altersangabe, Restart/Shutdown/Remove, Dashboard-Kennzahlen | E2E: App öffnen; Cache-Anzeige nach Netztrennung; Power-Aktionen am Testgerät protokolliert |
| **7 — Übernahme** | Migration der Alt-Konfiguration, SMB-Mounts, Backup-Jobs, ZeroTier-Diagnose aus 0.9.x | Alt-Konfiguration eines 0.9.23-Profils wird gelesen, Belegausgabe |
| **8 — Ausliefern** | Paket-Matrix (§ 4), Distro-Start-Matrix, Update-Kanal, README/liesmich in `de`/`en`, Release | Startbeleg je Distro; Flatpak-Lauf auf einem unveränderlichen System |

Phasen 1–8 sind unabhängig reviewbar; jede läuft auf einem eigenen Branch mit Squash-Merge.

---

## 13. Migration und Rollout

* v2 entsteht auf `v2/` — die `0.9.x`-Linie bleibt bis zum ersten stabilen v2-Release baubar.
* **Kopiert wird additiv, nie mit `--delete`** (Projektregel 1b): beim Übernehmen aus dem
  Alt-Repo werden Dateien einzeln und mit vollem Zielpfad geschrieben, danach Prüfsumme am
  Zielpfad verglichen.
* Bestandsnutzer: v2 liest die Alt-Konfiguration (`~/.config/zima-linux-client`, dazu die
  Altstände `zima-client`, `zimaos-client`, `zimaos-remote-client`, `zima-remote` — alle vier
  liegen auf diesem Rechner noch vor) **read-only** ein und schreibt in ein neues Verzeichnis.
  Nichts wird überschrieben, nichts gelöscht.
* Passwörter werden **nicht** aus dem alten Keyring migriert, sondern beim ersten Login neu
  erfragt — Migration von Secrets zwischen Backends wäre ein stiller Vertrauensbruch.

---

## 14. Offene Punkte — ehrlich benannt

1. **Die 29. Sprache.** 28 Locales sind an der ZimaOS-Oberfläche gemessen, 26 auf der
   App-Store-Seite gelistet. Die Zahl 29 stammt aus den Release-Notes des Mobile-Clients; welche
   Sprache dort zusätzlich enthalten ist, habe ich nicht belegt. **Prüfhandlung:** Sprachliste
   der Android-Paketdatei auslesen bzw. die Play-Store-Detailangaben abrufen. Bis dahin: 28.
2. ~~**Discovery-Mechanismus.**~~ **Geschlossen am 2026-07-30:** `_zimaos._tcp`, Port 80,
   TXT `os=ZimaOS` — an der avahi-Konfiguration des Hosts **und** per PTR-Abfrage von der
   Netzseite belegt (§ 6.2). Was der Mobile-Client benutzt, ist damit noch nicht bewiesen; für
   unseren Client ist es unerheblich, weil das Gerät diesen Typ nachweislich ankündigt.
3. **Photos-Verfügbarkeit.** Warum `/v2/photos` auf einem v1.7.0-Host fehlt (Mod nachinstalliert
   vs. Hardware-/Board-Abhängigkeit), ist nicht geklärt. Für den Client irrelevant — er erkennt
   es zur Laufzeit —, für die Anleitung relevant.
4. ~~**Screendesign des Mobile-Clients.**~~ **Geschlossen am 2026-07-30:** die fünf
   Store-Screenshots (860 × 1864) sind angesehen und in § 8.0 als Screen-Inventar festgehalten —
   Navigationsgerüst, Kartenoptik, Fortschritts-Pill, App-Fenster. Offen bleibt allein der
   **Dark Mode des Mobile-Clients**: alle vier Screens zeigen das helle Thema, ein dunkles
   Pendant ist nicht belegt. Unser Dark Mode leitet sich daher aus den ZimaOS-`.dark`-Tokens ab,
   nicht aus einer Mobile-Vorlage.
5. **arm64.** Der Alt-Build verpackt nur `bin/zerotier/x64`. Ob das arm64-Binary im Repo zur
   Zieldistro passt, ist nicht gemessen — Phase 8 prüft es auf echter arm64-Hardware oder gar
   nicht (dann wird arm64 nicht behauptet).
6. **Sub-Account-Login.** Dass ein Nicht-Admin-Konto die benötigten Endpunkte nutzen darf, ist
   nicht gemessen. Phase 0 prüft es mit einem Testkonto; sonst wird die Einschränkung dokumentiert.

---

## 15. Was dieser Plan absichtlich nicht enthält

* **Hintergrund-Sync für Fotos** — ausdrücklich nicht gewünscht, also auch kein Daemon, kein
  systemd-User-Service, kein Autostart-Uploader.
* **Erfundene Endpunkte.** Alles unter § 6 ist gemessen; wo nichts gemessen war, steht es in § 14.
* **Ein Versprechen „läuft überall".** Electron bindet an glibc; musl-Systeme (Alpine) sind
  ausgeschlossen. Behauptet wird nur, was die Start-Matrix aus § 11.5 belegt.
