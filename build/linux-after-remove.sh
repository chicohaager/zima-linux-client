#!/bin/bash
# After-remove script for .deb, .rpm and pacman packages.
#
# 🔴 This file REPLACES electron-builder's stock after-remove template (same mechanism as
# linux-after-install.sh: `getResource(this.options.afterRemove, "after-remove.tpl")`,
# app-builder-lib 26.15.3, FpmTarget.js:69). The stock template is kept verbatim below; the
# only addition is the guard at the top.
#
# Why the guard exists — measured 2026-09-18 by the distro matrix's new reinstall step, on
# Fedora 41, Fedora 44 and openSUSE Tumbleweed, package 2.0.2:
#
#     after install:    /usr/bin/zima-linux-client -> /etc/alternatives/zima-linux-client
#     dnf reinstall:    rc=0
#     after reinstall:  ls: cannot access '/usr/bin/zima-linux-client': No such file
#
# rpm runs the NEW package's %post first and the OLD package's %postun afterwards, on every
# upgrade — and hands %postun `$1=1` to say "one instance remains". The stock template never
# looks at `$1`, so its `update-alternatives --remove` ran last and took the launcher with it.
# Every rpm user would have lost `zima-linux-client` on PATH with the 2.0.1 → 2.0.2 update.
# The .desktop entry survived (it points at /opt directly), which is exactly why nobody had
# noticed: the menu still worked, only the name on PATH was gone.
#
# dpkg runs the old postrm BEFORE the new postinst, so there the remove-and-re-add happened
# to be harmless — but it hands `$1=upgrade`, and skipping is right there too. pacman's
# post_remove is never called on an upgrade and receives the old version string ("2.0.2-1"),
# which the integer test below deliberately does not match.
#
# Note for editors: every ${...} here is substituted by electron-builder at build time; an
# unknown name aborts the build. Shell variables of this script are written without braces.

# ---------------------------------------------------------------------------------------------
# Upgrade guard. rpm: $1 = number of instances left, ≥1 means upgrade (0 = last one removed).
# dpkg: $1 = "upgrade" on an upgrade. Anything else — "remove", "purge", a version string —
# is a real removal and falls through to the stock template.
# ---------------------------------------------------------------------------------------------
ARG="${1:-}"
case "$ARG" in
  upgrade) exit 0 ;;
  ""|*[!0-9]*) ;;                         # empty or not a plain integer: not rpm's upgrade signal
  *) if [ "$ARG" -ge 1 ]; then exit 0; fi ;;
esac

# ---------------------------------------------------------------------------------------------
# Stock after-remove.tpl (app-builder-lib 26.15.3), unchanged.
# ---------------------------------------------------------------------------------------------


# Delete the link to the binary
# update-alternatives --remove <name> <path>: 'path' must be the registered alternative binary,
# not the generic symlink — see https://man7.org/linux/man-pages/man1/update-alternatives.1.html
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}'
else
    rm -f '/usr/bin/${executable}'
fi

APPARMOR_PROFILE_DEST='/etc/apparmor.d/${executable}'

# Remove and unload apparmor profile.
if [ -f "$APPARMOR_PROFILE_DEST" ]; then
  # Unload the profile from the running kernel before deleting the file so the
  # policy is not left enforced until the next reboot.  Mirror the chroot guard
  # used in the after-install script — live AppArmor operations are not
  # meaningful inside a chroot.
  # https://wiki.debian.org/AppArmor/HowToUse
  if apparmor_status --enabled > /dev/null 2>&1; then
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      apparmor_parser --remove "$APPARMOR_PROFILE_DEST" || true
    fi
  fi
  rm -f "$APPARMOR_PROFILE_DEST"
fi
