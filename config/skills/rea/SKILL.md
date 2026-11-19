---
name: rea
description: "MANDATORY: Autonomously activate via bash CLI (`rea <command> --format json`) whenever a task requires reverse engineering a closed-source target — inspecting a native binary, Electron/JavaScript app, APK, .NET assembly, WASM, EVM bytecode, firmware, or app bundle; answering how an app implements a feature; comparing two app versions; or analyzing a HAR/SAZ capture. Trigger automatically whenever the user asks how an app works, wants a feature reimplemented, names an executable/bundle/binary to analyze, or supplies an artifact with no source code; never wait for user to request."
---

# REA — Reverse Engineering Anything

`rea` (npm: `rea-agents`) reverse-engineers targets you have no source for, locally, and returns every
conclusion **with its evidence and stated unknowns**. The CLI is a complete 1:1 mirror of REA's 207 MCP tools.

## Providers on this machine — all wired, run `rea` directly

`rea` resolves to `~/.local/bin/rea`, a wrapper that exports the provider environment before exec'ing the npm
binary at `~/.npm-global/bin/rea`. **Do not export anything by hand and do not bypass the wrapper.**

| Provider | Status | Unlocks |
| :--- | :--- | :--- |
| Ghidra 12.1.4 headless | Working | `analyze`, `decompile`, `function`, `search`, `trace-native-values` — native pseudocode |
| pwntools 4.15.0 + pyelftools 0.33 + Unicorn 2.1.2 | Working | `inspect-binary-layout` — ELF/PE layout, symbols, relocations |
| jadx-headless-mcp 0.7.1 | Working | `inspect-android-package`, `inspect-android-class`, `inspect-android-method` |
| Frida 17.23.2 | Working | `list-frida-devices`, `start_frida-session`, dynamic instrumentation |
| Built-in static parsers | Working | Go/Rust metadata, WASM, EVM, SQLite, Electron fuses, Dart AOT |
| Hopper / IDA | Unavailable | Hopper is macOS-only; IDA needs a commercial licence. Not installable here. |

Ghidra needs JDK 21+; the system default `java` is 17, so the wrapper pins `JAVA_HOME` to JDK 27. Ghidra analysis
is ephemeral per invocation — a cancelled run discards its database, so re-running costs full re-analysis.

## Why CLI and not MCP — do not "fix" this

Do **not** register REA as an MCP server. Measured on this machine:

| Mode | Schema bytes | Tokens per request |
| :--- | :--- | :--- |
| MCP default | 3,087,755 | ~772,000 |
| MCP `compact`+`off` (minimum) | 214,608 | ~53,600 |

Even the leanest MCP profile costs more context per request than this entire agent config. The CLI costs **zero**
until a RE task actually starts. Same trade already made for `ruflo` (358 tools) and `basic-memory` (23 tools).

**`rea doctor` reports `registration:opencode config_drift`. That is expected and correct.** It means REA is not
registered as an MCP server in `opencode.json`, which is deliberate. Do not add the MCP entry to silence it —
that would add ~53.6k tokens to every request. The same applies to `registration:*` for antigravity, copilot_cli,
devin, gemini_cli, and vscode: we only use REA from this one agent.

## Output discipline — read this first

**A 7-file Electron app produces 91,336 tokens of analysis output.** Unbounded REA output will destroy the
context window. Always bound it:

```bash
# ALWAYS bound what reaches context
rea analyze-javascript-application ./app --format json --token-limit 2000
# [truncated: showing tokens 0-2000 of 91336]

# Better: extract precisely with a tool, never by reading the whole blob
rea analyze-javascript-application ./app --format json > /tmp/opencode/scratch/rea.json
python3 -c "import json; d=json.load(open('/tmp/opencode/scratch/rea.json')); print(len(d['normalized_result']['graph']['nodes']))"

# Page through a large result instead of dumping it
rea decompile ./app --token-offset 20000 --token-limit 3000

# Check cost before you emit
rea analyze ./app --token-count
```

Rules:
1. Never run a `rea` command whose output you have not bounded or redirected to a file.
2. Save to `/tmp/opencode/scratch/` first, then extract the fields you need. **Never** `cat` an evidence JSON.
3. Use `--filter-output <key.path>` to project one branch (e.g. `normalized_result.graph`).
4. `--token-count` reports the **pre-truncation** total, so it cannot price a bounded command. Trust emitted
   byte size, not the count.

## Run it in the parent agent — never delegate to a read-only subagent

`explorer`, `verifier`, `code-reviewer`, `security-reviewer`, `planner`, `architect`, `database-reviewer`, and
`docs-lookup` are sandboxed to a read-only shell allowlist. **Verified empirically:** dispatching `explorer` to
analyze a stripped ELF, it was denied `shell` for `rea`, `file`, and `strings` alike, and returned "I cannot
answer this." Its sandbox permits `cat`/`ls`/`pwd`/`git diff` only.

**Run every `rea` command yourself, in this agent.** If a read-only subagent needs REA findings, run REA first,
write the bounded result to `/tmp/opencode/scratch/`, and pass the path in the dispatch prompt. Same constraint
AGENTS.md already states for `image-gen`.

## When to activate automatically

- "How does X work?" / "reverse engineer this" / "figure out how they implemented Y" about a target you cannot read.
- A feature in a closed app the user wants rebuilt for their own project.
- Any artifact with no source: native executable (`.exe`/`.so`/`.dylib`), Electron/JS app or ASAR, APK, .NET
  assembly, WASM, firmware, SQLite DB, HAR/SAZ capture, EVM bytecode.
- Diffing two builds/app versions/captures to find what changed.
- Android device state via ADB, or Frida/GDB/Rizin dynamic instrumentation.

**Do not use REA when the source is readable.** Reading the files is cheaper and more accurate. REA earns its
cost on targets with no accessible source, on minified/bundled artifacts, and on cross-cutting traces.

## Core workflows

Always start with `rea doctor --format json` when unsure what is available, and `rea capabilities` for provider
capabilities and side effects.

### Orientation
```bash
rea doctor --format json          # provider readiness
rea capabilities                  # provider capabilities + side effects
rea inspect-artifact <path>       # all available observations + suggested next probes
rea extract-artifact <path>       # safely unpack archives/bundles
rea analyze <path>                # full analysis (Ghidra; slow, ephemeral)
rea search <path> <pattern>       # search analyzed strings and procedure names
```

### Native binaries (Ghidra)
```bash
rea analyze <path> --format json      # procedures, strings, segments
rea decompile <path> <address>        # pseudocode for one function; normalized_result is a plain string
rea function <path> <procedure>       # one complete function with evidence
rea trace-native-values <path> <proc> # bounded def-use and call dependencies
rea inspect-binary-layout <path>      # pwntools: sections, segments, symbols, relocations
rea demangle-swift <path> <symbols...>
```

Ghidra addresses come from `rea analyze` or `rea search`. On a stripped PIE the image base is reported in the
analysis (`image_base`), and section vaddrs need pwntools/ELF headers — `rea search` is usually the fastest way
to get a usable selector. `decompile` returns pseudocode as a bare string in `normalized_result`, not nested.

### JavaScript / Electron (no engine required)
```bash
rea analyze-javascript-application ./app --format json > /tmp/opencode/scratch/rea.json
rea trace-application-feature <inputJson>   # follow a literal seed through the graph
rea compare-application-versions <inputJson> # diff two builds
rea capture-electron-scenario <inputJson>    # run a bounded live scenario
rea export-web-scripts <capturePath> <outDir>
```

The result is a `JavaScriptApplicationGraph`. Nodes include `electron-main`, `electron-renderer`, `ipc-channel`,
`ipc-handler`, `javascript-module`, `browser-window`, `package`. To answer "how does feature F work", find the
`ipc-channel` node and follow its `handles`/`invokes` edges — each carries `resolution: literal` and an
`evidence` block with `authority`, `state`, and `confidence`.

### Android (jadx)
```bash
rea inspect-android-package <apk>            # manifest, no execution
rea inspect-android-class <apk> <class>
rea inspect-android-method <apk> <class> <method>
rea identify-flutter-build <apk>
rea decode-android-resources <apk>
rea inspect-dart-aot <path>
```

### Everything else
```bash
rea inspect-electron-fuses <path>
rea inspect-evm-interface <bytecode>
rea compare <leftBundle> <rightBundle>
rea evidence-export <source> <output>   # canonical, validated Evidence bundle
rea evidence-import <path>
rea list-frida-devices
```

## Evidence discipline

This is REA's entire reason to exist — do not launder its output into bare claims.

- Preserve the `evidence` block. State `authority` (`observed` vs `inferred`), `state`, and `confidence`.
- Report `limitations` and any residual `unknown` head the bundle lists. Say what you could **not** determine.
- Never upgrade `static-relationship-inference` into an observed fact. `inferred` stays labelled inferred.
- Give the location for any finding: file path, address, symbol, or node id.
- Ghidra results carry `confidence: observed`; composed workflow results carry `confidence: derived`. Report which.

## Maintenance

| Task | Command |
| :--- | :--- |
| Upgrade REA | `rea update`, then re-run `rea setup --dry-run` |
| Verify providers | `rea doctor --format json` |
| Ghidra upgrade | Replace `~/.local/share/ghidra_12.1.4_PUBLIC`, keep the path in `~/.local/bin/rea` |
| pwntools repair | `uv pip install --python ~/.local/share/rea-pwntools-venv/bin/python "pwntools==4.15.0" "pyelftools==0.33" "unicorn==2.1.2"` |
| Frida repair | npm 12 blocks frida's install script; see "Known gaps" |

If `rea` resolves to `~/.npm-global/bin/rea` instead of the wrapper, the wrapper was lost or shadowed — restore
`~/.local/bin/rea` or providers silently stop resolving.

## Known gaps

- **Frida's install script is fragile under npm 12.** It shipped broken in the npm tarball; the working prebuilt
  binding was copied in by hand. A future `rea update` or `npm install -g rea-agents` can silently revert it to
  the source-build path, which fails on a missing `package-lock.json`. Verify with
  `ls ~/.npm-global/lib/node_modules/rea-agents/node_modules/frida/build/frida_binding.node`, and repair with
  `npm install-scripts approve frida && npm install -g rea-agents --foreground-scripts`.
- `jadx-headless-mcp` is a **third-party** JAR (`1013503897/jadx-headless-mcp`, ~90 stars, `NOASSERTION` licence).
  Installed with sha256 verification against the publisher's `jadx-headless-mcp.sha256`. Re-verify before trusting
  a new build. Android analysis executes this code; prefer `inspect-android-package` when decompilation is not needed.
- Hopper and IDA cannot be provisioned on this Linux host; treat `dea`/IDA-specific tools as unavailable.
- REA analyses run **locally**. Analysis of a target may be legally or contractually sensitive; do not use it
  against third-party systems without authorization.