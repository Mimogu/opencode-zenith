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

# Ensure local user bin paths are available in PATH
mkdir -p "${HOME}/.local/bin" "${HOME}/.npm-global/bin"
export PATH="${HOME}/.local/bin:${HOME}/.npm-global/bin:${HOME}/.bun/bin:${PATH}"

for profile in "${HOME}/.bashrc" "${HOME}/.profile"; do
  if [ -f "$profile" ] && ! grep -q "\.local/bin" "$profile" 2>/dev/null; then
    echo 'export PATH="${HOME}/.local/bin:${HOME}/.npm-global/bin:${HOME}/.bun/bin:${PATH}"' >> "$profile"
  fi
done

# 1. Dependency Checks & Setup
echo "[1/5] Checking prerequisites..."
for tool in git python3; do
  if has_cmd "$tool"; then
    echo "  [✓] $tool found"
  else
    echo "  [!] Missing $tool. Please install it with your system package manager."
    exit 1
  fi
done

# Check search tools (ripgrep / fd)
if has_cmd rg; then
  echo "  [✓] ripgrep (rg) found"
else
  echo "  [i] ripgrep (rg) not found. Highly recommended for code search (e.g. sudo apt install ripgrep / sudo pacman -S ripgrep)."
fi
if has_cmd fd || has_cmd fdfind; then
  echo "  [✓] fd found"
else
  echo "  [i] fd not found. Recommended for file discovery (e.g. sudo apt install fd-find / sudo pacman -S fd)."
fi

# Ensure npm doesn't fail with EACCES on root-owned /usr/local
if has_cmd npm; then
  NPM_PREFIX="$(npm config get prefix 2>/dev/null || true)"
  if [ "$NPM_PREFIX" = "/usr" ] || [ "$NPM_PREFIX" = "/usr/local" ]; then
    mkdir -p "${HOME}/.npm-global"
    npm config set prefix "${HOME}/.npm-global" 2>/dev/null || true
  fi
fi

if ! has_cmd bun && ! has_cmd node; then
  echo "  [+] Node/Bun missing. Installing Bun..."
  curl -fsSL --connect-timeout 15 --max-time 120 https://bun.sh/install | bash
  export PATH="${HOME}/.bun/bin:${PATH}"
fi

# Check OpenCode version (ensure v2.x)
get_opencode_version() {
  if has_cmd opencode; then
    local v
    v="$(opencode --version 2>/dev/null | head -n 1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || true)"
    echo "$v"
  fi
}

OC_VER="$(get_opencode_version)"
OC_MAJOR="${OC_VER%%.*}"

if [ -z "$OC_VER" ] || [ "${OC_MAJOR:-0}" -lt 2 ]; then
  if [ -n "$OC_VER" ]; then
    echo "  [!] Found outdated OpenCode $OC_VER. OpenCode Zenith requires OpenCode 2.x."
  fi
  echo "  [+] Installing/upgrading to OpenCode 2 (@opencode/cli)..."
  if has_cmd bun; then
    bun install -g @opencode/cli || curl -fsSL https://opencode.ai/install | bash
  elif has_cmd npm; then
    npm install -g @opencode/cli 2>/dev/null || curl -fsSL https://opencode.ai/install | bash
  else
    curl -fsSL https://opencode.ai/install | bash
  fi
  export PATH="${HOME}/.local/bin:${HOME}/.npm-global/bin:${HOME}/.bun/bin:${PATH}"
  OC_VER="$(get_opencode_version)"
  echo "  [✓] OpenCode ${OC_VER:-2.x} ready."
else
  echo "  [✓] OpenCode $OC_VER found."
fi

# OmniRoute gateway
if ! has_cmd omniroute; then
  echo "  [+] Installing OmniRoute gateway..."
  if has_cmd bun; then
    bun install -g omniroute || true
  elif has_cmd npm; then
    npm install -g omniroute 2>/dev/null || true
  fi
fi
if has_cmd omniroute; then
  echo "  [✓] OmniRoute gateway ready."
else
  echo "  [i] OmniRoute gateway not installed (optional; install anytime via 'npm install -g omniroute')."
fi

# 2. Backup existing configuration
echo "[2/5] Deploying Zenith configuration..."
if [ -d "$CONFIG_DIR" ]; then
  BACKUP_DIR="${CONFIG_DIR}.bak.$(date +%Y%m%d%H%M%S)"
  echo "  [!] Existing config found at $CONFIG_DIR"
  echo "  [+] Creating backup at $BACKUP_DIR"
  cp -r "$CONFIG_DIR" "$BACKUP_DIR"
  # Remove legacy symlinks that conflict with directory bundles
  find "$CONFIG_DIR" -type l -exec rm -f {} + 2>/dev/null || true
fi

mkdir -p "$CONFIG_DIR"
cp -r "${SCRIPT_DIR}/config/"* "$CONFIG_DIR/"
rm -rf "${CONFIG_DIR}/__pycache__" "${CONFIG_DIR}/tests/__pycache__"

# Install pinned MCP server binaries (playwright-mcp, firefox-devtools-mcp, camofox)
if [ -f "${CONFIG_DIR}/mcp-servers/package.json" ]; then
  echo "  [+] Installing browser MCP server binaries..."
  if has_cmd npm; then
    (cd "${CONFIG_DIR}/mcp-servers" && (npm ci --silent 2>/dev/null || npm install --silent 2>/dev/null || true))
    if [ -f "${CONFIG_DIR}/mcp-servers/camofox/package.json" ]; then
      (cd "${CONFIG_DIR}/mcp-servers/camofox" && (npm ci --silent 2>/dev/null || npm install --silent 2>/dev/null || true))
    fi
  elif has_cmd bun; then
    (cd "${CONFIG_DIR}/mcp-servers" && bun install --silent 2>/dev/null || true)
    if [ -f "${CONFIG_DIR}/mcp-servers/camofox/package.json" ]; then
      (cd "${CONFIG_DIR}/mcp-servers/camofox" && bun install --silent 2>/dev/null || true)
    fi
  fi
  if [ -f "${CONFIG_DIR}/mcp-servers/node_modules/@playwright/mcp/cli.js" ] && [ -f "${CONFIG_DIR}/mcp-servers/node_modules/@mozilla/firefox-devtools-mcp/dist/index.js" ]; then
    echo "  [✓] Browser MCP tools ready (playwright-mcp, firefox-devtools-mcp)."
  fi
fi

# 3. Process configuration templates
echo "[3/5] Initializing configuration files..."
if [ -f "${CONFIG_DIR}/opencode.json.template" ]; then
  sed "s|{{CONFIG_DIR}}|${CONFIG_DIR}|g" "${CONFIG_DIR}/opencode.json.template" > "${CONFIG_DIR}/opencode.json"

  # Validate MCP server availability and cleanly configure enabled/disabled states
  python3 -c "
import json, os, urllib.request

p = '${CONFIG_DIR}/opencode.json'
if not os.path.isfile(p):
    exit(0)
with open(p, 'r', encoding='utf-8') as f:
    data = json.load(f)

mcp = data.get('mcp', {})
if 'servers' in mcp:
    mcp = mcp['servers']

# Graphify remote endpoint check
graphify_up = False
try:
    with urllib.request.urlopen('http://127.0.0.1:8081/mcp', timeout=1) as resp:
        graphify_up = True
except Exception as e:
    if hasattr(e, 'code'):
        graphify_up = True

if 'graphify' in mcp:
    mcp['graphify']['enabled'] = bool(graphify_up)

# Browser & local MCP checks
pw_js = '${CONFIG_DIR}/mcp-servers/node_modules/@playwright/mcp/cli.js'
if not os.path.isfile(pw_js) and 'my-browser' in mcp:
    mcp['my-browser']['enabled'] = False

ff_js = '${CONFIG_DIR}/mcp-servers/node_modules/@mozilla/firefox-devtools-mcp/dist/index.js'
if not os.path.isfile(ff_js) and 'my-firefox' in mcp:
    mcp['my-firefox']['enabled'] = False

camo_js = '${CONFIG_DIR}/mcp-servers/camofox/server.mjs'
if not os.path.isfile(camo_js) and 'camofox' in mcp:
    mcp['camofox']['enabled'] = False

with open(p, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2)
" 2>/dev/null || true
fi

echo "  [+] Validating OpenCode configuration..."
if has_cmd opencode; then
  if opencode debug config --standalone >/dev/null 2>&1 || opencode debug config >/dev/null 2>&1; then
    echo "  [✓] OpenCode accepts the config."
  else
    echo "  [!] Warning: opencode debug config reported an issue with the configuration:"
    opencode debug config --standalone 2>&1 || opencode debug config 2>&1 || true
  fi
fi

# 4. Helper scripts & libraries
mkdir -p "${HOME}/.local/bin" "${HOME}/.local/lib"
if [ -f "${SCRIPT_DIR}/scripts/browser-ctl" ]; then
  cp "${SCRIPT_DIR}/scripts/browser-ctl" "${HOME}/.local/bin/"
  chmod +x "${HOME}/.local/bin/browser-ctl"
fi

for f in "${CONFIG_DIR}/lib/"agy_*.py; do
  [ -f "$f" ] && cp "$f" "${HOME}/.local/lib/" 2>/dev/null || true
done

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
CONFIG_ENV="${CONFIG_DIR}/free-models.env"
if [ ! -f "$CONFIG_ENV" ]; then
  cp "${SCRIPT_DIR}/.env.example" "$CONFIG_ENV"
  echo "  [+] Generated new free-models.env from template."
fi

if [ -e /dev/tty ] && [ -r /dev/tty ]; then
  python3 -c "
import sys, re, os

p = sys.argv[1]
if not os.path.isfile(p):
    exit(0)

with open(p, 'r', encoding='utf-8') as f:
    content = f.read()

def get_key(k):
    m = re.search(rf'^{k}=(.*)$', content, re.M)
    v = m.group(1).strip() if m else ''
    if v.startswith(('sk-your-', 'nvapi-your-', 'omni-your-')):
        return ''
    return v

def mask(v):
    if not v or len(v) <= 8:
        return '***'
    return v[:6] + '...' + v[-4:]

def update_key(k, v):
    global content
    pat = re.compile(rf'^{k}=.*$', re.M)
    if pat.search(content):
        content = pat.sub(f'{k}={v}', content)
    else:
        content += f'\n{k}={v}\n'

keys = [
    ('NVIDIA_API_KEY', 'NVIDIA API key (from https://build.nvidia.com)'),
    ('OPENROUTER_API_KEY', 'OpenRouter API key (from https://openrouter.ai/keys)'),
    ('OMNIROUTE_API_KEY', 'OmniRoute API key (from http://localhost:20128)'),
]

try:
    with open('/dev/tty', 'r') as tty, open('/dev/tty', 'w') as tty_out:
        for k, desc in keys:
            curr = os.environ.get(k, '') or get_key(k)
            if curr:
                m = mask(curr)
                tty_out.write(f'  Existing {k} detected ({m}).\n  Enter new key to update (Enter = keep current): ')
                tty_out.flush()
                line = tty.readline().strip()
                if line:
                    update_key(k, line)
                    tty_out.write(f'  [✓] {k} updated.\n\n')
                else:
                    update_key(k, curr)
                    tty_out.write(f'  [✓] Current {k} preserved.\n\n')
            else:
                tty_out.write(f'  Enter {desc} (Enter = skip): ')
                tty_out.flush()
                line = tty.readline().strip()
                if line:
                    update_key(k, line)
                    tty_out.write(f'  [✓] {k} saved.\n\n')
                else:
                    tty_out.write(f'  [i] Skipped {k} (existing settings preserved).\n\n')
            tty_out.flush()
except Exception:
    pass

with open(p, 'w', encoding='utf-8') as f:
    f.write(content)
" "$CONFIG_ENV" 2>/dev/null || true
  echo ""
  echo "To view or update your free model keys anytime: ${CONFIG_ENV}"
else
  echo "  [✓] Existing free-models.env preserved (your API keys are safe)."
fi

# 7. Service templates
if [ -d "${SCRIPT_DIR}/systemd" ] && has_cmd systemctl; then
  SYSTEMD_USER="${HOME}/.config/systemd/user"
  mkdir -p "$SYSTEMD_USER"
  [ -f "${SCRIPT_DIR}/systemd/omniroute.service" ] && cp "${SCRIPT_DIR}/systemd/omniroute.service" "$SYSTEMD_USER/"
  [ -f "${SCRIPT_DIR}/systemd/opencode-sentinel.service" ] && cp "${SCRIPT_DIR}/systemd/opencode-sentinel.service" "$SYSTEMD_USER/"
  [ -f "${SCRIPT_DIR}/systemd/opencode-benchmark.service" ] && cp "${SCRIPT_DIR}/systemd/opencode-benchmark.service" "$SYSTEMD_USER/"
  [ -f "${SCRIPT_DIR}/systemd/opencode-benchmark.timer" ] && cp "${SCRIPT_DIR}/systemd/opencode-benchmark.timer" "$SYSTEMD_USER/"
  systemctl --user daemon-reload 2>/dev/null || true
  systemctl --user enable --now omniroute.service 2>/dev/null || true
  systemctl --user enable --now opencode-sentinel.service 2>/dev/null || true
  systemctl --user enable --now opencode-benchmark.timer 2>/dev/null || true
  echo "  [✓] Systemd user services (omniroute, sentinel, benchmark timer) enabled."
fi

# Restart OpenCode background services so new MCP servers and config take effect
if has_cmd opencode-stack; then
  opencode-stack down >/dev/null 2>&1 || true
  opencode-stack up >/dev/null 2>&1 || true
elif has_cmd pkill; then
  pkill -fx "/usr/lib/opencode-desktop/opencode-cli serve --service" 2>/dev/null || true
  pkill -f "opencode-cli serve" 2>/dev/null || true
fi

if [ "$CLEANUP_TEMP" = true ]; then
  rm -rf "$SCRIPT_DIR"
fi

echo ""
echo "=================================================="
echo "          Opencode Zenith Ready to Use!           "
echo "=================================================="
echo "Run 'opencode' in your terminal to start."
