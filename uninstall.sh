#!/usr/bin/env bash
set -euo pipefail

# Opencode Zenith Uninstaller for Linux
# Author: Mimogu

echo "=================================================="
echo "         Opencode Zenith Uninstaller (Linux)      "
echo "=================================================="

CONFIG_DIR="${HOME}/.config/opencode"

ask_yes_no() {
  local prompt="$1"
  local default="${2:-N}"
  local reply
  if [ -e /dev/tty ] && [ -r /dev/tty ]; then
    printf "  [?] %s [%s]: " "$prompt" "$default"
    read -r reply </dev/tty || reply="$default"
  else
    reply="$default"
  fi
  [[ "$reply" =~ ^[Yy]$ ]]
}

# 1. Stop and disable systemd user services
echo "[1/4] Stopping background services..."
if command -v systemctl >/dev/null 2>&1; then
  for unit in opencode-benchmark.timer opencode-benchmark.service opencode-sentinel.service omniroute.service; do
    if systemctl --user is-active --quiet "$unit" 2>/dev/null || systemctl --user is-enabled --quiet "$unit" 2>/dev/null; then
      echo "  [-] Stopping and disabling $unit..."
      systemctl --user stop "$unit" 2>/dev/null || true
      systemctl --user disable "$unit" 2>/dev/null || true
    fi
  done

  SYSTEMD_USER="${HOME}/.config/systemd/user"
  for unit in opencode-benchmark.timer opencode-benchmark.service opencode-sentinel.service omniroute.service; do
    if [ -f "${SYSTEMD_USER}/${unit}" ]; then
      rm -f "${SYSTEMD_USER}/${unit}"
      echo "  [-] Removed ${SYSTEMD_USER}/${unit}"
    fi
  done
  systemctl --user daemon-reload 2>/dev/null || true
fi

# Stop any loose sentinel or omniroute background processes
pkill -u "$(id -u)" -f "sentinel.py" 2>/dev/null || true
pkill -u "$(id -u)" -f "omniroute serve" 2>/dev/null || true
echo "  [✓] Background services stopped."

# 2. Remove helper scripts
echo "[2/4] Removing Zenith binaries..."
if [ -f "${HOME}/.local/bin/browser-ctl" ]; then
  rm -f "${HOME}/.local/bin/browser-ctl"
  echo "  [-] Removed ${HOME}/.local/bin/browser-ctl"
fi

# 3. Clean configuration folder
echo "[3/4] Cleaning OpenCode configuration..."
if [ -d "$CONFIG_DIR" ]; then
  if ask_yes_no "Delete the OpenCode Zenith configuration folder ($CONFIG_DIR)?" "y"; then
    rm -rf "$CONFIG_DIR"
    echo "  [✓] Configuration removed."
  else
    echo "  [i] Configuration preserved at $CONFIG_DIR."
  fi
else
  echo "  [i] No configuration folder found at $CONFIG_DIR."
fi

# 4. Completion notice
echo "[4/4] Cleanup complete."
echo ""
echo "=================================================="
echo "          Opencode Zenith Uninstalled             "
echo "=================================================="
echo "Base programs (Git, Python, Node, Bun, OpenCode CLI, OmniRoute)"
echo "remain installed. To uninstall global packages if desired:"
echo "  npm uninstall -g @opencode/cli omniroute"
