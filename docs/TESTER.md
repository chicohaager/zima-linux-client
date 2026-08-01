# ZimaOS Client 2.0.0-alpha.1 — Hinweise für Testerinnen und Tester

Danke fürs Mittesten. Das hier ist ein **Alpha-Stand**: er ist auf genau **einer** Maschine
gestartet worden (Ubuntu 24.04, GNOME auf Wayland, x86_64). Ob er auf deiner startet, ist die
erste Frage, die dieser Test beantworten soll.

Was in diesem Dokument steht, ist gemessen. Wo etwas **nicht** gemessen ist, steht das ausdrücklich
dabei — dann ist es eine Bitte um einen Test, keine Zusage.

**Zum Ausfüllen und Zurückschicken gibt es [TESTPROTOKOLL.md](TESTPROTOKOLL.md)** — dieselben
Schritte als Formular, mit den Befehlen, die deine Umgebung und die Rechte nach der Installation
festhalten. Dieses Dokument hier erklärt die Hintergründe, das Protokoll fragt die Ergebnisse ab.

---

## 1. Was du bekommst

| Datei | Für | Größe |
| --- | --- | --- |
| `zima-linux-client_2.0.0-alpha.1_amd64.deb` | Debian, Ubuntu, Linux Mint, Pop!_OS … | 101,3 MiB |
| `zima-linux-client-2.0.0-alpha.1.x86_64.rpm` | Fedora, openSUSE, RHEL-Abkömmlinge | 89,4 MiB |

**Nur 64-Bit-Intel/AMD (x86_64).** Für ARM (Raspberry Pi, ARM-Notebooks) gibt es nichts — ein
arm64-Paket ist nicht gebaut und wäre ungetestet.

Beide Pakete sind **nicht signiert**. Prüfsummen dieses Standes (Bau vom 2026-07-31):

```
3fee2b8668ad25c76921bfb44d2eefaafc85074bf6b8dad26decf5663220ed35  …_amd64.deb
e457f61089425daf7f16e7910055bd74de806421da4c9c978682a8ab64b7a071  …x86_64.rpm

sha256sum <datei>       # zum Vergleichen
```

---

## 2. Installieren

### Der bequeme Weg: `install.sh`

Lege `install.sh` neben die Paketdatei und starte es. Es sucht das Paket, das zu deiner
Distribution passt, vergleicht die Prüfsumme, installiert mit dem richtigen Werkzeug — und
**misst danach nach**, ob die Anwendung überhaupt starten kann:

```bash
chmod +x install.sh
sudo ./install.sh
```

Weitere Aufrufe:

```bash
./install.sh --check       # nur nachsehen, ändert nichts (braucht kein sudo)
sudo ./install.sh --repair # behebt, was behebbar ist (Sandkasten-Rechte)
sudo ./install.sh --uninstall
```

Das Skript endet mit `0`, wenn alles gemessen in Ordnung ist, und mit `1`, wenn die Anwendung so
nicht laufen wird — dann bitte **die ganze Ausgabe** schicken. Es startet die Anwendung nicht: eine
Prüfung, die ein Fenster aufmacht, ist keine Prüfung.

### Der Weg von Hand

**Debian/Ubuntu:**

```bash
sudo apt install ./zima-linux-client_2.0.0-alpha.1_amd64.deb
```

`apt` zieht dabei `libcap2-bin` mit — das braucht das Paket, siehe Punkt 4.

**Diese Meldung dabei ist harmlos:**

```
N: Der Download wird als root und nicht Sandbox-geschützt durchgeführt, da auf die Datei
   »…_amd64.deb« durch den Benutzer »_apt« nicht zugegriffen werden kann.
   - pkgAcquire::Run (13: Keine Berechtigung)
```

`apt` liest lokale Dateien normalerweise als Benutzer `_apt`. Auf Ubuntu 24.04 steht dein
Home-Verzeichnis auf `750`, da kommt `_apt` nicht durch — also macht `apt` es selbst als root und
sagt das an. **Die Installation läuft ganz normal durch**; nachgemessen am 2026-07-31 auf
Ubuntu 24.04: nach genau dieser Meldung stand `ii zima-linux-client 2.0.0~alpha.1` im
Paketverzeichnis, und alles aus Punkt 4 war eingerichtet. Wer die Meldung nicht sehen will, legt
das Paket vorher woanders hin:

```bash
cp zima-linux-client_2.0.0-alpha.1_amd64.deb /tmp/ && sudo apt install /tmp/zima-linux-client_2.0.0-alpha.1_amd64.deb
```

**Fedora:**

```bash
sudo dnf install ./zima-linux-client-2.0.0-alpha.1.x86_64.rpm
```

**openSUSE:**

```bash
sudo zypper install --allow-unsigned-rpm ./zima-linux-client-2.0.0-alpha.1.x86_64.rpm
```

Weil die Pakete unsigniert sind, kann `dnf` je nach Einstellung (`localpkg_gpgcheck`) meckern;
dann `--nogpgcheck` anhängen. Das RPM deklariert **nicht**, welches Paket `setcap` mitbringt —
falls beim Installieren die Meldung `setcap not found` kommt, bitte melden **und** dazu die Ausgabe
von `rpm -q --whatprovides /usr/sbin/setcap` schicken; damit kann die Abhängigkeit richtig
eingetragen werden.

Installiert wird nach `/opt/ZimaOS Client/`.

**Deinstallieren:** `sudo apt remove zima-linux-client` bzw. `sudo dnf remove zima-linux-client`.
Deine Einstellungen unter `~/.config/zima-linux-client/` bleiben dabei liegen; wenn du sie loswerden
willst, dieses Verzeichnis von Hand löschen.

---

## 3. Starten — und was die erste Sorte Fehler wäre

Über das Anwendungsmenü („ZimaOS Client") oder im Terminal:

```bash
zima-linux-client
```

Der Verweis `/usr/bin/zima-linux-client` wird bei der Installation angelegt und wurde am
2026-07-31 auf Ubuntu 24.04 nachgemessen: er zeigt über `/etc/alternatives/` auf
`/opt/ZimaOS Client/zima-linux-client`, und der Start über den bloßen Namen bringt das Fenster
hoch. Auf einer anderen Distribution ist das **nicht** nachgemessen — falls der Befehl bei dir
nicht existiert, ist das ein Befund.

**Wenn gar kein Fenster kommt**, ist die Ausgabe im Terminal das Wichtigste. Zwei Meldungen sind
bekannt und interessant:

* `The SUID sandbox helper binary was found, but is not configured correctly …` — dann greift auf
  deinem System der Namespace-Sandkasten nicht. Bitte melden, das ist ein echter Befund.
* irgendetwas mit `ozone`, `wayland` oder `GPU` — der Client startet sich auf problematischen
  Grafiktreibern absichtlich selbst unter X11 neu; wenn das schiefgeht, will ich es wissen.

Bitte in beiden Fällen dazuschreiben: Distribution + Version, Wayland oder X11, Grafiktreiber.

---

## 4. Was die Installation an Rechten vergibt

Das Paket bringt ein eigenes `zerotier-one` mit (für den Verbindungsweg „Remote ID") und erteilt
ihm beim Installieren `CAP_NET_ADMIN`. Das läuft im Post-Install-Skript, das ohnehin als root
läuft — die Anwendung selbst fragt **nie** nach einem Passwort.

Gemessen: ohne dieses Recht nimmt ZeroTier einen Netzbeitritt an, den es nie ausführen kann — es
sieht aus wie Erfolg und bleibt wirkungslos. Deshalb meldet das Skript jeden Fehlschlag laut. Falls
beim Installieren eine Zeile mit `zima-linux-client:` erscheint, bitte mitschicken.

Ein bereits auf deinem Rechner installiertes ZeroTier wird **nicht** angefasst.

---

## 5. Die „muss gehen"-Liste

Bitte der Reihe nach durchklicken. Alles, was hakt, ist ein Befund — auch Kleinigkeiten.

1. **Erststart:** Fenster erscheint, Oberfläche ist in deiner Sprache (oder Englisch), nirgends
   stehen rohe Schlüssel wie `devices.none` statt eines Satzes.
2. **Gerät finden:** „Lokales Netzwerk durchsuchen" → dein ZimaOS taucht auf. Alternativ
   „Über IP-Adresse verbinden".
3. **Anmelden:** Benutzername/Passwort deines ZimaOS. Danach zeigt die Gerätekarte Benutzer, Rolle
   und die verbleibende Gültigkeit der Sitzung.
4. **Neu starten:** Programm schließen, wieder öffnen — du solltest **angemeldet bleiben**.
5. **Dateien:** Ordner öffnen, navigieren, eine Vorschau ansehen.
6. **Fotos:** Galerie öffnen. Auf Geräten ohne das Fotos-Modul soll dort eine verständliche Meldung
   stehen, keine leere Fläche.
7. **Apps:** Liste der installierten Apps, jede mit ihrem eigenen Symbol. Wenn dort dauerhaft „wird
   geladen" steht: melden, mit ungefährer Wartezeit.
8. **Sprache umschalten** (oben im Fenster) — die Oberfläche muss sofort umspringen.
9. **Hell/Dunkel umschalten** — beides muss lesbar sein.
10. **Remote ID** (nur wenn du eine hast): „Über Remote-ID verbinden".

**Nicht enthalten** — bitte nicht danach suchen: Hintergrund-Synchronisation von Fotos
(ausdrücklich nicht gewollt), SMB-Einbindungen und Backup-Jobs aus der 0.9-Linie.

---

## 6. Wenn etwas schiefgeht: das Protokoll

```
~/.config/zima-linux-client/logs/main.log
```

Die Datei hat Rechte `600`, liest also nur dein Benutzerkonto. Sie enthält **Adressen und
Gerätenamen aus deinem Netz** — bitte vor dem Weiterschicken einmal durchsehen und ersetzen, was
du nicht teilen willst. Die letzten paar hundert Zeilen um den Fehler herum reichen:

```bash
tail -300 ~/.config/zima-linux-client/logs/main.log
```

Hilfreich in einer Meldung: was du geklickt hast, was passiert ist, was passieren sollte, plus
Distribution, Desktop-Umgebung und Wayland/X11.

---

## 7. Was bekannt und noch offen ist

* **Nur eine Maschine hat diesen Stand gestartet** (Ubuntu 24.04, GNOME/Wayland). Fedora, Arch und
  openSUSE sind ungetestet — das ist der Hauptgrund für diesen Test.
* **Die Wirkung der Installation ist nur auf Ubuntu 24.04 nachgemessen** — dort liegen
  `/usr/bin/zima-linux-client`, das AppArmor-Profil und die ZeroTier-Capability nachweislich
  richtig (2026-07-31, am installierten Paket abgelesen). Auf jeder anderen Distribution ist das
  offen; Punkt 4 des [Testprotokolls](TESTPROTOKOLL.md) fragt es mit fünf Befehlen ab.
* **Übersetzungen:** 28 Sprachen sind vollständig, aber 25 davon sind maschinell übersetzt und von
  keinem Muttersprachler geprüft. Holprige Formulierungen sind erwartbar — Meldungen trotzdem
  willkommen.
* **Tailscale** wird nur **erkannt**, nicht verwaltet: der Client benutzt einen bereits laufenden
  Tunnel und ändert keine DNS- oder Routing-Einstellungen. Eine Anmeldung über eine
  Tailscale-Adresse ist noch nicht von Anfang bis Ende durchgeklickt.
* **Keine automatische Aktualisierung.** Eine neue Fassung kommt als neues Paket.
* **Kein Flatpak, kein arm64.**
* **Konten ohne Admin-Rechte** sind ungetestet — falls du eines hast, ist das ein besonders
  wertvoller Test.
