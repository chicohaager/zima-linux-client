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

# --- Ausgabe ---------------------------------------------------------------------------------

failures=0
warnings=0

ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*" >&2; warnings=$((warnings + 1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; failures=$((failures + 1)); }
info() { printf '    %s\n' "$*"; }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die()  { printf '\n\033[31mAbbruch:\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
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
    echo "${PRETTY_NAME:-${ID:-unbekannt}}"
  else
    echo 'unbekannt (keine /etc/os-release)'
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
    warn "keine SHA256SUMS-Datei neben dem Paket — Prüfsumme nicht vergleichbar"
    return 0
  fi

  line="$(grep -F " ${base}" "$sums" 2>/dev/null || true)"
  if [ -z "$line" ]; then
    warn "$(basename -- "$sums") nennt ${base} nicht — Prüfsumme nicht vergleichbar"
    return 0
  fi

  local expected actual
  expected="${line%% *}"
  actual="$(sha256sum "$file")"
  actual="${actual%% *}"
  if [ "$expected" = "$actual" ]; then
    ok "Prüfsumme stimmt (${actual:0:16}…)"
  else
    bad "Prüfsumme weicht ab — erwartet ${expected:0:16}…, gemessen ${actual:0:16}…"
    die 'Das Paket ist nicht das, als das es sich ausgibt. Nicht installiert.'
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
    info 'apt-get install (löst libcap2-bin gleich mit auf)'
    DEBIAN_FRONTEND=noninteractive apt-get install -y "$staged"
  else
    info 'dpkg -i (kein apt-get vorhanden — Abhängigkeiten müssen von Hand kommen)'
    dpkg -i "$staged" || die 'dpkg meldet fehlende Abhängigkeiten. Bitte nachinstallieren (libcap2-bin) und erneut versuchen.'
  fi
  rm -rf "$tmp"
}

install_rpm() {
  local file="$1"
  # Die Pakete sind nicht signiert — das wird hier ausgesprochen, nicht umgangen.
  if command -v dnf >/dev/null 2>&1; then
    info 'dnf install --nogpgcheck (das Paket ist unsigniert)'
    dnf install -y --nogpgcheck "$file"
  elif command -v zypper >/dev/null 2>&1; then
    info 'zypper install --allow-unsigned-rpm'
    zypper --non-interactive install --allow-unsigned-rpm "$file"
  else
    info 'rpm -Uvh (kein dnf/zypper — Abhängigkeiten müssen von Hand kommen)'
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

  step 'Ist das Paket registriert?'
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
    ok "Paketverwaltung meldet: $registered"
  else
    bad "keine Paketverwaltung kennt $EXECUTABLE"
  fi

  step 'Liegt die Anwendung da, wo sie hingehört?'
  if [ -x "$PRODUCT_DIR/$EXECUTABLE" ]; then
    ok "$PRODUCT_DIR/$EXECUTABLE ist vorhanden und ausführbar"
  else
    bad "$PRODUCT_DIR/$EXECUTABLE fehlt oder ist nicht ausführbar"
  fi

  # Kein `[ -e … ] && var=…`: schlägt der Test fehl, ist der Rückgabewert der ganzen Zeile 1 —
  # und `set -e` beendet das Skript genau in dem Fall, den es melden soll. Der Fehlerfall muss
  # der zuverlässigste Zweig sein, nicht der, der das Werkzeug umbringt.
  local resolved=''
  if [ -e "$BIN_LINK" ]; then
    resolved="$(readlink -f "$BIN_LINK" 2>/dev/null || true)"
  fi
  if [ "$resolved" = "$PRODUCT_DIR/$EXECUTABLE" ]; then
    ok "$BIN_LINK zeigt auf die Anwendung — Start über den bloßen Namen möglich"
  elif [ -n "$resolved" ]; then
    warn "$BIN_LINK zeigt auf $resolved statt auf $PRODUCT_DIR/$EXECUTABLE"
  else
    warn "$BIN_LINK fehlt — die App startet dann nur über das Menü oder den vollen Pfad"
  fi

  step 'Kann die Anwendung ihren Sandkasten benutzen?'
  local mode=''
  if [ -e "$SANDBOX" ]; then
    mode="$(stat -c '%a' "$SANDBOX" 2>/dev/null || true)"
  fi
  if [ -z "$mode" ]; then
    bad "$SANDBOX fehlt — ohne diese Datei startet Chromium nicht"
  else
    info "chrome-sandbox hat Modus $mode"
    local userns_state
    if userns_available_for_user; then
      userns_state=ja
    else
      case $? in
        1) userns_state=nein ;;
        *) userns_state=unbekannt ;;
      esac
    fi
    info "unprivilegierte User-Namespaces für den aufrufenden Benutzer: $userns_state"

    case "$userns_state" in
      ja)
        ok 'Namespace-Sandkasten steht zur Verfügung — Modus 0755 ist hier richtig'
        ;;
      nein)
        if [ "$mode" = '4755' ]; then
          ok 'kein Namespace-Sandkasten, aber chrome-sandbox ist setuid — der Rückfallweg trägt'
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
            ok "chrome-sandbox von $before auf 4755 gesetzt — sonst wäre jeder Start abgebrochen"
          else
            bad "chrome-sandbox ließ sich nicht auf 4755 setzen (steht auf $mode)"
            info "Abhilfe von Hand: sudo chmod 4755 '$SANDBOX'"
          fi
        else
          bad 'kein Namespace-Sandkasten UND chrome-sandbox nicht setuid — die App bricht beim Start ab'
          info 'Chromium meldet dann: "The SUID sandbox helper binary was found, but is not configured correctly."'
          info "Abhilfe: sudo chmod 4755 '$SANDBOX'"
        fi
        ;;
      *)
        warn 'nicht messbar (kein unshare, oder das Skript läuft nicht über sudo eines Benutzers)'
        info "Modus $mode kann daher weder bestätigt noch beanstandet werden"
        ;;
    esac
  fi

  step 'Darf das mitgelieferte ZeroTier ein Netzwerkgerät anlegen?'
  local zt_bin caps
  zt_bin="$ZEROTIER/$(uname -m | sed -e 's/^x86_64$/x64/' -e 's/^aarch64$/arm64/')/zerotier-one"
  if [ ! -f "$zt_bin" ]; then
    warn "kein mitgeliefertes zerotier-one unter $zt_bin — der Weg „Remote ID\" entfällt"
  elif ! command -v getcap >/dev/null 2>&1; then
    warn 'getcap nicht vorhanden (libcap) — die Rechte sind nicht prüfbar'
  else
    caps="$(getcap "$zt_bin" 2>/dev/null || true)"
    case "$caps" in
      # `##* ` und nicht `#* `: der Produktname enthält ein Leerzeichen („ZimaOS Client"), am
      # ersten zu schneiden liefert einen Pfadrest statt der Capability-Liste.
      *cap_net_admin*) ok "CAP_NET_ADMIN erteilt (${caps##* })" ;;
      '') warn 'keine Capabilities gesetzt — „Remote ID" wird nicht funktionieren' ;;
      *) warn "Capabilities gesetzt, aber ohne cap_net_admin: $caps" ;;
    esac
  fi

  # AppArmor: nur eine Feststellung, kein Urteil. Auf Systemen ohne AppArmor gehört hier nichts hin.
  if command -v apparmor_status >/dev/null 2>&1 && apparmor_status --enabled >/dev/null 2>&1; then
    step 'AppArmor'
    if [ -f "${ROOT}/etc/apparmor.d/${EXECUTABLE}" ]; then
      ok "/etc/apparmor.d/${EXECUTABLE} ist installiert"
    else
      warn "/etc/apparmor.d/${EXECUTABLE} fehlt — auf Ubuntu 24+ kann das den Sandkasten kosten"
    fi
  fi
}

uninstall() {
  step 'Entfernen'
  if command -v apt-get >/dev/null 2>&1 && dpkg-query -W "$EXECUTABLE" >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get remove -y "$EXECUTABLE"
  elif command -v dnf >/dev/null 2>&1 && rpm -q "$EXECUTABLE" >/dev/null 2>&1; then
    dnf remove -y "$EXECUTABLE"
  elif command -v zypper >/dev/null 2>&1 && rpm -q "$EXECUTABLE" >/dev/null 2>&1; then
    zypper --non-interactive remove "$EXECUTABLE"
  elif command -v pacman >/dev/null 2>&1 && pacman -Q "$EXECUTABLE" >/dev/null 2>&1; then
    pacman -R --noconfirm "$EXECUTABLE"
  else
    die "$EXECUTABLE ist über keine erkannte Paketverwaltung installiert"
  fi
  ok "$EXECUTABLE entfernt"
  info 'Deine Einstellungen unter ~/.config/zima-linux-client/ sind absichtlich liegen geblieben.'
}

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    if command -v sudo >/dev/null 2>&1; then
      printf 'Dafür werden Root-Rechte gebraucht — starte neu über sudo.\n\n'
      exec sudo -- "$0" "$@"
    fi
    die 'Bitte als root ausführen (oder sudo installieren).'
  fi
}

# --- Ablauf ----------------------------------------------------------------------------------

# Das Urteil steht an einer einzigen Stelle, damit kein Zweig sich am Ende grüner ausgeben kann
# als seine eigenen Messungen — eine Zusammenfassung darf nie mehr behaupten als ihre Details.
finish() {
  printf '\n'
  if [ "$failures" -gt 0 ]; then
    printf '\033[31m%s Fehler\033[0m, %s Hinweis(e). Die Anwendung wird so nicht laufen.\n' "$failures" "$warnings"
    printf 'Bitte diese Ausgabe vollständig melden.\n'
    exit 1
  fi
  if [ "$warnings" -gt 0 ]; then
    printf '\033[33mMit %s Hinweis(en) durchgelaufen.\033[0m Start: %s\n' "$warnings" "$EXECUTABLE"
    printf 'Die Hinweise oben bitte in einer Meldung mitschicken — sie schränken Funktionen ein.\n'
    exit 0
  fi
  printf '\033[32mAlles gemessen und in Ordnung.\033[0m Start: %s (oder über das Anwendungsmenü)\n' "$EXECUTABLE"
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
    -*) die "unbekannte Option: $1 (siehe --help)" ;;
    *) package="$1" ;;
  esac

  printf '\033[1mZimaOS Client — Installation\033[0m\n'
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
      die 'Weder apt/dpkg noch dnf/zypper/rpm noch pacman gefunden — diese Distribution kann das Skript nicht bedienen.'
    fi
    info "Paketverwaltung: $family"

    if [ -z "$package" ]; then
      package="$(find_package "$family" || true)"
      [ -n "$package" ] ||
        die "kein passendes Paket gefunden. Lege die Datei neben dieses Skript oder gib sie an: sudo $0 <paketdatei>"
    fi
    [ -f "$package" ] || die "Datei nicht gefunden: $package"

    step 'Paket'
    info "$package"
    verify_checksum "$package"

    step 'Installieren'
    case "$package" in
      *.deb) install_deb "$package" ;;
      *.rpm) install_rpm "$package" ;;
      *.pacman) install_pacman "$package" ;;
      *) die "unbekannte Dateiendung: $package" ;;
    esac
    ok 'Paketverwaltung meldet Erfolg — was das wert ist, sagen die Messungen darunter'

    check_installation repair
  fi

  finish
}

main "$@"
