---
name: agentskills
description: "Universal SDLC skill orchestrator and phase router. Automatically detects the current software development lifecycle phase (Planning, Coding, Testing, Publishing) and activates the dedicated skill at the right time. Use on all software engineering tasks to ensure disciplined execution."
---

# AgentSkills: Full SDLC Lifecycle Orchestrator

## Overview
AgentSkills organizes engineering work into four structured Software Development Lifecycle (SDLC) phases. It continuously detects the active phase of the conversation or project, automatically activating the exact right skill at the right time.

```
       ┌───────────────┐
       │   PLANNING    │  brainstorming, plans
       └───────┬───────┘
               │ (plan approved)
               ▼
       ┌───────────────┐
       │    CODING     │  ponytail, codebase-design, design-quality, subagent-driven-development
       └───────┬───────┘
               │ (code written)
               ▼
       ┌───────────────┐
       │    TESTING    │  test-quality, systematic-debugging
       └───────┬───────┘
               │ (all tests green)
               ▼
       ┌───────────────┐
       │  PUBLISHING   │  code-review, git-workflow, publishing-release
       └───────────────┘
```

---

## Autonomous Phase Detection & Skill Routing Matrix

| Phase | When Triggered / User Intent | Active Skill to Invoke | Next Phase Gate |
|---|---|---|---|
| **1. PLANNING** | New feature request, unclear requirements, architectural question, "how should we build X", "help me design Y" | • `brainstorming` (explore alternatives)<br>• `brainstorming` (grill mode) (interactive interview)<br>• `plans` (write) (formal plan doc)<br>• `plans` (execute) (plan runner) | Clear, approved task breakdown with measurable success criteria. |
| **2. CODING** | Plan approved, implementation prompt, refactoring, building UI or backend, adding endpoints | • `ponytail` (lazy senior dev: YAGNI, stdlib first, minimal LOC)<br>• `codebase-design` (architecture & clean modularity)<br>• `design-quality` (modern responsive accessible UI)<br>• `subagent-driven-development` (parallel subtasks) | Code written following minimal diffs and clean boundaries. |
| **3. TESTING** | Bug reported, feature complete, test suite run, error thrown, pre-completion check | • `test-quality` (tdd) (failing test first)<br>• `systematic-debugging` (root-cause 4-phase analysis)<br>• `test-quality` (e2e) (browser/E2E testing)<br>• `test-quality` (verify) (mandatory gate) | 100% green tests, syntax verification, zero regressions. |
| **4. PUBLISHING** | Implementation verified green, ready to merge, push PR, cut release, tag version | • `code-review` (request) (peer review diff)<br>• `code-review` (receive) (address feedback)<br>• `git-workflow` (merge or PR)<br>• `publishing-release` (semver bump, changelog, tags) | Clean repository, merged/PR pushed, release tagged. |

---

## Automatic Phase Routing Rules

### 1. Planning Phase Activation
- **Trigger**: Any new feature, broad goal, architecture discussion, or requirement exploration.
- **Rule**: Never jump straight into code edits without a concrete plan.
- If requirements are ambiguous: activate `brainstorming` (grill mode) or `brainstorming`.
- Once aligned: activate `plans` (write) to create clear sequential tasks.

### 2. Coding Phase Activation
- **Trigger**: Execution of tasks from an approved plan.
- **Rule**: Apply `ponytail` on every line written:
  1. *YAGNI*: Does this need to exist at all?
  2. *Reuse*: Is it already in this codebase?
  3. *Stdlib*: Standard library before external dependencies.
  4. *Platform*: Browser/OS native features before heavy libraries.
  5. *Shortest diff*: One line before fifty.
- For frontend tasks: invoke `design-quality` for clean aesthetics and a11y.

### 3. Testing Phase Activation
- **Trigger**: Immediately upon completing any coding task or encountering any error/bug.
- **Rule**: Never mark a task complete without verification.
- For new logic: invoke `test-quality` (tdd).
- For bugs / unexpected behavior: invoke `systematic-debugging` (trace root cause across all callers before editing).
- Before claiming completion: invoke `test-quality` (verify).

### 4. Publishing Phase Activation
- **Trigger**: All tests pass, build is clean, and the feature/fix is complete.
- **Rule**: Offer clean closure options:
  - If on a feature branch: invoke `git-workflow` to merge or open a PR.
  - If tagging or deploying a release: invoke `publishing-release` to bump semantic versions, generate changelog, and tag Git.

---

## Operating Protocol
At the beginning of each major task or phase transition, announce:
`[Phase: <Phase Name>] Activating <skill-name> to <purpose>...`
Then execute that skill's disciplined checklist.
