# v2 — Umsetzungsstand

**Branch:** `v2` · **Version:** 2.0.0-alpha.1 · **Stand:** 2026-07-31

Der Plan steht in [V2-PLAN.md](V2-PLAN.md). Diese Datei sagt, was davon **läuft** — mit dem Beleg
daneben. Nichts hier ist „fertig", wofür kein Kommando oder Messwert genannt ist.

**Zuletzt gefahren, 2026-07-31 — der Stand dieses Commits:**

```
npm run verify   ✓  type-check · lint · build · build-gate · i18n-gate · privacy-gate
npx vitest run   ✓  135 Tests in 10 Dateien
i18n gate           clean — 280 Schlüssel in en_US; 2 Sprachen bei 100 %, 26 bei 111/280
privacy gate        clean, 115 verfolgte Dateien
```

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

> ⚠️ **Nicht mehr gültig.** Die Bildschirme der Phasen 3b–7 haben den Katalog auf **280**
> Schlüssel gebracht (Messung 2026-07-31); gepflegt sind bisher nur `de_DE` und `en_US`. Die
> anderen 26 stehen bei 111 von 280 (40 %) und fallen für den Rest auf Englisch zurück. Das Gate
> erzwingt keine
> Vollständigkeit — Übersetzen ist laufende Arbeit —, aber seine **Kopfzeile** behauptete
> `28 locales, 253 keys each`, was für 26 Dateien falsch war. Sie nennt jetzt beide Zahlen:
> `2 locale(s) at 100%, 26 partial`. Eine Zusammenfassung darf nicht grüner sein als die
> Zeilen darunter.

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

Auf Holgis Wunsch (2026-07-30) holt der Client **alle** Icons, die die App-Metadaten nennen —
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

## Was ausdrücklich noch nicht existiert

*(Stand Phase 3 — die Platzhalter sind inzwischen durch die echten Bildschirme ersetzt, siehe
oben. Was hier steht, gilt nur noch für die verbliebenen Lücken.)*

Es fehlen weiterhin:

* **Playwright-E2E.** Der Rundgang (`ZIMA_VERIFY_SCENARIO=tour`) leistet heute die Arbeit,
  läuft aber nur gegen ein Gerät im LAN und nicht in CI.
* **Paketbau und Distro-Start-Matrix** (Phase 8), einschließlich der arm64-Frage beim
  mitgelieferten ZeroTier-Binary.
* **Anmeldung über eine Tailscale-Adresse**, durchgeklickt von Anfang bis Ende.
* **Übersetzungen:** 26 der 28 Kataloge stehen bei 111 von 280 Schlüsseln; 25 sind zudem
  ungeprüft (nur `de_DE`, `en_US`, `en_GB` sind als geprüft markiert).
* **Sub-Account-Rechte** (Plan § 14 Punkt 6) — der Admin-Pfad allein beantwortet nicht,
  welche Endpunkte ein Nicht-Admin benutzen darf.

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

> ⚠️ **Noch offen, gleiche Klasse:** die Logdateien unter `logs/` stehen auf **664** und
> enthalten LAN-Adressen (`main.log`: 23 Treffer). Der Dateimodus liegt bei electron-log, nicht
> bei uns — noch nicht angefasst.

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

## Alt-Stand

Der 0.9.23-Code liegt unverändert unter `legacy-0.9/` (per `git mv`, Historie erhalten) und ist
auf `main` weiter baubar. Es wurde nichts gelöscht.
