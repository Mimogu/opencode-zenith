---
name: chisle
description: |
  Maximum-efficiency dev mode + audit + review + help + strategic compaction.
  Sub-commands: on, audit, review, help, compact.
  Use for maximum-efficiency dev mode, code/prose audits, code reviews, and strategic context compaction.
---
# Chisle

Maximum-efficiency dev mode: terse zero-fluff prose + YAGNI-first code.

## Sub-Commands

| Command | Description |
|---------|-------------|
| `chisle on` | Activate maximum-efficiency mode (terse prose + YAGNI ladder) |
| `chisle off` / `normal mode` | Deactivate |
| `chisle audit [path]` | One-shot efficiency audit of file/diff/repo — code bloat AND prose verbosity |
| `chisle review` | Review current diff for over-engineering, speculative abstractions |
| `chisle help` | Quick-reference card for commands |
| `chisle compact` | Strategic compaction guidance (when to compact, what survives) |

---

## chisle on — Maximum-Efficiency Mode

**Persistence:** Active every response until `chisle off` / `normal mode`.

### Prose: Maximum Signal Per Token
- Fragments OK. Drop articles, filler, pleasantries, hedging.
- Causality as arrows (X → Y). Technical terms exact.
- Code blocks unchanged. Pattern: `[thing] [action] [reason].`
- Terse ≠ incomplete: keep every decisive fact (fix, gotcha, caveat, why).
- Structure is tokens: no headings, bullets, steps, tables unless asked.
- Two tight paragraphs beat five headed sections.

### Code: The Efficiency Ladder
Stop at first rung that holds:
1. Needs to exist at all? (YAGNI) → skip
2. Already in codebase? → Reuse
3. Stdlib does it? → Use it
4. Native platform feature? → CSS over JS, DB constraint over app code
5. Installed dependency solves it? → Use it
6. Can it be one line?
7. Only then: minimum code that works

No unrequested abstractions. Deletion over addition. Shortest diff wins.

### Thinking Is Billed Too
Reasoning tokens cost the same as output. Ladder is stopping rule, not checklist.
Obvious fix → give it. Never think less about understanding the problem.

### Context Diet
- Tool output re-bills every turn. Grep for symbol, Read with offset/limit.
- Narrow at source (`ls dir` not `ls -R`, pipe through `tail`/`grep`).
- Never re-read unchanged file. Never skim what you're about to edit.

### Never Minimal About
Input validation at trust boundaries, error handling preventing data loss, security, accessibility, anything explicitly requested.

---

## chisle audit — One-Shot Efficiency Audit

**Scope:** No arg → `git diff` (staged+unstaged). Path → that file/dir. "repo" → walk tree (skip vendored/generated/node_modules/dist/lockfiles).

### What to Flag

**Code (YAGNI axis):**
- Reinvented stdlib (debounce, deep-clone, groupBy, retry, date math)
- Abstraction with one implementation (interface/factory/wrapper for single case)
- New dependency for what few lines or installed dep covers
- Config/option/flag that never varies
- Speculative "for later" scaffolding with no caller
- Verbose code where native feature (CSS, DB constraint, `<input type>`) does it

**Prose (compression axis):**
- Comments restating code (`i += 1  // increment i`)
- Docstrings/READMEs padded with filler, hedging, ceremony, duplication
- Multi-paragraph explanations where one sentence carries meaning
- Decorative tables/emoji/headings adding tokens not information
- Dead prose: TODO graveyards, stale "see also", obsolete sections

**NOT to flag:** Input validation at boundaries, error handling preventing data loss, security, accessibility, documented `// chisle:` / `// ponytail:` shortcuts, domain comments explaining *why*.

### Output Format
```
path:line  [code|prose]  <tag>: <what's bloated> → <lean replacement>. (~N lines/tokens)
```
Code findings use the same tags as `chisle review` (`delete:` `stdlib:` `native:`
`yagni:` `shrink:`); prose findings use `prose:`.

**Rank biggest cut first.** End with:
```
N findings: X code, Y prose. net: -A lines code, -B lines prose, -M deps.
Biggest win: <single highest-impact cut>.
```
Mark uncertain findings `(check)`. Boundaries as in `chisle review`.

---

## chisle review — Code Review for Over-Engineering

**Focus:** What to delete, not style nits. One finding per line, no praise.

### What to Flag
- Abstraction with one implementation (interface/factory/wrapper for single case)
- Reinvented stdlib (hand-rolled debounce, deep-clone, groupBy, date math)
- New dependency for what few lines or installed dep covers
- Config/option that never varies
- Speculative "for later" scaffolding with no caller
- Verbose code where native feature (CSS, DB constraint, `<input type>`) does it

### NOT to Flag
- Input validation at trust boundaries
- Error handling preventing data loss
- Security / accessibility code
- Anything task explicitly required

### Finding Tags
Every finding carries exactly one tag:

| Tag | Means | Replacement |
|---|---|---|
| `delete:` | dead code, unused flexibility, speculative feature | nothing |
| `stdlib:` | hand-rolled thing the stdlib ships | name the function |
| `native:` | dep/code doing what the platform already does | name the feature |
| `yagni:` | one-implementation abstraction, config nobody sets, layer with one caller | inline it |
| `shrink:` | same logic, fewer lines | show the shorter form |

### Output Format
```
path:line: <tag>: <what's over-built>. <the lazier replacement>.
```
Example:
```
cache.js:12: yagni: ApiCacheManager class for one call site. lru_cache or a plain Map.
search.js:40: stdlib: hand-rolled debounce util. setTimeout+clearTimeout inline is enough.
app.ts:3: native: moment.js for one format call. Intl.DateTimeFormat, 0 deps.
```
End: `net: -<N> lines possible.` Nothing to cut: `Lean already. Ship.`

### Boundaries
Scope is complexity only. Correctness bugs, security holes and performance are
out of scope — route those to `code-review`. Lists findings, applies nothing.
A smoke test or `assert`-based self-check is the minimum, never flag it.

---

## chisle help — Quick Reference

```
**Chisle quick reference**

What it is: maximum-efficiency dev mode. Zero-fluff prose + YAGNI-first code.

Commands:
| Command | Effect |
|---------|--------|
| /chisle | Activate |
| /chisle-audit [path] | Audit diff/file/repo for code bloat AND prose verbosity |
| /chisle-review | Review current diff for over-engineering |
| stop chisle / normal mode | Deactivate |

Natural language: "activate chisle", "chisle mode", "chislify this".

Code ladder: YAGNI → reuse → stdlib → native → installed dep → one line → minimum code.

Statusline: not wired up (the chisle-hooks statusline script was removed). Activate/deactivate with the sub-commands above.

Never minimal about: input validation, error handling preventing data loss, security, accessibility, anything explicitly asked for.
```

---

## chisle compact — Strategic Compaction

**Purpose:** Manual `/compact` at logical boundaries, not arbitrary auto-compaction.

### When to Compact (Decision Guide)
| Phase Transition | Compact? | Why |
|-----------------|----------|-----|
| Research → Planning | Yes | Research bulky; plan is distilled output |
| Planning → Implementation | Yes | Plan written; free context for code |
| Implementation → Testing | Maybe | Keep if tests reference recent code |
| Debugging → Next feature | Yes | Debug traces pollute unrelated work |
| Mid-implementation | No | Losing variable names, paths, partial state costly |
| After failed approach | Yes | Clear dead-end reasoning before new approach |

### What Survives Compaction
| Persists | Lost |
|----------|------|
| AGENTS.md instructions | Intermediate reasoning |
| Files on disk | File contents previously read |
| Memory files (the runtime memory directory) | Multi-step conversation context |
| Git state (commits, branches) | Tool call history and counts |
| Task list (if todo tools enabled) | Nuanced verbal preferences |

> **Note:** `the runtime todo-tools env flag` brings back todo tools but is per-machine. Don't assume task list survives. **Write plan to file before compacting.**

### Configuration (Env Vars)
- `COMPACT_THRESHOLD` — Tool calls before suggestion (default: 50)
- `COMPACT_CONTEXT_THRESHOLD` — Context tokens before suggestion (default: 160000 on 200k window)
- `COMPACT_CONTEXT_INTERVAL` — Additional tokens before repeat (default: 60000)
- `ECC_CONTEXT_WINDOW_TOKENS` — Override window size for large-window models

### Token Optimization Patterns
- **Trigger-table lazy loading:** Load skills only when keywords trigger
- **Context composition awareness:** AGENTS.md always loaded, skills add 1-5K each, conversation history grows, tool results add bulk
- **Duplicate detection:** Same rules in multiple locations, skills repeating AGENTS.md, overlapping skills

---

## Token Optimization Patterns (Reference)

### Trigger-Table Lazy Loading
| Trigger | Skill | Load When |
|---------|-------|-----------|
| "test", "tdd", "coverage" | test-quality:tdd | User mentions testing |
| "security", "auth", "xss" | security-review | Security work |
| "deploy", "ci/cd" | deployment-patterns | Deployment context |

### Context Composition Awareness
- AGENTS.md — Always loaded, keep lean
- Loaded skills — Each adds 1-5K tokens
- Conversation history — Grows with each exchange
- Tool results — File reads, search add bulk

### Duplicate Instruction Detection
- Same rules in the runtime rules directory and project `.claude/rules/`
- Skills repeating AGENTS.md instructions
- Multiple skills covering overlapping domains

---

## Quick Reference

| Task | Command |
|------|---------|
| Activate efficient mode | `chisle on` |
| Audit file/diff/repo | `chisle audit [path]` |
| Review diff for bloat | `chisle review` |
| Show help | `chisle help` |
| Deactivate | `chisle off` / `normal mode` |
| Compaction guidance | `chisle compact` |