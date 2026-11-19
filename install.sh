#!/usr/bin/env bash
set -euo pipefail

# Opencode Zenith Installer for Linux
# Author: Mimogu

echo "=================================================="
echo "          Opencode Zenith Setup (Linux)           "
echo "=================================================="

CONFIG_DIR="${HOME}/.config/opencode"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

# 1. Dependency Checks
echo "[1/5] Checking prerequisites..."
for tool in git python3; do
  if has_cmd "$tool"; then
    echo "  [✓] $tool found"
  else
    echo "  [!] Missing $tool. Please install it with your system package manager."
    exit 1
  fi
done

if ! has_cmd bun && ! has_cmd node; then
  echo "  [+] Node/Bun missing. Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="${HOME}/.bun/bin:${PATH}"
fi

if ! has_cmd opencode; then
  echo "  [+] Installing OpenCode CLI..."
  if has_cmd bun; then
    bun install -g opencode-ai
  elif has_cmd npm; then
    npm install -g opencode-ai
  fi
else
  echo "  [✓] opencode found"
fi

# 2. Backup existing configuration
echo "[2/5] Deploying Zenith configuration..."
if [ -d "$CONFIG_DIR" ]; then
  BACKUP_DIR="${CONFIG_DIR}.bak.$(date +%Y%m%d%H%M%S)"
  echo "  [!] Existing config found at $CONFIG_DIR"
  echo "  [+] Creating backup at $BACKUP_DIR"
  cp -r "$CONFIG_DIR" "$BACKUP_DIR"
fi

mkdir -p "$CONFIG_DIR"
cp -r "${SCRIPT_DIR}/config/"* "$CONFIG_DIR/"

# 3. Process configuration templates
echo "[3/5] Initializing configuration files..."
if [ -f "${CONFIG_DIR}/opencode.json.template" ]; then
  sed "s|{{CONFIG_DIR}}|${CONFIG_DIR}|g" "${CONFIG_DIR}/opencode.json.template" > "${CONFIG_DIR}/opencode.json"
fi

# 4. Helper scripts
mkdir -p "${HOME}/.local/bin"
if [ -f "${SCRIPT_DIR}/scripts/browser-ctl" ]; then
  cp "${SCRIPT_DIR}/scripts/browser-ctl" "${HOME}/.local/bin/"
  chmod +x "${HOME}/.local/bin/browser-ctl"
fi

# 5. Environment configuration setup
if [ ! -f "${CONFIG_DIR}/free-models.env" ]; then
  cp "${SCRIPT_DIR}/.env.example" "${CONFIG_DIR}/free-models.env"
  echo "  [+] Generated new free-models.env from template."
  echo ""
  echo "To connect free models, edit ${CONFIG_DIR}/free-models.env and add your API keys:"
  echo "  - OpenRouter: https://openrouter.ai/keys"
  echo "  - NVIDIA NIM: https://build.nvidia.com"
fi

# 6. Service templates
if [ -d "${SCRIPT_DIR}/systemd" ] && has_cmd systemctl; then
  SYSTEMD_USER="${HOME}/.config/systemd/user"
  mkdir -p "$SYSTEMD_USER"
  cp "${SCRIPT_DIR}/systemd/"* "$SYSTEMD_USER/"
  systemctl --user daemon-reload 2>/dev/null || true
  systemctl --user enable --now opencode-benchmark.timer 2>/dev/null || true
  echo "  [✓] Systemd user timer opencode-benchmark.timer configured."
fi

echo ""
echo "=================================================="
echo "          Opencode Zenith Ready to Use!           "
echo "=================================================="
echo "Run 'opencode' in your terminal to start."
