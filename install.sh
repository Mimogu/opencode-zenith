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

is_interactive() {
  [ "${ZENITH_NON_INTERACTIVE:-0}" != "1" ] && [ "${CI:-0}" != "1" ] && (exec </dev/tty) 2>/dev/null && (exec >/dev/tty) 2>/dev/null
}

# Ensure local user bin paths are available in PATH
mkdir -p "${HOME}/.local/bin" "${HOME}/.npm-global/bin"
export PATH="${HOME}/.local/bin:${HOME}/.npm-global/bin:${HOME}/.bun/bin:${PATH}"

for profile in "${HOME}/.bashrc" "${HOME}/.profile" "${HOME}/.zshrc"; do
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

# Ensure graphify CLI is available for on-demand knowledge graph extraction
if ! has_cmd graphify; then
  echo "  [+] Installing Graphify CLI for on-demand codebase knowledge graphs..."
  python3 -m pip install -q --user --break-system-packages graphifyy 2>/dev/null || python3 -m pip install -q graphifyy 2>/dev/null || true
fi
if has_cmd graphify; then
  echo "  [✓] Graphify CLI ready (on-demand /graphify skill)."
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
  # A bundled skill replaces a same-named skill symlink; other links (npm .bin, the user's own skills) stay
  for bundled in "${SCRIPT_DIR}/config/skills/"*/; do
    link="${CONFIG_DIR}/skills/$(basename "$bundled")"
    if [ -L "$link" ]; then rm -f "$link"; fi
  done
fi

mkdir -p "$CONFIG_DIR"
cp -r --remove-destination "${SCRIPT_DIR}/config/"* "$CONFIG_DIR/" 2>/dev/null || cp -r -f "${SCRIPT_DIR}/config/"* "$CONFIG_DIR/"
rm -rf "${CONFIG_DIR}/__pycache__" "${CONFIG_DIR}/tests/__pycache__"

# Setup OpenCode Browse CLI & MCP (drives real desktop browsers via browser extension)
echo "  [+] Setting up OpenCode Browse (real browser automation)..."
if ! has_cmd browse; then
  curl -fsSL https://opencode.ai/browse/install | bash -s -- -a opencode --no-wait 2>/dev/null || true
else
  browse install -a opencode --no-wait 2>/dev/null || true
fi
if has_cmd browse; then
  echo "  [✓] OpenCode Browse CLI ready ($(browse version 2>/dev/null || echo 'installed'))."
fi

# 3. Process configuration templates
echo "[3/5] Initializing configuration files..."
if [ -f "${CONFIG_DIR}/opencode.json.template" ]; then
  sed "s|{{CONFIG_DIR}}|${CONFIG_DIR}|g" "${CONFIG_DIR}/opencode.json.template" > "${CONFIG_DIR}/opencode.json"

  # Keep the user's own MCP servers on update; add the template's new ones
  python3 - "${CONFIG_DIR}/opencode.json" "${BACKUP_DIR:-}/opencode.json" <<'MCP_MERGE' || echo "  [!] Could not merge your MCP servers; your previous config is in ${BACKUP_DIR:-the backup}."
import json, os, shutil, sys

new_path, old_path = sys.argv[1], sys.argv[2]
with open(new_path, encoding='utf-8') as f:
    data = json.load(f)

def servers(cfg):
    mcp = cfg.get('mcp')
    if not isinstance(mcp, dict):
        return {}
    inner = mcp.get('servers')
    return inner if isinstance(inner, dict) else mcp

target = servers(data)
if 'servers' in data.get('mcp', {}) or not target:
    data.setdefault('mcp', {}).setdefault('servers', target)

old = {}
if os.path.isfile(old_path):
    try:
        with open(old_path, encoding='utf-8') as f:
            old = servers(json.load(f))
    except (OSError, ValueError) as e:
        print(f'  [!] Previous opencode.json unreadable ({e}); using template MCP servers only.')

for name, cfg in old.items():
    if isinstance(cfg, dict):
        target[name] = cfg
if old:
    print(f'  [✓] Kept your {len(old)} MCP server(s): ' + ', '.join(sorted(old)))

def runnable(cfg):
    cmd = cfg.get('command')
    if cfg.get('type') != 'local' or not cmd:
        return True
    exe = cmd[0] if isinstance(cmd, list) else str(cmd).split()[0]
    return os.path.isfile(exe) if os.path.isabs(exe) else shutil.which(exe) is not None

for name, cfg in target.items():
    if isinstance(cfg, dict) and cfg.get('enabled', True) and not runnable(cfg):
        cfg['enabled'] = False
        print(f'  [i] MCP {name}: command not found, disabled (enable it after installing it).')

with open(new_path, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2)
MCP_MERGE
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
  ollama_up=0
  if curl -s -m 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
    ollama_up=1
  else
    systemctl start ollama 2>/dev/null || systemctl --user start ollama 2>/dev/null || true
    sleep 1
    if curl -s -m 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
      ollama_up=1
    fi
  fi

  if [ "$ollama_up" -eq 1 ]; then
    if ! ollama list 2>/dev/null | grep -q "embeddinggemma"; then
      echo "  [+] Pulling recommended local embedding model (embeddinggemma, ~620MB)..."
      ollama pull embeddinggemma || echo "  [!] Could not pull embeddinggemma automatically. You can run 'ollama pull embeddinggemma' anytime."
    else
      echo "  [✓] embeddinggemma model ready."
    fi
  else
    echo "  [!] Ollama is installed but the background daemon is not running on 127.0.0.1:11434."
    echo "      Zenith will use built-in BM25 keyword matching for skills and memory."
    echo "      To enable semantic embeddings anytime: start Ollama and run 'ollama pull embeddinggemma'."
  fi
else
  INSTALL_OLLAMA="n"
  if is_interactive; then
    printf "  [?] Ollama not found. Would you like to install Ollama & download embeddinggemma (~620MB) for vector search? [y/N]: " >/dev/tty
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

# 6. Service templates
if [ -d "${SCRIPT_DIR}/systemd" ] && has_cmd systemctl; then
  SYSTEMD_USER="${HOME}/.config/systemd/user"
  mkdir -p "$SYSTEMD_USER"
  [ -f "${SCRIPT_DIR}/systemd/omniroute.service" ] && cp "${SCRIPT_DIR}/systemd/omniroute.service" "$SYSTEMD_USER/"
  [ -f "${SCRIPT_DIR}/systemd/opencode-sentinel.service" ] && cp "${SCRIPT_DIR}/systemd/opencode-sentinel.service" "$SYSTEMD_USER/"
  [ -f "${SCRIPT_DIR}/systemd/opencode-benchmark.service" ] && cp "${SCRIPT_DIR}/systemd/opencode-benchmark.service" "$SYSTEMD_USER/"
  [ -f "${SCRIPT_DIR}/systemd/opencode-benchmark.timer" ] && cp "${SCRIPT_DIR}/systemd/opencode-benchmark.timer" "$SYSTEMD_USER/"
  systemctl --user daemon-reload 2>/dev/null || true
  systemd_ok=0
  if systemctl --user enable --now omniroute.service opencode-sentinel.service opencode-benchmark.timer 2>/dev/null; then
    systemd_ok=1
  fi
  if [ "$systemd_ok" -eq 1 ]; then
    echo "  [✓] Systemd user services (omniroute, sentinel, benchmark timer) enabled."
  else
    echo "  [i] Systemd user services not active (skipped; start services manually or via login script)."
  fi
fi

# 7. Environment & OmniRoute configuration
echo "[5/5] Finalizing environment & OmniRoute gateway..."
CONFIG_ENV="${CONFIG_DIR}/free-models.env"
if [ ! -f "$CONFIG_ENV" ]; then
  cp "${SCRIPT_DIR}/.env.example" "$CONFIG_ENV"
  echo "  [+] Generated new free-models.env from template."
fi

if has_cmd omniroute; then
  for _ in 1 2 3 4 5; do
    if curl -s -m 1 http://127.0.0.1:20128/ >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  if ! curl -s -m 1 http://127.0.0.1:20128/ >/dev/null 2>&1; then
    nohup omniroute serve --no-open >/dev/null 2>&1 &
    sleep 2
  fi
fi

python3 -c "
import sys, re, os, subprocess, json, getpass

config_env = sys.argv[1]
config_dir = sys.argv[2]
script_dir = sys.argv[3]

is_interactive = False
if os.environ.get('ZENITH_NON_INTERACTIVE') != '1' and os.environ.get('CI') != '1':
    try:
        with open('/dev/tty', 'r') as t_in, open('/dev/tty', 'w') as t_out:
            is_interactive = True
    except Exception:
        is_interactive = False

content = ''
if os.path.isfile(config_env):
    with open(config_env, 'r', encoding='utf-8') as f:
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

def has_cmd(cmd):
    return subprocess.run(['which', cmd], capture_output=True).returncode == 0

has_omniroute = has_cmd('omniroute')

def run_omni(*args):
    if not has_omniroute:
        return -1
    res = subprocess.run(['omniroute'] + list(args), capture_output=True)
    return res.returncode

# --- 1. OmniRoute Admin Password ---
if has_omniroute and is_interactive:
    omni_db = os.path.expanduser('~/.omniroute/storage.sqlite')
    is_existing = os.path.isfile(omni_db)
    try:
        import urllib.request
        urllib.request.urlopen('http://127.0.0.1:20128/', timeout=1)
        is_existing = True
    except Exception:
        pass

    if is_existing:
        try:
            pw1 = getpass.getpass('  OmniRoute admin password (Enter = keep current password): ').strip()
            if pw1:
                if len(pw1) < 8:
                    print('  [!] Password must be at least 8 characters. Keeping current password.')
                else:
                    code = run_omni('setup', '--non-interactive', '--password', pw1)
                    if code == 0:
                        print('  [✓] OmniRoute admin password updated.')
                    else:
                        print('  [!] Could not update password; keeping current.')
            else:
                print('  [✓] Current OmniRoute admin password preserved.')
        except Exception:
            pass
    else:
        print('  Choose an admin password for the OmniRoute dashboard (typing is hidden).')
        while True:
            try:
                pw1 = getpass.getpass('  OmniRoute admin password (Enter = skip): ').strip()
                if not pw1:
                    print('  [i] Skipped setting admin password.')
                    break
                if len(pw1) < 8:
                    print('  [!] Use at least 8 characters.')
                    continue
                pw2 = getpass.getpass('  Repeat the password: ').strip()
                if pw1 != pw2:
                    print('  [!] The passwords do not match.')
                    continue
                code = run_omni('setup', '--non-interactive', '--password', pw1)
                if code == 0:
                    print('  [✓] OmniRoute admin password set.')
                else:
                    print(f'  [!] Could not set password (code {code}); set it in the dashboard instead.')
                break
            except Exception:
                break

# --- 2. API Keys & Provider Connections ---
if is_interactive:
    try:
        with open('/dev/tty', 'r') as tty, open('/dev/tty', 'w') as tty_out:
            def prompt(text):
                tty_out.write(text)
                tty_out.flush()
                return tty.readline().strip()

            # NVIDIA_API_KEY
            curr_nv = os.environ.get('NVIDIA_API_KEY', '') or get_key('NVIDIA_API_KEY')
            if curr_nv:
                m = mask(curr_nv)
                val = prompt(f'  Existing NVIDIA_API_KEY detected ({m}).\n  Enter new key to update (Enter = keep current): ')
                if val:
                    update_key('NVIDIA_API_KEY', val)
                    os.environ['NVIDIA_API_KEY'] = val
                    curr_nv = val
                    print('  [✓] NVIDIA_API_KEY updated.')
                else:
                    update_key('NVIDIA_API_KEY', curr_nv)
                    print('  [✓] Current NVIDIA_API_KEY preserved.')
            else:
                tty_out.write('  NVIDIA NIM powers the flagship Nemotron 3.5 Super VL model (free tier).\n  Create a free key at https://build.nvidia.com, or press Enter to skip.\n')
                val = prompt('  Enter NVIDIA API key (Enter = skip): ')
                if val:
                    update_key('NVIDIA_API_KEY', val)
                    os.environ['NVIDIA_API_KEY'] = val
                    curr_nv = val
                    print('  [✓] NVIDIA_API_KEY saved.')
                else:
                    print('  [i] Skipped NVIDIA_API_KEY (existing settings preserved).')

            if curr_nv and has_omniroute:
                run_omni('setup', '--non-interactive', '--add-provider', '--provider', 'nvidia', '--provider-name', 'NVIDIA NIM', '--api-key', curr_nv)

            # OPENROUTER_API_KEY
            curr_or = os.environ.get('OPENROUTER_API_KEY', '') or get_key('OPENROUTER_API_KEY')
            if curr_or:
                m = mask(curr_or)
                val = prompt(f'  Existing OPENROUTER_API_KEY detected ({m}).\n  Enter new key to update (Enter = keep current): ')
                if val:
                    update_key('OPENROUTER_API_KEY', val)
                    os.environ['OPENROUTER_API_KEY'] = val
                    curr_or = val
                    print('  [✓] OPENROUTER_API_KEY updated.')
                else:
                    update_key('OPENROUTER_API_KEY', curr_or)
                    print('  [✓] Current OPENROUTER_API_KEY preserved.')
            else:
                tty_out.write('  OpenRouter gives free fallback models when the OpenCode free allowance runs out.\n  Create a free key at https://openrouter.ai/keys, or press Enter to skip.\n')
                val = prompt('  Enter OpenRouter API key (Enter = skip): ')
                if val:
                    update_key('OPENROUTER_API_KEY', val)
                    os.environ['OPENROUTER_API_KEY'] = val
                    curr_or = val
                    print('  [✓] OPENROUTER_API_KEY saved.')
                else:
                    print('  [i] Skipped OPENROUTER_API_KEY (existing settings preserved).')

            if curr_or and has_omniroute:
                run_omni('setup', '--non-interactive', '--add-provider', '--provider', 'openrouter', '--provider-name', 'OpenRouter', '--api-key', curr_or, '--test-provider')

            # OMNIROUTE_API_KEY
            curr_omni = os.environ.get('OMNIROUTE_API_KEY', '') or get_key('OMNIROUTE_API_KEY')
            if curr_omni:
                m = mask(curr_omni)
                val = prompt(f'  Existing OMNIROUTE_API_KEY detected ({m}).\n  Enter new key to update (Enter = keep current): ')
                if val:
                    update_key('OMNIROUTE_API_KEY', val)
                    os.environ['OMNIROUTE_API_KEY'] = val
                    curr_omni = val
                    print('  [✓] OMNIROUTE_API_KEY updated.')
                else:
                    update_key('OMNIROUTE_API_KEY', curr_omni)
                    print('  [✓] Current OMNIROUTE_API_KEY preserved.')
            else:
                tty_out.write('  Now the OmniRoute dashboard opens in your browser (http://localhost:20128).\n    1. Log in with your admin password.\n    2. Optional: Providers -> add the AI accounts you want to route through OmniRoute\n       (for example Antigravity / Google login).\n    3. API Keys -> create a key, copy it, and paste it below.\n')
                if (os.environ.get('DISPLAY') or os.environ.get('WAYLAND_DISPLAY')) and has_cmd('xdg-open'):
                    subprocess.Popen(['xdg-open', 'http://localhost:20128'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                val = prompt('  Paste the OmniRoute API key (Enter = skip): ')
                if val:
                    update_key('OMNIROUTE_API_KEY', val)
                    os.environ['OMNIROUTE_API_KEY'] = val
                    curr_omni = val
                    print('  [✓] OMNIROUTE_API_KEY saved.')
                else:
                    print('  [i] Skipped OMNIROUTE_API_KEY.')
    except Exception:
        pass
else:
    print('  [✓] Existing free-models.env preserved (your API keys are safe).')

# Write updated keys back to free-models.env
if content:
    with open(config_env, 'w', encoding='utf-8') as f:
        f.write(content)

# --- 3. OmniRoute Combos ---
if has_omniroute:
    combos_file = ''
    for cand in [os.path.join(script_dir, 'config', 'omniroute-combos.json'), os.path.join(config_dir, 'omniroute-combos.json')]:
        if os.path.isfile(cand):
            combos_file = cand
            break

    if combos_file:
        try:
            with open(combos_file, 'r', encoding='utf-8') as cf:
                target_combos = json.load(cf)

            res = subprocess.run(['omniroute', 'combo', 'list', '--output', 'json'], capture_output=True, text=True)
            existing = []
            s = res.stdout
            start = s.find('{')
            end = s.rfind('}')
            if start != -1 and end != -1:
                d = json.loads(s[start:end+1])
                existing = [c['name'] for c in d.get('combos', [])]

            for c in target_combos:
                cname = c.get('name')
                if cname in existing:
                    continue
                models_str = ','.join(c.get('models', []))
                strat = c.get('strategy', 'priority')
                c_res = subprocess.run(['omniroute', 'combo', 'create', cname, '--strategy', strat, '--models', models_str], capture_output=True, text=True)
                if c_res.returncode == 0 or 'already exists' in c_res.stdout:
                    print(f'  [✓] Combo {cname} ready.')
        except Exception:
            pass
" "$CONFIG_ENV" "$CONFIG_DIR" "$SCRIPT_DIR" 2>/dev/null || true

echo ""
echo "To view or update your free model keys anytime: ${CONFIG_ENV}"

# Restart OpenCode background services so new MCP servers and config take effect
if has_cmd opencode; then
  SERVICE_STATUS="$(timeout 2 opencode service status 2>/dev/null || echo 'stopped')"
  if [[ "$SERVICE_STATUS" == http* ]]; then
    timeout 5 opencode service restart >/dev/null 2>&1 || true
  fi
fi
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
echo "=========================================================================="
echo "               🌐 OpenCode Browser Extension Setup Guide                 "
echo "=========================================================================="
echo "OpenCode uses the official 'OpenCode Browse' extension to drive your real"
echo "browser without port conflicts or losing your login sessions."
echo ""
echo "1. Install the Extension (Chrome Web Store):"
echo "   https://chromewebstore.google.com/detail/mfnicocicmmlkpjnaffgihfjhdgjkdjg"
echo ""
echo "2. Browser Compatibility:"
echo "   • Google Chrome & Chromium : Click 'Add to Chrome'"
echo "   • Brave                    : Click 'Add to Brave'"
echo "   • Microsoft Edge           : Click 'Allow extensions from other stores',"
echo "                                then click 'Add to Edge'"
echo "   • Opera / Vivaldi / Arc    : Installs directly from Chrome Web Store"
echo ""
echo "   * Note for Firefox users: Firefox does not support Chromium extensions."
echo "     Keep a Chromium-based browser (Chrome, Brave, Edge) installed on your"
echo "     system for OpenCode browser automation tasks."
echo ""
echo "3. Activation:"
echo "   Once installed, click the OpenCode Browse icon in your browser toolbar"
echo "   once to connect it to OpenCode."
echo ""
echo "4. Recommended Extension Settings:"
echo "   • Right-click the Browse extension icon -> Options:"
echo "     - Set 'Collapse agent groups' to 'Never' to keep tabs expanded and visible"
echo "       in your tab strip (otherwise Chromium folds them into a collapsed dot)."
echo "     - 'Where agents open their tabs': 'Your window' (shared) or 'Own window'."
echo "=========================================================================="

if is_interactive && [ -n "${DISPLAY:-${WAYLAND_DISPLAY:-}}" ] && has_cmd xdg-open; then
  printf "Open the extension link in your default browser now? [y/N]: " >/dev/tty
  read -r open_ext </dev/tty || open_ext="n"
  case "$open_ext" in
    [yY]*) xdg-open "https://chromewebstore.google.com/detail/mfnicocicmmlkpjnaffgihfjhdgjkdjg" >/dev/null 2>&1 & ;;
  esac
fi

echo ""
echo "=================================================="
echo "          Opencode Zenith Ready to Use!           "
echo "=================================================="
echo "Run 'opencode' in your terminal to start."
