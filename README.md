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

### 🔄 Changing or Rotating API Keys Anytime

You can view, edit, or rotate your API keys whenever you want using any of these 4 convenient methods:

1. **Re-running the Installer (Interactive Update)**:
   Simply run `./install.sh` (Linux) or `windows\install.bat` (Windows). The installer automatically detects your existing keys, displays a masked preview (e.g. `nvapi-...4a2b`), and prompts:
   ```text
   Existing NVIDIA_API_KEY detected (nvapi-...4a2b).
   NVIDIA API key (Enter = keep current key):
   ```
   - Press **Enter** to keep your current key untouched.
   - Paste a new key to instantly update `free-models.env`, your user environment, and sync it with OmniRoute.

2. **Directly Editing `free-models.env`**:
   Open the configuration file in any text editor:
   - **Linux**: `nano ~/.config/opencode/free-models.env`
   - **Windows**: `notepad $env:USERPROFILE\.config\opencode\free-models.env`
   Save your edits; all Zenith background services and plugins load this file automatically.

3. **Via the OmniRoute Dashboard**:
   - Open [http://localhost:20128](http://localhost:20128) in your browser.
   - Go to **Providers** &rarr; select **NVIDIA NIM** or **OpenRouter** to update provider credentials.
   - Go to **API Keys** to generate, rotate, or inspect OmniRoute gateway keys.

4. **Via Windows User Environment Variables (Windows)**:
   In PowerShell:
   ```powershell
   [Environment]::SetEnvironmentVariable('NVIDIA_API_KEY', 'nvapi-your-new-key', 'User')
   [Environment]::SetEnvironmentVariable('OPENROUTER_API_KEY', 'sk-or-your-new-key', 'User')
   [Environment]::SetEnvironmentVariable('OMNIROUTE_API_KEY', 'omni-your-new-key', 'User')
   ```
   *(Or search "Edit environment variables for your account" from the Windows Start menu).*

### 🧠 Local Vector Embeddings (Optional via Ollama)

OpenCode Zenith features an intelligent memory and skill-routing engine with hybrid vector + keyword recall:

* **Default Mode (Zero Setup)**: Uses built-in BM25 keyword matching with stemming and synonym resolution. It works out of the box with zero external models or RAM usage.
* **Semantic Vector Mode (Enhanced)**: To enable deep vector similarity matching for skills and conversation recall, install [Ollama](https://ollama.com) and run:
  ```bash
  ollama pull embeddinggemma
  ```
  Zenith automatically detects Ollama on `http://127.0.0.1:11434`, uses `embeddinggemma` (~620MB) on demand, and seamlessly falls back to fast BM25 keyword matching without blocking if Ollama is ever stopped or unavailable.

---

## 🕹️ Everyday Commands & Cheat Sheet

Once installed, simply open any terminal and type:
```bash
opencode
```

### Essential Slash Commands (`/command`)

| Slash Command | What It Does | When to Use It | Example Prompt |
| :--- | :--- | :--- | :--- |
| **`/plan <task>`** | Researches the codebase, creates a step-by-step design plan with risk analysis, and **halts for your confirmation** before writing any code. | Use before starting any major feature or multi-file refactor. | `/plan build a REST API endpoint for user profile pictures` |
| **`/goal <task>`** | Autonomous objective loop. Keeps testing, diagnosing, and iterating autonomously until the task is verifiably complete. | Use for complex or overnight tasks where you want the agent to solve all errors without stopping. | `/goal fix all failing tests in the auth test suite and ensure clean build` |
| **`/grill-me <idea>`** | Interactive design interview. Asks 3–5 sharp architectural questions to stress-test decisions before coding. | Use to resolve edge cases and UX trade-offs before building. | `/grill-me migrate our state management from Redux to Zustand` |
| **`/debug <issue>`** | 4-phase systematic root-cause debugging (Evidence → Isolation → Surgical Fix → Verification). | Use whenever an error or unexpected behavior occurs in code. | `/debug why does the session token expire immediately on reload?` |
| **`/verify`** | Executes comprehensive validation across type-checks (`tsc`), linters, unit tests, and build scripts. | Use before committing or declaring work finished. | `/verify ensure all TypeScript types and unit tests pass cleanly` |
| **`/explore <topic>`** | Fast, read-only survey of repository structure and key entry points without modifying files. | Use when exploring a new or unfamiliar codebase. | `/explore find where user permissions are checked in the backend` |
| **`/status`** | Displays live benchmark scores, active model ladders, and router health. | Use to check current model rankings and server status. | `/status` |

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
OpenCode Zenith bundles **90 production-grade engineering skills**. All skills operate in **Manual On-Demand Invocation Mode** — they consume **zero token budget** during normal conversation and only load instructions when you explicitly invoke them with `@<name>` (e.g. `@docx create a report from notes.txt` or `@web-research search for...`).
For the full directory of all 90 skills with decision matrices and prompt recipes, see the comprehensive [Skills Catalog Guide](docs/skills-catalog.md).

> [!TIP]
> **Why is Graphify Run On-Demand (and NOT as a Persistent MCP Server)?**  
> 1. **Token Efficiency**: Graphify exposes 10+ tool definitions (`query`, `path`, `explain`, `extract`, `cluster`, etc.). Registering it as a persistent MCP server permanently inflates every prompt turn with large schemas, consuming precious context tokens even on basic 1-line queries.  
> 2. **Multi-Project Workspace Agility**: A persistent server locks to a single static `graph.json` generated in one directory. When switching projects, it serves stale nodes. In contrast, on-demand `/graphify` analyzes the exact repository you are currently working in.  
> 3. **Cross-Platform & WinApps Portability**: Background HTTP daemons on `127.0.0.1:8081` break inside Windows WinApps/QEMU guest containers without complex network bridging. The on-demand skill runs natively across Linux, macOS, and Windows.  
> 4. **Session Stability**: Eliminates connection drops and `404 Not Found` reconnect errors caused by long-lived MCP session idle reapers.

---

### 🗂️ All 90 Available Skills & Original Repositories by Category

<details open>
<summary><b>1. Document, Office & Content Creation</b> (6 skills) — <i>Tools for generating, editing, and converting Word, PowerPoint, Excel, PDF, and Markdown files.</i></summary>

| Skill | Original GitHub Repository | When to Use / Scenario | Example Use / Prompt |
| :--- | :--- | :--- | :--- |
| **`docx`** | [anthropics/skills](https://github.com/anthropics/skills) | When you need to generate professional Word reports, transform markdown notes into formatted DOCX files, or edit existing Word docs. | `@docx create a comprehensive report from these notes and export to report.docx` |
| **`pptx`** | [anthropics/skills](https://github.com/anthropics/skills) | When you want to turn a project summary, pitch deck, or lecture into a polished PowerPoint slide presentation. | `@pptx design a 7-slide presentation summarizing our quarterly progress` |
| **`xlsx`** | [anthropics/skills](https://github.com/anthropics/skills) | When you need to export data tables to Excel, build financial models, or check existing sheets for broken formulas. | `@xlsx build a monthly budget sheet with auto-sum formulas and formatted headers` |
| **`pdf`** | [anthropics/skills](https://github.com/anthropics/skills) | When you need to read content out of a PDF file, combine multiple PDFs, or inspect a PDF's visual layout. | `@pdf extract the text and tables from document.pdf` |
| **`markitdown`** | [microsoft/markitdown](https://github.com/microsoft/markitdown) | When you have non-text files and want their full contents extracted into plain text or markdown for easy editing and analysis. | `@markitdown convert annual_report.pdf into clean markdown` |
| **`canvas-design`** | [anthropics/skills](https://github.com/anthropics/skills) | When you want visually designed certificates, posters, social media banners, or graphical cheat sheets. | `@canvas-design design a modern minimalist event poster and save as poster.png` |

</details>

<details open>
<summary><b>2. Web, Frontend & UI/UX Design</b> (7 skills) — <i>Tools and design standards for modern HTML/CSS, UI polish, design systems, and web widgets.</i></summary>

| Skill | Original GitHub Repository | When to Use / Scenario | Example Use / Prompt |
| :--- | :--- | :--- | :--- |
| **`modern-web-guidance`** | [anthropics/skills](https://github.com/anthropics/skills) | When building or styling websites and you want modern, accessible, zero-dependency CSS patterns rather than outdated hacks. | `@modern-web-guidance style this modal dialog using native HTML dialog and modern CSS` |
| **`frontend-design`** | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) | When building new web pages or apps and you want them to look premium, modern, and human-designed rather than generic AI templates. | `@frontend-design redesign the dashboard landing page with a modern dark theme` |
| **`web-design-guidelines`** | [anthropics/skills](https://github.com/anthropics/skills) | When reviewing frontend code to ensure it meets accessibility standards and best UX design practices. | `@web-design-guidelines audit index.html for accessibility and UI flaws` |
| **`web-artifacts-builder`** | [anthropics/skills](https://github.com/anthropics/skills) | When you need a quick, clickable web tool, interactive prototype, or simulation in a single HTML file. | `@web-artifacts-builder build an interactive mortgage payment calculator in a single html file` |
| **`dual-viewport-ui`** | [anthropics/skills](https://github.com/anthropics/skills) | When building 3D product visualizers, interactive maps, or CAD-like tools with side-by-side controls. | `@dual-viewport-ui create a 3D model viewer with a side property inspector panel` |
| **`design-quality`** | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) | When your UI feels cluttered, misaligned, or visually unappealing and needs a design review. | `@design-quality review the checkout page layout and suggest design improvements` |
| **`create-design-md`** | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) | When onboarding onto a frontend project or building new pages that must strictly match the existing design tokens. | `@create-design-md inspect our frontend and write a DESIGN.md design system document` |

</details>

<details open>
<summary><b>3. Software Architecture, Coding & Refactoring</b> (10 skills) — <i>Engineering principles, minimalist architectures, TypeScript practices, and code cleaners.</i></summary>

| Skill | Original GitHub Repository | When to Use / Scenario | Example Use / Prompt |
| :--- | :--- | :--- | :--- |
| **`codebase-onboarding`** | [anthropics/skills](https://github.com/anthropics/skills) | When you first open a new repository and want a fast, high-level map of how everything connects and where to start. | `@codebase-onboarding analyze this repo and explain the architecture and key components` |
| **`codebase-design`** | [anthropics/skills](https://github.com/anthropics/skills) | When refactoring messy spaghetti code or designing a new service to prevent tight coupling and high cognitive load. | `@codebase-design design a clean, decoupled service architecture for user authentication` |
| **`engineering-principles`** | [anthropics/skills](https://github.com/anthropics/skills) | When reviewing code for bloat, unnecessary abstractions, or overly complex designs. | `@engineering-principles simplify this module and remove unnecessary boilerplate` |
| **`ponytail`** | [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) | When you want to stop over-engineering and implement a feature with minimal lines and zero bloated dependencies. | `@ponytail implement this file watcher with zero third-party packages` |
| **`ponytail-debt`** | [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) | When planning a cleanup sprint and you want to know all shortcuts taken across the project. | `@ponytail-debt scan the repository and build a technical debt report` |
| **`deslop`** | [anthropics/skills](https://github.com/anthropics/skills) | When code written by AI models feels bloated, repetitive, or cluttered with unnecessary defensive checks. | `@deslop clean up this controller file and remove AI-generated boilerplate` |
| **`no-comments`** | [anthropics/skills](https://github.com/anthropics/skills) | When code is polluted with comments like '// increment i' or redundant docstrings that obscure the actual logic. | `@no-comments strip obvious comments and make the code self-documenting` |
| **`typescript-best-practices`** | [anthropics/skills](https://github.com/anthropics/skills) | When writing or refactoring TypeScript code and you want bulletproof type safety and great autocomplete. | `@typescript-best-practices refactor these API interfaces to use discriminated unions` |
| **`schema-to-type`** | [anthropics/skills](https://github.com/anthropics/skills) | When integrating with an external API and you need typed models matching the API's JSON responses. | `@schema-to-type generate TypeScript types and Zod schemas for this user API payload` |
| **`chisle`** | [anthropics/skills](https://github.com/anthropics/skills) | When working with low-context or free models and you need focused, fast edits without conversational fluff. | `@chisle refactor this script with minimal context usage` |

</details>

<details open>
<summary><b>4. Testing, Verification & Debugging</b> (6 skills) — <i>Root-cause debugging, test suites, benchmarks, and pre-completion proof enforcers.</i></summary>

| Skill | Original GitHub Repository | When to Use / Scenario | Example Use / Prompt |
| :--- | :--- | :--- | :--- |
| **`systematic-debugging`** | [anthropics/skills](https://github.com/anthropics/skills) | When an error, test failure, or unexpected bug occurs and you want to fix the real cause instead of guessing. | `@systematic-debugging investigate why the session authentication fails` |
| **`test-quality`** | [anthropics/skills](https://github.com/anthropics/skills) | When adding tests for an existing feature, fixing brittle tests, or improving overall test coverage. | `@test-quality write comprehensive unit and integration tests for user registration` |
| **`verification-before-completion`** | [anthropics/skills](https://github.com/anthropics/skills) | When you want absolute proof that everything compiles and passes tests before finishing a turn. | `@verification-before-completion run test suites and verify all checks pass` |
| **`performance-profiling`** | [anthropics/skills](https://github.com/anthropics/skills) | When your application runs slowly, consumes too much RAM, or suffers from high latency spikes. | `@performance-profiling find why the data parsing loop is taking 8 seconds` |
| **`benchmark-checklist`** | [anthropics/skills](https://github.com/anthropics/skills) | When running benchmarks or comparing two implementations to make sure the speed numbers are genuine. | `@benchmark-checklist audit our latency benchmark methodology` |
| **`correct`** | [anthropics/skills](https://github.com/anthropics/skills) | When the AI keeps making the same mistake or bad assumption on a specific project. | `@correct diagnose our recurring build failures and add guardrails against them` |

</details>

<details open>
<summary><b>5. Code Review, Auditing & Security</b> (7 skills) — <i>Deep branch audits, OWASP security checks, impact analysis, and critical objective reviews.</i></summary>

| Skill | Original GitHub Repository | When to Use / Scenario | Example Use / Prompt |
| :--- | :--- | :--- | :--- |
| **`code-review`** | [anthropics/skills](https://github.com/anthropics/skills) | When preparing a pull request or reviewing changes before merging into your main branch. | `@code-review review the changes between main and feature-branch` |
| **`thermo-nuclear-review`** | [anthropics/skills](https://github.com/anthropics/skills) | When reviewing mission-critical code changes where security or stability failures are unacceptable. | `@thermo-nuclear-review audit our payment processing branch before deployment` |
| **`thermo-nuclear-code-quality-review`** | [anthropics/skills](https://github.com/anthropics/skills) | When reviewing code for long-term health and architectural cleanliness before it becomes tech debt. | `@thermo-nuclear-code-quality-review audit this new backend module` |
| **`thermos`** | [anthropics/skills](https://github.com/anthropics/skills) | When you want the ultimate, all-angles review of a major feature branch in one pass. | `@thermos perform a comprehensive audit of the latest pull request` |
| **`owasp-security`** | [anthropics/skills](https://github.com/anthropics/skills) | When writing security-sensitive code (auth, payment, sessions, APIs) or doing a security hardening sweep. | `@owasp-security audit our API endpoints for SQL injection and auth bypass risks` |
| **`blast-radius`** | [anthropics/skills](https://github.com/anthropics/skills) | When modifying shared database schemas, common utilities, or core API contracts. | `@blast-radius check what parts of the app will be affected if we change User.id to UUID` |
| **`anti-sycophancy`** | [anthropics/skills](https://github.com/anthropics/skills) | When you want an honest, unvarnished critical assessment of an idea, design, or architecture plan. | `@anti-sycophancy critically evaluate this database migration strategy` |

</details>

<details open>
<summary><b>6. Git, DevOps, Containers & Deployment</b> (7 skills) — <i>Git workflows, merge conflict resolutions, Docker optimization, and CI/CD pipelines.</i></summary>

| Skill | Original GitHub Repository | When to Use / Scenario | Example Use / Prompt |
| :--- | :--- | :--- | :--- |
| **`git-workflow`** | [anthropics/skills](https://github.com/anthropics/skills) | When organizing git commits, setting up git branching workflows, or preparing a clean PR history. | `@git-workflow organize our staged commits into conventional commit format` |
| **`git-conflict-resolver`** | [anthropics/skills](https://github.com/anthropics/skills) | When git rebase or merge runs into gnarly file conflicts with lots of overlapping changes. | `@git-conflict-resolver resolve the merge conflict in src/app.ts` |
| **`using-git-worktrees`** | [anthropics/skills](https://github.com/anthropics/skills) | When you need to review a bug fix or test a branch without interrupting your active working directory. | `@using-git-worktrees create an isolated worktree for bugfix-auth` |
| **`docker-infra`** | [anthropics/skills](https://github.com/anthropics/skills) | When containerizing a new application, reducing huge image sizes, or configuring local development compose setups. | `@docker-infra write a multi-stage Dockerfile and docker-compose.yml for this FastAPI app` |
| **`deployment-patterns`** | [anthropics/skills](https://github.com/anthropics/skills) | When setting up continuous integration/continuous deployment (CI/CD) pipelines from scratch. | `@deployment-patterns create a GitHub Actions workflow that tests and builds our app` |
| **`publishing-release`** | [anthropics/skills](https://github.com/anthropics/skills) | When your code is tested and ready to release as a new version or package. | `@publishing-release prepare a v1.2.0 release with a generated changelog` |
| **`production-hardening`** | [anthropics/skills](https://github.com/anthropics/skills) | When taking a prototype to real production traffic and ensuring it won't crash or leak sensitive data. | `@production-hardening audit this web service for production readiness` |

</details>

<details open>
<summary><b>7. Database, Backend & Cloud</b> (4 skills) — <i>Safe migrations, high-performance SQL, query tuning, and Supabase integrations.</i></summary>

| Skill | Original GitHub Repository | When to Use / Scenario | Example Use / Prompt |
| :--- | :--- | :--- | :--- |
| **`database-migrations`** | [anthropics/skills](https://github.com/anthropics/skills) | When altering production database tables, adding foreign keys, or altering large tables without downtime. | `@database-migrations create a zero-downtime migration for adding email_verified to users table` |
| **`data-sql-queries`** | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) | When writing complex joins, window functions, CTEs, or aggregations for reports and backend queries. | `@data-sql-queries write a PostgreSQL query calculating 30-day user retention cohorts` |
| **`data-write-query`** | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) | When a database query takes too long to run and needs to be optimized for low latency. | `@data-write-query optimize this slow orders report query` |
| **`supabase`** | [supabase/cli](https://github.com/supabase/cli) | When building apps with Supabase, setting up RLS policies, configuring Auth, or debugging Supabase client libraries. | `@supabase configure Row-Level Security policies for our multi-tenant notes table` |

</details>

<details open>
<summary><b>8. Data Science, Analytics & Visualizations</b> (12 skills) — <i>Exploratory data analysis, statistics, A/B testing, dashboards, machine learning, and plotting.</i></summary>

| Skill | Original GitHub Repository | When to Use / Scenario | Example Use / Prompt |
| :--- | :--- | :--- | :--- |
| **`data-analyze`** | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) | When you have a dataset and need actionable answers, business summaries, or pattern discoveries. | `@data-analyze analyze customer_churn.csv and identify the top drivers of churn` |
| **`data-explore-data`** | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) | When you receive a new dataset and want to understand what is inside before starting any modeling or reporting. | `@data-explore-data profile sales_data.csv and summarize missing values and distributions` |
| **`data-statistical-analysis`** | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) | When you need to mathematically prove whether differences in data are statistically significant. | `@data-statistical-analysis test if conversion rates between version A and B are statistically significant` |
| **`experiment-and-inference`** | [anthropics/skills](https://github.com/anthropics/skills) | When designing an experiment or interpreting A/B test results without falling for statistical traps. | `@experiment-and-inference calculate the sample size required for a 5% detectable lift` |
| **`data-validate-data`** | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) | When you want to verify that an analysis or executive report is mathematically sound and error-free. | `@data-validate-data QA our customer segmentation findings before the executive meeting` |
| **`data-visualization`** | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) | When creating charts for reports, articles, or presentations using Python. | `@data-visualization plot monthly revenue growth using Seaborn with a clean theme` |
| **`data-create-viz`** | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) | When you want a quick visual representation of a table or series without manual plotting setup. | `@data-create-viz generate a histogram of user session durations` |
| **`data-build-dashboard`** | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) | When you want to deliver an interactive reporting tool to stakeholders that runs without requiring a backend server. | `@data-build-dashboard build an interactive sales dashboard from monthly_sales.csv` |
| **`ml-workflow`** | [anthropics/skills](https://github.com/anthropics/skills) | When building predictive models (classification, regression) without data leakage. | `@ml-workflow train an XGBoost model predicting customer churn with cross-validation` |
| **`portfolio-project-builder`** | [anthropics/skills](https://github.com/anthropics/skills) | When assembling showcase projects for job applications, resumes, or public GitHub portfolios. | `@portfolio-project-builder outline a portfolio project analyzing public bike share data` |
| **`data-science-tutor`** | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) | When learning a complex statistical or machine learning concept and you want plain-English explanations. | `@data-science-tutor explain how gradient descent works in simple terms` |
| **`data-context-extractor`** | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) | When documenting data warehouse schemas and metric calculation rules for a company or project. | `@data-context-extractor document our company data warehouse business definitions` |

</details>

<details open>
<summary><b>9. Web Research, Academic & Document Intelligence</b> (8 skills) — <i>Web queries, deep research dossiers, academic paper pipelines, and photo geolocation.</i></summary>

| Skill | Original GitHub Repository | When to Use / Scenario | Example Use / Prompt |
| :--- | :--- | :--- | :--- |
| **`web-research`** | [anthropics/skills](https://github.com/anthropics/skills) | When you need to look up current documentation, pricing, release notes, or factual answers from the internet. | `@web-research find the latest pricing and features of Supabase vs Firebase` |
| **`deep-research`** | [Imbad0202/academic-research-skills](https://github.com/Imbad0202/academic-research-skills) | When preparing a comprehensive research brief, market analysis, or deep technical investigation. | `@deep-research research state-of-the-art methods in local LLM quantization` |
| **`academic-paper`** | [Imbad0202/academic-research-skills](https://github.com/Imbad0202/academic-research-skills) | When writing or formatting academic papers, journal submissions, or conference responses. | `@academic-paper draft the literature review section for our graph neural network paper` |
| **`academic-paper-reviewer`** | [Imbad0202/academic-research-skills](https://github.com/Imbad0202/academic-research-skills) | When you want harsh, realistic feedback on an academic paper draft before submitting to a real journal or conference. | `@academic-paper-reviewer simulate a peer review of draft.pdf` |
| **`academic-pipeline`** | [Imbad0202/academic-research-skills](https://github.com/Imbad0202/academic-research-skills) | When embarking on an end-to-end research paper project from initial idea to final submission-ready PDF. | `@academic-pipeline coordinate researching, writing, and reviewing our research topic` |
| **`sr-screener`** | [anthropics/skills](https://github.com/anthropics/skills) | When conducting medical, clinical, or scientific systematic literature reviews. | `@sr-screener screen these 50 paper abstracts against our inclusion criteria` |
| **`geo-sleuth`** | [anthropics/skills](https://github.com/anthropics/skills) | When you have a photo and want to pinpoint where or at what time of day it was taken. | `@geo-sleuth identify the location of this photo photo.jpg` |
| **`documentation-lookup`** | [anthropics/skills](https://github.com/anthropics/skills) | When using new library versions, recently changed APIs, or SDKs that change frequently. | `@documentation-lookup check the latest Next.js 15 App Router caching API` |

</details>

<details open>
<summary><b>10. Autonomous Multi-Agent & Orchestration</b> (7 skills) — <i>Lifecycle planning, subagent task execution, prompt sharpening, and structured ideation.</i></summary>

| Skill | Original GitHub Repository | When to Use / Scenario | Example Use / Prompt |
| :--- | :--- | :--- | :--- |
| **`agentskills`** | [agentskills/agentskills](https://github.com/agentskills/agentskills) | When managing complex software projects across multiple stages. | `@agentskills route this new feature through planning, coding, and verification` |
| **`subagent-driven-development`** | [anthropics/skills](https://github.com/anthropics/skills) | When tackling large multi-file refactors or implementations that benefit from modular execution. | `@subagent-driven-development execute the tasks outlined in PLAN.md` |
| **`ruflo`** | [ruvnet/ruflo](https://github.com/ruvnet/ruflo) | When running multi-agent swarms using the local Ruflo command-line tool. | `@ruflo coordinate a multi-agent review of the repository` |
| **`rea`** | [rea-agent/rea](https://github.com/rea-agent/rea) | When benchmarking agent performance or evaluating system metrics. | `@rea run evaluation benchmarks on our current setup` |
| **`plans`** | [anthropics/skills](https://github.com/anthropics/skills) | When starting a non-trivial project or complex refactor and you want to align on the blueprint first. | `/plan design and implement a token-bucket rate limiter for our API` |
| **`sharpen`** | [anthropics/skills](https://github.com/anthropics/skills) | When you have a rough idea and want the AI to refine it into a crystal-clear, high-quality prompt. | `@sharpen turn my rough idea 'make a dashboard' into a detailed specification` |
| **`brainstorming`** | [anthropics/skills](https://github.com/anthropics/skills) | When exploring alternative architectural patterns or feature designs before committing to code. | `@brainstorming explore options for caching database queries` |

</details>

<details open>
<summary><b>11. Creative, Media, Gaming & 3D</b> (7 skills) — <i>AI image/video generation, programmatic film direction, Godot 4, generative art, and 3D voxels.</i></summary>

| Skill | Original GitHub Repository | When to Use / Scenario | Example Use / Prompt |
| :--- | :--- | :--- | :--- |
| **`image-gen`** | [anthropics/skills](https://github.com/anthropics/skills) | When you need an image, avatar, illustration, or visual asset generated from a prompt. | `@image-gen generate an illustration of a cozy cyberpunk coffee shop` |
| **`video-gen`** | [anthropics/skills](https://github.com/anthropics/skills) | When you need a short motion clip or visual video asset. | `@video-gen generate a 5-second video of ocean waves crashing at sunset` |
| **`lemo-opuscar`** | [anthropics/skills](https://github.com/anthropics/skills) | When creating programmatic video explainers, educational animations, or artistic short films. | `@lemo-opuscar direct a short animation explaining gravity in watercolor style` |
| **`algorithmic-art`** | [anthropics/skills](https://github.com/anthropics/skills) | When creating creative coding projects, generative backgrounds, or interactive math visualizers. | `@algorithmic-art create an interactive flow field particle simulation in p5.js` |
| **`godot4-dev`** | [godotengine/godot](https://github.com/godotengine/godot) | When developing 2D or 3D games, mechanics, or UI inside the Godot 4 engine. | `@godot4-dev create a character controller script with double-jump in GDScript` |
| **`voxel-craft-cad`** | [anthropics/skills](https://github.com/anthropics/skills) | When building procedural voxel worlds, 3D structures, or algorithmic building generators. | `@voxel-craft-cad generate a procedural spiral castle tower in voxels` |
| **`mcfunction-builder`** | [anthropics/skills](https://github.com/anthropics/skills) | When planning large Minecraft survival construction projects and calculating required stacks. | `@mcfunction-builder calculate how many shulker boxes of cobblestone are needed for a 50x50 pyramid` |

</details>

<details open>
<summary><b>12. System, Desktop, Browser & Tooling</b> (9 skills) — <i>Linux desktop control, browser automation, knowledge graphs, MCP builders, and memory tools.</i></summary>

| Skill | Original GitHub Repository | When to Use / Scenario | Example Use / Prompt |
| :--- | :--- | :--- | :--- |
| **`desktop-control`** | [anthropics/anthropic-quickstarts](https://github.com/anthropics/anthropic-quickstarts) | When you want the AI to interact directly with desktop GUI applications on your Linux desktop. | `@desktop-control take a screenshot of the active window and inspect its UI` |
| **`browser-automation`** | [microsoft/playwright](https://github.com/microsoft/playwright) | When automating web tasks, scraping dynamic web pages, or testing web application interactions. | `@browser-automation open our staging site and verify the login flow` |
| **`graphify`** | [Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify) | When exploring a huge project and you need to query caller/callee graphs or circular dependencies. | `@graphify build a knowledge graph of this repository and find the key hub nodes` |
| **`mcp-builder`** | [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) | When developing a new MCP server or tool integration to connect external services to OpenCode. | `@mcp-builder build a Python MCP server that provides weather tools` |
| **`memory-import`** | [anthropics/skills](https://github.com/anthropics/skills) | When migrating to OpenCode from another assistant and you want to bring over your personal preferences and context. | `@memory-import import my exported ChatGPT memories from memories.json` |
| **`find-skills`** | [agentskills/agentskills](https://github.com/agentskills/agentskills) | When you need a specialized capability that isn't currently installed and want to search for community skills. | `@find-skills search for skills related to Rust web development` |
| **`skill-creator`** | [anthropics/skills](https://github.com/anthropics/skills) | When building a brand new custom skill for OpenCode to automate a recurring workflow. | `@skill-creator scaffold a new skill for managing local Kubernetes clusters` |
| **`context-budget`** | [anthropics/skills](https://github.com/anthropics/skills) | When tuning your setup for low-context free models and checking where your token budget is spent. | `@context-budget audit our active configuration and report token consumption` |
| **`output-skill`** | [anthropics/skills](https://github.com/anthropics/skills) | When requesting very large outputs and you want to prevent the model from stopping halfway or truncating code. | `@output-skill ensure the full 500-line configuration file is output without truncation` |

</details>

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

### Optional: Removing the Local Embedded AI (Ollama & embeddinggemma)

If you installed Ollama and downloaded the `embeddinggemma` model (~620MB) during setup and wish to reclaim disk space or remove it completely:

1. **Delete the embedding model (`embeddinggemma`, ~620MB)**:  
   Both uninstallers (`uninstall.sh` and `uninstall.bat`) will ask if you want to delete this model automatically. You can also delete it manually anytime:
   ```bash
   ollama rm embeddinggemma
   ```

2. **Completely uninstall Ollama (if you no longer use it)**:
   * **Linux**:
     ```bash
     # Stop and disable the Ollama system service
     sudo systemctl stop ollama 2>/dev/null || true
     sudo systemctl disable ollama 2>/dev/null || true

     # Remove Ollama binaries and downloaded models
     sudo rm -f /usr/local/bin/ollama
     rm -rf ~/.ollama
     ```
   * **Windows**:
     * Open Windows **Settings > Apps > Installed apps**, locate **Ollama**, and click **Uninstall**.
     * Optionally delete the model cache folder: `%USERPROFILE%\.ollama`.

---

## 📄 License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.
