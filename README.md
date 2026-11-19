# Opencode Zenith

An optimized, resilient configuration and distribution for [OpenCode](https://opencode.ai). Designed to run autonomously with high precision across local models, free API endpoints, and cloud inference.

Created by **Mimogu**.

---

## Highlights

- **Automated Failover Ladders**: Configured with dynamic multi-tier fallback chains. If an upstream endpoint experiences rate limits or server errors, requests cascade seamlessly down the ladder.
- **Automated Daily Benchmarking**: Runs a daily benchmark at 04:00 to test model reasoning, coding, and tool execution, dynamically adjusting the active ladder to prioritize the top-performing provider.
- **Over 90 Curated Skills**: Includes an extensive suite of specialized skills for software engineering, deep research, document editing, and multimedia. See [docs/skills-catalog.md](docs/skills-catalog.md).
- **Execution Guardrails & Review Control**: Integrates claim verification to ensure reported actions reflect actual filesystem modifications. For quick interactive or media tasks, simply append `#noreview` to bypass review delays.
- **Dynamic Desktop Browser Control**: Remotely controls installed browsers (Brave, Chrome, Firefox) via CDP or Marionette with clean process lifecycle management.

---

## Quick Installation

### Linux
Clone the repository and run the setup script:
```bash
git clone https://github.com/Mimogu/opencode-zenith.git
cd opencode-zenith
./install.sh
```

### Windows (10 / 11)
Clone or download the repository, open PowerShell or Command Prompt, and run:
```powershell
cd opencode-zenith\windows
.\install.bat
```

The installer verifies prerequisites (Git, Python, Node/Bun) and installs missing components automatically via `winget`.

---

## Configuring Providers & API Keys

After installation, update `~/.config/opencode/free-models.env` (or `%USERPROFILE%\.config\opencode\free-models.env` on Windows):

```bash
# Recommended free endpoints:
OPENROUTER_API_KEY=your_key_here    # https://openrouter.ai/keys
NVIDIA_API_KEY=your_key_here        # https://build.nvidia.com
OMNIROUTE_API_KEY=your_key_here     # http://localhost:20128
```

---

## Key Commands & Workflow

- **Slash Commands**:
  - `/plan <task>`: Deconstructs requirements and creates an implementation plan before writing code.
  - `/goal <task>`: Autonomous loop that runs until objectives are verified.
  - `/debug <issue>`: 4-phase systematic root-cause debugging.
  - `/verify`: Validates types, linters, unit tests, and builds.
  - `/status`: Checks active model ranking and system health.

- **Review Bypass**:
  Append `#noreview` to any prompt when running quick visual or browser tasks:
  ```text
  remote control brave to play this video for 30 seconds #noreview
  ```

---

## License

MIT License. See [LICENSE](LICENSE) for details.
