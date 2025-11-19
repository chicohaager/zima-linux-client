#!/usr/bin/env bash
set -euo pipefail

SERVICE="zima-zerotier.service"

echo "## 1) Show unit contents & effective ExecStart"
echo "---- unit (cat) ----"
systemctl --user cat "$SERVICE" || true
echo
echo "---- unit ExecStart (show) ----"
systemctl --user show -p ExecStart "$SERVICE" || true
echo

# Extract ExecStart path (best-effort)
EXEC="$(systemctl --user show -p ExecStart "$SERVICE" | sed -E 's/^ExecStart=(.*)$/\1/' | awk '{print $1}' | sed -E 's/^\"?(.+zerotier-one)\"?.*$/\1/')"
if [ -z "${EXEC}" ] || [ ! -x "${EXEC}" ]; then
  echo "!! Could not determine zerotier-one path from unit. Please check above output."
else
  echo "## 2) zerotier-one path from unit:"
  echo "EXEC=${EXEC}"
  echo "ls -l:"; ls -l "${EXEC}" || true
  echo "getcap:"; getcap "${EXEC}" || true
  echo
fi

echo "## 3) Check /dev/net/tun"
ls -l /dev/net/tun || echo "!! /dev/net/tun missing"

echo
echo "## 4) Show user service status"
systemctl --user status "$SERVICE" --no-pager --full || true
echo
echo "## 5) Recent logs"
journalctl --user -u "$SERVICE" -n 120 --no-pager || true

echo
echo "## 6) ZT home directory content (~/.zima-zerotier)"
ls -la "${HOME}/.zima-zerotier" || true

echo
echo "## 7) Try CLI (info & listnetworks) using the same home"
CLI="$(dirname "${EXEC:-/usr/bin/false}")/zerotier-cli"
echo "CLI=${CLI}"; ls -l "${CLI}" || true
"${CLI}" -D "${HOME}/.zima-zerotier" info || true
"${CLI}" -D "${HOME}/.zima-zerotier" listnetworks || true

echo
echo "## 8) If interface still absent, try direct run (won't daemonize here):"
echo "    ${EXEC} -H ${HOME}/.zima-zerotier"
