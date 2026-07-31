#!/bin/sh
# Grants the bundled zerotier-one the one capability it needs to create a TUN device.
#
# This runs from the .deb/.rpm post-install script, which is already root. That is the whole
# point: the privilege exists here anyway, so the application never has to ask for it — no
# password dialog out of a desktop app, and nothing for the user to paste into a terminal.
#
# Measured 2026-07-30 on this project: without CAP_NET_ADMIN, zerotier-one prints
# "unable to configure TUN/TAP device for TAP operation" and then ACCEPTS a network join it
# can never carry out — the join looks successful and the member list stays empty.
#
# Failure is reported, never swallowed. A missing `setcap` (libcap not installed) or a
# filesystem mounted `nosuid`/without xattr support means the Remote-ID route will not work,
# and the install log is the only place that can say so before the user hits it.
set -eu

# The install directory is the install prefix (/opt) plus sanitizedProductName — read off
# app-builder-lib 26.15.3 (`targets/FpmTarget.js:215`, `targets/LinuxTargetHelper.js:76`),
# and confirmed in the built package: `/opt/ZimaOS Client/`.
#
# The macro productFilename stood here and produced the same string only by accident: it
# falls back to sanitizedProductName while `linux.executableName` is unset (`appInfo.js:57`).
# Setting that option one day would have moved this path and left the capability ungranted
# on every future install — with the package still reporting success.
#
# Note for editors: every ${...} in this file is substituted by electron-builder before the
# package is built, and an unknown name aborts the build ("Macro X is not defined") — that
# includes ones written inside comments. Only the names in FpmTarget's bashTemplateOptions
# exist here; shell variables of this script must be written without braces.
BIN="/opt/${sanitizedProductName}/resources/zerotier/$(uname -m | sed -e 's/^x86_64$/x64/' -e 's/^aarch64$/arm64/')/zerotier-one"

if [ ! -f "$BIN" ]; then
  echo "zima-linux-client: no bundled zerotier-one at $BIN — the Remote ID route will not work" >&2
  exit 0
fi

if ! command -v setcap >/dev/null 2>&1; then
  echo "zima-linux-client: setcap not found (install libcap2-bin / libcap) — $BIN has no CAP_NET_ADMIN," >&2
  echo "                   so ZeroTier cannot create a network device and the Remote ID route will not work" >&2
  exit 0
fi

if setcap cap_net_admin,cap_net_raw,cap_net_bind_service+eip "$BIN"; then
  # Read back rather than trusting the exit code: on a nosuid or xattr-less filesystem
  # setcap can return 0 and the capability still not be there.
  #
  # 🔴 Captured into a variable instead of `getcap … | grep -q`. `grep -q` exits at the first
  # match and kills the producer with SIGPIPE; under `set -o pipefail` that turns a SUCCESSFUL
  # read-back into a failed pipeline — the check would report "no capability" precisely when
  # the capability is there. This script has no pipefail today, which is exactly what makes it
  # a trap: adding one line at the top would silently invert the result. It is also a race, so
  # it would pass in testing and fail in the field.
  CAPS="$(getcap "$BIN" 2>/dev/null || true)"
  case "$CAPS" in
    *cap_net_admin*)
      echo "zima-linux-client: granted CAP_NET_ADMIN to $BIN"
      ;;
    *)
      echo "zima-linux-client: setcap reported success but $BIN still has no CAP_NET_ADMIN" >&2
      echo "                   (getcap said: ${CAPS:-nothing}) — a nosuid mount or a filesystem" >&2
      echo "                   without xattr support does this; the Remote ID route will not work" >&2
      ;;
  esac
else
  echo "zima-linux-client: could not grant CAP_NET_ADMIN to $BIN — the Remote ID route will not work" >&2
fi

exit 0
