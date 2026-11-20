# 🚀 OpenCode Zenith

> **The Turnkey, Self-Healing Multi-Agent Distribution for [OpenCode](https://opencode.ai)**  
> *Pre-configured with zero-cost model failover ladders, daily capability benchmarking, 90+ engineering skills, dynamic browser remote control, and human review gates.*

**Maintained & Created by [Mimogu](https://github.com/Mimogu)**

---

## ✨ Why OpenCode Zenith?

Standard AI coding assistants either burn expensive cloud tokens or fail miserably when running on free models. **OpenCode Zenith** solves this through intelligent system design:

* 🔄 **Zero-Cost Automated Fallback Ladders**: Combines free endpoints from OpenRouter, NVIDIA NIM, and local gateways into a resilient chain (Primary → Secondary → Standby → Local). If one hits a rate limit or 503 error, it seamlessly continues on the next tier.
* 📊 **Self-Healing Daily Benchmarks**: Runs an automated live test every morning at 04:00 AM, scoring available free models on real tasks and dynamically promoting the best-performing model to the top of your ladder.
* 🛠️ **90+ Curated Skills**: Instant access to specialized workflows for Word (`.docx`), PowerPoint (`.pptx`), Excel (`.xlsx`), PDF extraction, high-performance TypeScript, systematic debugging, OWASP security scanning, and film direction.
* 🚦 **Human Review Gates (`#noreview`)**: Built-in verification checks ensure models never hallucinate file changes. For quick visual or browser tasks, simply append `#noreview` to finish cleanly in one turn without delays.
* 🌐 **Dynamic Desktop Browser Control**: Remotely drives any installed desktop browser (Brave, Chrome, Chromium, Firefox) with programmatic media timing and clean process termination.

---

## 📥 How to Install (Choose Your Preferred Method)

You can install OpenCode Zenith in under 2 minutes. The installer is **completely non-destructive** — it checks what you already have installed (Git, Python, Node, Bun) and skips existing tools without overwriting your personal files.

### Method 1: The 1-Line Terminal Command (Recommended)

#### On Linux (Ubuntu, Debian, Arch, Fedora):
Open your terminal and run:
```bash
curl -fsSL https://raw.githubusercontent.com/Mimogu/opencode-zenith/main/install.sh | bash
```

#### On Windows (PowerShell):
Open PowerShell and run:
```powershell
irm https://raw.githubusercontent.com/Mimogu/opencode-zenith/main/windows/install.ps1 | iex
```

---

### Method 2: Download & Double-Click (For Windows Users)

If you prefer not using terminal commands to install:

1. Click the green **`<> Code`** button at the top of this GitHub repository and select **Download ZIP**.
2. Right-click the downloaded `.zip` file and select **Extract All**.
3. Open the extracted folder, navigate to `windows`, and double-click **`install.bat`**.
4. Follow the short on-screen prompts.

---

### Method 3: Standard Git Clone

```bash
# 1. Clone the repository
git clone https://github.com/Mimogu/opencode-zenith.git
cd opencode-zenith

# 2. Run the installer
# On Linux:
./install.sh

# On Windows:
.\windows\install.bat
```

---

## 🔄 How to Update OpenCode Zenith

OpenCode Zenith receives continuous improvements: new engineering skills, updated prompt rules, model failover enhancements, and engine bug fixes.

Updating is **100% safe and non-destructive**:
* 🛡️ **Your API keys are never touched**: `free-models.env` (Linux) and Windows User Environment variables are preserved intact.
* 📦 **Automatic Backup**: Your previous configuration is automatically saved with a timestamp (`~/.config/opencode.bak.<timestamp>`).
* ⚡ **Core Engine Update**: The `opencode` CLI engine itself is automatically updated to the latest upstream release.

Choose the update method that matches how you installed:

### 1. For 1-Line Terminal Installs
Simply run the same command again. It fetches the latest bundle, backs up your old configuration, and installs all updates automatically:

* **Linux**:
  ```bash
  curl -fsSL https://raw.githubusercontent.com/Mimogu/opencode-zenith/main/install.sh | bash
  ```
* **Windows (PowerShell)**:
  ```powershell
  irm https://raw.githubusercontent.com/Mimogu/opencode-zenith/main/windows/install.ps1 | iex
  ```

### 2. For Download & Double-Click Installs (Windows ZIP)
1. Click the green **`<> Code`** button at the top of this GitHub repo and select **Download ZIP**.
2. Extract the new `.zip` archive.
3. Open the `windows` folder and double-click **`install.bat`**.
4. The installer automatically recognizes that your programs and API keys are already configured, backs up your previous config, and deploys the update.

### 3. For Git Clone Installs
Open your terminal in the cloned repository folder:

* **Linux**:
  ```bash
  cd opencode-zenith
  git pull
  ./install.sh
  ```
* **Windows**:
  ```cmd
  cd opencode-zenith
  git pull
  windows\install.bat
  ```

---

## 🔑 Setting Up Free API Keys (Zero-Cost Operation)

OpenCode Zenith works out of the box with completely free developer tier keys.

After running the installer, open your environment configuration file:
* **Linux**: `~/.config/opencode/free-models.env`
* **Windows**: `%USERPROFILE%\.config\opencode\free-models.env`

Add your keys (press Enter to skip any you don't use):

```bash
# 1. OpenRouter (Free models: Gemini Flash, Llama 3.3 70B, Nemotron)
# Sign up and get your free key at: https://openrouter.ai/keys
OPENROUTER_API_KEY=your_key_here

# 2. NVIDIA NIM (Free allowance for Nemotron 3.5 Super VL 120B and Ultra 550B)
# Sign up and get your free key at: https://build.nvidia.com
NVIDIA_API_KEY=your_key_here

# 3. OmniRoute Local Gateway (Runs locally on your machine on port 20128)
# Open http://localhost:20128 in your browser to grab your key
OMNIROUTE_API_KEY=your_key_here
```

### 🧠 Local Vector Embeddings (Optional via Ollama)

OpenCode Zenith features an intelligent memory and skill-routing engine with hybrid vector + keyword recall:

* **Default Mode (Zero Setup)**: Uses built-in BM25 keyword matching with stemming and synonym resolution. It works out of the box with zero external models or RAM usage.
* **Semantic Vector Mode (Enhanced)**: To enable deep vector similarity matching for skills and conversation recall, install [Ollama](https://ollama.com) and run:
  ```bash
  ollama pull embeddinggemma
  ```
  Zenith automatically detects Ollama on `http://127.0.0.1:11434`, warms up `embeddinggemma` (~620MB) on demand, and automatically unloads it from RAM after 20 minutes of inactivity. If Ollama is ever stopped, Zenith seamlessly falls back to BM25 keyword matching without blocking.

---

## 🕹️ Everyday Commands & Cheat Sheet

Once installed, simply open any terminal and type:
```bash
opencode
```

### Essential Slash Commands (`/command`)

| Slash Command | What It Does | When to Use It |
| :--- | :--- | :--- |
| **`/plan <task>`** | Researches the codebase, creates a step-by-step design plan with risk analysis, and **halts for your confirmation** before writing any code. | Use before starting any major feature or multi-file refactor. |
| **`/goal <task>`** | Autonomous objective loop. Keeps testing, diagnosing, and iterating autonomously until the task is verifiably complete. | Use for complex or overnight tasks where you want the agent to solve all errors without stopping. |
| **`/grill-me <idea>`** | Interactive design interview. Asks 3–5 sharp architectural questions to stress-test decisions before coding. | Use to resolve edge cases and UX trade-offs before building. |
| **`/debug <issue>`** | 4-phase systematic root-cause debugging (Evidence → Isolation → Surgical Fix → Verification). | Use whenever an error or unexpected behavior occurs in code. |
| **`/verify`** | Executes comprehensive validation across type-checks (`tsc`), linters, unit tests, and build scripts. | Use before committing or declaring work finished. |
| **`/explore <topic>`** | Fast, read-only survey of repository structure and key entry points without modifying files. | Use when exploring a new or unfamiliar codebase. |
| **`/status`** | Displays live benchmark scores, active model ladders, and router health. | Use to check current model rankings and server status. |

---

### The `#noreview` Tag (Fast Single-Turn Mode)

OpenCode includes an automated reviewer (`verify-claims`) that keeps free models from hallucinating success on coding tasks. 

For **interactive, visual, or browser tasks** where you are watching the screen yourself, you don't need automated background checks. Simply append **`#noreview`**:

```text
remote control brave to play this video for 30 seconds #noreview
open localhost:3000 in firefox and inspect the navigation bar #noreview
test the login form with sample credentials #noreview
```

* **With `#noreview`**: Executes the task, answers immediately, and cleanly stops on **Attempt 1**.
* **Without `#noreview`**: Runs full deterministic verification (ideal for code refactoring and bug fixing).

---

### 🌐 Browser Remote Control

OpenCode Zenith supports two browser operational modes:

1. **Desktop Remote Control (Real User Window)**:
   ```text
   remote control brave to search youtube for miku dayo and play the first result #noreview
   remote control chrome to open github.com/trending and summarize the top 3 repos #noreview
   ```
   *Dynamically launches your installed browser with its automation port and cleanly shuts it down when finished.*

2. **Autonomous Background Browsing (Stealth Agent)**:
   ```text
   browse the web in the background to find solutions for this docker build error
   ```
   *Uses the local stealth headless Camofox browser (port 9377) without opening any windows on your screen.*

---

## 📚 Complete Skills Catalog (90+ Skills)

For the complete directory of all 90 bundled skills with decision matrices and copy-paste prompt examples, see the [Skills Catalog Guide](docs/skills-catalog.md).

Categories include:
* **Documents & Office**: Word (`docx`), PowerPoint (`pptx`), Excel (`xlsx`), PDF tools, MarkItDown.
* **Architecture & Clean Code**: Clean code refactoring, schema generation, TypeScript best practices, ponytail minimalism.
* **Testing & Verification**: Systematic debugging, test quality, pre-completion proof enforcement.
* **Security & Audits**: OWASP security scans, blast-radius analysis, PR code reviews.
* **Data Science & ML**: Statistical analysis, feature engineering, A/B testing, machine learning workflows.
* **Creative & Media**: Programmatic film direction, image/video generation, 3D voxel CAD, Godot 4.

---

## ❓ Frequently Asked Questions

<details>
<summary><b>Can I use OpenCode Zenith with paid models like Claude 3.7 or GPT-4o?</b></summary>
Yes! While Zenith is specialized to maximize free model performance, you can add your Anthropic, OpenAI, or OpenRouter paid keys to <code>free-models.env</code> anytime.
</details>

<details>
<summary><b>Will the installer overwrite my existing tools?</b></summary>
No. The installer checks if Git, Python, Node, Bun, and ripgrep are already installed and skips them. If you already have a <code>~/.config/opencode</code> folder, it creates a timestamped backup before deploying.
</details>

<details>
<summary><b>How do I update OpenCode Zenith?</b></summary>

Updating is 100% safe, non-destructive, and automatically backs up your existing configuration. Your API keys (`free-models.env` or Windows User environment variables) are **never overwritten**.

Choose the update instructions for how you originally installed:

* **1. If you installed via the 1-Line Command**:  
  Re-run the exact same command in your terminal. It will download the latest update, upgrade the `opencode` CLI, and deploy updated skills and plugins:
  * **Linux**:
    ```bash
    curl -fsSL https://raw.githubusercontent.com/Mimogu/opencode-zenith/main/install.sh | bash
    ```
  * **Windows (PowerShell)**:
    ```powershell
    irm https://raw.githubusercontent.com/Mimogu/opencode-zenith/main/windows/install.ps1 | iex
    ```

* **2. If you installed via the Windows ZIP Download**:  
  1. Download the latest **`opencode-zenith`** ZIP from GitHub (**`<> Code`** → **Download ZIP**).
  2. Extract the `.zip` archive.
  3. Double-click `windows\install.bat`. It will recognize your existing setup and saved API keys, upgrade OpenCode, back up your old config, and apply the update without asking you to re-type keys.

* **3. If you cloned via Git**:  
  Open your terminal inside your `opencode-zenith` folder and run:
  * **Linux**:
    ```bash
    git pull && ./install.sh
    ```
  * **Windows**:
    ```cmd
    git pull
    windows\install.bat
    ```

* **What happens to my API keys and memory?**  
  All your API keys, model benchmarks, and personal configurations remain intact. A timestamped backup (`~/.config/opencode.bak.<timestamp>`) is created automatically before updating.
</details>

<details>
<summary><b>Do I need to install Ollama for local embeddings?</b></summary>

No, it is optional. OpenCode Zenith includes a high-speed built-in BM25 keyword matching engine that requires zero extra software and zero background RAM.

If you want deep semantic vector embeddings for memory and skill matching:
* The installer will detect if you have Ollama installed and offer to install Ollama and download the <code>embeddinggemma</code> model (~620MB) for you.
* Alternatively, you can install <a href="https://ollama.com">Ollama</a> anytime and run: <code>ollama pull embeddinggemma</code>. Zenith will automatically detect it on <code>http://127.0.0.1:11434</code> and activate semantic vector search.
</details>

---

## 🗑️ How to Uninstall (All 3 Methods)

Uninstallation is completely clean, transparent, and reversible. It safely stops background services (`omniroute` and `sentinel`), deletes background scheduled tasks and systemd user timers, and prompts you before removing the configuration folder (`~/.config/opencode` or `%USERPROFILE%\.config\opencode`).

> [!NOTE]
> Base runtime programs (**Git, Python, Node.js, Bun**) and the `opencode` CLI remain installed on your machine so none of your other developer tools or workflows are disrupted.

### Method 1: The 1-Line Uninstaller (Automated)

* **On Linux (Ubuntu, Debian, Arch, Fedora)**:
  Open your terminal and run:
  ```bash
  curl -fsSL https://raw.githubusercontent.com/Mimogu/opencode-zenith/main/uninstall.sh | bash
  ```
  *Stops user systemd services, removes `browser-ctl`, and prompts before cleaning `~/.config/opencode`.*

* **On Windows (PowerShell)**:
  Open PowerShell and run:
  ```powershell
  irm https://raw.githubusercontent.com/Mimogu/opencode-zenith/main/windows/uninstall.ps1 | iex
  ```
  *Stops running background processes, removes the login startup launcher and Model Lab scheduled task, and prompts before cleaning the configuration folder and environment keys.*

---

### Method 2: Windows ZIP Download (Double-Click)

1. Open your extracted `opencode-zenith` folder.
2. Double-click **`uninstall.bat`** (located in the root folder or inside `windows\uninstall.bat`).
3. Follow the interactive prompts in the window:
   * Confirms `[y/N]` before deleting `%USERPROFILE%\.config\opencode`.
   * Confirms `[y/N]` before clearing saved environment keys (`NVIDIA_API_KEY`, `OPENROUTER_API_KEY`, `OMNIROUTE_API_KEY`).

---

### Method 3: Standard Git Clone

Open your terminal inside your cloned `opencode-zenith` directory and run:

* **On Linux**:
  ```bash
  ./uninstall.sh
  ```
* **On Windows (Command Prompt or PowerShell)**:
  ```cmd
  uninstall.bat
  ```

After the uninstaller finishes, you can safely delete the cloned repository directory:
```bash
# Linux
rm -rf ~/opencode-zenith

# Windows (Command Prompt)
rmdir /s /q opencode-zenith
```

---

### Optional: Completely Removing Global CLI Packages

If you also wish to remove the OpenCode and OmniRoute CLI tools from your system:

* **Linux / macOS**:
  ```bash
  npm uninstall -g @opencode/cli omniroute
  # or if installed via bun:
  bun remove -g @opencode/cli omniroute
  ```

* **Windows**:
  Run in PowerShell or Command Prompt:
  ```cmd
  npm uninstall -g @opencode/cli omniroute
  ```
  *(Or uninstall OpenCode via Windows **Settings > Apps > Installed apps**).*

---

## 📄 License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.
