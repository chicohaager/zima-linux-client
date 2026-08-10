# v2 — Umsetzungsstand

**Branch:** `v2` · **Version:** 2.0.0-alpha.4 · **Stand:** 2026-08-10

Der Plan steht in [V2-PLAN.md](V2-PLAN.md). Diese Datei sagt, was davon **läuft** — mit dem Beleg
daneben. Nichts hier ist „fertig", wofür kein Kommando oder Messwert genannt ist.

**Zuletzt gefahren, 2026-08-10 — der Stand dieses Commits:**

```
npm run verify        ✓ (rc=0)  type-check · lint · 275 Tests · build · build-gate · i18n · privacy
npm run verify:release ✓ (rc=0)  8 Prüfungen am dist-Verzeichnis (siehe unten)
npx playwright test   ✓ 4 von 4 E2E im echten Fenster gegen ein aufgezeichnetes Gerät
i18n gate           clean — 289 Schlüssel in en_US; 28 Sprachen bei 100 %, 0 unvollständig
privacy gate        clean, 215 verfolgte Dateien (Bilder überspringt es — siehe unten)
Distro-Matrix       6 von 6 am AUSGELIEFERTEN Paket, Sandkasten an (§ Distro-Start-Matrix) —
                    Messwert vom 2026-08-09, an alpha.4 NICHT wiederholt
Handlauf alpha.4    Zorin OS 18: Start OHNE Sitzung und ohne eigenmächtigen Zugriff; nach
                    Verbinden über Remote-ID stand die Sitzung, 38 Gateway-Routen, neun
                    Fähigkeiten `available`, Dateien/Fotos/Apps benutzt. NICHT geprüft:
                    der Knopf „Verbinden" am gespeicherten Gerät (Token-Weg)
Pakete              deb · rpm · pacman · AppImage · tar.gz gebaut aus 4fd04b3, alle fünf in
                    einem Lauf am 2026-08-10, 15:52–15:58; Flatpak aus der Zielliste.
                    `sha256sum -c SHA256SUMS-2.0.0-alpha.4.txt` → 5× OK
postinst            aus dem GEBAUTEN .deb gelesen: enthält die vollständige
                    electron-builder-Vorlage (update-alternatives, chmod 4755
                    chrome-sandbox, apparmor_parser) UND die setcap-Erteilung
Zweig               auf `origin/v2` hochgeladen (2026-08-10, per `git ls-remote` gegengeprüft)
Release             v2.0.0-alpha.4 als Pre-Release, 7 Assets, Tag auf 4fd04b3;
                    `sha256sum -c` aus dem echten GitHub-Download grün für alle fünf Pakete
                    (heruntergeladen, nicht an den lokalen Dateien geprüft).
                    alpha.1 bis alpha.3 bleiben stehen; alpha.2 trägt oben einen
                    Warnhinweis, weil es „({{paths}})" auf den Bildschirm schrieb
```

Die Vorgängerbauten liegen unter `dist/_stale-2026-08-10-de27002/` und
`dist/_stale-2026-08-10-alpha2/` — beiseitegelegt, nicht gelöscht, damit im `dist/` nie wieder
Dateien aus zwei Läufen unter einer Versionsnummer stehen. Das Release-Gate war vor dem Neubau
schon einmal **rot** (`rc=1`, „no artefact predates the last build-input commit") und hat damit
genau die Lage gemeldet, für die es gebaut wurde.

**Was alpha.3 noch nicht konnte, als Merkposten:** Der Client stellte gespeicherte Verbindungen
beim Start von selbst wieder her. Die Beschwerde galt dem **Ob**, ich hatte sie als Beschwerde
über das **Wie** gelesen und den Automatismus nur klüger gemacht — zwei Releases lang. Seit
`660c886` passiert beim Start nichts; der Knopf „Verbinden" ist die einzige Stelle, die noch nach
außen greift. Der tragende Test ist der negative
(`src/renderer/src/features/session/__tests__/useResume.test.tsx`).

**Was alpha.2 gekostet hat, als Merkposten:** Die Fassung ging mit einem ungefüllten Platzhalter
auf dem Bildschirm heraus (`… hat geantwortet ({{paths}})`). Drei Prüfungen waren grün und keine
davon konnte es sehen — das i18n-Gate zählt Schlüssel, der Rundgang sucht rohe Schlüssel, und die
Unit-Tests haben diesen Zweig nie **gerendert**. Der Wächter dagegen steht jetzt in
`src/renderer/src/shared/lib/__tests__/errorMessage.test.tsx` und misst am gerenderten Text.

Die Zeile `Pakete` nennt seit dem 2026-08-10 den **Commit**, aus dem gebaut wurde, und
`npm run verify:release` erzwingt das: eine Bau-Behauptung ohne Commit lässt das Gate rot
werden. Der Grund steht in `scripts/verify-release.mjs` — hier standen einen Tag lang fünf
Pakete aus **drei** Läufen unter der Überschrift „der Stand dieses Commits".

Die Exit-Codes stehen mit dabei, weil sie einzeln abgefragt wurden: `npm run verify | tail`
zeigt die Ausgabe des Gates und wirft seinen Rückgabewert weg.

Die Testzahlen weiter unten (21, 63) sind **Messwerte ihrer jeweiligen Phase** und bleiben so
stehen — sie sagen, was damals grün war, nicht was heute existiert.

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

## Phase 2 — Verbinden: läuft

### Am echten Gerät gemessener Login-Vertrag

Vor der ersten Zeile Code den Endpunkt befragt, damit keine Antwortform erfunden wird:

| Anfrage | HTTP | Hülle |
| --- | --- | --- |
| `POST /v1/users/login`, falsches Passwort | **400** | `{"success":10013,"message":"User does not exist or password is invalid"}` |
| `POST /v1/users/login`, leerer Body | 400 | `{"success":400,"message":"Parameters Error"}` |
| `POST /v1/users/refresh` ohne Token | 401 | `{"success":20006,"message":"Verification failure"}` |
| `GET /v1/users/status` | 200 | `{"success":200,"message":"ok","data":{…}}` |
| `GET /v2/zimaos/sys/hardware` ohne Token | 401 | `{"message":"invalid or expired jwt"}` — **keine** Hülle |
| `GET /v2_1/files/file` ohne Token | 401 | `{"message":"Unauthorized"}` — **keine** Hülle |

🔴 **Ein falsches Passwort ist HTTP 400, nicht 401** — und 400 heißt auf der Files-API „ungültiger
Pfad". Wer nur den Status liest, zeigt dem Nutzer bei falschem Passwort „Das Gerät lehnt diesen Pfad
ab". Deshalb entscheidet in `src/main/zima/envelope.ts` der **Anwendungscode**, und der HTTP-Status
ist nur der Rückfall. Nur gemessene Codes sind abgebildet; ein unbekannter fällt sichtbar durch.

### Was gebaut ist

* **`iss`-Pinning** (`src/main/zima/jwt.ts`): Access-Token trägt `iss:"casaos"` (~3 h),
  Refresh-Token `iss:"refresh"` (~7 Tage) — **mit demselben Schlüssel signiert**. Ein unbekannter
  Aussteller wird abgewiesen statt als Access-Token angenommen. Die Signatur wird bewusst **nicht**
  lokal geprüft: wir sind der Client, nicht die Ressourcenseite.
* **Single-Flight-Erneuerung** (`auth.ts`): drei gleichzeitige Anfragen lösen **eine** Erneuerung
  aus. ZimaOS rotiert den Refresh-Token, ein Rennen würde einen Aufrufer mit einem bereits
  ersetzten Token zurücklassen.
* **Credentials** (`secrets/credentials.ts`): nur der **Refresh-Token** wird gespeichert, nie das
  Passwort. Bei fehlendem Schlüsselbund verweigert der Hauptprozess das Schreiben und liefert
  `plaintext-risk`, bis der Nutzer im UI zugestimmt hat. Wechselt das Backend, ist das ein benannter
  Fehler und kein stilles „nie angemeldet".
* **Geräte-Registry** (`devices/`): Mehrere Geräte, mehrere Wege pro Gerät, Umschalten, Priorität
  hochstufen, Entfernen samt Sitzung. Reine Logik in `ordering.ts` — deshalb testbar ohne Electron.
* **Transport-Strategien** (`transport/strategy.ts`): LAN und Direct IP vollständig; **Remote-ID
  liefert einen benannten Grund** statt einer leeren Kandidatenliste, weil „leer" wie „kein Gerät
  gefunden" aussieht.
* **Oberfläche**: Anmeldeformular, Sitzungskarte im Layout des Mobile-Clients (Konto, Verbindungs-
  Pill, Restlaufzeit der Sitzung), Geräteliste mit Wechseln/Priorität/Entfernen, Keyring-Banner mit
  echter Rückfrage.

### 🔴 Der Fehler, den erst das Fenster gezeigt hat

Typprüfung, Lint, 63 Tests und Build waren grün — im Fenster meldete jede Anmeldung „Da ist etwas
schiefgegangen". Ursache: das **Preload-Skript wurde als ESM gebaut** (`index.mjs`), der Renderer
läuft aber in der Sandbox, und ein sandboxed Preload kann kein ESM laden. `window.zima` war
`undefined`, jeder Aufruf warf einen TypeError, und der generische Fallback ließ das wie einen
Gerätefehler aussehen. Behoben: Preload wird als **CJS** ausgegeben, die Kanalnamen liegen jetzt in
einem zod-freien Modul (`src/shared/channels.ts`) — das Preload schrumpfte von 6,2 kB auf 1,57 kB
und bringt keine Fremdabhängigkeit mehr an die privilegierteste Grenze der App.

Damit das nicht zurückkommt: **`npm run verify:build`** liest die **erzeugten Dateien** —
Preload ist CJS, enthält kein Top-Level-`import`, ruft `exposeInMainWorld`, bündelt kein zod; der
Hauptprozess verweist auf `.cjs`; Sandbox und Context-Isolation sind an; CSP ohne `unsafe-eval`;
CSS-Klammerbilanz und Dark-Variante vorhanden. *(Der CSP-Check schlug zuerst falsch an — er fand
`unsafe-eval` in meinem eigenen Kommentar. Er liest jetzt den Attributwert, nicht die Datei.)*

### Belege Phase 2

```
npm run verify   ✓   type-check · lint · 63 Tests · build · build-gate · privacy-gate
Startbeweis      ✓   ok=true, keine rohen i18n-Keys, Locale de
```

Szenario **im echten Fenster** gegen ein echtes Gerät (`ZIMA_VERIFY_SCENARIO=signin-wrong-password`):
Formular öffnen → ausfüllen → absenden → gerendert erscheint **„Benutzername oder Passwort ist
falsch."** mit der technischen Herkunft darunter (`path=/v1/users/login code=10013 status=400`).
Das prüft die ganze Kette: Formular → IPC → HTTP → Hüllen-Auswertung → Übersetzung → DOM.

Benutzt wurde ein **nicht existierender** Benutzername, damit kein echtes Konto Fehlversuche
sammelt. **Der Erfolgsfall ist damit nicht belegt** — dafür braucht es ein Testkonto (siehe unten).

## Phase 3 — Design-System: läuft

### Adaptives Layout

Eine Informationsarchitektur, zwei Layouts — **gemessen**, nicht behauptet:

| Fenster | Navigation | Beleg |
| --- | --- | --- |
| < 860 px | schwebende Pill (Dateien/Fotos/Apps) + abgesetzter „Z"-Knopf, wie im Mobile-Client | `layout=pill` bei `width=560` |
| ≥ 860 px | Seitenleiste mit denselben **vier** Zielen samt Beschriftung, Kopfzeile mit Sprache/Theme | `layout=sidebar` bei `width=1180` |

Der Umbruch ist kein CSS-Breakpoint, sondern zwei Komponentenbäume — die Pill und die
Seitenleiste sind verschieden aufgebaut, nicht dasselbe anders gestylt.

### Dark Mode, in beide Richtungen

Drei Zustände statt Umschalter: **System / Hell / Dunkel**. „Dem System folgen" ist ein eigener
Wunsch, den ein Zweizustands-Toggle nicht ausdrücken kann — einmal getippt käme man nie zurück.
Der Verifier liest das Ergebnis aus der **berechneten Hintergrundhelligkeit**, nicht aus dem
Attribut, das er selbst gesetzt hat.

### 28 Sprachen, vollständig

```
i18n gate: clean — 28 locales, 104 keys each
  ca_ES cs_CZ da_DK de_DE el_GR en_GB en_US es_ES fr_FR ga_IE hr_HR hu_HU it_IT ja_JP
  ko_KR ml_IN nb_NO nl_NL pl_PL pt_BR pt_PT ro_RO ru_RU sk_SK sv_SE tr_TR zh_CN zh_TW
```

Alle 28 bei **100 % Abdeckung** — Stand Phase 3, bei 104 Schlüsseln. Nachladen per Chunk
(`import.meta.glob`), damit nicht 28 Kataloge im Startbündel liegen; `en_US` ist fest
eingebaut, weil es der Rückfall für alle ist.

> ⚠️ **Zwischenstand, inzwischen aufgeholt.** Die Bildschirme der Phasen 3b–7 haben den Katalog
> auf **280** Schlüssel gebracht; eine Zeit lang waren nur `de_DE` und `en_US` gepflegt und die
> anderen 26 standen bei 111 von 280 (40 %). Das Gate erzwingt keine Vollständigkeit —
> Übersetzen ist laufende Arbeit —, aber seine **Kopfzeile** behauptete damals
> `28 locales, 253 keys each`, was für 26 Dateien falsch war. Sie nennt jetzt beide Zahlen:
> `28 locale(s) at 100%, 0 partial`. Eine Zusammenfassung darf nicht grüner sein als die
> Zeilen darunter. Der Nachzug ist unten beschrieben.

**Ehrliche Kennzeichnung:** nur `de_DE`, `en_US` und `en_GB` sind als **geprüft** markiert. Die
anderen 25 habe **ich** übersetzt, ohne muttersprachliche Kontrolle — sie stehen im Sprachmenü mit
dem Hinweis „ungeprüft" daneben. Maschinenausgabe als fertige Arbeit auszugeben wäre genau die
ungedeckte Zusicherung, die dieses Projekt vermeiden will.

**Das Gate prüft mehr als Vollständigkeit:** unbekannte Schlüssel, abweichende Platzhalter (ein
verlorenes `{{count}}` landet als Text beim Nutzer) und den Verdacht „diese Datei ist nur eine
englische Kopie" (> 90 % identisch zu `en_US` bei einer nicht-englischen Sprache). Gemessene
Identitätsquoten: 2 % (`zh_CN`) bis 11 % (`da_DK`) — der Rest sind Eigennamen wie „App Store",
„Remote ID" und `{{platzhalter}}`.

### Belege Phase 3 (2026-07-30)

```
npm run verify   ✓   type-check · lint · 63 Tests · build · build-gate · i18n-gate · privacy-gate
```

Vier Startbeweise aus dem **echten Build**, je mit Screenshot und JSON-Report:

```
wide-light    ok=True  width=1180  theme=light  lang=de-DE  layout=sidebar  keine rohen Keys
wide-dark     ok=True  width=1180  theme=dark   lang=de-DE  layout=sidebar  keine rohen Keys
narrow-light  ok=True  width=560   theme=light  lang=de-DE  layout=pill     keine rohen Keys
narrow-dark   ok=True  width=560   theme=dark   lang=de-DE  layout=pill     keine rohen Keys
```

Gegenprobe mit nicht-lateinischer Schrift: `ja_JP` → „デバイス", `ru_RU` → „Устройство",
beide ohne rohe i18n-Keys.

### Ein Bug, den der Linter gefunden hat — kein Stilproblem

`bg.match(/oklch\(([0-9.]+)/)` stand **innerhalb eines Template-Strings**, der in den Renderer
injiziert wird. Der String verschluckt den Backslash, und im Browser wäre `oklch(` als
**Gruppenanfang** angekommen statt als Klammer — die Prüfung hätte stillschweigend das Falsche
gemessen. `no-useless-escape` hat genau das gemeldet. Jetzt ohne Regex.

## Phasen 3b–7: gebaut — und was ein Rundgang durchs echte Fenster daran gefunden hat

Dateien, Fotos, Apps, ZeroTier, Power-Aktionen und der Alt-Import sind umgesetzt. Belegt wird
das nicht durch die Existenz der Dateien, sondern durch zwei Werkzeuge, die beide **an der
laufenden Anwendung** messen.

### Das Werkzeug, das gefehlt hat: die Leser gegen das echte Gerät

`verify:live` hat bis dahin gemessen, was das Gerät **sagt** — Methode, Status, Bytes, Form der
Antwort. Das ist Erreichbarkeit. Es ist nicht **Eignung**: eine Form kann sauber protokolliert
sein, während der eigene Parser sie ablehnt. Genau das war der Fall.

`src/main/app/parserProbes.ts` ruft jetzt dieselben Funktionen auf, die auch die IPC-Handler
benutzen, und meldet Zahlen statt „kein Fehler":

```
readers against the real device:
   ok   apps.listApps            18 app(s); 15 with a published port
   ok   system.readDeviceInfo    model=Default string
   ok   system.readUtilization   cpu=10% mem=35%
   ok   system.listVolumes       2 volume(s)
   ok   files.listDirectory      34 entr(ies) under /media/ZimaOS-HD
   ok   files.listTasks          0 task(s)
   ok   files.listTrash          117 entr(ies)
   ok   files.listPins           3 pin(s)
   ok   photos.galleryPage       24 asset(s) of 1098
   ok   photos.readProgress      status=idle 1076/1076 images
```

Beim **ersten** Lauf waren drei davon rot.

### 🔴 Drei Bildschirme, ein Fehler: die Hülle wurde am falschen Merkmal erkannt

`unwrap` packte `data` nur aus, wenn die Antwort ein numerisches `success`-Feld trug. Das haben
aber nur die **v1**-Endpunkte. Gemessen am laufenden v1.7.0-Host — es gibt **drei** Familien:

| Form | Endpunkte |
| --- | --- |
| `{success,message,data}` | `/v1/sys/utilization`, `/v1/users/current`, `/v1/sys/hardware` |
| `{data,message}` | `/v2_1/files/tasks`, `/v2/app_management/web/appgrid` |
| `{data}` | `/v2_1/files/trash`, `/v2_1/files/trash/stats`, `/v2/app_management/installed/list` |
| nackte Nutzlast | `/v2_1/files/file`, `/v2/photos/*`, `/v2/zimaos/device/info`, `/v2_1/files/pin` |

Jede v2-Liste kam damit **noch verpackt** beim Parser an: `expected array, received object` —
auf Apps, Papierkorb und Aufgabenliste. Im Fenster stand „Das Gerät hat in einer Form
geantwortet, die dieser Client nicht versteht." Dieselbe Fehlerfamilie wie beim
Refresh-Token: ein **ungemessener Nachbar** hat die Annahme des gemessenen geerbt.

Die neue Erkennung ist bewusst **eng**: `data` vorhanden **und** jeder Schlüssel aus
`{success, message, data}`. Ein bloßes `'data' in body` würde jede Nutzlast auspacken, die
zufällig ein `data`-Feld besitzt — eine Ausnahme so breit wie die Regel. Gegen alle 21
gemessenen 200-Antworten geprüft: keine nackte Nutzlast hat ein `data` auf oberster Ebene.

**Positivkontrolle gefahren:** den alten Ausdruck wieder eingesetzt → **3 Tests rot**, genau
die drei v2-Familien. Jede Familie hat ihr eigenes Fixture; ein gemeinsames hätte den
Unterschied wieder wegvereinfacht.

### Der Rundgang: alle vier Bildschirme, geklickt statt gesetzt

`ZIMA_VERIFY_SCENARIO=tour` klickt die echten Navigationsknöpfe, wartet auf Daten vom Gerät
und zählt, was gerendert wurde — pro Abschnitt ein Screenshot daneben.

```
ok = true   failures: []
device   cards=14 rows=16 images=0   broken=0  buttons=23
files    cards=3  rows=34 images=0   broken=0  buttons=57
photos   cards=3  rows=0  images=120 broken=0  buttons=132
apps     cards=18 rows=0  images=2   broken=0  buttons=56
```

Drei Befunde, die **nur** dieser Lauf gezeigt hat:

1. **Der Knopf „Gerät" war für nichts auffindbar, was auf gerendertem Text sucht.** Sein Icon
   ist der Buchstabe „Z", also lautet sein Textinhalt `ZGerät`. Die Sidebar-Knöpfe haben jetzt
   ein ausdrückliches `aria-label`. Daneben lag ein echter a11y-Fehler: das `<nav>` der
   Seitenleiste trug `aria-label={t('nav.device')}` — ein Screenreader kündigte die gesamte
   Navigation als „Gerät" an.
2. **Die Prüfung auf rohe i18n-Keys beschuldigte zwei echte Dateien.** Sie suchte nach
   `wort.wort` und zog danach eine handgepflegte Endungsliste ab — `location.sh` und
   `wechseln.sh` auf dem Gerät galten als unübersetzter Oberflächentext. Eine Endungsliste ist
   eine Vermutung über fremde Dateinamen. Gefragt wird jetzt gegen den **echten Katalog**
   (`src/main/app/catalogueKeys.ts`): ist das Token ein Schlüssel, den `en_US` definiert?
3. **Der Report schnitt den Bildschirm ab.** Zwei Schnitte hintereinander (400 und 1200
   Zeichen) endeten mitten in der Geräteliste — alles darunter fehlte im Report, während der
   Report vollständig aussah. Ein Verifikationsbericht, der still die untere Hälfte weglässt,
   ist ein Bericht über die obere Hälfte.

### Nachtrag: die App-Icons werden jetzt geladen

Auf Wunsch des Betreuers (2026-07-30) holt der Client **alle** Icons, die die App-Metadaten nennen —
auch von fremden Hosts (github, jsdelivr, imgur, `icon.casaos.io`). Vorher zeigten 16 von 18
Kacheln nur einen Buchstaben.

Die alte Beschränkung „nur was das Gerät selbst ausliefert" hat den Fall, nach dem sie benannt
war, gar nicht verhindert: das **Box.com-Logo auf der Immich-Kachel** stammte aus einem
falschen Store-Eintrag — sie ersetzte ein falsches Bild durch **kein** Bild und kostete jedes
richtige mit.

Der Abruf ist stattdessen gehärtet: aus dem **Hauptprozess** (der Renderer öffnet keine
Verbindung, die strenge `img-src`-CSP bleibt), `credentials: 'omit'` (kein Cookie, kein Token
an Dritte), nur `http`/`https`, die Antwort **muss** ein Bild sein, dazu Größen- und
Zeitschranke. Bleibt der ehrliche Preis: ein Icon-Abruf verrät die IP dieses Rechners an
dessen Hoster — genauso wie die Weboberfläche des Geräts.

**Zwei Dinge hat erst der Lauf gezeigt:**

* Die erste Größenschranke (256 KiB) war aus der Vorstellung abgeleitet, was ein Icon wiegen
  *sollte*. Der erste Lauf gegen die echte App-Liste verwarf ein legitimes Icon mit
  **1 499 594 Bytes**. Jetzt 4 MiB — die Schranke soll eine bösartige Antwort begrenzen, kein
  Urteil über Bildgrößen fällen.
* Zwei Icon-URLs antworten **404** (tote Links in den Metadaten). Die Kachel fällt auf den
  Buchstaben zurück, statt ein kaputtes Bild zu zeigen; der Grund steht im Log.

Dabei fiel auf, dass `notFound()` **stumm** war: drei Icons scheiterten, und im Log stand
nichts, weil nur die spezifischen Ablehnungen protokollierten und die allgemeinen Ausgänge
nicht. Der Text eines 404 geht an ein `<img>` und wird dort verworfen — er muss zusätzlich
ins Log.

```
apps: cards=18 rows=0 images=14 broken=0     (vorher: images=2)
```

### Ein Fehler von mir, der dabei entstanden ist

16 von 18 App-Kacheln zeigen einen Buchstaben statt ihres Icons. Ich habe gemessen, dass
`media.foreign-icon-blocked` **0-mal** im Log steht, und daraus geschlossen, der
`appicon`-Handler werde nie benutzt — dann funktionierenden Code umgebaut. Ergebnis: die
**zwei** Icons, die vorher liefen, waren danach kaputt (`broken=0` → `broken=2`).

Tatsächlich entscheidet `ipc/appsHandlers.ts` das bereits selbst und übergibt dem Renderer
eine fertige `zima-media://`-URL oder `null`. Meine Änderung kodierte sie ein zweites Mal.
Eine leere Zählung an der **zweiten** Verteidigungslinie belegt nicht „ungenutzt" — sie kann
belegen, dass die **erste** sauber arbeitet. Zurückgenommen; die entscheidende Stelle loggt
jetzt (`apps.icon-not-device-served`), damit „bewusster Platzhalter" und „kaputte Pipeline"
unterscheidbar sind. Gefunden hat es der Rundgang, nicht ich.

## `npm run dev` war kaputt — durch den X11-Relaunch

Gemeldet aus der Benutzung am 2026-07-30: `electron-vite dev` lief los, meldete
`platform.relaunch-on-x11` — und danach nichts mehr.

**Gemessen, statt vermutet:**

| Prüfpunkt | Befund |
| --- | --- |
| Elternprozess des Electron | `systemd --user` statt electron-vite → **abgekoppelt** |
| Vite-Dev-Server auf 5173 | **lief nicht mehr** |
| electron-vite-Prozesse | **keine** |

Ursache: `app.relaunch()` startet einen **losgelösten** Prozess und beendet den aktuellen.
electron-vite ist aber der Elternprozess — es sieht Electron enden, fährt den Dev-Server
herunter, und übrig bleibt ein Fenster, dessen Renderer-Quelle es nicht mehr gibt. Der
Mechanismus, der die App auf einer kaputten Grafik**stack** rettet, zerlegt die
Entwicklungsumgebung.

**Behoben:** Unter `electron-vite dev` (erkennbar an `ELECTRON_RENDERER_URL`, das
electron-vite selbst setzt) wird **nicht** relauncht. Stattdessen steht der Grund samt
Startkommando auf stderr und im Log — das Werkzeug bleibt heil, der Entwickler entscheidet.

### Zwei Sackgassen, beide gemessen statt geglaubt

* **`ELECTRON_OZONE_PLATFORM_HINT=x11` wirkt nicht.** Mit Hint und unterdrücktem Relaunch
  stirbt der Prozess weiterhin mit **SIGSEGV**. Ich hatte den Hint erst *eingebaut* und dann
  gemessen — in dieser Reihenfolge wäre er zur Falle geworden: Der Code hätte „schon auf
  X11" geglaubt und genau den Relaunch unterdrückt, der hilft. Die Messung hat es gefangen,
  die Reihenfolge war trotzdem falsch herum.
* **`ELECTRON_CLI_ARGS` von Hand zu setzen bringt nichts.** Die Variable existiert, aber
  `electron-vite/dist/cli.js:59` **überschreibt** sie mit dem, was nach `--` steht — sie ist
  ein Ausgang der CLI, kein Eingang.

**Was funktioniert:** `npm run dev:x11` = `electron-vite dev -- --ozone-platform=x11`. Nur
argv zählt, weil Ozone seine Plattform wählt, bevor irgendein JavaScript läuft.

```
Vite-Server auf 5173     läuft
electron-vite-Prozesse   3
Electron                 --ozone-platform=x11, Elternprozess = electron-vite
forcedX11                true, Fenster offen
```

## ZeroTier: der Client bringt sein eigenes Binary mit

Der Remote-ID-Weg scheiterte zunächst mit „Dieser Verbindungsweg ist in dieser Fassung noch
nicht verfügbar" — einem Textrest aus der Zeit, als er wirklich nicht gebaut war. Dahinter
lagen **drei** echte Fehler und ein Rechteproblem.

### Drei Fehler, die der Text verdeckte

1. **Der Daemon startete nie.** Der Aufruf war `['-p', '9997', …]`. ZeroTier erkennt
   `-p 9997` mit Leerzeichen nicht, druckt seine Usage-Meldung und beendet sich mit **Code
   0**. Richtig ist `-p9997` — der 0.9-Client hatte es so; es war ein Abschreibfehler.
2. **`stdio: 'ignore'` warf die Erklärung weg.** Der Daemon schrieb den Grund auf stderr,
   das Log sagte nur „exited, code 0". Ein Diagnosewert, verworfen im Moment seiner
   Entstehung.
3. **Die Detailzeile zeigte nur `kind=remote-id`.** `errorDetail` rendert ausschließlich den
   `context` und ließ `message` — also die eigentliche Ursache — auf dem letzten Schritt vor
   dem Bildschirm fallen.

### Das eigentliche Hindernis, gemessen

```
ERROR: unable to configure TUN/TAP device for TAP operation
```

Ein unprivilegierter `zerotier-one` darf kein virtuelles Netzwerkgerät anlegen — und
**akzeptiert den Beitritt trotzdem**, ohne je in das Netz zu kommen. Dieselbe Familie wie
„der Store nimmt die Anfrage an und führt sie nicht aus": die Zusage kommt von der Seite,
die entgegennimmt, nicht von der, die arbeitet.

| Binary | Capabilities |
| --- | --- |
| `~/.local/lib/…/zerotier-one` des 0.9-Clients | `cap_net_admin,cap_net_raw,cap_net_bind_service` |
| `/usr/sbin/zerotier-one` (Distribution) | **keine** — systemd startet es als root |

Den laufenden System-Daemon mitzubenutzen scheidet ebenfalls aus: sein API-Token ist
root-only — **gemessen**, auch als Mitglied der Gruppe `zerotier-one` nicht lesbar.

### Die Lösung: eigenes Binary, fremdes unangetastet

`src/main/zerotier/provision.ts` kopiert das mitgelieferte `zerotier-one` nach
`~/.local/lib/zima-linux-client/zerotier/`. Die Distribution besitzt ihr Binary; wir
befähigen unseres.

### 🔴 Und dann war der erste Entwurf davon zweimal falsch

Erteilt wurde die Capability zunächst per `pkexec setcap` aus der App heraus. Das scheiterte
mit `pkexec must be setuid root` — an einem `/usr/bin/pkexec`, das nachweislich
`-rwsr-xr-x root root` ist. Die Ursache stand nicht in der Meldung:

```
/proc/<electron-main>/status        NoNewPrivs: 1
unser Daemon (Kind von Electron)    CapEff: 0000000000000000   NoNewPrivs: 1
0.9-Daemon (Kind von systemd --user) CapEff: 0000000000003400   NoNewPrivs: 0
```

Der Electron-Hauptprozess läuft mit `no_new_privs`. Das Flag vererbt sich an jedes Kind, ist
nicht löschbar, und der Kernel ignoriert dann **setuid-Bit und Datei-Capabilities** beim
`execve`. Daraus zwei Fehler in einem:

1. `pkexec` konnte nie funktionieren. Das Bit war da; der Kernel hat es ignoriert.
2. Der teurere: **die Rechteerteilung hätte nichts genützt.** Ein aus unserem Prozessbaum
   gestarteter Daemon läuft mit `CapEff: 0`, egal was `getcap` über die Datei sagt. Der
   Nutzer hätte sein Passwort für eine folgenlose Änderung getippt.

Der Beleg, auf den ich mich gestützt hatte — „der 0.9-Client liefert sein eigenes Binary mit
`setcap` aus und funktioniert weiter" — war richtig gemessen und falsch verwendet: ich hatte
`getcap` auf die Datei geprüft, **nie wie sie gestartet wird**. Sie läuft über
`~/.config/systemd/user/zima-zerotier.service`, also durch `systemd --user`, in einem anderen
Prozessbaum. Ein funktionierendes Vorbild belegt seinen eigenen Aufbau, nicht meinen.

### Die Fassung, die trägt

**Der Start verlässt den Prozessbaum.** `src/main/zerotier/supervisor.ts` startet den Daemon
als transiente `systemd --user`-Unit. Positivkontrolle **aus dem eingeschränkten Kontext** —
aus einer sauberen Shell hätte sie nichts bewiesen:

```
$ setpriv --no-new-privs sh -c 'systemd-run --user --pipe --wait ... grep NoNewPrivs'
NoNewPrivs: 0
```

**`locateBinary` wählt nach der Eigenschaft, nicht nach dem Ort.** Die feste Reihenfolge war
an einem Tag in beide Richtungen falsch: erst das System-Binary (kann nie Capabilities
haben), dann unsere Kopie (die sie beim Kopieren *verliert* — `copyFileSync` überträgt keine
xattrs). Jetzt gewinnt der erste Kandidat mit `CAP_NET_ADMIN`; der Ort ist nur noch
Stichentscheid.

**Die Rechteerteilung macht die App nicht mehr selbst.** Zwei Gründe: sie kann es nicht
(siehe oben), und sie sollte es nicht — eine Anwendung, die ihren eigenen Passwortdialog
hochzieht, erzieht dazu, das Passwort bei allem einzutippen, was danach fragt.

* **`.deb`/`.rpm`:** `build/linux-after-install.sh` setzt die Capability im Post-Install, wo
  root ohnehin vorhanden ist. Niemand wird je gefragt. Das Ergebnis wird zurückgelesen — auf
  `nosuid`- oder xattr-losen Dateisystemen liefert `setcap` 0 und wirkt trotzdem nicht.
* **AppImage/Tarball:** die Oberfläche zeigt **den einen Befehl** zum Kopieren an, im
  Terminal des Nutzers, wo er ihn vorher lesen kann.

**Belegt am laufenden System (2026-07-30):**

```
unser Daemon über systemd --user       NoNewPrivs: 0   CapEff: 0000000000000000
  (0, weil die Datei das Recht noch nicht trägt)
Gegenprobe, gleiche Startroute,
ein Binary MIT dem Recht              NoNewPrivs: 0   CapEff: 0000000000003400
```

Die Kette ist damit vollständig gemessen: Startweg ✓, Rechtewirksamkeit ✓.

### 🔴 Und dann war „die Datei hat das Recht" wieder nicht die Frage

Nach dem ersten echten `setcap` kam nicht die Verbindung, sondern
`joined … but the daemon does not list it`. Gemessen:

```
getcap <binary>                       cap_net_admin,… =eip      (Datei: erteilt)
/proc/<laufender Daemon>/CapEff       0000000000000000          (Prozess: nichts)

Daemon gestartet   19:43:32
setcap (ctime)     19:44:56
```

Capabilities wirken beim `execve`. Ein **laufender** Prozess bekommt sie nie nachträglich —
der Daemon war 84 Sekunden vor der Erteilung gestartet. Zwei Stellen im Code lagen deshalb
falsch, beide mit derselben Verwechslung von Datei und Prozess:

* `ensureRunning()` kehrte bei jedem antwortenden Daemon sofort zurück. **Laufend ist nicht
  fähig.** Jetzt wird der laufende Prozess geprüft und **einmal** neu gestartet, wenn er das
  Recht nicht hat, das Binary es aber hergäbe. `null` („nicht feststellbar") ist ausdrücklich
  kein Grund zum Neustart — sonst würden laufende Netze grundlos abgeworfen.
* `joinBlockedReason()` fragte `getcap` auf der **Datei** — die sagte jetzt ja — und ließ die
  nichtssagende Meldung „does not list it" stehen. Jetzt wird `CapEff` aus
  `/proc/<pid>/status` gelesen, der PID über `systemctl --user show -p MainPID` **von systemd
  erfragt** statt per Namenssuche (auf dieser Maschine laufen drei ZeroTier-Daemons).

Zusätzlich: der Beitritt wird jetzt **gepollt** statt einmal gelesen — die Mitgliedschaft
erscheint erst kurz nach dem POST in `/network`, und ein Rennen als Diagnose auszugeben ist
schlimmer als gar keine.

**Belegt, Ende zu Ende, im echten Fenster (2026-07-30 19:48):**

```
zerotier.service-started  binary=~/.local/lib/zima-linux-client/zerotier/zerotier-one
/proc/<daemon>/CapEff     0000000000003400        ← das Recht wirkt jetzt
zerotier.joined           <remote-id>
remote-id.resolved        host=<zt-adresse>  latencyMs=28
session.signed-in         kind=remote-id  role=admin
```

Vom Nutzer bestätigt: „läuft — konnte mich einloggen."

**Nebenbefund am eigenen Prüfwerkzeug:** Das Szenario meldete bei genau diesem geglückten
Lauf `ok: false` — es verlangte ein Passwortfeld, die gespeicherte Sitzung lief aber direkt
bis zum angemeldeten Bildschirm durch. Ein Wächter, der beim guten Ausgang rot wird, wird
weggeschaut; die Bedingung akzeptiert jetzt beide Ausgänge.

**Noch offen:** die Erteilung über `.deb`/`.rpm` (`build/linux-after-install.sh`) ist gebaut,
aber nicht aus einem echten Paket heraus belegt — dafür muss erst ein Paket gebaut und
installiert werden.

## Nach dem Neustart: „Wird geladen" ohne Ende — und ein 400 bei jedem Besuch der Dateien

Zwei Meldungen aus dem Betrieb, mit unterschiedlichen Ursachen.

### Es gab kein Messgerät

Der erste Befund war, dass ich **keinen** hatte: kein Zeitprotokoll pro Anfrage. Die Strecke
zum Gerät lag bei 3–16 ms über den Tunnel und 1–2 ms über LAN, die Verzögerung war also
unsere — und nichts konnte sagen, *welche* Anfrage. `client.ts` protokolliert jetzt jede
Anfrage, die **langsam oder erfolglos** ist, mit Dauer, Status und Bytezahl; schnelle
Erfolge bleiben stumm, denn ein Protokoll, das alles aufschreibt, schreibt nichts auf.

Die erste Zeile daraus benannte die Ursache sofort:

```
zima.request-failed  path=/v1/users/refresh  ms=10001  reason="aborted"
```

### Die Ursache: der Tunnel wird abgebaut und nie wieder aufgebaut

Der ZeroTier-Daemon wird beim Schließen des Fensters gestoppt — bewusst, dieser Client hat
keinen Hintergrundbetrieb. Aber **nichts holte ihn zurück.** Die gespeicherte Adresse
`10.x.y.1` zeigte nach jedem Neustart in einen Tunnel, den es nicht mehr gab:

```
systemctl --user is-active zima-linux-client-zerotier   inactive
ping 10.x.y.1                                            3 Pakete, 100 % Verlust
POST /v1/users/refresh über 10.x.y.1                     keine Antwort, Abbruch nach 10 s
derselbe POST über die LAN-Adresse                       401 in 3 ms
```

Deshalb liefen `/v1/users/refresh` **und** `/v1/gateway/routes` in ihren vollen Timeout und
kamen als „Überhaupt keine Antwort — möglicherweise verwirft eine Firewall die Verbindung"
zurück. Der Satz ist als Erklärung nicht falsch, hier aber grundfalsch adressiert: es gab
keine Firewall, es gab keine Strecke.

**Behoben:** Eine `remote-id`-Adresse trägt jetzt ihre `networkId` mit sich
(`DeviceAddress.networkId`), und sowohl `resume` als auch `signIn` bauen den Tunnel wieder
auf, bevor die erste Anfrage rausgeht. Für Einträge aus der Zeit davor greift der gemessene
`capabilities.zerotier.networkId` als Rückfall. Zusätzlich behält „Verbinden" bei einem
gespeicherten Gerät die Art `remote-id`, statt sie auf `direct` herunterzustufen — dabei ging
genau die Angabe verloren, die den Wiederaufbau möglich macht.

**Belegt (2026-07-30 20:06):**

```
session.reopening-remote-road  host=<zt-adresse>
zerotier.service-started       binary=~/.local/lib/zima-linux-client/zerotier/zerotier-one
zerotier.joined                <remote-id>
session.zerotier-probed        state=online            ← 1,1 s nach app.ready
ping <zt-adresse>              2 von 2, 0 % Verlust, 2 ms
```

Kein `zima.request`-Eintrag mehr — nichts war langsam, nichts schlug fehl.

### ⚠️ Ein Zwischenbefund, der falsch war

Ich hatte unterwegs gemessen und berichtet: „GET geht über den Tunnel, POST hängt." Das war
**falsch** — die beiden Messungen stammten von **vor** und **nach** einem Neustart, also aus
zwei verschiedenen Welten: vorher lief der Tunnel, nachher nicht. Kurz darauf hing auch ein
GET. Der Zustand der Strecke muss im **selben Atemzug** festgestellt werden wie die Anfrage,
über die geurteilt wird; sonst vergleicht man zwei unzusammenhängende Augenblicke.

### Der 400: ein Pfad, den niemand genannt hat

`server rejected the path · /v2_1/files/file · status=400` bei **jedem** Besuch der Dateien.
`FilesScreen` fragte `useDirectory(root ?? '/')`, während die Datenträgerliste noch unterwegs
war — also eine Anfrage nach `/`, einer Wurzel, die das Gerät nicht listet (ZimaOS bedient
`/media/…` und `/DATA/…`). Der Kommentar direkt daneben sagte die Regel bereits („eine
geratene Wurzel sähe aus wie ein kaputter Client"), und der Rückfall drei Zeilen darüber
brach sie.

**Behoben in der Datenschicht, nicht im Bildschirm:** `useDirectory` nimmt jetzt
`string | null` und bleibt bei `null` untätig (`enabled`). Ein Aufrufer ohne Pfad *kann*
nicht mehr fragen — das ist der Unterschied zwischen einer Regel, die dasteht, und einer,
die gilt.

## Remote ID — der dritte Weg hinein, in der Form, die der Nutzer erwartet

Der Ablauf ist: **lokal scannen ODER eine Remote-ID eingeben → Benutzer und Passwort → drin.**
Der ZeroTier-Beitritt ist Mechanik, kein Schritt, den jemand von Hand ausführt.

Genau das war zuvor falsch gebaut: Es gab ein ZeroTier-Panel mit Netzwerk-ID-Feld,
„Beitreten" und „Verlassen" — eine Netzwerkverwaltung, wo ein Verbindungsweg hingehört.
Aus der Benutzung als verkehrt gemeldet, zu Recht.

### Was dafür gemessen wurde

| Frage | Antwort | Woran gemessen |
| --- | --- | --- |
| Was ist die Remote-ID? | die **ZeroTier-Netzwerk-ID** des Geräts (16 Hex) | das Gerät meldet sie selbst in `GET /v2/zimaos/zt/info` |
| Wo ist das Gerät in diesem Netz? | die erste Host-Adresse der Netz-Route (`<x.y>.0.0/16` → `<x.y>.0.1`) | das Gerät nennt in derselben Antwort genau diese `ip` |
| Stimmt das mit dem Alt-Client überein? | ja | `legacy-0.9/main/zerotier/manager.ts` leitet unabhängig dieselbe Adresse ab |

Zwei unabhängige Quellen sagen dasselbe — und die Adresse bleibt trotzdem ein **Kandidat**:
Sie geht durch dieselbe Probe wie ein mDNS-Treffer oder eine getippte IP. Das Gerät kann man
nicht fragen, wo es ist, bevor man es erreicht; also wird abgeleitet und dann **gemessen**.

`connect:remote-id` erledigt in einem Schritt, was das Panel dem Nutzer aufbürdete: Daemon
starten, beitreten, Adresse ableiten, Erreichbarkeit belegen — und liefert eine Adresse ans
Anmeldeformular oder einen **benannten** Grund. `ACCESS_DENIED` wird dabei eigens genannt:
Das ist ein privates Netz ohne Freigabe, und da hilft kein Proben.

**Im Fenster belegt:** die drei Wege stehen gleichrangig nebeneinander —
„Lokales Netzwerk durchsuchen", „Über IP-Adresse verbinden", „Über Remote-ID verbinden".

**Noch nicht belegt:** ein vollständiger Durchlauf über die Remote-ID bis zur angemeldeten
Sitzung. Der Beitritt startet den eigenen Daemon auf Port 9997; dass das auf dieser Maschine
klappt, ist wahrscheinlich (der 0.9-Client betreibt seit Monaten einen unprivilegierten
Daemon auf 9995), aber **nicht von mir gemessen** — und der Login braucht ein Passwort.

## Tailscale — erkannt, nie übernommen

Ein zweiter Weg neben ZeroTier, gemessen am 2026-07-30 (Tailscale 1.98.9):

```
tailscale status --json  als normaler Benutzer   exit 0 — KEIN root nötig
/var/run/tailscale/tailscaled.sock               srw-rw-rw- (0666)
BackendState                                     Running
```

**Warum nur Erkennung, kein Betrieb.** Für ZeroTier startet dieser Client einen eigenen
Daemon, weil der System-Daemon sein Token hinter root hält. Für Tailscale wäre dasselbe
falsch — und ein gemeldeter Nutzerbericht sagt genau warum: der offizielle Zima-Client
übernimmt ZeroTier für seinen Fernzugriff und verdrängt dabei das vom Nutzer eingerichtete
DNS; dessen AdGuard-Filterung hört auf zu wirken, und er muss sich zwischen Fernzugriff und
eigenem Resolver entscheiden. Wer den Tunnel an sich reißt, trifft diese Wahl für den Nutzer.

Deshalb: läuft ein Tunnel, wird er **benutzt**. Nichts wird gestartet, gestoppt, umkonfiguriert,
kein DNS angefasst. Der Kanal `tailscale:state` ist **nur lesend** — kein Join, kein Leave.

**Ein Peer namens „ZimaOS" ist kein Beleg für ein ZimaOS-Gerät.** Die Peers sind Kandidaten;
es entscheidet dieselbe Probe, die auch LAN- und IP-Adressen qualifiziert. Am echten Tailnet
gemessen:

```
probing each candidate (gateway route table, the same check as LAN):
  ZimaOS   100.64.0.3         82ms      (Peer heißt "ZimaBoard")
  ZimaOS   100.64.0.4         67ms
  no       100.64.0.5         refused   (Peer heißt "homeassistant")
  ZimaOS   100.64.0.6         36ms

3 of 4 peer(s) answer as ZimaOS over Tailscale
```

Ein Namensfilter hätte `ZimaBoard` übersehen und zwei ununterscheidbare „ZimaOS" behalten.
Genau das prüft eine Positivkontrolle im Test: `homeassistant` **muss** angeboten werden.

**Im Fenster belegt** (Rundgang, `de_DE`): Panel mit `Running`, Tailnet-Name und vier Peers,
jeder mit „Verwenden"; `ok=true`, keine rohen i18n-Keys. Fehlt Tailscale, zeichnet das Panel
**nichts** — auf den meisten Rechnern wäre es sonst nur Lärm, und „nicht installiert" ist kein
zu meldendes Problem.

**Noch offen:** ein Anmeldevorgang über eine Tailscale-Adresse von Anfang bis Ende (der
Verbindungsweg ist verdrahtet und typgeprüft, aber nicht durchgeklickt — dafür braucht es ein
Passwort), und die 26 unvollständigen Sprachdateien enthalten die fünf neuen
`tailscale.*`-Schlüssel noch nicht.

## 28 Sprachen vollständig — und der Wächter, der das gar nicht hätte sehen können

Am 2026-07-31 sind die fehlenden **169 Schlüssel × 26 Sprachen** nachgezogen. Das Gate:

```
i18n gate: clean — 28 locales, 280 keys in en_US; 28 locale(s) at 100%, 0 partial
höchste Identitätsquote zu en_US: 8 %   (zh_CN/zh_TW: 2 %)
```

Die Identitätsquote ist die Gegenprobe gegen „englische Kopie mit anderem Dateinamen": bliebe
eine Datei bei über 90 % identisch zu `en_US`, schlägt das Gate an. Der Rest sind Eigennamen
(`Tailscale`, `ZeroTier`, `Remote ID`, `W`) und Platzhalter.

Zusammengeführt wurde **additiv**: ein Schlüssel, der schon einen Wert hatte, wird nicht
überschrieben — sonst hätte der Nachzug die gepflegten 111 Zeilen jeder Datei stillschweigend
ersetzt.

### 🔴 Der Rundgang konnte in keiner anderen Sprache als Deutsch laufen

Beim Versuch, die neuen Zeichenketten **im Fenster** zu belegen, meldete
`ZIMA_VERIFY_LOCALE=ja_JP ZIMA_VERIFY_SCENARIO=tour`:

```
navigation button for "Gerät" not found
navigation button for "Dateien" not found
navigation button for "Fotos" not found
navigation button for "Apps" not found       ← ok=false, bei völlig heiler Navigation
```

Der Rundgang suchte seine Knöpfe am **gerenderten Text** — also am deutschen. Damit prüfte er
die Übersetzung statt die Navigation und konnte genau dort nichts belegen, wo er gebraucht
wurde: in den 27 anderen Sprachen. Jetzt tragen die Knöpfe `data-nav="<section>"`, und der
Rundgang klickt darauf; der Text darf sich ändern, ohne die Prüfung umzuwerfen.

**Zweiter Fund derselben Familie im selben Werkzeug:** die Liste verbotener Bildschirmtexte
(„Da ist etwas schiefgegangen", „lehnt diesen Pfad ab") ist **deutscher Fließtext**. In `ja_JP`
kann sie nicht auftauchen, auch wenn die App kaputt ist — die Prüfung wäre grün gewesen und
hätte nichts geprüft. Sie ist jetzt geteilt: sprachunabhängig (`NaN`, `undefined`,
`Not implemented yet`) gilt immer, die deutschen nur bei `lang=de*`, und der Report schreibt
mit, **welcher Satz in Kraft war** (`forbidden.scope`).

### Was damit belegt ist — und was nicht

```
Startbeweis in sechs Sprachen (frisches Profil):
  ja_JP ru_RU ml_IN ga_IE zh_TW tr_TR   ok=true, rawKeys=[], failures=[]
Rundgang ja_JP über alle vier Bildschirme:
  locale=ja-JP  device/files/photos/apps: click ok, keine rohen Keys, keine verbotenen Texte
```

**Ehrliche Grenze:** in diesem Lauf stand **keine** Sitzung, deshalb zeigten Dateien, Fotos und
Apps ihre Abmelde- bzw. Leerzustände (`サインインしてください。`). Belegt sind damit die
Navigation, das Geräte-Panel, das Tailscale-Panel und die Fehler-/Leertexte auf Japanisch —
**nicht** die Listentexte mit echten Daten. Dafür braucht es einen Rundgang mit angemeldeter
Sitzung in einer nicht-deutschen Sprache; der steht aus.

> **Stolperstein fürs nächste Mal:** `./node_modules/.bin/electron out/main/index.js` benutzt
> `~/.config/Electron` als Profil, **nicht** `~/.config/zima-linux-client`. Der erste Lauf sah
> deshalb „noch keine Geräte gespeichert" und das sah nach Datenverlust aus. Wer das echte
> Profil messen will, muss `--user-data-dir` mitgeben.

### 🔴 Und ein Fehler, den ich dabei selbst gebaut habe

`ZIMA_VERIFY_SCENARIO=tour` **ohne** `:pfad` ließ das Argument leer, `dirname('')` ergibt `.`,
und der Rundgang schrieb seine vier Screenshots ins **aktuelle Verzeichnis** — also in die
Wurzel des Repositorys. Von dort hat mein `git add -A` sie mitgenommen: Bilder eines echten
Tailnets samt Peer-Adressen in einem Commit. Bemerkt beim Durchsehen der Commit-Statistik,
zurückgenommen per `--amend` (nichts war gepusht, und `git rev-list --all --objects` findet die
Blobs nicht mehr); `tour-*.png` und die Report-Dateien stehen jetzt in `.gitignore`.

Der Rückfall auf das Arbeitsverzeichnis ist genau die Sorte Default, die einen Fehler
**unsichtbar** macht statt harmlos: ein vergessenes Argument wird zu Dateien, wo niemand sie
sucht. Jetzt fällt der Pfad auf `ZIMA_VERIFY_STARTUP` zurück und **scheitert laut**, wenn auch
das fehlt. Positivkontrolle gefahren — Rundgang ohne `:pfad`: 0 PNG im Repo, 5 neben dem
Report, `ok=true`.

> **Nebenbefund, inzwischen behoben:** die Testsuite schrieb in die **echte** Logdatei des
> Nutzers. Siehe [den eigenen Abschnitt weiter unten](#der-testlauf-schrieb-ins-log-des-nutzers--123-zeilen-pro-lauf).

## Was ausdrücklich noch nicht existiert

*(Stand Phase 3 — die Platzhalter sind inzwischen durch die echten Bildschirme ersetzt, siehe
oben. Was hier steht, gilt nur noch für die verbliebenen Lücken.)*

Es fehlen weiterhin:

* ~~**Playwright-E2E.**~~ **Erledigt 2026-08-09** (`66f2371`): Aufzeichnungs-Proxy, Scrubber und
  Replay-Server, vier Fälle, laufen ohne Gerät in CI.
* ~~**Anmeldung über eine Tailscale-Adresse**~~ **Erledigt 2026-08-09** (`66f2371`), durchgeklickt
  über den DERP-Relay, nicht über das LAN.
* ~~**Distro-Start-Matrix**~~ **Erledigt 2026-08-09**: sechs von sechs Zeilen grün, am
  ausgelieferten Paket, mit eingeschaltetem Sandkasten — siehe
  [Distro-Start-Matrix](#-distro-start-matrix-sechs-von-sechs-am-ausgelieferten-paket).
  Offen bleibt die **arm64**-Frage beim mitgelieferten ZeroTier-Binary.
* **Muttersprachliche Prüfung der Übersetzungen.** Alle 28 Kataloge sind seit 2026-07-31
  vollständig (280/280), aber 25 davon habe **ich** übersetzt — sie stehen weiterhin als
  `reviewed: false` im Sprachmenü. Vollständig ist nicht dasselbe wie richtig.
* ~~**Sub-Account-Rechte**~~ **Beantwortet 2026-08-09** — die Frage ist auf ZimaOS 1.7.0
  gegenstandslos, siehe den nächsten Abschnitt.

## Sub-Account-Rechte — die Frage hat auf ZimaOS 1.7.0 keinen Gegenstand

Plan § 14 Punkt 6 wollte wissen, welche Endpunkte ein **Nicht-Admin** benutzen darf. Die Antwort
ist nicht „diese hier" und auch nicht „unbekannt", sondern: **ein zweites Konto gibt es nicht.**
Gemessen 2026-08-09 gegen einen ZimaOS-**v1.7.0**-Host im LAN (`PRETTY_NAME` aus `/etc/os-release`
über SSH gelesen), mit einem gültigen Admin-Token, ohne irgendetwas auf dem Gerät zu verändern:

| Gemessen | Antwort | Was daraus folgt |
| --- | --- | --- |
| `GET /v1/users/name` | `200`, `data` = Liste mit **genau einem** Namen | Der Endpunkt ist die Kontoliste. Auf diesem Gerät steht ein Konto darin. |
| `GET /v1/users/current` | `200`, `id: 1`, `role: "admin"` | Das eine Konto ist das erste und ist Admin. |
| `GET /v1/users/list` | `500`, `{"success":10006,"message":"User does not exist"}` | Es gibt keine Auflistung mehrerer Konten — der Pfad existiert, der Dienst kennt kein zweites. |
| `GET /v2/users/*` | `404`, `{"message":"no matching operation was found"}` | `/v2/users` steht zwar in der Gateway-Routentabelle, hat aber **keine einzige** Operation. |
| `POST /v1/users/register` (leerer Body) | `400`, `{"success":10008,"message":"Key does not exist"}` | Registrierung verlangt einen Schlüssel … |
| `GET /v1/users/status` | `200`, `initialized: true`, `key: ""` | … und der ist nach der Ersteinrichtung **leer**. `register` ist der Einrichtungs-Endpunkt des ersten Starts, keine Benutzerverwaltung. |
| ZimaOS-Web-Bundle (`index-*.js`, `vendor-api-system-*.js`) | nur `getUserInfo`, `getUserName`, `getUserStatus`, `getUserAvatar`, `updateUserAvatar` | Auch die Oberfläche des Herstellers hat kein Anlegen, kein Löschen, keine Rollenvergabe. |

**Warum das hier steht und nicht als „ungeprüft" durchgeht:** die ursprüngliche Aufgabe lautete,
ein Testkonto anzulegen und wieder zu entfernen. Ein Entfernen-Endpunkt existiert nicht — ein
angelegtes Konto wäre also **nicht zurücknehmbar** gewesen, auf einem Gerät, das in Benutzung ist.
Deshalb ist der Befund ausschließlich aus lesenden Abrufen gebaut.

**Folge für den Client:** Er darf Mehrbenutzer-Fähigkeit nirgends behaupten, und die
Rollen-Anzeige der Sitzungskarte (`role` aus dem JWT) bleibt das, was sie ist — eine Anzeige des
gelesenen Feldes, keine Zusicherung, dass andere Rollen existieren oder funktionieren.

**Geltungsbereich:** gemessen an **einem** Gerät auf **v1.7.0**, an den oben genannten Endpunkten.
Wenn ZimaOS später Konten bekommt, ist das hier ein Datum, kein Naturgesetz.

## Erfolgspfad der Anmeldung — belegt, und zwar nicht von meinem eigenen Skript

Bis hierher war jeder Beleg von einem Skript erzeugt, das ich selbst geschrieben habe. Der
folgende stammt aus einer Sitzung, die ein Mensch an der gestarteten App durchgeklickt hat
(lokaler Scan → Gerät auswählen → anmelden), auf einem ZimaOS-1.7.0-Host im LAN:

| Behauptung | Gemessen woran |
| --- | --- |
| Der lokale Scan findet ein Gerät | Discovery-Treffer, Adresse ins Formular vorbelegt |
| Anmeldung gelingt, Rolle wird gelesen | Sitzungskarte zeigt Benutzer + Rolle `admin` |
| Zugriffs-Token läuft nach ~3 h ab | Anzeige „Sitzung noch **179 min** gültig" — deckt sich mit dem in Phase 2 gemessenen `casaos`-TTL |
| Capability-Erkennung liest die echte Routenliste | **38 Gateway-Routen**, daraus 9 Funktionen als `verfügbar` |
| Fotos sind auf diesem Host vollständig | „Fotos durchsehen", „Foto-Backup" **und** „Fotosuche & Facetten" alle verfügbar — dieser Host hat das Modul, der zweite nicht (siehe Plan § 7.3.1) |
| Gerät landet in der Registry | `devices.json`, Eintrag mit „Zuletzt gesehen" und Verbindungsweg `#0` |

### Was auf der Platte liegt — nachgesehen, nicht angenommen

`credentials.json`, Modus **600**, 491 Bytes. Inhalt geprüft **ohne** die Werte auszugeben:

- enthält genau drei Felder: `secret`, `backend`, `savedAt`
- die Zeichenketten `password`, `accessToken`, `access_token` kommen **nicht** vor — es wird
  nur der Refresh-Token gespeichert, wie vorgesehen
- `backend` = `gnome_libsecret`, also ein **echter** Schlüsselbund. Nicht der
  `basic_text`-Rückfall, bei dem Electron mit einem fest eingebauten Passwort „verschlüsselt"
- der Wert beginnt base64-dekodiert mit `v11\0` — der OSCrypt-AES-Kopf. Gegenprobe: der
  Klartext-JWT (`eyJ`) ist **nirgends** in der Datei zu finden. Damit ist „verschlüsselt" an der
  Sache gemessen und nicht am Rückgabewert des Verschlüsselers

### Der Punkt, der dabei auffiel — und warum die naheliegende Fassung nichts geändert hätte

`devices.json` hatte Modus **664**, lesbar für jeden lokalen Benutzer. Keine Geheimnisse, aber
Gerätenamen und LAN-Adressen, also Netz-Topologie. Jetzt **0600**, wie die Credentials.

Die offensichtliche Lösung wäre `writeFileSync(…, { mode: 0o600 })` gewesen — und die wirkt
**nur beim Anlegen**. Auf jeder Maschine, die schon einen älteren Build laufen hatte, existiert
die Datei, behält ihren alten Modus, und die Option meldet Erfolg, ohne etwas zu ändern: der
Rückgabewert des Setzers ist kein Zeuge. Deshalb steht `chmodSync` dahinter, in `registry.ts`
**und** in `credentials.ts`.

Geprüft mit drei Tests gegen das **echte** Registry-Modul (Electrons `app.getPath` gemockt, kein
Nachbau der Schreiblogik), darunter der Fall, der hier tatsächlich vorlag: eine bestehende Datei
mit 0664. **Positivkontrolle gefahren** — `chmodSync` wieder entfernt:

```
✓ creates the registry at 0600
× tightens a registry an older build left world-readable   expected '664' to be '600'
✓ keeps the stored device readable after the tightening
```

Genau der eine Test wird rot, und zwar mit `664` — die Zahl, die vorher auf der Platte stand.

### Dieselbe Klasse eine Ebene weiter: die Logdateien

Die Logs nennen Hosts, LAN- und ZeroTier-Adressen und Anfragepfade — dieselbe Topologie wie
`devices.json`, und sie standen auf **664** (`main.log`: 23 Treffer auf RFC1918-Adressen).
electron-log legt Dateien mit `0o666 & umask` an; die Voreinstellung ist world-readable.

Beide Hälften, weil die eine ohne die andere nichts ändert:

* `transports.file.writeOptions.mode = 0o600` — gilt für **neue** Dateien.
* `tightenLogFiles()` (`src/main/logging/permissions.ts`), einmal beim Start — für die, die
  schon da sind. Bewusst eng: nur `*.log` und rotierte `*.log.<n>` **direkt** in diesem einen
  Verzeichnis, keine Rekursion, kein anderes Suffix. Eine Rechte-Umstellung fasst Dateien an,
  die sie nicht geschrieben hat; die Grenze ist der Punkt.

**Am echten Build gemessen** (frisches `--user-data-dir`, `ZIMA_VERIFY_STARTUP`):

```
Lauf 1, leeres Profil     main.log neu angelegt → 600      (writeOptions wirkt)
Lauf 2, davor auf 664     main.log 664 → 600
                          zima-client-2025-11-22.log 664 → 600
                          logging.tightened {"count":2}    (im Log selbst)
ok=true  failures=[]
```

Dazu vier Tests mit **zwei** Positivkontrollen: Filter entfernt → der Wächter-Test wird rot
(`devices.json`, `README.md`, `main.logger` würden mitgefasst); `chmod` entfernt → der
Wirkungs-Test wird rot mit `expected '664' to be '600'`.

> ⚠️ **Maß halten bei der Einordnung:** `~/.config/zima-linux-client` selbst ist **700**. Kein
> anderer lokaler Benutzer kam also durch dieses Verzeichnis hindurch, gleich welchen Modus die
> Dateien darin trugen. Der Modus war trotzdem falsch — er trägt, wenn das Verzeichnis einmal
> nicht 700 ist (Sicherung, entpacktes Archiv, kopiertes Profil) —, aber „world-readable" war
> **wirksam** nicht der Fall. Gemessen, nicht angenommen.
>
> Nicht mitgefasst: die `.<hash>-audit.json` von `winston-daily-rotate-file` aus dem
> 0.9-Client. Sie stehen weiter auf 664 und enthalten Logdateipfade, keine Messwerte. Der
> Filter lässt sie bewusst liegen — sie stammen nicht von diesem Programm.

## Zwei echte Fehler, die erst der Neustart am laufenden Programm gezeigt hat

Beide wurden von **Handbenutzung** gefunden, nicht von Tests oder Gates — es lohnt sich, das
festzuhalten, weil beide Klassen für Prüfungen unsichtbar sind.

### 1. Die Erneuerung hat nie funktioniert — bei 63 grünen Tests

Symptom: Gerät nach dem Neustart gemerkt, Sitzung weg. Erst als der fehlende Aufruf eingebaut
war, wurde der Grund laut sichtbar: **„Das Gerät hat in einer Form geantwortet, die dieser
Client nicht versteht."**

Gemessen an einem echten Gerät — die beiden Auth-Endpunkte antworten **unterschiedlich**:

| Endpunkt | Antwort |
| --- | --- |
| `POST /v1/users/login` | `data.token.{access_token,refresh_token}` — **verschachtelt** |
| `POST /v1/users/refresh` | `data.{access_token,refresh_token,expires_at}` — **flach** |

Ich hatte `login` live gemessen und `refresh` nur aus dem Web-Bundle abgeleitet — der Vermerk am
Endpunkt sagte selbst `bundle` statt `live`. Dann liefen beide durch **einen** Parser. Zwei
Dinge haben das verborgen:

- Der Fehlerpfad wird im Alltag nie betreten: beim Entwickeln ist man frisch angemeldet.
- Das Test-Fixture baute die Antwort der *Erneuerung* mit der Form des *Logins*. Die Testwelt
  hatte genau den Unterschied wegvereinfacht, an dem der Code zerbrach — der Fehler *konnte*
  dort nicht auftreten.

Jetzt zwei getrennte Leser mit je ihrem Messdatum, und drei Tests, darunter eine
**Positivkontrolle**, die die *fremde* Form ausdrücklich ablehnt. Gegenprobe gefahren: den
Fehler kurz wieder eingebaut → **4 von 11 Tests rot**, darunter der Renewal-Test, der vorher
grün log. Ein Test, der nie rot war, ist kein Wächter.

**Beleg am laufenden Programm:** Der gespeicherte Refresh-Token ist beim Neustart **rotiert**
(SHA-256-Präfix `d860af1d` → `343cc23c`, `savedAt` auf die Sekunde des App-Starts), und die
Sitzungskarte zeigt wieder Konto, Rolle, Verbindungsweg und 180 Minuten — ohne Passwort. Der
Hash-Wechsel ist der Zeuge, dass der Token *ausgegeben* wurde; eine Erfolgsmeldung allein wäre
nur das Echo der eigenen Anfrage. Das nicht aktive Gerät blieb unangetastet.

### 2. Die Anmeldemaske blieb nach korrektem Passwort stehen

Der Erfolgs-Handler tat alles am **Modell** — Passwort verwerfen, Abfragen invalidieren — und
nichts am **Ansichtszustand**: der Bildschirm hielt weiter seinen Anmelde-Ziel-Zustand und
rendelte deshalb weiter das Formular. Wegklicken und Zurückkommen entlud die Komponente, und die
Übersicht erschien. Für den Nutzer las sich das als „Anmeldung tut nichts", obwohl die Sitzung
längst stand. Behoben über einen `onSignedIn`-Rückruf, der den Zustand dort zurücksetzt, wo er
liegt.

Keine Fehlermeldung, kein roter Test, kein Log-Eintrag — die Anmeldung war ja erfolgreich. Diese
Lücke sitzt ausschließlich zwischen „Daten sind neu" und „der Nutzer sieht das Neue".

**Beleg:** von der Person bestätigt, die den Fehler gemeldet hat — Abmelden, neu anmelden, die
Übersicht erscheint direkt. Diesen Beleg konnte ich nicht selbst führen: er braucht ein Passwort,
und das habe ich nicht. Genau deshalb steht hier, **wer** gemessen hat und nicht nur, dass
gemessen wurde.

## Nebenbefund, der Plan § 7.3.1 live bestätigt

Die Registry hält jetzt zwei Geräte. Das zweite meldet `photoLibrary: false`, aber
`photoBrowse: true` und `photoBackup: true` — genau die Aufteilung, mit der „Photos ist Pflicht"
auflösbar war: Durchsehen und Backup hängen an der Files-API und gehen auf **jedem** Gerät, nur
Suche und Facetten brauchen das Modul. Das war bisher aus der Routentabelle abgeleitet; jetzt
steht es als gespeicherte Fähigkeit eines echten Geräts da.

**Was für die restlichen Belege noch fehlt:** ein **Sub-Account mit wenig Rechten** für Plan
§ 14 Punkt 6 — welche Endpunkte ein Nicht-Admin überhaupt benutzen darf. Der Admin-Pfad allein
beantwortet das nicht. Und der Gerätewechsel zwischen den beiden gespeicherten Geräten ist
angelegt, aber noch nicht durchgeklickt.

## Phase 8 — Ausliefern: die ersten Pakete, und was sie über den laufenden Code verraten haben

Gebaut am 2026-07-31 auf Ubuntu 24.04 (x64). Drei Formate entstehen hier ohne Zusatzwerkzeug,
drei brauchen ein Programm, das auf dieser Maschine fehlt — und sagen das mit Namen:

| Ziel | Ergebnis | Größe |
| --- | --- | --- |
| **deb** | gebaut, Nutzlast gestartet | 101,3 MiB (`Installed-Size: 347142` ≈ 339 MiB) |
| **AppImage** | gebaut, gestartet | 130,0 MiB |
| **tar.gz** | gebaut, entpackt, gestartet | 123,1 MiB |
| **rpm** | *(zuerst: `Need executable 'rpmbuild'`)* — Werkzeug nachinstalliert, **gebaut, Nutzlast gestartet** | 89,4 MiB |
| **pacman** | *(zuerst: `bsdtar` fehlt, Exit 127)* — Werkzeug nachinstalliert, **gebaut, Nutzlast gestartet** | 91,7 MiB |
| flatpak | `flatpak-builder` liegt inzwischen vor, aber **keine Runtime installiert** (`flatpak list --runtime` ist leer) — ungebaut | — |

Nachgetragen am 2026-07-31 abends: `rpmbuild` und `bsdtar` sind auf dieser Maschine vorhanden,
damit fielen zwei der drei Lücken. Jeder Startbeleg wurde an der **entpackten Paketnutzlast**
geführt, aus einem Verzeichnis, dessen letzter Teil genau `ZimaOS Client` heißt:

```
rpm     ok=true  css=51  nav=4  locale=de-DE  1180 px  consoleErrors=[]  failures=[]
pacman  ok=true  css=51  nav=4  locale=de-DE  1180 px  consoleErrors=[]  failures=[]
```

Inhaltlich geprüft, nicht angenommen: beide tragen nur `resources/zerotier/x64/` (der arm64-Ballast
ist auch hier weg), beide installieren nach `/opt/ZimaOS Client/`, das `.desktop` trägt in beiden
`StartupWMClass=zima-linux-client`, und das Post-Install-Skript liegt in beiden mit demselben
`BIN`-Pfad und demselben `setcap`-Aufruf.

**Nicht gemessen:** eine Installation des `.rpm` bzw. `.pacman` auf einer echten RPM-/Arch-Distribution.
Belegt ist der Paketinhalt und der Start der Nutzlast, nicht der Installationsvorgang dort.

> ⚠️ **Ungleichheit, bewusst nicht geraten:** das `.deb` deklariert `Depends: libcap2-bin`, das
> `.rpm` deklariert **nichts**, was `setcap` mitbringt. Welches Paket das auf Fedora bzw. openSUSE
> ist, habe ich nicht gemessen, und ein falscher `Requires` würde die Installation ganz verhindern
> statt nur zu warnen. Das Skript fängt den Fall laut ab (`setcap not found … the Remote ID route
> will not work`, danach `exit 0`). **Prüfhandlung für die erste RPM-Maschine:**
> `rpm -q --whatprovides /usr/sbin/setcap` — der Name daraus kann dann als `rpm.depends` eingetragen
> werden.

### 🔴 Der Fehler, den erst das Paket gezeigt hat: die App startet nie, wo sie installiert wird

Der Reihe nach gemessen, jedes Mal am gepackten Artefakt mit `ZIMA_VERIFY_STARTUP`:

```
AppImage, wie ein Nutzer sie doppelklickt   kein Report, kein Prozess, kein Fenster
AppImage mit --ozone-platform=x11 in argv   ok=true, 51 CSS-Regeln, Layout sidebar
```

Dazwischen liegt der X11-Rückfall aus Phase 1. Er rettet die App auf dieser Grafik — und in
zwei ausgelieferten Formaten **verhinderte er den Start vollständig**. Das Protokoll endete bei
`platform.relaunch-on-x11`, danach kam nichts mehr: kein zweites `app.ready`, kein Prozess, und
weil der Rückfallpfad vor dem Sentinel zurückkehrt, nicht einmal eine Spur. Ein Doppelklick, bei
dem nichts passiert — die stummste Fehlerart, die dieses Projekt kennt.

**Zwei unabhängige Ursachen, beide gemessen, jede für sich tödlich:**

1. **In der AppImage zeigt `process.execPath` in die eigene Einhängung.**
   Von *innen* abgefragt (`ELECTRON_RUN_AS_NODE=1 ./ZimaOS*.AppImage -e '…'`):

   ```
   APPIMAGE  /home/…/dist/ZimaOS Client-2.0.0-alpha.1.AppImage
   APPDIR    /tmp/.mount_ZimaOSkCxb9M
   execPath  /tmp/.mount_ZimaOSkCxb9M/zima-linux-client
   ```

   Die Einhängung stirbt mit dem Prozess. `app.relaunch()` einen **stabilen** Pfad zu geben
   (`execPath: <die .AppImage-Datei>`) hat **nicht** gereicht — derselbe Lauf, dieselbe Stille,
   nur mit `via: "appimage"` im Log. Electrons Relaunch geht durch einen Helfer, der selbst aus
   dem eingehängten Binary startet; das Ziel, das man ihm nennt, ist dann schon egal.

2. **`app.relaunch()` verträgt kein Leerzeichen im Pfad.** Dieselbe Nutzlast, zwei Verzeichnisse:

   ```
   …/ZimaOS Client/zima-linux-client   kein zweites app.ready, nichts überlebt
   …/nospace/zima-linux-client         app.ready, ok=true
   ```

   Das ist kein Randfall: **`/opt/ZimaOS Client/` ist das Installationsverzeichnis** von deb, rpm
   und pacman (`sanitizedProductName`, am gebauten Paket abgelesen). Auf jeder Maschine, die
   diesen Rückfall braucht, hätte das installierte Paket **gar nichts** gestartet.

   Dass mir das so lange entgangen ist, hat einen Namen: mein „läuft doch"-Beleg kam aus
   `dist/linux-unpacked` — einem Pfad **ohne** Leerzeichen. Ein Vorbild belegt seinen eigenen
   Aufbau, nicht den ausgelieferten.

**Behoben** in `src/main/app/resilientPlatform.ts`: der Ersatzprozess wird selbst gestartet
(`spawn`, detached, Argumente als Array — nichts wird neu geparst), und `resolveRelaunchTarget()`
entscheidet vorher, **von wo**: die `.AppImage`-Datei aus `APPIMAGE`, sonst das eigene Binary. Gibt
es keinen Pfad, der diesen Prozess überlebt (entpacktes AppDir ohne `APPIMAGE`), wird **nicht**
gestartet, sondern `platform.relaunch-impossible` protokolliert und der Befehl genannt — ein
Fehlschlag mit Grund statt eines Doppelklicks ins Leere.

**Belege nach der Änderung** (je drei Kaltstarts, frisches `--user-data-dir`):

```
AppImage, ohne Flag         3× ok=true   via=appimage → app.ready forcedX11=true → startup.verified
deb-Nutzlast in "…/ZimaOS Client/"  3× ok=true   via=self
tar.gz, entpackt            ok=true   via=self
```

Sechs Tests decken `resolveRelaunchTarget` ab; **Positivkontrolle gefahren** — das alte Verhalten
wieder eingesetzt (immer `execPath`): **5 von 6 rot**, darunter ausdrücklich die Zusicherung „gibt
niemals einen Pfad aus der Einhängung zurück". Ein Test, der nur prüft, *dass* ein Pfad kommt, wäre
auf der kaputten Fassung grün geblieben.

### Drei Befunde aus der Paketprüfung selbst

* **Die amd64-Pakete trugen ein arm64-Binary mit.** `extraResources` kopierte `bin/zerotier`
  vollständig, also beide Architekturen — 14,9 MB, die auf einem x64-Rechner nie laufen können.
  Jetzt `bin/zerotier/${arch}` → `zerotier/${arch}`; die Laufzeitpfade
  (`resources/zerotier/<process.arch>/…`) bleiben unverändert, das `.deb` schrumpft von 106,1 MiB
  auf 101,3 MiB. Am Paketinhalt nachgesehen: nur noch `x64/` drin.
* **Das Fenster gehörte zu keinem Starter.** `StartupWMClass=ZimaOS Client` stand im `.desktop`,
  gemessen am laufenden Fenster war die Klasse aber `zima-linux-client`:

  ```
  $ xprop -id <window> WM_CLASS
  WM_CLASS(STRING) = "zima-linux-client", "zima-linux-client"
  ```

  Damit ordnet keine Desktop-Umgebung das laufende Fenster dem Starter zu (generisches Symbol im
  Dock, kein „angeheftet"). `desktopName` in package.json plus `linux.syncDesktopName` bringt beide
  auf denselben Wert; im neu gebauten Paket steht jetzt `StartupWMClass=zima-linux-client`.
* **Ein Makro im Post-Install-Skript stimmte nur zufällig.** Dort stand `/opt/${productFilename}`,
  während electron-builder nach `/opt/${sanitizedProductName}` installiert
  (`FpmTarget.js:215`). Beide ergeben heute „ZimaOS Client" — aber nur, solange
  `linux.executableName` ungesetzt ist (`appInfo.js:57`). Wer diese Option einmal setzt, verschiebt
  den Pfad, und die Rechteerteilung liefe ins Leere, während das Paket weiter Erfolg meldet.
  Korrigiert auf `sanitizedProductName`.
  *(Nebenbei gelernt: `${…}` wird in diesem Skript **auch in Kommentaren** ersetzt — ein erklärender
  Kommentar mit `${installPrefix}` hat den Paketbau mit „Macro installPrefix is not defined"
  abgebrochen.)*

### 🔴 Und das Skript, das die Rechte erteilt, lag gar nicht im Repository

`build/` steht in `.gitignore` — unter der Überschrift „Build outputs", geerbt aus der 0.9-Linie.
Bei electron-builder ist `build/` aber ein **Eingabe**-Verzeichnis (`buildResources`). Folge:
`build/linux-after-install.sh` existierte nur auf dieser einen Maschine, während dieses Dokument
es als „gebaut" führte. Ein frischer Klon hätte Pakete **ohne** die Rechteerteilung erzeugt — und
`git status` hätte nie etwas gemeldet, weil die Datei sauber ignoriert wurde.

Aufgefallen ist es nur, weil die Datei nach einer Änderung **nicht** in `git status` auftauchte.
Dieselbe Familie wie die zu breite Ausnahme im Privacy-Gate: eine Ignorier-Regel deckte genau das
ab, was sie hätte zeigen müssen. Jetzt ist `build/` verfolgt (177 statt 175 Dateien im
Privacy-Gate, weiterhin clean), und in `.gitignore` steht, warum es dort **nicht** hingehört.

> ⚠️ **Gleiche Klasse, nicht behoben:** `package-lock.json` steht ebenfalls in `.gitignore`. Für
> eine Anwendung, die als Paket ausgeliefert wird, heißt das: kein reproduzierbarer Build — zwei
> Klone können unterschiedliche Abhängigkeitsversionen bekommen. Das ist eine Entscheidung, keine
> Panne, deshalb hier nur benannt und nicht eigenmächtig geändert.

### 🔴 Danach hat das Messgerät selbst geschwiegen — und die Stille sah aus wie ein kaputtes Paket

Kaltstarts der gepackten Nutzlast schrieben **keinen Report**. Genau die Ausgabe, die im Abschnitt
oben „die App startet nicht" bedeutet hat — und diesmal war sie falsch: der Prozess lief, das
Fenster stand vollständig da. Stehengeblieben war das **Prüfwerkzeug**, das ohne jede Zeitgrenze
auf einen Schritt wartete, der nicht zurückkam.

**Erste Konsequenz — ein Lauf endet immer mit einem Urteil.** `armVerificationWatchdog()` wird
gescharft, **bevor** das Ladeereignis kommt (auch „`did-finish-load` kommt nie" ist eine der
Formen). Nach `ZIMA_VERIFY_TIMEOUT_MS` (Vorgabe 90 s) wird der Report **trotzdem** geschrieben:
`ok: false` und der Name des Schrittes, in dem der Lauf steckt. Ein falsches Urteil kann man
bestreiten; Stille schickt einen ins falsche Bauteil.

**Und dann hat der Wächter genau das getan.** Reproduziert am 2026-07-31 an der entpackten
`.deb`-Nutzlast, gestartet aus einem Verzeichnis, dessen letzter Teil genau `ZimaOS Client/`
heißt — der Name, den die Installation anlegt — mit frischem `--user-data-dir`:

```
[11:37:56.591] [warn]  platform.relaunch-on-x11 {"reason":"known-problematic drm driver: vmwgfx",…}
[11:37:56.920] [info]  app.ready {"electron":"43.2.0","forcedX11":true,…}
[11:39:26.989] [error] startup.verification-timeout {"step":"capturing the screenshot","limitMs":90000}
```

**`webContents.capturePage()` war nicht zurückgekommen.** Alles davor hatte funktioniert, und das
ist nicht erschlossen, sondern abgelesen: die Sentinel-Datei `startup-in-progress` war **weg** —
sie wird nur in `ready-to-show` gelöscht, das Fenster hat also gezeichnet — und der Schrittname
stand bereits hinter dem Probelauf, der Report konnte also gemessen werden. **Warum** die Aufnahme
hängt, ist **nicht** gemessen: einmal in zwölf Kaltstarts derselben Nutzlast. Eine naheliegende
Erklärung wurde geprüft und **fällt aus** — mit und ohne `--no-sandbox` je drei Läufe, alle grün.

**Zweite Konsequenz — der Screenshot ist Beleg, nicht Urteil.** Die Aufnahme bekommt eine eigene
Frist (`ZIMA_VERIFY_CAPTURE_MS`, sonst ein Sechstel des Gesamtbudgets, höchstens 15 s). Hängt sie,
soll das **das Bild** kosten und nicht den Lauf: alles, was vorher gemessen wurde, steht im Report,
und `failures` sagt, was fehlt.

> ⚠️ **Dieser Absatz beschreibt die Absicht, nicht das gemessene Verhalten.** Beim echten Hänger auf
> der AppImage ist diese Frist **nicht** gefeuert; der Lauf endete am Wächter, mit Nullen. Was die
> Messwerte tatsächlich rettet, steht zwei Abschnitte weiter unten (`record()`).

**Positivkontrolle am ausgelieferten Artefakt**, dieselbe `.deb`-Nutzlast, zwei Läufe:

| Lauf | Ergebnis |
| --- | --- |
| normal | `ok=true`, 51 CSS-Regeln, PNG geschrieben (96 545 Bytes) |
| `ZIMA_VERIFY_CAPTURE_MS=1` | `ok=false`, **51 CSS-Regeln, 4 Navigationsknöpfe, `de-DE`, 1180 px** — kein PNG, `failures: ["screenshot capture did not return within 1 ms — everything else in this report was measured before it"]` |

Die zweite Zeile ist der eigentliche Beleg: die Messwerte sind **da**. Ein Report voller Nullen
wäre der des Wächters gewesen, also der alte Totalausfall unter neuem Namen.

**Positivkontrolle im Test:** die alte, unbegrenzte Fassung (`await capturePage()`) wieder
eingesetzt → der neue Test wird rot, und zwar mit *`no report after 3 s`* — wortwörtlich das
Symptom aus der Produktion.

#### 🔴 Und dann hat die Absicherung selbst die Messung zerstört

Der erste Kaltstart der frisch gebauten **AppImage** lief in genau dieselbe Stelle — und der
Report war trotzdem der des Wächters, mit lauter Nullen:

```
[11:52:51.079] [info]  app.ready {…"forcedX11":true}
[11:53:36.357] [error] startup.verification-timeout {"step":"capturing the screenshot","limitMs":45000}
```

Die Frist für die Aufnahme lag bei 7,5 s und hat **nicht** gegriffen; der Wächter schlug erst nach
45 s an. Beide sind `setTimeout` auf derselben Schleife, also war die Schleife dazwischen
blockiert: der Hauptthread stand rund 43 Sekunden **in** der Aufnahme. Als er weiterlief, waren
beide Zeitgeber fällig, Node führte den früheren zuerst aus — und dieser Weg begann seinen Report
**asynchron** zu schreiben, während der Wächter mit `writeFileSync` schrieb und `app.exit` rief.
Das gemessene Urteil hat das Rennen gegen sein eigenes Sicherheitsnetz verloren.

**Behoben:** Report und Screenshot werden **synchron** geschrieben. Ein synchroner Schreibvorgang
kann von keinem Zeitgeber unterbrochen werden; wer zuerst dort ankommt, schreibt fertig, und der
Wächter wird unmittelbar danach abgeschaltet.

**Positivkontrolle:** der Test hält den Augenblick des `app.exit` fest — was in *dieser* Sekunde
auf der Platte lag — statt am Ende nachzusehen, wenn alle Zusagen längst eingelöst sind. Mit der
alten asynchronen Fassung wird er rot (`cssRuleCount: 0` statt 51), mit der neuen grün. Damit
waren es **fünf** Tests auf dem Wächter, 165 gesamt — der sechste kam eine halbe Stunde später
dazu, siehe unten.

> Die erste Fassung dieses Tests war grün — **auch mit dem alten Verhalten**. Sie wartete das Ende
> des Laufs ab und sah dann eine heile Datei; genau die Annahme („der Prozess wartet höflich"), die
> den Fehler überhaupt erst verdeckt hat. Ein Test, der beide Fassungen besteht, prüft nichts.

#### 🔴 Und die Frist für die Aufnahme hat in genau dem Lauf nicht gegriffen, für den sie gebaut war

Zwei Kaltstarts derselben frisch gebauten AppImage, drei Minuten auseinander:

| Uhrzeit | Ergebnis |
| --- | --- |
| 12:14 | Aufnahme hängt → Wächter-Report nach 90 s, **lauter Nullen** |
| 12:17 | `ok=true`, 51 CSS-Regeln, 4 Navigationsknöpfe, `de-DE`, 1180 px, PNG 89 031 Bytes |

Der zweite Lauf belegt, dass die AppImage startet und sauber verifiziert. Der erste widerlegt einen
Satz, der weiter oben in diesem Dokument stand: „Hängt sie, kostet das **das Bild** und nicht den
Lauf." Die Frist von 15 s hätte 75 Sekunden vor dem Wächter greifen müssen — sie hat es nicht.
`currentStep` stand auf `capturing the screenshot`, die Frist war also **scharf**. Warum ihr
Zeitgeber trotzdem nicht fällig wurde, ist **nicht gemessen** und wird hier nicht erklärt.

**Warum die alte Positivkontrolle das nicht sehen konnte.** `ZIMA_VERIFY_CAPTURE_MS=1` belegt, dass
der Rückfall*weg* funktioniert — bei 1 ms feuert die Frist, **bevor** die Aufnahme überhaupt
loslegt. Ein blockierter Hauptthread wurde damit nie nachgestellt. Die Prüfung war grün und prüfte
eine andere Eigenschaft als die behauptete.

**Behoben, ohne die Ursache zu behaupten:** der Lauf übergibt seine Messwerte an den Wächter
(`record()`), sobald die Untersuchung des Renderers durch ist — also **bevor** irgendetwas kommt,
das hängen kann. Wer danach gewinnt, ist gleichgültig: der Report trägt, was gemessen wurde. Ein
Wächter-Report aus Nullen war nicht nur wertlos, er war **falsch** — `cssRuleCount: 0` liest sich
als „das Stylesheet hat nie geladen" und beschuldigt ein Bauteil, das gearbeitet hat.

**Positivkontrolle im Test:** `record()` stillgelegt → der neue Test wird rot mit
`expected +0 to be 51`, wortwörtlich das Symptom aus dem 12:14-Lauf; die anderen fünf bleiben grün,
der Test deckt also genau diese Eigenschaft und nichts sonst.

**Positivkontrolle am ausgelieferten Artefakt** — der Wächter absichtlich gewinnen lassen, indem
die Gesamtfrist mitten in ein Szenario gelegt wird (also nach der Übergabe; Zieladresse `192.0.2.1`
aus dem Dokumentationsbereich RFC 5737, es wird kein echtes Gerät angefasst):

```
ZIMA_VERIFY_SCENARIO=signin-wrong-password:192.0.2.1 ZIMA_VERIFY_TIMEOUT_MS=3500
[error] startup.verification-timeout {"step":"running scenario signin-wrong-password","limitMs":3500,"cssRuleCount":51}
```

Der geschriebene Report ist der des Wächters — `ok:false`, `failures: ["verification timed out
after 3500 ms while: running scenario signin-wrong-password"]` — und trägt trotzdem
`cssRuleCount: 51`, `navButtons: 4`, `locale: de-DE`, `viewportWidth: 1180`. Die Protokollzeile
nennt die Zahl jetzt selbst mit, damit auf einen Blick zu sehen ist, ob ein Wächter-Report Messwerte
trägt oder wirklich leer ist.

**Sechs Tests** decken den Wächter ab, **166 gesamt**, `npm run verify` grün.

**Nebenbefund, gleicher Weg:** `index.ts` nimmt die Einzelinstanz-Sperre auf Modulebene, also
**bevor** über den X11-Rückfall entschieden wird. Der sterbende Elternprozess hielt sie damit noch,
während sein Nachfolger startete — und ein Nachfolger ohne Sperre ruft `app.quit()` und verschwindet
ohne Fenster. Das Fenster ist klein und war hier nicht die Ursache, aber ein Rennen, dessen einzige
sichtbare Form „es startet nichts" ist, bleibt nicht stehen: die Sperre wird jetzt vor dem `spawn`
zurückgegeben.

### 🟢 Nachgetragen: das installierte Paket, mit Rechten

Am 2026-07-31 mit `sudo` installiert (`dpkg -i`, Ubuntu 24.04) — damit fällt der Punkt, der Phase 3b
offen hielt.

| Geprüft | Ergebnis |
| --- | --- |
| Post-Install-Skript | `zima-linux-client: granted CAP_NET_ADMIN to /opt/ZimaOS Client/resources/zerotier/x64/zerotier-one` |
| Datei-Capability | `cap_net_bind_service,cap_net_admin,cap_net_raw=eip` (`getcap`) |
| Start aus dem Installationspfad | `ok=true`, 51 CSS-Regeln, 4 Navigationsknöpfe, `de-DE`, 1180 px, PNG 89 031 Bytes |
| X11-Rückfall im Paket | `platform.relaunch-on-x11 {"via":"self","execPath":"/opt/ZimaOS Client/zima-linux-client"}` — der Pfad mit Leerzeichen trägt |

**Und die Rechteerteilung wirkt auch wirklich** — `getcap` beschreibt nur die Datei, also wurde der
laufende Prozess befragt, mit exakt dem Aufruf des Clients (`-p<port> -U <home>`):

| Lauf | `NoNewPrivs` | `CapEff` |
| --- | --- | --- |
| A — aus dem Startweg der App | 0 | `0000000000003400` = cap_net_bind_service, cap_net_admin, cap_net_raw |
| B — identisch, unter `setpriv --no-new-privs` | 1 | `0000000000000000` |

Lauf B ist die Gegenprobe und zeigt die Bedingung: `no_new_privs` **des Aufrufers** entwertet die
Datei-Capability. Genau deshalb bevorzugt `daemon.ts` den Weg über `systemd --user`.

> ⚠️ **Korrektur einer zu breiten Aussage.** Im Code stand „der Electron-Hauptprozess läuft mit
> `NoNewPrivs: 1`" — gemessen am 2026-07-30, aber aus einem Editor-Terminal gestartet. Am
> installierten Paket ist es **0**, sowohl über den Desktop-Eintrag (`gio launch`, systemd-Scope
> `app-zima-linux-client-<pid>.scope`) als auch aus einer Shell. Das Flag ist eine Eigenschaft des
> **Aufrufers**, nicht der Anwendung. Der Rückfall „als Kindprozess starten" ist damit kein toter
> Code, und der `systemd --user`-Weg bleibt trotzdem erste Wahl, weil er nicht davon abhängt, wer
> uns gestartet hat.

**Nicht belegt:** dass der Remote-ID-Weg *fachlich* durchläuft (Netzwerk beitreten, Mitglied
werden). Gemessen ist, dass das Binary mit den nötigen Rechten hochkommt — nicht, was es danach
im Netz tut.

### Was an Phase 8 ausdrücklich offen ist

* ~~**rpm, pacman**~~ **gebaut und gestartet** (2026-07-31 abends, siehe Tabelle). **flatpak** ist
  seit 2026-08-09 **aus der Standard-Zielliste genommen** — es ist kein Remote eingerichtet, und
  electron-builder zielt auf die zurückgezogene Runtime `20.08`; solange es in der Liste stand,
  brach `package:linux` daran ab, **bevor** deb/rpm/pacman gebaut waren.
* **arm64** ist seit 2026-08-09 gebaut und installiert, das mitgelieferte ZeroTier läuft dort —
  **der App-Start bleibt unbelegt**, siehe
  [arm64](#-arm64-drei-viertel-belegt-und-das-letzte-viertel-braucht-hardware). Ausgeliefert wird
  arm64 deshalb nicht.
* ~~**Distro-Start-Matrix** (Plan § 11.5)~~ **Erledigt 2026-08-09**: sechs Distributionen, das
  installierte Paket im echten Pfad, Startbeleg je Zeile. Damit ist der frühere Vorbehalt
  („gemessen wurde auf **einer** Maschine") aufgehoben.
* **README und liesmich beschreiben weiterhin den 0.9-Client** (macOS-Abschnitt, alte Screenshots,
  alte Projektstruktur). Angeglichen wurden nur die Paketier-Befehle, weil die nachweislich falsch
  waren (`npm run package:mac` existiert in diesem Zweig nicht). Der Rest gehört zum Release.

## Der Testlauf schrieb ins Log des Nutzers — 123 Zeilen pro Lauf

Stand als „Nebenbefund, nicht behoben" in diesem Dokument. Zuerst gemessen statt geglaubt,
an der echten Datei, um einen Testlauf herum:

```
vor  npx vitest run    7007 Zeilen in ~/.config/zima-linux-client/logs/main.log
nach npx vitest run    7130 Zeilen        → 123 Zeilen aus dem Testlauf
```

Zwei Sorten, und die zweite ist die gefährliche:

* Stapelspuren `log.initialize({ preload }) already called` — jede Testdatei rief beim Import
  `log.initialize()` erneut auf.
* **Echter Programmtext aus einem Fixture:**
  `zima.request {"host":"device.local","path":"/v1/users/login","method":"POST","status":400}`.
  Nichts an dieser Zeile sagt, dass sie aus einem Test stammt. Genau so eine Zeile hatte mich
  schon einmal auf die falsche Fährte geführt.

Ein Log, das Testverkehr trägt, kann die Frage „was hat die Anwendung getan" nicht mehr
beantworten — und dieses Projekt stützt fast jede Aussage auf dieses Log.

### Die Sperre ist baulich, kein `if (process.env.VITEST)`

`logger.ts` setzt beim Import `log.transports.file.level = false` (die Vorgabe von
electron-log ist `'silly'`, also „alles auf die Platte"). Geschrieben wird erst, wenn
`enableFileLogging()` gerufen wird — und das tut **nur** der Hauptprozess, als erste Zeile
seines Rumpfes. Eine Umgebungsvariable abzufragen hieße raten, in welcher Welt man steckt;
so müsste ein Test das Schreiben **absichtlich** einschalten, um ins Benutzerverzeichnis zu
kommen.

Der Aufruf steht **vor** `decidePlatform()`, weil die X11-Entscheidung selbst Beweismaterial
ist. Das Rechte-Nachziehen alter Logdateien (`tightenLogFiles`) ist in denselben Aufruf
gewandert: es muss ohnehin laufen, bevor die erste Zeile dieses Laufs danebenliegt.

### Belege

Am gebauten Artefakt, Kaltstart mit frischem Profil und einer absichtlich world-readable
hinterlegten Altdatei — ohne X11-Flag, der Relaunch findet also statt:

```
[info] logging.tightened {"count":1}                     ← Sweep wirkt von der neuen Stelle
[warn] platform.risky-drm-driver {"driver":"vmwgfx",…}
[warn] platform.relaunch-on-x11 {…"via":"self"…}         ← die Entscheidung steht im File
[info] app.ready {…"forcedX11":true…}                    ← der Nachfolger schreibt weiter
[info] startup.verified {"ok":true,"cssRuleCount":51,…}

ls -l  main.log 600 · zima-client-2026-01-01.log 664 → 600
Report ok=true  css=51  nav=4  locale=de-DE  failures=[]
```

Und die Datei, um die es ging:

```
npm run verify (voller Durchlauf)   main.log 7133 → 7133 Zeilen
```

### Drei Positivkontrollen, drei gezielte Rotfärbungen

Drei Tests, und jeder wurde einzeln zum Anschlagen gebracht, indem die Stelle, die er deckt,
wieder kaputtgemacht wurde:

| Entfernt | Rot wird | Meldung |
| --- | --- | --- |
| `level = false` beim Import | „writes nothing to disk until it is switched on" | `expected [ 'console', 'file' ] to not include 'file'` — und `main.log` wuchs wieder |
| `level = 'info'` in `enableFileLogging` | „writes 0600 once enabled" | `expected '' to contain 'app.ready …'` |
| `writeOptions` (der 0600-Modus) | „gets 0600 from the write itself" | `expected '664' to be '600'` |

Die dritte Zeile ist nachgetragen, und zwar wegen eines Fehlversuchs: die erste Fassung des
0600-Tests blieb **grün**, als ich `writeOptions` entfernte. Gemessen statt weitergegangen —
`enableFileLogging()` legt die Datei über `logger.filePath()` an, und der Sweep direkt danach
chmod't alles, was `*.log` heißt. Die beiden Hälften überlappen sich also auf genau der
Hauptlogdatei, und eine von ihnen lief ungeprüft mit. Der dritte Test benutzt deshalb einen
Namen, den der Sweep nicht fasst — das ist kein Kunstgriff, sondern der Fall, der im Betrieb
zählt: eine Rotation **während** des Laufs erzeugt eine Datei, die kein Start-Sweep je sieht.

> **Nebenbefund am Werkzeug:** Der `ValidateAfterEdit`-Hook meldete für beide Dateien
> `bun build failed … cannot require "child_process"`. Er baut mit **Browser**-Target gegen
> Hauptprozess-Code. Gegenprobe gefahren, bevor ich etwas „repariert" habe: die unveränderte
> `HEAD`-Fassung derselben Datei scheitert identisch (`exit=1`). Ein Falsch-Positiv des
> Prüfwerkzeugs, kein Fehler im Code.

## 🔴 Mein Post-Install-Skript hat das Standardskript nicht ergänzt, sondern ersetzt

Aufgefallen bei einer Nebensache: im `postinst` des fertigen `.deb` stand **nur** unsere
ZeroTier-Rechteerteilung — keine Zeile von dem, was electron-builder sonst dort hinschreibt.

**Ursache, am Werkzeug abgelesen** (`app-builder-lib` 26.15.3, `targets/FpmTarget.js:68`):

```js
afterInstall: await writeConfigFile(…, getResource(this.options.afterInstall, "after-install.tpl"), …)
```

`getResource` liefert die eigene Datei **statt** der Vorlage. Ein `afterInstall` ergänzt nicht, es
verdrängt — und nichts im Bauvorgang sagt das. Am **installierten** Paket dieser Maschine
nachgesehen:

```
/usr/bin/zima-linux-client          fehlt   (die Vorlage legt ihn per update-alternatives an)
/etc/apparmor.d/zima-linux-client   fehlt   (Profil für Ubuntu 24+ nie installiert)
chrome-sandbox                      0755    (nie auf 4755 gehoben)
```

**Warum die letzte Zeile keine Kosmetik ist.** Steht der Namespace-Sandkasten nicht zur Verfügung,
fällt Chromium auf den SUID-Helfer zurück — und **bricht ab**, statt ungeschützt zu laufen.
Erzwungen am installierten Programm mit `--disable-namespace-sandbox`:

```
FATAL sandbox/linux/suid/client/setuid_sandbox_host.cc:166
  "The SUID sandbox helper binary was found, but is not configured correctly. Rather than run
   without sandboxing I'm aborting now. … chrome-sandbox is owned by root and has mode 4755."
→ kein Fenster, kein Report, Exit 133
```

**Warum es hier nie auffiel:** auf dieser Maschine funktionieren unprivilegierte User-Namespaces
(`unshare --user true` gelingt als normaler Nutzer, trotz
`kernel.apparmor_restrict_unprivileged_userns = 1`). Der Rückfallweg lief also nie an. Auf einer
Maschine, auf der sie abgeschaltet sind, ist das **jeder** Start — genau der Fall, der bei einem
fremden Tester eintritt und bei mir nicht. Dieselbe Familie wie „das Entwicklungs-Layout ist nicht
das ausgelieferte", eine Stufe weiter: **meine Maschine ist nicht die des Testers.**

**Behoben:** `build/linux-after-install.sh` enthält jetzt die Standardvorlage **wörtlich** und
danach unseren Block. Kein `set -e` mehr — die Vorlage läuft bewusst ohne, ein stolpernder
`apparmor_parser` darf keine Paketinstallation abbrechen; jeder Fehler wird stattdessen gemeldet,
und das Skript endet auf `exit 0`.

**Der Wächter vergleicht gegen das Original, nicht gegen eine abgeschriebene Liste.** Vier Tests
lesen `node_modules/app-builder-lib/templates/linux/after-install.tpl` zur Laufzeit und verlangen,
dass **jede** Anweisung daraus auch in unserem Skript steht — ändert electron-builder seine
Vorlage, wird das rot, statt dass wir stillschweigend weniger tun als das Standardpaket. Dazu eine
Absicherung gegen den leeren Fall: fehlt die Vorlage oder hat sie weniger als 15 Anweisungen,
scheitert der Test, statt inhaltslos grün zu sein.

**Positivkontrolle:** `chmod 4755` → `chmod 0755` gesetzt (und nachgesehen, dass die Änderung
ankam) → **3 von 4 Tests rot**, darunter wörtlich `stock template lines absent from
build/linux-after-install.sh`. Zurückgesetzt → wieder grün.

Im neu gebauten `.deb` **und** `.rpm` nachgelesen — nicht erschlossen:

```
update-alternatives --install '/usr/bin/zima-linux-client' … '/opt/ZimaOS Client/zima-linux-client'
chmod 4755 '/opt/ZimaOS Client/chrome-sandbox'      (im userns-losen Zweig)
APPARMOR_PROFILE_TARGET='/etc/apparmor.d/zima-linux-client'
setcap cap_net_admin,cap_net_raw,cap_net_bind_service+eip "$BIN"
```

### 🟢 Nachgetragen am selben Abend: das reparierte Paket ist installiert und gemessen

Das Paket wurde mit `sudo apt install ./…_amd64.deb` installiert (auf dieser Maschine gibt es kein
`sudo` ohne Passwort, ich konnte es nicht selbst). Danach nachgesehen — und zwar **welche** Fassung
dort liegt, nicht nur *dass* etwas liegt:

```
/opt/ZimaOS Client/resources/app.asar   65fc8a7f…3087   ← identisch mit dem neuen .deb
/usr/bin/zima-linux-client → /etc/alternatives/… → /opt/ZimaOS Client/zima-linux-client
/etc/apparmor.d/zima-linux-client       261 Bytes, root
/opt/ZimaOS Client/chrome-sandbox       0755
getcap …/zerotier/x64/zerotier-one      cap_net_bind_service,cap_net_admin,cap_net_raw=eip
Start über den bloßen Namen             ok=true  css=51  nav=4  de-DE  failures=[]
```

Damit sind alle drei Verluste zurück. `chrome-sandbox` bleibt bei `0755` — die Vorlage entscheidet
über `4755` anhand des **Installationsrechners**, und hier funktionieren unprivilegierte
Namespaces. Das ist das Verhalten von electron-builder, kein Rest dieses Fehlers.

**Nebenbefund aus demselben Lauf, harmlos aber erklärungsbedürftig:** apt meldet
`N: Der Download wird als root und nicht Sandbox-geschützt durchgeführt, da auf die Datei … durch
den Benutzer »_apt« nicht zugegriffen werden kann. - pkgAcquire::Run (13: Keine Berechtigung)`.
Gemessen: `/home/<benutzer>` steht auf `750`, `_apt` kommt also nicht bis zur Datei; apt lädt sie
dann selbst als root. Es ist eine **Notiz**, kein Abbruch — die Installation lief nachweislich
durch. Steht so in den Tester-Hinweisen (die nicht im Repository liegen), weil jeder
Ubuntu-24.04-Tester sie sehen wird.

**Weiterhin NICHT gemessen:** dasselbe auf einer RPM- oder Arch-Distribution.

## 🟢 Distro-Start-Matrix: sechs von sechs, am ausgelieferten Paket

`scripts/distro-matrix.sh`, gefahren 2026-08-09 gegen die an diesem Tag gebauten Pakete. Jede Zeile
installiert das **echte Artefakt** in einem frischen Container, in den echten Installationspfad
`/opt/ZimaOS Client/` (mit Leerzeichen), und startet es als **gewöhnlicher Benutzer** — mit
**eingeschaltetem** Sandkasten, denn genau den richtet das Post-Install ein. Der Container läuft
dafür mit `--security-opt seccomp=unconfined`; Dockers Standardprofil verbietet die
Namespace-Aufrufe, die Chromiums Sandkasten braucht. Ein `--no-sandbox` hätte jede Zeile grün
gemacht, auch mit kaputtem `chrome-sandbox` — deshalb steht es nur im Kontrolllauf, der greift,
wenn der echte Weg nichts geschrieben hat.

Beleg je Zeile ist der Startbericht der App selbst (`ZIMA_VERIFY_STARTUP`), der die **laufende
Engine** fragt, nicht die Dateien:

| Zeile | Paket | `ok` | CSS-Regeln | Fenster | rohe i18n-Schlüssel | Konsolenfehler |
| --- | --- | --- | --- | --- | --- | --- |
| `ubuntu:22.04` | deb | ✅ | 51 | 1180 px, Seitenleiste | 0 | 0 |
| `ubuntu:24.04` | deb | ✅ | 51 | 1180 px, Seitenleiste | 0 | 0 |
| `debian:12` | deb | ✅ | 51 | 1180 px, Seitenleiste | 0 | 0 |
| `fedora:41` | rpm | ✅ | 51 | 639 px, Pillenleiste | 0 | 0 |
| `archlinux` | pacman | ✅ | 51 | 639 px, Pillenleiste | 0 | 0 |
| `opensuse/tumbleweed` | rpm | ✅ | 51 | 614 px, Pillenleiste | 0 | 0 |

Nebenbei mitbelegt, ohne dass es geplant war: die **responsive Umschaltung**. Die Xvfb-Vorgabe ist
je Distribution verschieden, und beide Layouts sind darüber gelaufen — Seitenleiste mit 4
Navigationsknöpfen bei 1180 px, Pillenleiste mit 8 bei ~620 px. Das ist die Erklärung für die
unterschiedlichen `nav`-Zahlen und kein Befund.

**Der erste Lauf war 1 von 6.** Was dazwischen lag, steht in den drei Abschnitten hier drunter —
alle drei Fehler waren ausschließlich am **ausgelieferten** Paket sichtbar und für jeden Test,
jeden Build und jeden Start aus `dist/linux-unpacked` unsichtbar.

## 🟡 arm64: drei Viertel belegt, und das letzte Viertel braucht Hardware

Gemessen 2026-08-09 unter `qemu-user` (binfmt über `tonistiigi/binfmt --install arm64`), Paket
gebaut mit `electron-builder --linux deb --arm64 -c.directories.output=dist-arm64`.

| Frage | Antwort | Beleg |
| --- | --- | --- |
| Baut ein arm64-Paket? | ja | `zima-linux-client_2.0.0-alpha.1_arm64.deb`, `dpkg -f … Architecture` → `arm64` |
| Trägt es das richtige ZeroTier? | ja, **nur** das arm64 | `dpkg-deb -c` zeigt allein `resources/zerotier/arm64/` |
| Installiert es auf aarch64? | ja | `ldd` am installierten Binary: **0** fehlende Bibliotheken |
| Erteilt das Post-Install dort die Rechte? | ja | `getcap` → `cap_net_bind_service,cap_net_admin,cap_net_raw=eip` |
| Läuft das mitgelieferte `zerotier-one` auf arm64? | **ja, 1.14.2** | siehe unten |
| Startet die **App** auf arm64? | **unbelegt** | qemu-user scheitert an Chromiums `clone` |

### Zwei Fehlbilder, die beide keine waren

**`zerotier-one: Operation not permitted`** — dieselbe Datei hatte Minuten vorher aus dem
Repository `1.14.2` gemeldet. Unterschied: das `setcap` des Post-Installs. Der Kernel reicht
Datei-Capabilities **nicht** durch einen binfmt-Interpreter, und unter qemu ist genau das der
Ausführungsweg. Drei Läufe statt einer Vermutung:

| | Ergebnis |
| --- | --- |
| Original **mit** Capabilities | startet nicht, exit 126 |
| Kopie (Capabilities fallen beim Kopieren weg) | `1.14.2` |
| dasselbe Original nach `setcap -r` | `1.14.2` |

Das Binary ist also arm64-tauglich; die Meldung gehört dem Emulator. Auf echter Hardware gibt es
keinen Interpreter, dort stellt sich die Frage nicht.

**`failed to execvp: /opt/ZimaOS`** — der Pfad abgeschnitten am Leerzeichen, also exakt das Bild
des Relaunch-Fehlers, den dieses Projekt schon einmal hatte. Das wäre die teure Fehldiagnose
gewesen: eine Reparatur an Pfadbehandlung, die nachweislich funktioniert (sechs grüne Zeilen der
x86-Matrix aus genau diesem Pfad). Gegenprobe, dieselbe Nutzlast an zwei Orten im selben Lauf:

```
A) /opt/ZimaOS Client/…   failed to execvp: /opt/ZimaOS
                          FATAL zygote_host_impl_linux.cc:207   exit 133
B) /opt/nospace/…         clone: Invalid argument
                          FATAL zygote_host_impl_linux.cc:207   exit 133
```

Beide sterben an **derselben** Zeile, und B nennt die Ursache mit qemus eigener Fehlermeldung:
die `clone`-Flags von Chromiums Zygote sind unter `qemu-user` nicht nachbildbar. Das Leerzeichen
ist unschuldig.

### Was ausdrücklich NICHT gemessen ist

Ein Startbeweis auf arm64. Er ist über Emulation **nicht zu holen** — nicht „noch nicht", sondern
gar nicht, solange der Zygote am Emulator scheitert. Dafür braucht es eine echte arm64-Maschine.
Bis dahin sagen README und liesmich weiterhin „kein arm64", und es wird auch keines ausgeliefert:
ein Paket, dessen Start niemand gesehen hat, gehört nicht in eine Veröffentlichung.

*Ein weiterer Isolationslauf (`--no-sandbox`, `--no-zygote`) sollte den Zygote noch genauer
einkreisen und ist an einem Off-by-one in meinem eigenen Sondenskript gescheitert — Berichtspfad
und Flags um eine Stelle verschoben. Die drei Läufe sind ungültig und stehen hier nicht als Beleg;
der Schluss oben hängt allein an der A/B-Gegenprobe.*

## 🔴 Derselbe Anpassungspunkt-Fehler, ein Feld weiter: `depends` ersetzte die Standardliste

Gemessen 2026-08-09, erste Zeile der Distro-Matrix, `ubuntu:24.04`, gegen das an diesem Tag frisch
gebaute `.deb`. Die Installation gelang, und dann:

```
/usr/bin/zima-linux-client: error while loading shared libraries: libnspr4.so:
cannot open shared object file: No such file or directory        → app exited 127
```

Kein Fenster, kein Startbericht. Ursache im `package.json`:

```json
"deb": { "depends": ["libcap2-bin"] }
```

`build.<ziel>.depends` **ersetzt** die Standardliste von electron-builder, es ergänzt sie nicht —
dieselbe Familie wie beim `afterInstall` im Abschnitt darüber, ein Feld weiter. Das gebaute Paket
forderte genau eine Bibliothek an und **keine** der neun, die app-builder-lib per Default einträgt
(`out/targets/FpmTarget.js:315`). Am Paket abgelesen, nicht vermutet:

```
$ dpkg-deb -f dist/zima-linux-client_2.0.0-alpha.1_amd64.deb Depends
libcap2-bin
```

`libnspr4` kommt mit `libnss3` — der fehlenden Angabe. **Warum es so lange unsichtbar war:** jeder
Rechner, auf dem wir gebaut und gestartet haben, hatte GTK und NSS längst installiert. Die
fehlende Deklaration kostet dort nichts. Sie kostet auf einer schlanken Installation den Start —
und `apt` warnt nicht, denn das Paket sagt ja, es brauche nichts weiter.

**Behoben:** die Standardliste steht jetzt vollständig in `package.json`, für alle drei Formate,
plus je eine gemessene Ergänzung:

| Ziel | Ergänzung | Warum, gemessen 2026-08-09 |
| --- | --- | --- |
| deb | `libcap2-bin` | `setcap` fehlt auf `ubuntu:24.04`; das Post-Install braucht es |
| rpm | `/usr/sbin/setcap` | Datei-Abhängigkeit, weil das Paket je Distribution anders heißt: `fedora:41` löst sie auf `libcap` auf, `tumbleweed` auf `libcap-progs` — und dort fehlt `setcap` im Basis-Abbild tatsächlich |
| pacman | `libcap` | besitzt `/usr/bin/setcap` auf Arch (`pacman -Qo`) |

### Und dann war auch die Standardliste selbst nicht genug

Mit der wiederhergestellten Liste kam die App **immer noch** nicht hoch, nur mit einem anderen
Namen im Fehler. Statt Fehler für Fehler nachzuziehen, ist die vollständige Lücke gemessen worden:
Paket installieren, dann `ldd` auf das installierte Binary und **alle** `not found` einsammeln.

| Zeile | fehlt nach der Installation |
| --- | --- |
| `ubuntu:22.04` | `libasound.so.2`, `libgbm.so.1` |
| `ubuntu:24.04` | `libasound.so.2` |
| `debian:12` | `libasound.so.2` |
| `opensuse/tumbleweed` | `libasound.so.2`, `libgbm.so.1` |
| `fedora:41` | — (dort zieht `gtk3` beides transitiv nach; deshalb war diese Zeile schon grün) |

Electron 43 braucht beide, electron-builders Standardliste nennt keine von beiden. Nachgetragen:
`libasound2` und `libgbm1` für deb, und für rpm die **Soname-Fähigkeiten**
`libasound.so.2()(64bit)` / `libgbm.so.1()(64bit)` — weil eine einzige rpm-Liste zwei
Distributionen bedienen muss, die die Pakete verschieden nennen (`alsa-lib`/`mesa-libgbm` auf
Fedora, `libasound2`/`libgbm1` auf Tumbleweed). Beide Schreibweisen sind auf beiden Distributionen
als auflösbar gemessen.

### `http-parser` machte das `.pacman`-Paket unbenutzbar

Arch brach in der Matrix schon bei der Installation ab:

```
warning: cannot resolve "http-parser", a dependency of "zima-linux-client"
error: failed to prepare transaction (could not satisfy dependencies)
```

`http-parser` steht in electron-builders Standardliste für pacman und existiert in **keinem**
Arch-Repository mehr (`pacman -Si` und `pacman -Sp` scheitern beide). Das Paket war damit auf
aktuellem Arch schlicht nicht installierbar. Entfernt — und weil der Wächter oben eine Obermenge
verlangt, mit einer **namentlichen** Ausnahme samt Messprotokoll, nicht mit einem Schalter, der die
Regel abschaltet. Ein zweiter Test lässt diese Ausnahme rot werden, sobald electron-builder den
Namen selbst fallen lässt; sie soll ihren Grund nicht überleben. `libappindicator-gtk3` sah zuerst
genauso aus, löst aber über `libappindicator` auf — gegengeprüft und deshalb geblieben.

### 🔴 Der teuerste der drei: ein Paket, das sich sauber installiert und dann stirbt

Nach dem Nachtragen von `libasound2` startete die App auf 22.04, Debian 12, Fedora, Arch und
Tumbleweed — auf **Ubuntu 24.04** dagegen:

```
symbol lookup error: undefined symbol: snd_device_name_get_hint, version ALSA_0.9
→ app exited 127
```

Keine fehlende Bibliothek: die Datei war da, das Symbol nicht. Ursache ist der `time_t`-Übergang.
Auf 24.04 heißt die echte Bibliothek `libasound2t64`, und `libasound2` ist nur noch ein **Name**,
den außerdem `liboss4-salsa-asound2` liefert — eine OSS-Kompatibilitätsschicht. apt hat die
Schicht gewählt; `dpkg -l` nach der Installation zeigte sie, und kein `libasound2t64`. Die Schicht
trägt den Soname und einen Teil der Symbole, `snd_device_name_get_hint` gehört nicht dazu.

**Das ist die unangenehmere Hälfte dieses Fehlerbildes:** eine fehlende Bibliothek fällt bei der
Installation auf, ein falscher Anbieter erst beim Start. `apt` meldet Erfolg.

**Behoben** als Alternative mit der echten Bibliothek zuerst — die Schreibweise überlebt fpm und
steht so im Paket:

```
$ dpkg-deb -f dist/zima-linux-client_2.0.0-alpha.1_amd64.deb Depends
… libsecret-1-0, libasound2t64 | libasound2, libgbm1, libcap2-bin
```

Gemessen nach der Änderung, je Distribution installiert und nachgesehen, **welches** Paket
tatsächlich kam:

| Zeile | gezogen | fehlende Bibliotheken |
| --- | --- | --- |
| `ubuntu:22.04` | `libasound2 1.2.6.1` | 0 |
| `ubuntu:24.04` | `libasound2t64 1.2.11` | 0 |
| `debian:12` | `libasound2 1.2.8` | 0 |

Ein Test hält die Schreibweise **samt Reihenfolge** fest, damit sie niemand später zu `libasound2`
„vereinfacht" — das wäre auf 24.04 genau dieser Absturz.

🔴 **Dreimal an einem Nachmittag hat mein Messgerät „nein" gesagt, wo es die Frage nicht stellen
konnte:** `awk` fehlt im openSUSE-Basisabbild (die Messwerte wurden zu einer Fehlermeldung);
`apt-get install -s libasound2` scheitert auf 24.04, obwohl `libasound2t64` den Namen liefert und
`Depends: libasound2` sauber auflöst — die falsche Operation für die Frage; `dnf install
--assumeno` liefert **immer** einen Fehlercode, weil das Flag die Rückfrage verneint. Jedes Mal sah
es aus wie ein Befund über die Sache. Konsequenz: jede Prüfung, aus deren Fehlschlag etwas
geschlossen wird, läuft einmal gegen einen Fall, der anschlagen **muss**.

**Wächter:** `src/main/app/__tests__/packageDepends.test.ts` liest die Standardliste **zur
Laufzeit** aus `app-builder-lib` und verlangt, dass unsere eine Obermenge ist. Damit wird ein
electron-builder-Update rot, statt still weniger zu deklarieren — genau die Konsequenz, die beim
`afterInstall` schon gezogen wurde. **Positivkontrolle gefahren:** `libnss3` aus `package.json`
entfernt (Sabotage am Ziel geprüft, `grep -c '"libnss3"'` = 0), Test wird rot und **benennt den
fehlenden Namen**; nach Rücknahme wieder grün.

## 🔴 „Das Gerät hat nicht geantwortet" — während das Gerät in 3 ms antwortete

Gemeldet aus dem laufenden Fenster: *„Apps: Gespeicherte Liste · Stand 15:43 — das Gerät hat
gerade nicht geantwortet"*, um 20:06 Uhr.

Das Protokoll nennt den Vorgang genau:

```
20:06:02 … 20:06:44   apps.served-from-cache {"kind":"still-refreshing"}   (20×, alle 2,2 s)
20:06:09/18/27/36/45  zima.request-failed {"path":"/v2/app_management/installed/list",
                                           "ms":8001,"reason":"This operation was aborted"}
```

**Gegenprobe von diesem Rechner, zur selben Zeit, an dieselbe Adresse:**

```
GET /v1/sys/version                    HTTP 401   0,007 s
GET /v1/users/login                    HTTP 401   0,005 s
GET /v2/app_management/installed/list  HTTP 401   0,003 s
```

Das Gerät war also **erreichbar und schnell**. Die Oberfläche behauptete etwas über das Gerät, was
zeitgleich widerlegbar war — dieselbe Familie wie „ein generischer Fehler beschuldigt das fernste
Bauteil", nur diesmal in einem Satz, den ich selbst geschrieben habe.

**Das Verhalten war richtig, die Aussage falsch.** Die Schleife hat um 20:06:45 aufgehört: der
nächste Versuch kam durch, die Liste wurde aktuell, seither keine Zeile mehr. Nach 43 Sekunden
Stocken hat das Gerät geantwortet — dieselbe sporadische Verzögerung des *authentifizierten*
`installed/list`, die schon am Nachmittag gemessen und deren Ursache **nicht** identifiziert wurde.
Genau deshalb bleibt die Wiederholung ohne Obergrenze: eine Aufgabe-Schwelle hätte hier einen
Fehler angezeigt, wo die Anwendung sich gerade erholte. Am Verhalten wurde nichts geändert.

**Geändert wurde der Satz** — von einer Behauptung über das Gerät zu einer Aussage über die
eigene Anfrage: „Stand 15:43 — noch keine Antwort auf die Abfrage, wird weiter versucht."

### 🔴 Und dabei fiel auf: 26 von 28 Sprachen trugen die Hälfte des Satzes nie

`apps.cachedAt` lautete außerhalb von `de_DE` und `en_US` schlicht `Stand: {{time}}` — ohne
jeden Grund für das Datum. Das i18n-Gate meldet für **alle 28** Kataloge 100 % (280/280), weil es
**Schlüssel** zählt. Vollständigkeit ist nicht Gleichwertigkeit; eine Übersetzung kann komplett
sein und **weniger sagen** als die Quelle.

Zwei mechanische Prüfungen dagegen wurden gebaut und **beide wieder verworfen**, weil sie die
falsche Eigenschaft messen:

| Versuch | Ergebnis |
| --- | --- |
| „Quelle hat einen Gedankenstrich-Nebensatz → Übersetzung auch" | **39 Fehlalarme** — viele Sprachen setzen dort einen Doppelpunkt und tragen den Satz vollständig |
| „Übersetzung < 45 % der Quelllänge (CJK < 30 %)" | **62 Fehlalarme** — chinesische Übersetzungen sind legitim 20–30 % so lang |

Beide messen Zeichensetzung bzw. Länge statt Bedeutung. Ein lautes Gate, das man zu ignorieren
lernt, ist schlechter als keins — dieselbe Begründung steht schon im Kopf von `verify-i18n.mjs`
für einen früheren verworfenen Versuch. **Also kein neues Gate.** Die 28 Kataloge sind von Hand
angeglichen; die Lücke bleibt benannt und gehört zur ohnehin offenen muttersprachlichen Prüfung.
Eine *saubere* mechanische Lösung wäre eine Frische-Markierung nach gettext-Art (Quelltext-Hash je
Schlüssel und Katalog) — sie misst „die Quelle hat sich seit der Übersetzung geändert" und nicht
den Text selbst; nicht gebaut.

## 🔴 Die README-Screenshots — und was der erste Lauf beinahe veröffentlicht hätte

`npm run screenshots` (`scripts/screenshots.mjs`) nimmt sieben Bilder im echten Fenster auf,
gegen dasselbe aufgezeichnete Gerät, das auch die E2E-Suite abspielt. Sie liegen in `docs/img/`
und stehen mit Bildunterschriften in README und `liesmich.md`.

**Der Fehler:** Ich hatte geschlossen „läuft gegen ein gewaschenes Fixture, also kann nichts
Privates im Bild sein". Das **erste Bild** zeigte das echte Tailnet des Aufnahme-Rechners —
Name, drei Rechnernamen, drei Adressen. Die Tailscale-Kachel fragt nicht das Gerät, sie fragt den
**lokalen Daemon**. Zweiter Fund auf demselben Bildschirm: die Kachel „Vom alten Client
übernehmen" liest `~/.config` und zeigte drei echte Pfade **samt Benutzername** neben den zuletzt
benutzten Hosts; `--user-data-dir` verlegt Electrons Speicher, nicht das, was die Anwendung liest.

Eine Aufzeichnung belegt die Herkunft dessen, was sie **ersetzt** — nicht die von allem anderen,
das mit ihr auf demselben Bildschirm steht.

**Warum kein Tor es gesehen hat:** das Fixture *war* gewaschen, das Privacy-Gate meldete „clean"
(es überspringt `.png`, siehe `verify-privacy.mjs`, Zeile 94), und die Dateien waren noch nicht
committet. Gefunden hat es ein **Blick auf das Bild**.

**Was jetzt davorsteht — Technik, nicht Vorsatz:**

| Maßnahme | Beleg |
| --- | --- |
| Aufnahmelauf mit eigenem leerem `HOME` und `PATH` ohne `tailscale` | Lauf meldet „removed 2 director(y\|ies) holding a tailscale binary" |
| `scripts/screenshot-guard.mjs` prüft **vor jeder** Aufnahme | schlug beim zweiten Lauf sofort an: „2 address(es) not from the recording (10.x.x.x, 172.x.x.x)" |
| Als **positive** Eigenschaft formuliert (erlaubt ist nur die abgespielte Adresse) | eine Sperrliste privater Werte müsste sie enthalten, um zu wirken |
| Meldet maskiert (`100.x.x.x`, `/home/<user>`) | sonst schreibt der Wächter den Wert in das Protokoll, das er schützen soll |
| 8 Tests, Positivkontrolle gefahren | sabotiert werden 3 rot; die Sabotage war per `grep -c` nachweislich in der Datei |
| PNG-Metadaten von Hand geprüft (das Gate kann es nicht) | nur `IHDR/IDAT/IEND`, kein Textblock; 0 Treffer für `/home/`, Name, Domain, Adressen |

**Und ein zweiter eigener Fehler direkt danach:** ich hatte die geleakten Adressen wörtlich als
Testdaten in den neuen Test übernommen. Das Privacy-Gate hat sie gefangen — jetzt RFC 5737
(`203.0.113.x`, `192.0.2.x`).

**Bewusst im Bild geblieben,** weil es die Wahrheit über den Aufnahme-Rechner ist und in der README
als solche benannt wird: der rote Keyring-Kasten (kein Schlüsselbund; zwei Versuche mit
Wegwerf-Schlüsselbund in eigener D-Bus-Sitzung und `--password-store=gnome-libsecret` blieben bei
`basic_text`) und die flachen Farbkacheln der Fotogalerie (die Aufzeichnung liefert
Platzhalter-Bytes, weil echte Fotos echte wären).

## Alt-Stand

Der 0.9.23-Code liegt unverändert unter `legacy-0.9/` (per `git mv`, Historie erhalten) und ist
auf `main` weiter baubar. Es wurde nichts gelöscht.
