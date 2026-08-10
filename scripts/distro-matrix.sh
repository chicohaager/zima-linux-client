#!/usr/bin/env bash
#
# Starts the SHIPPED package on each target distribution and reports whether a window
# actually came up.
#
# Why this exists in this form: the X11 fallback of this client was proved for weeks against
# `dist/linux-unpacked/`, and the packaged build did not start at all — `app.relaunch()`
# cannot cope with the space in `/opt/ZimaOS Client/`. Same bytes, different location, no
# window and no message. So the matrix installs the real artefact, into the real path, and
# runs it as an ordinary user, because:
#
#   - the post-install script is what makes `chrome-sandbox` setuid, and without it Chromium
#     aborts on any host whose kernel denies unprivileged user namespaces;
#   - as root, Chromium refuses to start without --no-sandbox, so running as root would
#     measure a different program than the one users run;
#   - the installation path contains a space, and that has already broken this app once.
#
# Each row ends in a JSON report from the app's own startup proof, which asks the RUNNING
# engine how many CSS rules applied and whether any raw i18n key is on screen. "The process
# did not exit non-zero" would not be evidence of a window.
#
# Usage: scripts/distro-matrix.sh [name ...]      (default: every row)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${ZIMA_MATRIX_OUT:-${ROOT}/dist/matrix}"
mkdir -p "${OUT}"

# image | package kind | install command run as root inside the container
ROWS=(
  "ubuntu2204|deb|ubuntu:22.04|apt-get update -qq && apt-get install -y -qq /pkg/*.deb xvfb"
  "ubuntu2404|deb|ubuntu:24.04|apt-get update -qq && apt-get install -y -qq /pkg/*.deb xvfb"
  "debian12|deb|debian:12|apt-get update -qq && apt-get install -y -qq /pkg/*.deb xvfb"
  "fedora41|rpm|fedora:41|dnf install -y -q /pkg/*.rpm xorg-x11-server-Xvfb"
  "archlinux|pacman|archlinux:latest|pacman -Sy --noconfirm --needed xorg-server-xvfb >/dev/null && pacman -U --noconfirm /pkg/*.pacman"
  # 🔴 `adwaita-fonts` is in this row and not in the others because this image has NO font at
  # all, and its xvfb package pulls none. Measured 2026-08-10 after the exact install command
  # above: openSUSE 0 font files, Fedora 17 (whose `xorg-x11-server-Xvfb` drags them in).
  #
  # The consequence was a report that lied by omission: the window came up, the stylesheet
  # applied, eight buttons rendered — and `visibleText` was empty, because there was nothing
  # to draw glyphs with. The screenshot shows it plainly: layout, colours and icons all
  # there, every label blank. A row that ships no font measures its own container, not the
  # application. See CLAUDE.md, "ein NEGATIVER Befund an einem Ort, wo die Sache gar nicht
  # geladen ist, ist kein Befund".
  "opensuse|rpm|opensuse/tumbleweed|zypper --non-interactive --no-gpg-checks install --allow-unsigned-rpm /pkg/*.rpm xvfb-run adwaita-fonts"
)

# The binary is installed under a name with a space in it; the launcher on PATH is not.
LAUNCHER="/usr/bin/zima-linux-client"

run_row() {
  local name="$1" kind="$2" image="$3" install="$4"
  local pkgdir report
  pkgdir="$(mktemp -d)"
  report="${OUT}/${name}.json"

  case "${kind}" in
    deb) cp "${ROOT}"/dist/*.deb "${pkgdir}/" ;;
    rpm) cp "${ROOT}"/dist/*.rpm "${pkgdir}/" ;;
    pacman) cp "${ROOT}"/dist/*.pacman "${pkgdir}/" ;;
  esac

  echo "=== ${name} (${image}, ${kind}) ==="

  # `|| true` on the docker run itself: a non-zero exit is a RESULT to be reported next to
  # the report file, not a reason to abandon the remaining rows.
  #
  # `seccomp=unconfined`, and NOT `--no-sandbox`: this matrix exists to prove the shipped
  # post-install script, and the most consequential thing that script does is
  # `chmod 4755 chrome-sandbox`. Starting the app with `--no-sandbox` would bypass exactly
  # the mechanism under test — the row would go green with a broken sandbox binary. Docker's
  # default seccomp profile denies the namespace calls Chromium's sandbox needs, so the
  # restriction has to be lifted here or the measurement would fail for a reason that has
  # nothing to do with the package. If the sandboxed start fails anyway, the row falls back
  # to `--no-sandbox` and reports BOTH results, so "the app cannot start" stays separable
  # from "the sandbox cannot work inside this container".
  # `--platform linux/amd64`, explicitly: these are the x86_64 packages, and the row must
  # measure them on x86_64.
  #
  # Measured 2026-08-09: an arm64 experiment earlier the same day pulled `ubuntu:24.04` for
  # linux/arm64, which overwrote the LOCAL tag. The next matrix run — no `--platform`, so
  # whatever the tag now points at — installed the amd64 .deb into an arm64 container and
  # reported `E: Unable to correct problems, you have held broken packages`. That reads as a
  # broken package and was a broken measurement: the row had silently changed architecture
  # underneath itself. Pinning it here means the tag's state can no longer decide what this
  # script measures.
  docker run --rm \
    --platform linux/amd64 \
    --security-opt seccomp=unconfined \
    -v "${pkgdir}:/pkg:ro" \
    -v "${OUT}:/out" \
    "${image}" \
    /bin/sh -c "
      set -e
      ${install} >/dev/null 2>&1 || { echo 'INSTALL FAILED'; ${install}; exit 90; }

      # An ordinary user, because that is who runs this program — and because Chromium
      # refuses its sandbox as root, which would silently turn this into a different test.
      (id -u zima >/dev/null 2>&1 || useradd -m zima) 2>/dev/null || adduser -D zima
      mkdir -p /out /home/zima/.config && chown -R zima /home/zima /out

      echo '--- installed layout ---'
      ls -la '/opt/ZimaOS Client/' 2>/dev/null | head -5 || echo 'NO /opt/ZimaOS Client'
      ls -l ${LAUNCHER} 2>/dev/null || echo 'NO launcher on PATH'

      # The post-install script's own claim, read back from the installed file: setuid bit
      # set and owned by root. \`ls\` shows it, but a mode read as a number is what a later
      # regression can be compared against.
      if [ -e '/opt/ZimaOS Client/chrome-sandbox' ]; then
        echo \"chrome-sandbox mode=\$(stat -c %a '/opt/ZimaOS Client/chrome-sandbox') owner=\$(stat -c %U '/opt/ZimaOS Client/chrome-sandbox')\"
      else
        echo 'NO chrome-sandbox'
      fi

      echo '--- start (sandbox ON — the path users get) ---'
      su zima -c \"ZIMA_VERIFY_STARTUP=/out/${name}.json xvfb-run -a ${LAUNCHER}\" \
        || echo \"app exited \$?\"

      # Only if the real path produced nothing: a second run that removes the sandbox from
      # the equation. Two empty reports mean the package is broken; one empty and one full
      # means the sandbox is what failed, and that difference is the whole point.
      if [ ! -s /out/${name}.json ]; then
        echo '--- start (sandbox OFF — control run, tells the two failures apart) ---'
        su zima -c \"ZIMA_VERIFY_STARTUP=/out/${name}-nosandbox.json xvfb-run -a ${LAUNCHER} --no-sandbox\" \
          || echo \"app exited \$?\"
      fi
    " 2>&1 | sed 's/^/  /' || true

  rm -rf "${pkgdir}"

  if [ -f "${report}" ]; then
    node -e "
      const r = require('${report}')
      const failures = r.failures ?? []
      console.log('  -> sandbox ON:  ok=' + r.ok + '  css=' + r.cssRuleCount + '  nav=' + r.navButtons + '  failures=' + JSON.stringify(failures))
    "
  else
    echo "  -> sandbox ON:  NO REPORT — the app produced no startup proof on ${name}"
  fi

  if [ -f "${OUT}/${name}-nosandbox.json" ]; then
    node -e "
      const r = require('${OUT}/${name}-nosandbox.json')
      console.log('  -> sandbox OFF: ok=' + r.ok + '  css=' + r.cssRuleCount + '  nav=' + r.navButtons + '  <- so the SANDBOX failed, not the package')
    "
  fi
  echo
}

wanted=("$@")
for row in "${ROWS[@]}"; do
  IFS='|' read -r name kind image install <<<"${row}"
  if [ ${#wanted[@]} -gt 0 ]; then
    case " ${wanted[*]} " in *" ${name} "*) ;; *) continue ;; esac
  fi
  run_row "${name}" "${kind}" "${image}" "${install}"
done

echo "reports in ${OUT}"
