# v2 — Umsetzungsstand

**Branch:** `v2` · **Version:** 2.0.0-alpha.1 · **Stand:** 2026-07-30

Der Plan steht in [V2-PLAN.md](V2-PLAN.md). Diese Datei sagt, was davon **läuft** — mit dem Beleg
daneben. Nichts hier ist „fertig", wofür kein Kommando oder Messwert genannt ist.

## Phase 0 — Messen: abgeschlossen

| Frage | Ergebnis | Beleg |
| --- | --- | --- |
| Welche API-Fläche hat ZimaOS wirklich? | 35 bzw. 38 Gateway-Routen an zwei v1.7.0-Hosts; Files-, System- und Photos-Pfade aus dem ausgelieferten Web-Bundle abgelesen | `src/main/zima/endpoints.ts`, jede Konstante mit Verifikationsmarke; KB §41 |
| Wie findet man Geräte im LAN? | **`_zimaos._tcp`, Port 80, TXT `os=ZimaOS`** | avahi-Definition auf dem Host **und** PTR-Abfrage von der Netzseite; `npx vite-node -c vitest.config.ts scripts/smoke-discovery.ts` findet 2 Geräte |
| Ist Photos überall vorhanden? | **Nein** — auf einem der beiden Hosts fehlt `/v2/photos` samt Binary | `systemctl is-enabled zimaos-photos` → `not-found`; Fixtures in `src/main/zima/__tests__/fixtures/` |
| Startet Electron 43 überall? | **Nein** — Wayland + `vmwgfx` = SIGSEGV; behoben durch Relaunch auf X11 | Plan §4.3, Messtabelle mit sechs Startvarianten |
| Wie viele Sprachen? | 28 belegt (ZimaOS-UI v1.7.0). Die 29. des Mobile-Clients ist **unbelegt** | Plan §9, Plan §14 Punkt 1 |

## Phase 1 — Fundament: läuft

**Stack installiert und verifiziert:** Electron 43.2.0 · React 19.2.8 · Vite 7.3.6 ·
electron-vite 5.0.0 · Tailwind 4.3.3 · zod 4.4.3 · Vitest 3.2.7 · TypeScript 5.9.3.

> ⚠️ Korrektur zum Plan: **Vite 7, nicht 8.** electron-vite 5.0.0 deklariert
> `peerDependencies.vite = "^5.0.0 || ^6.0.0 || ^7.0.0"`. Im Plan standen zunächst zwei
> Höchstversionen nebeneinander, deren Verträglichkeit ich nicht geprüft hatte — `npm install`
> brach mit `ERESOLVE` ab. Zwei aktuelle Versionen sind kein verträgliches Paar.

### Was gebaut ist

* **Prozessarchitektur** mit strikter Grenze: Renderer `sandbox: true`, `contextIsolation: true`,
  `nodeIntegration: false`, CSP ohne `unsafe-eval`, jede Fensteröffnung explizit entschieden.
* **Typisierter IPC-Kontrakt** (`src/shared/contract.ts`) — ein zod-Schema je Kanal, Antworten
  immer als Hülle `{ok:true,value} | {ok:false,error}`. Kein generisches `invoke(channel)`.
* **`Result<T,E>` statt Ausnahmen** (`src/shared/result.ts`) mit unterschiedenen Fehlerarten:
  `refused` ≠ `timeout` ≠ `dns` ≠ `unexpected-status`.
* **mDNS-Discovery** ohne Fremdabhängigkeit, direkt am Drahtformat (`src/main/discovery/mdns.ts`).
* **Probe mit gemessener Latenz** und Prioritäts-Tiebreak (`src/main/transport/probe.ts`).
* **Capability-Erkennung** aus der Routentabelle (`src/main/zima/capabilities.ts`).
* **Keyring-Status laut gemacht** (`src/main/secrets/store.ts`): `getSelectedStorageBackend()`
  wird gelesen, und bei `basic_text` warnt das UI, **bevor** etwas gespeichert wird.
* **Plattform-Resilienz** (`src/main/app/resilientPlatform.ts`) — siehe Plan §4.3.
* **Design-System** aus den gemessenen ZimaOS-Tokens, hell **und** dunkel, Toggle gewinnt in
  beiden Richtungen (`src/renderer/src/styles/tokens.css`).
* **Navigation wie im Mobile-Client**: Pill mit Dateien/Fotos/Apps + abgesetzter „Z"-Knopf.
* **Startbeweis-Werkzeug** (`ZIMA_VERIFY_STARTUP=<report.json>`) — fragt die **laufende Engine**
  nach angewandten CSS-Regeln und berechneten Stilwerten, sucht sichtbare rohe i18n-Keys und legt
  Screenshot plus JSON-Report ab. Genau das braucht die Distro-Matrix aus Plan §11.5.

### Belege (alle am 2026-07-30 gefahren)

```
npm run type-check   ✓   (Positivkontrolle: absichtlicher Typfehler wird rot)
npm run lint         ✓   (Positivkontrolle: Renderer-Import von 'electron' wird abgelehnt)
npm test             ✓   21 Tests, 2 Dateien
npm run build        ✓   main 22.5 kB · preload 3.1 kB · renderer 757 kB + 18.2 kB CSS
npm run verify:privacy ✓ (Positivkontrolle: eingefügte RFC1918-Adresse wird gefunden)
Startbeweis          ✓   ok=true, 2 Kaltstarts ohne Flag, failures: []
```

Live gegen zwei echte Geräte:

```
mDNS _zimaos._tcp: 2 Antworten (Port 80, txt os=ZimaOS)
Gerät A: reachable=true  20 ms  routes=35  photoLibrary=false photoBrowse=true photoBackup=true
Gerät B: reachable=true   6 ms  routes=38  photoLibrary=true  photoBrowse=true photoBackup=true
Negativkontrolle nichts-lauscht  -> refused
Negativkontrolle nicht-geroutet  -> timeout
```

Damit ist die Zusage aus Plan §7.3.1 gemessen: **Fotos-Durchsehen und -Backup sind auf beiden
Geräten verfügbar**, auch auf dem ohne Photos-Modul.

## Was ausdrücklich noch nicht existiert

Dateien, Fotos und Apps zeigen einen benannten Platzhalter mit Phasennummer — **kein leerer
Bildschirm**, weil „leer" wie „nichts vorhanden" aussieht und etwas anderes behauptet als „noch
nicht gebaut". Es fehlen: Login und Token-Erneuerung, Geräte-Registry samt Umschalten,
Restart/Shutdown, File Hub, Photos-Oberfläche und -Backup, Apps mit Offline-Cache, die
26 weiteren Sprachdateien, Playwright-E2E, Paketbau und die Distro-Start-Matrix.

## Alt-Stand

Der 0.9.23-Code liegt unverändert unter `legacy-0.9/` (per `git mv`, Historie erhalten) und ist
auf `main` weiter baubar. Es wurde nichts gelöscht.
