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

Alle 28 bei **100 % Abdeckung**. Nachladen per Chunk (`import.meta.glob`), damit nicht 28
Kataloge im Startbündel liegen; `en_US` ist fest eingebaut, weil es der Rückfall für alle ist.

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

## Was ausdrücklich noch nicht existiert

Dateien, Fotos und Apps zeigen einen benannten Platzhalter mit Phasennummer — **kein leerer
Bildschirm**, weil „leer" wie „nichts vorhanden" aussieht und etwas anderes behauptet als „noch
nicht gebaut". Es fehlen: Remote-ID über ZeroTier (**Phase 3b**), Restart/Shutdown, File Hub,
Photos-Oberfläche und -Backup, Apps mit Offline-Cache, Playwright-E2E, Paketbau und die
Distro-Start-Matrix. Die 28 Sprachdateien sind vollständig, 25 davon ungeprüft.

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

### Offener Punkt, der dabei aufgefallen ist

`devices.json` hat Modus **664** — lesbar für jeden lokalen Benutzer. Es enthält keine
Geheimnisse, aber Gerätenamen und LAN-Adressen, also Netz-Topologie. Sollte auf 600 wie die
Credentials. Noch **nicht** geändert.

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

⚠️ **Was daran noch unbelegt ist:** Fehler 1 ist am laufenden Programm bewiesen, Fehler 2
**nicht** — dafür braucht es eine echte Anmeldung mit Passwort, also einen Menschen mit
Zugangsdaten. Bis dahin gilt: im Code behoben, im Bild nicht bestätigt.

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

## Alt-Stand

Der 0.9.23-Code liegt unverändert unter `legacy-0.9/` (per `git mv`, Historie erhalten) und ist
auf `main` weiter baubar. Es wurde nichts gelöscht.
