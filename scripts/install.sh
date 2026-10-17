#!/bin/bash
#
# Installs the ZimaOS Linux client from a local package and MEASURES the result.
#
# The measuring half is the point. A package manager reporting success says the files were
# unpacked; it says nothing about whether the application can start. Measured 2026-07-31 on this
# project: a post-install script that had quietly replaced the stock one produced a perfectly
# installed package whose application aborted before drawing a window, on every machine without
# working user namespaces:
#
#     FATAL setuid_sandbox_host.cc:166 "The SUID sandbox helper binary was found, but is not
#     configured correctly. Rather than run without sandboxing I'm aborting now."
#
# So every check below prints the value it measured, not the word "ok", and the exit code says
# whether the application can be expected to start.
#
# Deliberately NOT done here:
#   * downloading anything — the package is a local file, so what gets installed is what you have
#     in your hand and can check with sha256sum;
#   * starting the application as a smoke test — measured: `zima-linux-client --version` does not
#     print a version, it starts the app. A "check" that opens a window is not a check.
#
# `set -eu` without `pipefail`, on purpose: with pipefail a consumer that exits early (`head`,
# `grep -q`) kills its producer with SIGPIPE and turns a SUCCESSFUL read into a failed pipeline —
# a race that passes in testing and fails in the field. Command output is captured into variables
# instead of piped.

set -eu

readonly EXECUTABLE='zima-linux-client'

# ZIMA_TEST_ROOT ist ausschließlich eine Prüfnaht: damit lassen sich die FEHLERfälle dieses
# Skripts gegen einen nachgebauten Baum fahren (fehlender Symlink, fehlende chrome-sandbox, kein
# ZeroTier). Ohne diese Naht wäre der einzige Weg, sie zu erreichen, eine kaputte echte
# Installation — also würde niemand sie je prüfen, und genau die Zweige, die im Ernstfall
# arbeiten müssen, blieben ungetestet. Im Normalbetrieb ist die Variable leer.
readonly ROOT="${ZIMA_TEST_ROOT:-}"
readonly PRODUCT_DIR="${ROOT}/opt/ZimaOS Client"
readonly BIN_LINK="${ROOT}/usr/bin/${EXECUTABLE}"
readonly SANDBOX="${PRODUCT_DIR}/chrome-sandbox"
readonly ZEROTIER="${PRODUCT_DIR}/resources/zerotier"

# --- Sprache ---------------------------------------------------------------------------------

# English unless the locale says German — LC_ALL before LC_MESSAGES before LANG, the order
# gettext uses. Until 2.0.5 every line here was German while README, release notes and the
# video are English (video fact check 2026-10-08). `t "<deutsch>" "<english>"` picks one.
case "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" in
  de*) LANG_DE=1 ;;
  *) LANG_DE=0 ;;
esac
readonly LANG_DE
t() { if [ "$LANG_DE" = 1 ]; then printf '%s' "$1"; else printf '%s' "$2"; fi; }

# --- Ausgabe ---------------------------------------------------------------------------------

failures=0
warnings=0

ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*" >&2; warnings=$((warnings + 1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; failures=$((failures + 1)); }
info() { printf '    %s\n' "$*"; }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die()  { printf '\n\033[31m%s\033[0m %s\n' "$(t 'Abbruch:' 'Aborted:')" "$*" >&2; exit 1; }

usage() {
  if [ "$LANG_DE" = 0 ]; then
    cat <<'USAGE'
ZimaOS Client — installation

  sudo ./install.sh                  installs the package that matches this distribution
  sudo ./install.sh <package-file>   installs exactly this file
       ./install.sh --check          checks an existing installation, changes nothing
  sudo ./install.sh --repair         checks and fixes what can be fixed (sandbox permissions)
  sudo ./install.sh --uninstall      removes the package (your settings stay)
       ./install.sh --help           this help

Without a file argument it looks next to the script and in the current directory:
  *.deb    for Debian, Ubuntu, Mint, Pop!_OS …
  *.rpm    for Fedora, openSUSE, RHEL derivatives
  *.pacman for Arch and derivatives

If a SHA256SUMS*.txt file sits next to it, the checksum is compared first.
USAGE
    return
  fi
  cat <<'USAGE'
ZimaOS Client — Installation

  sudo ./install.sh                  installiert das Paket, das zu dieser Distribution passt
  sudo ./install.sh <paketdatei>     installiert genau diese Datei
       ./install.sh --check          prüft eine vorhandene Installation, ändert nichts
  sudo ./install.sh --repair         prüft und behebt, was behebbar ist (Sandkasten-Rechte)
  sudo ./install.sh --uninstall      entfernt das Paket (Einstellungen bleiben erhalten)
       ./install.sh --help           diese Hilfe

Ohne Dateiangabe wird neben dem Skript und im aktuellen Verzeichnis gesucht:
  *.deb    für Debian, Ubuntu, Mint, Pop!_OS …
  *.rpm    für Fedora, openSUSE, RHEL-Abkömmlinge
  *.pacman für Arch und Abkömmlinge

Liegt eine Datei SHA256SUMS*.txt daneben, wird die Prüfsumme vorher verglichen.
USAGE
}

# --- Distribution und Paketverwaltung --------------------------------------------------------

# Gemessen wird das VORHANDENE Werkzeug, nicht der Name der Distribution: ein Derivat, das sich
# anders nennt, hat trotzdem das apt seiner Grundlage.
detect_family() {
  if command -v apt-get >/dev/null 2>&1 || command -v dpkg >/dev/null 2>&1; then
    echo deb
  elif command -v dnf >/dev/null 2>&1 || command -v zypper >/dev/null 2>&1 ||
    command -v rpm >/dev/null 2>&1; then
    echo rpm
  elif command -v pacman >/dev/null 2>&1; then
    echo pacman
  else
    echo unknown
  fi
}

pretty_name() {
  if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    echo "${PRETTY_NAME:-${ID:-$(t unbekannt unknown)}}"
  else
    t 'unbekannt (keine /etc/os-release)' 'unknown (no /etc/os-release)'; echo
  fi
}

find_package() {
  local family="$1" pattern here
  case "$family" in
    deb) pattern='*.deb' ;;
    rpm) pattern='*.rpm' ;;
    pacman) pattern='*.pacman' ;;
    *) return 1 ;;
  esac

  here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  local dir found
  for dir in "$here" "$here/../dist" "$PWD"; do
    [ -d "$dir" ] || continue
    # `find … -print -quit` statt `ls | head`: kein früh aussteigender Konsument in einer Pipe.
    found="$(find "$dir" -maxdepth 1 -name "$pattern" -type f -print -quit 2>/dev/null || true)"
    if [ -n "$found" ]; then
      echo "$found"
      return 0
    fi
  done
  return 1
}

verify_checksum() {
  local file="$1" dir base sums line
  dir="$(dirname -- "$file")"
  base="$(basename -- "$file")"

  sums="$(find "$dir" -maxdepth 1 -name 'SHA256SUMS*' -type f -print -quit 2>/dev/null || true)"
  if [ -z "$sums" ]; then
    warn "$(t "keine SHA256SUMS-Datei neben dem Paket — Prüfsumme nicht vergleichbar" "no SHA256SUMS file next to the package — checksum cannot be compared")"
    return 0
  fi

  line="$(grep -F " ${base}" "$sums" 2>/dev/null || true)"
  if [ -z "$line" ]; then
    warn "$(basename -- "$sums") $(t "nennt ${base} nicht — Prüfsumme nicht vergleichbar" "does not list ${base} — checksum cannot be compared")"
    return 0
  fi

  local expected actual
  expected="${line%% *}"
  actual="$(sha256sum "$file")"
  actual="${actual%% *}"
  if [ "$expected" = "$actual" ]; then
    ok "$(t "Prüfsumme stimmt" "checksum matches") (${actual:0:16}…)"
  else
    bad "$(t "Prüfsumme weicht ab — erwartet ${expected:0:16}…, gemessen ${actual:0:16}…" "checksum differs — expected ${expected:0:16}…, measured ${actual:0:16}…")"
    die "$(t 'Das Paket ist nicht das, als das es sich ausgibt. Nicht installiert.' 'The package is not what it claims to be. Not installed.')"
  fi
}

# --- Installieren ----------------------------------------------------------------------------

install_deb() {
  local file="$1"

  # apt liest lokale Dateien als Benutzer `_apt`. Steht das Home-Verzeichnis auf 750 (Vorgabe auf
  # Ubuntu 24.04), kommt `_apt` nicht bis zur Datei; apt lädt sie dann als root und meldet das als
  # Notiz. Harmlos, aber beunruhigend zu lesen — also legen wir das Paket vorher an eine Stelle,
  # die `_apt` lesen kann. Die Meldung entfällt damit, statt erklärt werden zu müssen.
  local tmp staged
  tmp="$(mktemp -d)"
  chmod 0755 "$tmp"
  install -m 0644 "$file" "$tmp/"
  staged="$tmp/$(basename -- "$file")"

  if command -v apt-get >/dev/null 2>&1; then
    info "$(t 'apt-get install (löst libcap2-bin gleich mit auf)' 'apt-get install (pulls in libcap2-bin as well)')"
    DEBIAN_FRONTEND=noninteractive apt-get install -y "$staged"
  else
    info "$(t 'dpkg -i (kein apt-get vorhanden — Abhängigkeiten müssen von Hand kommen)' 'dpkg -i (no apt-get — dependencies have to be installed by hand)')"
    dpkg -i "$staged" || die "$(t 'dpkg meldet fehlende Abhängigkeiten. Bitte nachinstallieren (libcap2-bin) und erneut versuchen.' 'dpkg reports missing dependencies. Install them (libcap2-bin) and try again.')"
  fi
  rm -rf "$tmp"
}

install_rpm() {
  local file="$1"
  # Die Pakete sind nicht signiert — das wird hier ausgesprochen, nicht umgangen.
  if command -v dnf >/dev/null 2>&1; then
    info "$(t 'dnf install --nogpgcheck (das Paket ist unsigniert)' 'dnf install --nogpgcheck (the package is unsigned)')"
    dnf install -y --nogpgcheck "$file"
  elif command -v zypper >/dev/null 2>&1; then
    info 'zypper install --allow-unsigned-rpm'
    zypper --non-interactive install --allow-unsigned-rpm "$file"
  else
    info "$(t 'rpm -Uvh (kein dnf/zypper — Abhängigkeiten müssen von Hand kommen)' 'rpm -Uvh (no dnf/zypper — dependencies have to be installed by hand)')"
    rpm -Uvh "$file"
  fi
}

install_pacman() {
  local file="$1"
  info 'pacman -U'
  pacman -U --noconfirm "$file"
}

# --- Messen ----------------------------------------------------------------------------------

# Kann der aufrufende Benutzer einen unprivilegierten User-Namespace anlegen?
#
# Gefragt wird ausdrücklich für den NUTZER, nicht für root: als root gelingt das immer, und die
# Antwort wäre ein Ersatzsignal für die Frage, die zählt. Ist die Antwort "nein", muss
# chrome-sandbox setuid sein, sonst bricht Chromium beim Start ab.
userns_available_for_user() {
  command -v unshare >/dev/null 2>&1 || return 2   # 2 = nicht messbar

  # Läuft das Skript ohnehin unprivilegiert (`--check`), ist der direkte Versuch die beste
  # Messung überhaupt: derselbe Benutzer, dieselben Grenzen wie später beim Start der App.
  if [ "$(id -u)" -ne 0 ]; then
    unshare --user true >/dev/null 2>&1 && return 0 || return 1
  fi

  local target="${SUDO_USER:-}"
  if [ -z "$target" ] || [ "$target" = 'root' ]; then
    return 2   # als root ohne bekannten Aufrufer: die Frage lässt sich nicht für ihn beantworten
  fi
  if command -v runuser >/dev/null 2>&1; then
    runuser -u "$target" -- unshare --user true >/dev/null 2>&1 && return 0 || return 1
  fi
  su -s /bin/sh -c 'unshare --user true' "$target" >/dev/null 2>&1 && return 0 || return 1
}

check_installation() {
  local repair="$1"   # 'repair' oder 'readonly'

  step "$(t 'Ist das Paket registriert?' 'Is the package registered?')"
  local registered=''
  if command -v dpkg-query >/dev/null 2>&1; then
    registered="$(dpkg-query -W -f='${Version} ${Status}' "$EXECUTABLE" 2>/dev/null || true)"
  fi
  if [ -z "$registered" ] && command -v rpm >/dev/null 2>&1; then
    registered="$(rpm -q --qf '%{VERSION}-%{RELEASE}' "$EXECUTABLE" 2>/dev/null || true)"
    case "$registered" in *'not installed'*) registered='' ;; esac
  fi
  if [ -z "$registered" ] && command -v pacman >/dev/null 2>&1; then
    registered="$(pacman -Q "$EXECUTABLE" 2>/dev/null || true)"
  fi
  if [ -n "$registered" ]; then
    ok "$(t "Paketverwaltung meldet" "package manager reports"): $registered"
  else
    bad "$(t "keine Paketverwaltung kennt $EXECUTABLE" "no package manager knows $EXECUTABLE")"
  fi

  step "$(t 'Liegt die Anwendung da, wo sie hingehört?' 'Is the application where it belongs?')"
  if [ -x "$PRODUCT_DIR/$EXECUTABLE" ]; then
    ok "$PRODUCT_DIR/$EXECUTABLE $(t "ist vorhanden und ausführbar" "is present and executable")"
  else
    bad "$PRODUCT_DIR/$EXECUTABLE $(t "fehlt oder ist nicht ausführbar" "is missing or not executable")"
  fi

  # Kein `[ -e … ] && var=…`: schlägt der Test fehl, ist der Rückgabewert der ganzen Zeile 1 —
  # und `set -e` beendet das Skript genau in dem Fall, den es melden soll. Der Fehlerfall muss
  # der zuverlässigste Zweig sein, nicht der, der das Werkzeug umbringt.
  local resolved=''
  if [ -e "$BIN_LINK" ]; then
    resolved="$(readlink -f "$BIN_LINK" 2>/dev/null || true)"
  fi
  if [ "$resolved" = "$PRODUCT_DIR/$EXECUTABLE" ]; then
    ok "$BIN_LINK $(t "zeigt auf die Anwendung — Start über den bloßen Namen möglich" "points to the application — it starts by its plain name")"
  elif [ -n "$resolved" ]; then
    warn "$BIN_LINK $(t "zeigt auf $resolved statt auf $PRODUCT_DIR/$EXECUTABLE" "points to $resolved instead of $PRODUCT_DIR/$EXECUTABLE")"
  else
    warn "$BIN_LINK $(t "fehlt — die App startet dann nur über das Menü oder den vollen Pfad" "is missing — the app then starts only from the menu or by its full path")"
  fi

  step "$(t 'Kann die Anwendung ihren Sandkasten benutzen?' 'Can the application use its sandbox?')"
  local mode=''
  if [ -e "$SANDBOX" ]; then
    mode="$(stat -c '%a' "$SANDBOX" 2>/dev/null || true)"
  fi
  if [ -z "$mode" ]; then
    bad "$SANDBOX $(t "fehlt — ohne diese Datei startet Chromium nicht" "is missing — Chromium does not start without it")"
  else
    info "$(t "chrome-sandbox hat Modus $mode" "chrome-sandbox has mode $mode")"
    local userns_state
    if userns_available_for_user; then
      userns_state=yes
    else
      case $? in
        1) userns_state=no ;;
        *) userns_state=unknown ;;
      esac
    fi
    info "$(t "unprivilegierte User-Namespaces für den aufrufenden Benutzer" "unprivileged user namespaces for the calling user"): $(case "$userns_state" in yes) t ja yes ;; no) t nein no ;; *) t unbekannt unknown ;; esac)"

    case "$userns_state" in
      yes)
        ok "$(t 'Namespace-Sandkasten steht zur Verfügung — Modus 0755 ist hier richtig' 'namespace sandbox available — mode 0755 is right here')"
        ;;
      no)
        if [ "$mode" = '4755' ]; then
          ok "$(t 'kein Namespace-Sandkasten, aber chrome-sandbox ist setuid — der Rückfallweg trägt' 'no namespace sandbox, but chrome-sandbox is setuid — the fallback holds')"
        elif [ "$repair" = 'repair' ]; then
          # Kein `chmod … && chown …` als eine Zeile: scheitert das erste, beendet `set -e` das
          # Skript mitten in der Reparatur. Und geurteilt wird über das NACHGEMESSENE Ergebnis,
          # nicht über den Rückgabewert von chmod — dieselbe Regel, nach der das
          # Post-Install-Skript sein setcap mit getcap gegenliest.
          local before="$mode"
          # Erst chown, DANN chmod. Gemessen 2026-07-31: ein `chown` nach dem `chmod 4755`
          # löscht das setuid-Bit wieder — beide Befehle melden dabei Erfolg, und das Ergebnis
          # ist eine Datei mit 0755, an der die App weiterhin abbricht. Die Reihenfolge ist der
          # ganze Unterschied.
          chown root:root "$SANDBOX" 2>/dev/null || true
          chmod 4755 "$SANDBOX" 2>/dev/null || true
          mode="$(stat -c '%a' "$SANDBOX" 2>/dev/null || echo '?')"
          if [ "$mode" = '4755' ]; then
            ok "$(t "chrome-sandbox von $before auf 4755 gesetzt — sonst wäre jeder Start abgebrochen" "chrome-sandbox changed from $before to 4755 — otherwise every start would have aborted")"
          else
            bad "$(t "chrome-sandbox ließ sich nicht auf 4755 setzen (steht auf $mode)" "chrome-sandbox could not be set to 4755 (it is $mode)")"
            info "$(t "Abhilfe von Hand" "fix by hand"): sudo chmod 4755 '$SANDBOX'"
          fi
        else
          bad "$(t 'kein Namespace-Sandkasten UND chrome-sandbox nicht setuid — die App bricht beim Start ab' 'no namespace sandbox AND chrome-sandbox not setuid — the app aborts on start')"
          info "$(t 'Chromium meldet dann:' 'Chromium then reports:') \"The SUID sandbox helper binary was found, but is not configured correctly.\""
          info "$(t "Abhilfe" "Fix"): sudo chmod 4755 '$SANDBOX'"
        fi
        ;;
      *)
        warn "$(t 'nicht messbar (kein unshare, oder das Skript läuft nicht über sudo eines Benutzers)' 'cannot be measured (no unshare, or the script is not run via sudo by a user)')"
        info "$(t "Modus $mode kann daher weder bestätigt noch beanstandet werden" "so mode $mode can be neither confirmed nor faulted")"
        ;;
    esac
  fi

  step "$(t 'Darf das mitgelieferte ZeroTier ein Netzwerkgerät anlegen?' 'May the bundled ZeroTier create a network device?')"
  local zt_bin caps
  zt_bin="$ZEROTIER/$(uname -m | sed -e 's/^x86_64$/x64/' -e 's/^aarch64$/arm64/')/zerotier-one"
  if [ ! -f "$zt_bin" ]; then
    # shellcheck disable=SC1111  # „…“ are the German typographic quotes, meant literally
    warn "$(t "kein mitgeliefertes zerotier-one unter $zt_bin — der Weg „Remote ID“ entfällt" "no bundled zerotier-one at $zt_bin — the Remote ID path is not available")"
  elif ! command -v getcap >/dev/null 2>&1; then
    warn "$(t 'getcap nicht vorhanden (libcap) — die Rechte sind nicht prüfbar' 'getcap not present (libcap) — the permissions cannot be checked')"
  else
    caps="$(getcap "$zt_bin" 2>/dev/null || true)"
    case "$caps" in
      # `##* ` und nicht `#* `: der Produktname enthält ein Leerzeichen („ZimaOS Client"), am
      # ersten zu schneiden liefert einen Pfadrest statt der Capability-Liste.
      *cap_net_admin*) ok "$(t "CAP_NET_ADMIN erteilt" "CAP_NET_ADMIN granted") (${caps##* })" ;;
      '') warn "$(t 'keine Capabilities gesetzt — „Remote ID“ wird nicht funktionieren' 'no capabilities set — Remote ID will not work')" ;;
      *) warn "$(t "Capabilities gesetzt, aber ohne cap_net_admin" "capabilities set, but without cap_net_admin"): $caps" ;;
    esac
  fi

  # AppArmor: nur eine Feststellung, kein Urteil. Auf Systemen ohne AppArmor gehört hier nichts hin.
  if command -v apparmor_status >/dev/null 2>&1 && apparmor_status --enabled >/dev/null 2>&1; then
    step 'AppArmor'
    if [ -f "${ROOT}/etc/apparmor.d/${EXECUTABLE}" ]; then
      ok "/etc/apparmor.d/${EXECUTABLE} $(t "ist installiert" "is installed")"
    else
      warn "/etc/apparmor.d/${EXECUTABLE} $(t "fehlt — auf Ubuntu 24+ kann das den Sandkasten kosten" "is missing — on Ubuntu 24+ this can cost the sandbox")"
    fi
  fi
}

uninstall() {
  step "$(t 'Entfernen' 'Removing')"
  if command -v apt-get >/dev/null 2>&1 && dpkg-query -W "$EXECUTABLE" >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get remove -y "$EXECUTABLE"
  elif command -v dnf >/dev/null 2>&1 && rpm -q "$EXECUTABLE" >/dev/null 2>&1; then
    dnf remove -y "$EXECUTABLE"
  elif command -v zypper >/dev/null 2>&1 && rpm -q "$EXECUTABLE" >/dev/null 2>&1; then
    zypper --non-interactive remove "$EXECUTABLE"
  elif command -v pacman >/dev/null 2>&1 && pacman -Q "$EXECUTABLE" >/dev/null 2>&1; then
    pacman -R --noconfirm "$EXECUTABLE"
  else
    die "$(t "$EXECUTABLE ist über keine erkannte Paketverwaltung installiert" "$EXECUTABLE is not installed through any recognised package manager")"
  fi
  ok "$EXECUTABLE $(t entfernt removed)"
  info "$(t 'Deine Einstellungen unter ~/.config/zima-linux-client/ sind absichtlich liegen geblieben.' 'Your settings in ~/.config/zima-linux-client/ were left in place on purpose.')"
}

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    if command -v sudo >/dev/null 2>&1; then
      printf '%s\n\n' "$(t 'Dafür werden Root-Rechte gebraucht — starte neu über sudo.' 'This needs root — restarting through sudo.')"
      exec sudo -- "$0" "$@"
    fi
    die "$(t 'Bitte als root ausführen (oder sudo installieren).' 'Please run as root (or install sudo).')"
  fi
}

# --- Ablauf ----------------------------------------------------------------------------------

# Das Urteil steht an einer einzigen Stelle, damit kein Zweig sich am Ende grüner ausgeben kann
# als seine eigenen Messungen — eine Zusammenfassung darf nie mehr behaupten als ihre Details.
finish() {
  printf '\n'
  if [ "$failures" -gt 0 ]; then
    printf "\033[31m%s $(t Fehler 'error(s)')\033[0m, %s $(t 'Hinweis(e). Die Anwendung wird so nicht laufen.' 'warning(s). The application will not run like this.')\n" "$failures" "$warnings"
    printf '%s\n' "$(t 'Bitte diese Ausgabe vollständig melden.' 'Please report this output in full.')"
    exit 1
  fi
  if [ "$warnings" -gt 0 ]; then
    printf "\033[33m$(t 'Mit %s Hinweis(en) durchgelaufen.' 'Finished with %s warning(s).')\033[0m Start: %s\n" "$warnings" "$EXECUTABLE"
    printf '%s\n' "$(t 'Die Hinweise oben bitte in einer Meldung mitschicken — sie schränken Funktionen ein.' 'Please include the warnings above in a report — they limit features.')"
    exit 0
  fi
  printf "\033[32m$(t 'Alles gemessen und in Ordnung.' 'Everything measured and in order.')\033[0m Start: %s $(t '(oder über das Anwendungsmenü)' '(or from the application menu)')\n" "$EXECUTABLE"
  exit 0
}

main() {
  local mode=install package=''

  case "${1:-}" in
    --help | -h) usage; exit 0 ;;
    --check) mode=check ;;
    --repair) mode=repair ;;
    --uninstall) mode=uninstall ;;
    '') : ;;
    -*) die "$(t "unbekannte Option: $1 (siehe --help)" "unknown option: $1 (see --help)")" ;;
    *) package="$1" ;;
  esac

  printf '\033[1m%s\033[0m\n' "$(t 'ZimaOS Client — Installation' 'ZimaOS Client — installation')"
  info "System: $(pretty_name)"

  if [ "$mode" = check ]; then
    check_installation readonly
  else
    require_root "$@"

    if [ "$mode" = uninstall ]; then
      uninstall
      exit 0
    fi

    if [ "$mode" = repair ]; then
      check_installation repair
      finish
    fi

    local family
    family="$(detect_family)"
    if [ "$family" = unknown ]; then
      die "$(t 'Weder apt/dpkg noch dnf/zypper/rpm noch pacman gefunden — diese Distribution kann das Skript nicht bedienen.' 'Neither apt/dpkg nor dnf/zypper/rpm nor pacman found — this script cannot serve this distribution.')"
    fi
    info "$(t Paketverwaltung "Package manager"): $family"

    if [ -z "$package" ]; then
      package="$(find_package "$family" || true)"
      [ -n "$package" ] ||
        die "$(t "kein passendes Paket gefunden. Lege die Datei neben dieses Skript oder gib sie an: sudo $0 <paketdatei>" "no matching package found. Put the file next to this script or name it: sudo $0 <package-file>")"
    fi
    [ -f "$package" ] || die "$(t "Datei nicht gefunden" "file not found"): $package"

    step "$(t Paket Package)"
    info "$package"
    verify_checksum "$package"

    step "$(t Installieren Installing)"
    case "$package" in
      *.deb) install_deb "$package" ;;
      *.rpm) install_rpm "$package" ;;
      *.pacman) install_pacman "$package" ;;
      *) die "$(t "unbekannte Dateiendung" "unknown file extension"): $package" ;;
    esac
    ok "$(t 'Paketverwaltung meldet Erfolg — was das wert ist, sagen die Messungen darunter' 'package manager reports success — what that is worth, the measurements below say')"

    check_installation repair
  fi

  finish
}

main "$@"
