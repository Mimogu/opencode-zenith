#!/usr/bin/env bash
set -euo pipefail

# Opencode Zenith Installer for Linux
# Author: Mimogu

echo "=================================================="
echo "          Opencode Zenith Setup (Linux)           "
echo "=================================================="

CONFIG_DIR="${HOME}/.config/opencode"
CLEANUP_TEMP=false
SCRIPT_DIR=""

if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

if [ -z "$SCRIPT_DIR" ] || [ ! -d "${SCRIPT_DIR}/config" ]; then
  echo "  [+] Fetching Opencode Zenith bundle..."
  TMP_DIR="$(mktemp -d -t opencode-zenith-XXXXXX)"
  if command -v git >/dev/null 2>&1; then
    git clone --depth=1 https://github.com/Mimogu/opencode-zenith.git "$TMP_DIR" >/dev/null 2>&1 || {
      curl -fsSL https://github.com/Mimogu/opencode-zenith/archive/refs/heads/main.tar.gz | tar -xz -C "$TMP_DIR" --strip-components=1
    }
  else
    curl -fsSL https://github.com/Mimogu/opencode-zenith/archive/refs/heads/main.tar.gz | tar -xz -C "$TMP_DIR" --strip-components=1
  fi
  SCRIPT_DIR="$TMP_DIR"
  CLEANUP_TEMP=true
fi

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
  echo "  [✓] opencode found. Ensuring latest version..."
  if has_cmd bun; then
    bun install -g opencode-ai >/dev/null 2>&1 || true
  elif has_cmd npm; then
    npm install -g opencode-ai >/dev/null 2>&1 || true
  fi
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

# 5. Local Embedding AI (Ollama + embeddinggemma)
echo "[4/5] Checking local embedding engine..."
if has_cmd ollama; then
  echo "  [✓] Ollama found."
  if ! ollama list 2>/dev/null | grep -q "embeddinggemma"; then
    echo "  [+] Pulling recommended local embedding model (embeddinggemma, ~620MB)..."
    ollama pull embeddinggemma || echo "  [!] Could not pull embeddinggemma automatically. You can run 'ollama pull embeddinggemma' anytime."
  else
    echo "  [✓] embeddinggemma model ready."
  fi
else
  INSTALL_OLLAMA="n"
  if [ -e /dev/tty ] && [ -r /dev/tty ]; then
    printf "  [?] Ollama not found. Would you like to install Ollama & download embeddinggemma (~620MB) for vector search? [y/N]: "
    read -r INSTALL_OLLAMA </dev/tty || INSTALL_OLLAMA="n"
  fi
  if [[ "$INSTALL_OLLAMA" =~ ^[Yy]$ ]]; then
    echo "  [+] Installing Ollama..."
    curl -fsSL https://ollama.com/install.sh | sh || true
    if has_cmd ollama; then
      echo "  [✓] Ollama installed. Starting service..."
      systemctl start ollama 2>/dev/null || systemctl --user start ollama 2>/dev/null || true
      sleep 2
      echo "  [+] Pulling embeddinggemma model..."
      ollama pull embeddinggemma || echo "  [!] Could not pull model automatically. Run 'ollama pull embeddinggemma' anytime."
      echo "  [✓] embeddinggemma model ready."
    else
      echo "  [!] Ollama installation did not complete. Continuing with keyword fallback."
    fi
  else
    echo "  [i] Skipping Ollama. Zenith will use fast built-in BM25 keyword matching for memory and skill routing."
    echo "      To enable semantic vector embeddings anytime: install Ollama and run 'ollama pull embeddinggemma'."
  fi
fi

# 6. Environment configuration setup
echo "[5/5] Finalizing environment & services..."
if [ ! -f "${CONFIG_DIR}/free-models.env" ]; then
  cp "${SCRIPT_DIR}/.env.example" "${CONFIG_DIR}/free-models.env"
  echo "  [+] Generated new free-models.env from template."
  echo ""
  echo "To connect free models, edit ${CONFIG_DIR}/free-models.env and add your API keys:"
  echo "  - OpenRouter: https://openrouter.ai/keys"
  echo "  - NVIDIA NIM: https://build.nvidia.com"
else
  echo "  [✓] Existing free-models.env preserved (your API keys are safe)."
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

if [ "$CLEANUP_TEMP" = true ]; then
  rm -rf "$SCRIPT_DIR"
fi

echo ""
echo "=================================================="
echo "          Opencode Zenith Ready to Use!           "
echo "=================================================="
echo "Run 'opencode' in your terminal to start."
