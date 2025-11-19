#!/usr/bin/env bash
set -euo pipefail

# install_caps_and_unit.sh
# Copies bundled ZeroTier binaries to a user-writable path,
# grants Linux capabilities, writes a systemd --user unit,
# and enables/starts the service.

# Usage:
#   ./install_caps_and_unit.sh /path/to/resources/zerotier
# If not provided, defaults to ./resources/zerotier relative to current dir.

SRC_DIR="${1:-./resources/zerotier}"
DEST_DIR="${HOME}/.local/lib/zima-remote/zerotier"
UNIT_DIR="${HOME}/.config/systemd/user"
UNIT_FILE="${UNIT_DIR}/zima-zerotier.service"
ZT_HOME="${HOME}/.zima-zerotier"

echo "==> Source dir: ${SRC_DIR}"
echo "==> Dest dir:   ${DEST_DIR}"
mkdir -p "${DEST_DIR}" "${UNIT_DIR}" "${ZT_HOME}"

# Copy binaries
cp -f "${SRC_DIR}/zerotier-one" "${DEST_DIR}/zerotier-one"
cp -f "${SRC_DIR}/zerotier-cli" "${DEST_DIR}/zerotier-cli"
chmod +x "${DEST_DIR}/zerotier-one" "${DEST_DIR}/zerotier-cli"

# Ensure /dev/net/tun exists
if [ ! -e /dev/net/tun ]; then
  echo "==> /dev/net/tun missing, attempting to load tun module (may require sudo)"
  if command -v sudo >/dev/null 2>&1; then
    sudo modprobe tun || true
  else
    modprobe tun || true
  fi
fi

# Grant capabilities to zerotier-one
if ! command -v setcap >/dev/null 2>&1; then
  echo "ERROR: setcap not found. Install libcap2-bin (Debian/Ubuntu) or libcap (RPM)."
  exit 1
fi

echo "==> Granting capabilities to zerotier-one (CAP_NET_ADMIN, CAP_NET_RAW)"
if command -v sudo >/dev/null 2>&1; then
  sudo setcap cap_net_admin,cap_net_raw=eip "${DEST_DIR}/zerotier-one"
else
  setcap cap_net_admin,cap_net_raw=eip "${DEST_DIR}/zerotier-one"
fi

echo "==> Current capabilities:"
getcap "${DEST_DIR}/zerotier-one" || true

# Write systemd --user unit
cat > "${UNIT_FILE}" <<'EOF'
[Unit]
Description=ZeroTier for Zima Remote Client (user)
After=network-online.target

[Service]
Type=forking
ExecStart=%h/.local/lib/zima-remote/zerotier/zerotier-one -d -U %h/.zima-zerotier
ExecStop=%h/.local/lib/zima-remote/zerotier/zerotier-cli -D %h/.zima-zerotier shutdown
Restart=always
NoNewPrivileges=false

[Install]
WantedBy=default.target
EOF

echo "==> Wrote ${UNIT_FILE}"

# Reload and start
systemctl --user daemon-reload
systemctl --user enable --now zima-zerotier.service

echo "==> Service status:"
systemctl --user --no-pager --full status zima-zerotier.service || true

# Quick sanity checks
echo "==> Zerotier info:"
if [ -f "${ZT_HOME}/zerotier-one.port" ] && [ -f "${ZT_HOME}/authtoken.secret" ]; then
  PORT=$(cat "${ZT_HOME}/zerotier-one.port")
  TOKEN=$(cat "${ZT_HOME}/authtoken.secret")
  "${DEST_DIR}/zerotier-cli" -p"${PORT}" -T"${TOKEN}" info || true
  echo "==> Zerotier networks:"
  "${DEST_DIR}/zerotier-cli" -p"${PORT}" -T"${TOKEN}" listnetworks || true
  echo ""
  echo "==> If no zt* interface appears yet, join a network:"
  echo "    PORT=\$(cat ${ZT_HOME}/zerotier-one.port)"
  echo "    TOKEN=\$(cat ${ZT_HOME}/authtoken.secret)"
  echo "    ${DEST_DIR}/zerotier-cli -p\"\$PORT\" -T\"\$TOKEN\" join <networkId>"
else
  echo "Port/token files not found yet. Service may still be starting..."
fi
