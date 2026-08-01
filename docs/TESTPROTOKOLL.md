# Testprotokoll — ZimaOS Client 2.0.0-alpha.1

**So benutzt:** Diese Datei kopieren, beim Testen ausfüllen und zurückschicken. Die Kästchen sind
zum Ankreuzen (`[x]`), die Zeilen darunter für alles, was auffällt.

Die Hintergründe stehen in [TESTER.md](TESTER.md) — dort ist beschrieben, *warum* etwas so ist.
Hier steht nur, was zu tun ist und was dabei herauskommen soll.

**Drei Regeln, damit das Protokoll etwas wert ist:**

1. **Ein „nicht getestet" ist eine gute Antwort.** Ein angekreuztes „ok" für etwas, das gar nicht
   ausprobiert wurde, ist schlimmer als eine Lücke — dann schaut nämlich niemand mehr hin.
2. **Wenn etwas hakt, bitte die *ganze* Ausgabe schicken**, nicht die Zusammenfassung. Der
   entscheidende Satz steht erfahrungsgemäß in der Zeile, die nach „unwichtig" aussieht.
3. **Was in der Spalte „erwartet" steht, ist auf Ubuntu 24.04 gemessen** — sonst nirgends. Weicht
   deine Maschine ab, ist das genau der Befund, um den es hier geht, und kein Fehler von dir.

---

## 0. Wer und was

| Feld | Eintrag |
| --- | --- |
| Name / Kürzel | |
| Datum des Tests | |
| Getestetes Paket | `[ ] .deb`  `[ ] .rpm`  `[ ] AppImage` |
| Installiert über | `[ ] install.sh`  `[ ] von Hand (apt/dnf/zypper)`  `[ ] gar nicht (AppImage)` |

---

## 1. Umgebung

Diesen Block im Terminal ausführen und die Ausgabe unten einfügen:

```bash
{ . /etc/os-release; echo "Distribution:  $PRETTY_NAME"; }
echo "Kernel:        $(uname -srm)"
echo "Sitzung:       ${XDG_SESSION_TYPE:-unbekannt} / ${XDG_CURRENT_DESKTOP:-unbekannt}"
echo "Grafiktreiber: $(for d in /sys/class/drm/card*/device/driver; do [ -e "$d" ] && basename "$(readlink -f "$d")"; done | sort -u | tr '\n' ' ')"
echo "Sprache:       ${LANG:-unbekannt}"
```

```
(Ausgabe hier einfügen)



```

Wayland oder X11 und der Grafiktreiber sind die zwei wichtigsten Zeilen: auf `vmwgfx` unter Wayland
stirbt Electron 43 mit einem SIGSEGV, deshalb startet sich der Client dort selbst unter X11 neu.
Ob dieser Rückfall auf anderen Treibern richtig greift — oder unnötig anspringt —, weiß niemand.

---

## 2. Vor der Installation: Prüfsumme

```bash
sha256sum zima-linux-client_2.0.0-alpha.1_amd64.deb
sha256sum zima-linux-client-2.0.0-alpha.1.x86_64.rpm
```

Sollwerte (Bau vom 2026-07-31):

```
3fee2b8668ad25c76921bfb44d2eefaafc85074bf6b8dad26decf5663220ed35  …_amd64.deb
e457f61089425daf7f16e7910055bd74de806421da4c9c978682a8ab64b7a071  …x86_64.rpm
```

- [ ] Prüfsumme stimmt überein
- [ ] weicht ab → **hier abbrechen und melden**, dann ist die Datei nicht die, die ich gebaut habe

---

## 3. Installation

| | Erwartet (auf Ubuntu 24.04 gemessen) | Ergebnis |
| --- | --- | --- |
| 3.1 | Die Installation läuft ohne Abbruch durch | `[ ] ok` `[ ] Fehler` `[ ] nicht getestet` |
| 3.2 | Es erscheint **keine** Zeile, die mit `zima-linux-client:` beginnt und einen Fehlschlag meldet | `[ ] ok` `[ ] Fehler` `[ ] nicht getestet` |
| 3.3 | Bei `apt`: die Meldung über den Benutzer `_apt` ist harmlos (siehe TESTER.md § 2) | `[ ] gesehen` `[ ] nicht gesehen` |

**Ganze Ausgabe der Installation** (auch wenn sie glatt lief — die Post-Install-Zeilen sind
interessant):

```
(Ausgabe hier einfügen)



```

**Bei `install.sh`:** Das Skript endet mit `0`, wenn alles gemessen in Ordnung ist, und mit `1`,
wenn die Anwendung so nicht laufen wird. Bitte den Exit-Code mitschicken:

```bash
sudo ./install.sh; echo "exit=$?"
```

Exit-Code: `________`

---

## 4. Was die Installation hinterlassen hat

Diese fünf Zeilen ausführen und die Ausgabe einfügen. Sie ändern nichts.

```bash
echo "1) $(command -v zima-linux-client || echo FEHLT)"
echo "2) $(getcap '/opt/ZimaOS Client/resources/zerotier/x64/zerotier-one' 2>&1)"
echo "3) $(ls -l '/opt/ZimaOS Client/chrome-sandbox' 2>&1 | awk '{print $1}')"
unshare --user true 2>/dev/null && echo "4) user-namespaces: ok" || echo "4) user-namespaces: NICHT verfügbar"
dpkg -l zima-linux-client 2>/dev/null | tail -1 || rpm -q zima-linux-client
```

```
(Ausgabe hier einfügen)



```

**Wie das zu lesen ist:**

| Zeile | Erwartet | Wenn nicht |
| --- | --- | --- |
| 1 | `/usr/bin/zima-linux-client` | Der Startbefehl fehlt — **Befund** |
| 2 | `cap_net_bind_service,cap_net_admin,cap_net_raw=eip` | Ohne `cap_net_admin` nimmt ZeroTier einen Netzbeitritt an, den es nie ausführt: sieht aus wie Erfolg, bleibt wirkungslos — **Befund** |
| 3 | `-rwxr-xr-x` **oder** `-rwsr-xr-x` | beides ist in Ordnung: das `s` setzt die Installation nur dort, wo Zeile 4 „NICHT verfügbar" sagt |
| 4 | `ok` oder `NICHT verfügbar` | beides ist ein gültiges Ergebnis — aber „NICHT verfügbar" **zusammen mit** `-rwxr-xr-x` in Zeile 3 heißt: die App wird nicht starten. Dann bitte `sudo ./install.sh --repair` und melden |
| 5 | `2.0.0~alpha.1` (deb) bzw. `2.0.0-alpha.1` (rpm) | eine andere Fassung ist installiert |

---

## 5. Erster Start

Bitte **aus dem Terminal** starten, damit die Ausgabe sichtbar ist:

```bash
zima-linux-client
```

| | Erwartet | Ergebnis |
| --- | --- | --- |
| 5.1 | Ein Fenster erscheint | `[ ] ok` `[ ] kein Fenster` |
| 5.2 | Es dauert bis zum Fenster nicht länger als ein paar Sekunden | `[ ] ok` `[ ] länger: ____ s` |
| 5.3 | Die Oberfläche ist in deiner Sprache oder auf Englisch | `[ ] ok` `[ ] Mischung` `[ ] falsche Sprache` |
| 5.4 | Nirgends stehen rohe Schlüssel wie `devices.none` statt eines Satzes | `[ ] ok` `[ ] gesehen bei: ______` |

**Terminal-Ausgabe des Starts** (besonders wichtig, wenn kein Fenster kam):

```
(Ausgabe hier einfügen)



```

Zwei Meldungen sind bekannt und besonders interessant:

* `The SUID sandbox helper binary was found, but is not configured correctly …` — dann greift der
  Namespace-Sandkasten auf deinem System nicht. **Echter Befund**, bitte melden.
* irgendetwas mit `ozone`, `wayland` oder `GPU` — dann hat der X11-Rückfall zugeschlagen oder ist
  gescheitert. Beides will ich wissen.

Zusätzlich diese drei Zeilen aus dem Protokoll der Anwendung mitschicken:

```bash
grep -hE 'platform\.|app\.ready' ~/.config/zima-linux-client/logs/main.log | tail -3
```

```
(Ausgabe hier einfügen)


```

---

## 6. Die „muss gehen"-Liste

Der Reihe nach. Alles, was hakt, ist ein Befund — auch Kleinigkeiten.

| | Schritt | Erwartet | Ergebnis | Notiz |
| --- | --- | --- | --- | --- |
| 6.1 | **Gerät finden:** „Lokales Netzwerk durchsuchen" | Dein ZimaOS taucht in der Liste auf | `[ ] ok` `[ ] Fehler` `[ ] n. get.` | |
| 6.2 | **Alternativ:** „Über IP-Adresse verbinden" | Gerät antwortet, Laufzeit wird angezeigt | `[ ] ok` `[ ] Fehler` `[ ] n. get.` | |
| 6.3 | **Anmelden** mit Benutzer/Passwort deines ZimaOS | Gerätekarte zeigt Benutzer, Rolle und Restlaufzeit der Sitzung | `[ ] ok` `[ ] Fehler` `[ ] n. get.` | |
| 6.4 | **Falsches Passwort** absichtlich einmal | „Benutzername oder Passwort ist falsch." — **nicht** eine Meldung über einen abgelehnten Pfad | `[ ] ok` `[ ] Fehler` `[ ] n. get.` | |
| 6.5 | **Neu starten:** schließen, wieder öffnen | Du bleibst **angemeldet** | `[ ] ok` `[ ] Fehler` `[ ] n. get.` | |
| 6.6 | **Dateien:** Ordner öffnen, navigieren, Vorschau ansehen | Inhalte erscheinen, keine Fehlermeldung beim bloßen Öffnen | `[ ] ok` `[ ] Fehler` `[ ] n. get.` | |
| 6.7 | **Datei herunterladen** | Datei landet im Zielordner, Größe stimmt | `[ ] ok` `[ ] Fehler` `[ ] n. get.` | |
| 6.8 | **Datei hochladen** | Datei erscheint auf dem Gerät | `[ ] ok` `[ ] Fehler` `[ ] n. get.` | |
| 6.9 | **Papierkorb** öffnen | Liste erscheint (darf leer sein) | `[ ] ok` `[ ] Fehler` `[ ] n. get.` | |
| 6.10 | **Fotos:** Galerie öffnen | Bilder erscheinen — **oder**, auf Geräten ohne Fotos-Modul, eine verständliche Meldung statt einer leeren Fläche | `[ ] ok` `[ ] Fehler` `[ ] n. get.` | |
| 6.11 | **Apps:** Liste öffnen | Installierte Apps, jede mit eigenem Symbol. Steht dort dauerhaft „wird geladen": melden, mit ungefährer Wartezeit | `[ ] ok` `[ ] Fehler` `[ ] n. get.` | |
| 6.12 | **App-Weboberfläche öffnen** | Browser geht auf der richtigen Adresse auf | `[ ] ok` `[ ] Fehler` `[ ] n. get.` | |
| 6.13 | **Gerät:** Systemdaten, Auslastung, Datenträger | Zahlen erscheinen und wirken plausibel | `[ ] ok` `[ ] Fehler` `[ ] n. get.` | |
| 6.14 | **Sprache umschalten** (oben im Fenster) | Oberfläche springt **sofort** um | `[ ] ok` `[ ] Fehler` `[ ] n. get.` | |
| 6.15 | **Hell / Dunkel / System** durchschalten | Alle drei lesbar, „System" folgt der Desktop-Einstellung | `[ ] ok` `[ ] Fehler` `[ ] n. get.` | |
| 6.16 | **Fenster schmal ziehen** (< 860 px) | Navigation wird zur schwebenden Pill, breit wieder zur Seitenleiste | `[ ] ok` `[ ] Fehler` `[ ] n. get.` | |
| 6.17 | **Remote ID** (nur wenn du eine hast) | „Über Remote-ID verbinden" führt bis zum Anmeldeformular | `[ ] ok` `[ ] Fehler` `[ ] n. get.` | |
| 6.18 | **Abmelden und neu anmelden** | Funktioniert, ohne das Programm neu zu starten | `[ ] ok` `[ ] Fehler` `[ ] n. get.` | |

**Besonders wertvoll, weil hier ungetestet:**

- [ ] Anmeldung mit einem **Konto ohne Admin-Rechte** — welche Bildschirme dann leer bleiben oder
      Fehler zeigen, ist völlig unbekannt.
- [ ] Ein Gerät **ohne** Fotos-Modul (6.10).
- [ ] Eine **Tailscale**-Verbindung: läuft bei dir ein Tunnel, taucht ein Panel mit deinen Peers auf.
      Ein vollständiger Login darüber ist noch nie durchgeklickt worden.

---

## 7. Bitte **nicht** als fehlend melden

Diese Dinge fehlen mit Absicht — sie sind kein Befund:

- Hintergrund-Synchronisation von Fotos. Das Backup läuft nur bei offenem Fenster, und das steht
  auch so auf dem Bildschirm.
- SMB-Einbindungen und geplante Backup-Jobs aus der 0.9-Linie.
- Automatische Aktualisierung.
- Ein Flatpak oder ein arm64-Paket.
- Änderungen an deinem Tailscale: der Client liest dessen Zustand und fasst nichts an.

---

## 8. Wenn etwas schiefging

Das Protokoll der Anwendung:

```bash
tail -300 ~/.config/zima-linux-client/logs/main.log
```

⚠️ **Vor dem Weiterschicken einmal durchsehen.** Die Datei enthält Adressen, Gerätenamen und
Ordnernamen aus deinem Netz sowie deinen Benutzernamen im Pfad. Ersetze, was du nicht teilen
willst — für die Fehlersuche reicht `<geraet>` statt des echten Namens.

Hilfreich in jeder Meldung:

| Frage | Antwort |
| --- | --- |
| Was hast du geklickt? | |
| Was ist passiert? | |
| Was sollte passieren? | |
| Reproduzierbar? | `[ ] jedes Mal` `[ ] manchmal` `[ ] einmalig` |

---

## 9. Gesamteindruck

| Frage | Antwort |
| --- | --- |
| Startet der Client auf deiner Maschine? | `[ ] ja` `[ ] nein` |
| Konntest du dich anmelden? | `[ ] ja` `[ ] nein` |
| Würdest du ihn in diesem Zustand benutzen? | `[ ] ja` `[ ] nein, weil …` |
| Was hat am meisten gestört? | |
| Was hat gefehlt? | |

**Freitext — alles, wofür oben keine Zeile war:**

```



```

Danke fürs Mittesten.
