---
name: git-conflict-resolver
description: "MANDATORY: Autonomously activate whenever encountering git merge conflicts, rebase halts, cherry-pick collisions, or conflict markers (<<<<<<< HEAD). Analyzes intent of incoming and current branches, synthesizes conflict-free resolutions, and validates builds. Trigger automatically on git conflicts; never wait for user to request."
---

# Git Conflict & Rebase Resolver Protocol

Guides the agent to systematically resolve git conflicts, cherry-pick collisions, and rebase halts without losing changes or corrupting git history.

## 4-Step Resolution Lifecycle

### Step 1: Diagnose Conflict Surface
Run:
```bash
git status --short
git diff --name-only --diff-filter=U
```
Identify each unmerged file.

### Step 2: Understand Divergence
For each conflicted file, analyze the 3 sides:
1. `<<<<<<< HEAD` (Current / Target branch state)
2. `||||||| base` (Common ancestor, if `merge.conflictstyle=diff3` or `zdiff3` enabled)
3. `>>>>>>> incoming` (Incoming commit / Branch state)

Determine:
- Did both branches edit the same lines for different features?
- Did one branch rename or refactor while the other modified logic?
- Did one branch delete a method that the other called?

### Step 3: Synthesize & Clean
- Combine the logic so that **both intentions are preserved**.
- Remove conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`).
- Avoid blindly picking `--ours` or `--theirs` unless one side completely supersedes the other.

### Step 4: Validate Before Continuing
Always run compiler checks or tests:
```bash
# Verify syntax / types / tests
npm run build || python -m py_compile ... || cargo check
git add <resolved-files>
git rebase --continue  # or git merge --continue
```
If tests fail, fix the integration bug before advancing the rebase.
