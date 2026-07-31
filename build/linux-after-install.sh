#!/bin/bash
# Post-install script for .deb, .rpm and pacman packages.
#
# 🔴 This file REPLACES electron-builder's stock after-install template — it does not extend it.
# Read off app-builder-lib 26.15.3, `targets/FpmTarget.js:68`:
#
#     afterInstall: await writeConfigFile(…, getResource(this.options.afterInstall,
#                                                        "after-install.tpl"), …)
#
# getResource returns the custom file INSTEAD of the template. The first version of this script
# only granted the ZeroTier capability and thereby silently dropped everything the stock template
# does. Measured 2026-07-31 on the installed 2.0.0-alpha.1 package:
#
#     /usr/bin/zima-linux-client          missing  (no way to start the app by name)
#     /etc/apparmor.d/zima-linux-client   missing  (Ubuntu 24+ profile never installed)
#     chrome-sandbox                      0755     (never raised to 4755)
#
# Why the last line is not cosmetic: where the namespace sandbox is unavailable, Chromium falls
# back to the SUID helper and ABORTS rather than run unsandboxed. Reproduced the same day by
# starting the installed app with --disable-namespace-sandbox:
#
#     FATAL sandbox/linux/suid/client/setuid_sandbox_host.cc:166
#     "The SUID sandbox helper binary was found, but is not configured correctly. Rather than
#      run without sandboxing I'm aborting now. You need to make sure that
#      /opt/ZimaOS Client/chrome-sandbox is owned by root and has mode 4755."
#     → no window, no report, exit 133
#
# On this build machine unprivileged user namespaces work, so the fallback never ran and the loss
# stayed invisible. On a machine where they are switched off that is EVERY start.
#
# Therefore: the stock template first, kept verbatim, and our capability grant after it.
#
# Deliberately NO `set -e`: the stock template runs without it, and an `apparmor_parser` or
# `update-alternatives` hiccup must not abort a package installation. Every failure below is
# reported instead of swallowed, and the script ends with `exit 0`.
#
# Note for editors: every ${...} in this file is substituted by electron-builder before the
# package is built, and an unknown name aborts the build ("Macro X is not defined") — that
# includes ones written inside comments. Only the names in FpmTarget's bashTemplateOptions
# exist here; shell variables of this script must be written without braces.

# ---------------------------------------------------------------------------------------------
# Stock after-install.tpl (app-builder-lib 26.15.3), unchanged.
# ---------------------------------------------------------------------------------------------

if type update-alternatives >/dev/null 2>&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

# Check if user namespaces are supported by the kernel and working with a quick test:
if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
    # Use SUID chrome-sandbox only on systems without user namespaces:
    chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
else
    chmod 0755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

# Install apparmor profile. (Ubuntu 24+)
# First check if the version of AppArmor running on the device supports our profile.
# This is in order to keep backwards compatibility with Ubuntu 22.04 which does not support abi/4.0.
# In that case, we just skip installing the profile since the app runs fine without it on 22.04.
#
# Those apparmor_parser flags are akin to performing a dry run of loading a profile.
# https://wiki.debian.org/AppArmor/HowToUse#Dumping_profiles
#
# Unfortunately, at the moment AppArmor doesn't have a good story for backwards compatibility.
# https://askubuntu.com/questions/1517272/writing-a-backwards-compatible-apparmor-profile
if apparmor_status --enabled > /dev/null 2>&1; then
  APPARMOR_PROFILE_SOURCE='/opt/${sanitizedProductName}/resources/apparmor-profile'
  APPARMOR_PROFILE_TARGET='/etc/apparmor.d/${executable}'
  if apparmor_parser --skip-kernel-load --debug "$APPARMOR_PROFILE_SOURCE" > /dev/null 2>&1; then
    cp -f "$APPARMOR_PROFILE_SOURCE" "$APPARMOR_PROFILE_TARGET"

    # Updating the current AppArmor profile is not possible and probably not meaningful in a chroot'ed environment.
    # Use cases are for example environments where images for clients are maintained.
    # There, AppArmor might correctly be installed, but live updating makes no sense.
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      # Extra flags taken from dh_apparmor:
      # > By using '-W -T' we ensure that any abstraction updates are also pulled in.
      # https://wiki.debian.org/AppArmor/Contribute/FirstTimeProfileImport
      apparmor_parser --replace --write-cache --skip-read-cache "$APPARMOR_PROFILE_TARGET"
    fi
  else
    echo "Skipping the installation of the AppArmor profile as this version of AppArmor does not seem to support the bundled profile"
  fi
fi

# ---------------------------------------------------------------------------------------------
# End of stock template. Everything below is this project's own.
# ---------------------------------------------------------------------------------------------

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

# The install directory is the install prefix (/opt) plus sanitizedProductName — read off
# app-builder-lib 26.15.3 (`targets/FpmTarget.js:215`, `targets/LinuxTargetHelper.js:76`),
# and confirmed in the built package: `/opt/ZimaOS Client/`.
#
# The macro productFilename stood here and produced the same string only by accident: it
# falls back to sanitizedProductName while `linux.executableName` is unset (`appInfo.js:57`).
# Setting that option one day would have moved this path and left the capability ungranted
# on every future install — with the package still reporting success.
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
