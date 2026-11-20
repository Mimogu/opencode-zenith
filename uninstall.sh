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

# 4. Local Embedding AI cleanup (optional)
echo "[4/5] Checking local embedding models..."
if command -v ollama >/dev/null 2>&1; then
  if ollama list 2>/dev/null | grep -q "embeddinggemma"; then
    if ask_yes_no "Remove the local embedding model (embeddinggemma, ~620MB) to reclaim disk space?" "y"; then
      echo "  [-] Removing embeddinggemma model..."
      ollama rm embeddinggemma 2>/dev/null || true
      echo "  [✓] embeddinggemma removed."
    else
      echo "  [i] embeddinggemma model kept."
    fi
  else
    echo "  [i] No embeddinggemma model found in Ollama."
  fi
fi

# 5. Completion notice
echo "[5/5] Cleanup complete."
echo ""
echo "=================================================="
echo "          Opencode Zenith Uninstalled             "
echo "=================================================="
echo "Base programs (Git, Python, Node, Bun, OpenCode CLI, OmniRoute, Ollama)"
echo "remain installed. If you wish to remove them completely:"
echo "  - CLI packages: npm uninstall -g @opencode/cli omniroute (or bun remove -g)"
echo "  - Ollama model: ollama rm embeddinggemma"
echo "  - Ollama service (Linux): sudo systemctl stop ollama && sudo rm /usr/local/bin/ollama"
