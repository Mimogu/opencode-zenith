---
name: git-workflow
description: >
  Git workflow end to end: branching strategies, commit conventions, clean history, merge vs rebase, conflict resolution, worktree isolation, and finishing a branch (merge vs PR vs keep, cleanup, remote deletion). Use when choosing a branching strategy, writing commits, tidying history before a PR, working in a worktree, deciding how to integrate a branch, or resolving conflicts.

metadata:
  origin: ECC
---

# Git Workflow Patterns

Best practices for Git version control, branching strategies, and collaborative development.

## When to Activate

- Setting up Git workflow for a new project
- Deciding on branching strategy (GitFlow, trunk-based, GitHub flow)
- Writing commit messages and PR descriptions
- Resolving merge conflicts
- Managing releases and version tags
- Onboarding new team members to Git practices

## Branching Strategies

### GitHub Flow (Simple, Recommended for Most)

Best for continuous deployment and small-to-medium teams.

```
main (protected, always deployable)
  │
  ├── feature/user-auth      → PR → merge to main
  ├── feature/payment-flow   → PR → merge to main
  └── fix/login-bug          → PR → merge to main
```

**Rules:**
- `main` is always deployable
- Create feature branches from `main`
- Open Pull Request when ready for review
- After approval and CI passes, merge to `main`
- Deploy immediately after merge

### Trunk-Based Development (High-Velocity Teams)

Best for teams with strong CI/CD and feature flags.

```
main (trunk)
  │
  ├── short-lived feature (1-2 days max)
  ├── short-lived feature
  └── short-lived feature
```

**Rules:**
- Everyone commits to `main` or very short-lived branches
- Feature flags hide incomplete work
- CI must pass before merge
- Deploy multiple times per day

### GitFlow (Complex, Release-Cycle Driven)

Best for scheduled releases and enterprise projects.

```
main (production releases)
  │
  └── develop (integration branch)
        │
        ├── feature/user-auth
        ├── feature/payment
        │
        ├── release/1.0.0    → merge to main and develop
        │
        └── hotfix/critical  → merge to main and develop
```

**Rules:**
- `main` contains production-ready code only
- `develop` is the integration branch
- Feature branches from `develop`, merge back to `develop`
- Release branches from `develop`, merge to `main` and `develop`
- Hotfix branches from `main`, merge to both `main` and `develop`

### When to Use Which

| Strategy | Team Size | Release Cadence | Best For |
|----------|-----------|-----------------|----------|
| GitHub Flow | Any | Continuous | SaaS, web apps, startups |
| Trunk-Based | 5+ experienced | Multiple/day | High-velocity teams, feature flags |
| GitFlow | 10+ | Scheduled | Enterprise, regulated industries |

## Commit Messages

### Conventional Commits Format

```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

### Types

| Type | Use For | Example |
|------|---------|---------|
| `feat` | New feature | `feat(auth): add OAuth2 login` |
| `fix` | Bug fix | `fix(api): handle null response in user endpoint` |
| `docs` | Documentation | `docs(readme): update installation instructions` |
| `style` | Formatting, no code change | `style: fix indentation in login component` |
| `refactor` | Code refactoring | `refactor(db): extract connection pool to module` |
| `test` | Adding/updating tests | `test(auth): add unit tests for token validation` |
| `chore` | Maintenance tasks | `chore(deps): update dependencies` |
| `perf` | Performance improvement | `perf(query): add index to users table` |
| `ci` | CI/CD changes | `ci: add PostgreSQL service to test workflow` |
| `revert` | Revert previous commit | `revert: revert "feat(auth): add OAuth2 login"` |

### Good vs Bad Examples

```
# BAD: Vague, no context
git commit -m "fixed stuff"
git commit -m "updates"
git commit -m "WIP"

# GOOD: Clear, specific, explains why
git commit -m "fix(api): retry requests on 503 Service Unavailable

The external API occasionally returns 503 errors during peak hours.
Added exponential backoff retry logic with max 3 attempts.

Closes #123"
```

### Commit Message Template

Create `.gitmessage` in repo root:

```
# <type>(<scope>): <subject>
# # Types: feat, fix, docs, style, refactor, test, chore, perf, ci, revert
# Scope: api, ui, db, auth, etc.
# Subject: imperative mood, no period, max 50 chars
#
# [optional body] - explain why, not what
# [optional footer] - Breaking changes, closes #issue
```

Enable with: `git config commit.template .gitmessage`

## Merge vs Rebase

### Merge (Preserves History)

```bash
# Creates a merge commit
git checkout main
git merge feature/user-auth

# Result:
# *   merge commit
# |\
# | * feature commits
# |/
# * main commits
```

**Use when:**
- Merging feature branches into `main`
- You want to preserve exact history
- Multiple people worked on the branch
- The branch has been pushed and others may have based work on it

### Rebase (Linear History)

```bash
# Rewrites feature commits onto target branch
git checkout feature/user-auth
git rebase main

# Result:
# * feature commits (rewritten)
# * main commits
```

**Use when:**
- Updating your local feature branch with latest `main`
- You want a linear, clean history
- The branch is local-only (not pushed)
- You're the only one working on the branch

### Rebase Workflow

```bash
# Update feature branch with latest main (before PR)
git checkout feature/user-auth
git fetch origin
git rebase origin/main

# Fix any conflicts
# Tests should still pass

# Force push (only if you're the only contributor)
git push --force-with-lease origin feature/user-auth
```

### When NOT to Rebase

```
# NEVER rebase branches that:
- Have been pushed to a shared repository
- Other people have based work on
- Are protected branches (main, develop)
- Are already merged

# Why: Rebase rewrites history, breaking others' work
```

## Pull Request Workflow

### PR Title Format

```
<type>(<scope>): <description>

Examples:
feat(auth): add SSO support for enterprise users
fix(api): resolve race condition in order processing
docs(api): add OpenAPI specification for v2 endpoints
```

### PR Description Template

```markdown
## What

Brief description of what this PR does.

## Why

Explain the motivation and context.

## How

Key implementation details worth highlighting.

## Testing

- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual testing performed

## Screenshots (if applicable)

Before/after screenshots for UI changes.

## Checklist

- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex logic
- [ ] Documentation updated
- [ ] No new warnings introduced
- [ ] Tests pass locally
- [ ] Related issues linked

Closes #123
```

### Code Review Checklist

**For Reviewers:**

- [ ] Does the code solve the stated problem?
- [ ] Are there any edge cases not handled?
- [ ] Is the code readable and maintainable?
- [ ] Are there sufficient tests?
- [ ] Are there security concerns?
- [ ] Is the commit history clean (squashed if needed)?

**For Authors:**

- [ ] Self-review completed before requesting review
- [ ] CI passes (tests, lint, typecheck)
- [ ] PR size is reasonable (<500 lines ideal)
- [ ] Related to a single feature/fix
- [ ] Description clearly explains the change

## Conflict Resolution

### Identify Conflicts

```bash
# Check for conflicts before merge
git checkout main
git merge feature/user-auth --no-commit --no-ff

# If conflicts, Git will show:
# CONFLICT (content): Merge conflict in src/auth/login.ts
# Automatic merge failed; fix conflicts and then commit the result.
```

### Resolve Conflicts

```bash
# See conflicted files
git status

# View conflict markers in file
# <<<<<<< HEAD
# content from main
# =======
# content from feature branch
# >>>>>>> feature/user-auth

# Option 1: Manual resolution
# Edit file, remove markers, keep correct content

# Option 2: Use merge tool
git mergetool

# Option 3: Accept one side
git checkout --ours src/auth/login.ts    # Keep main version
git checkout --theirs src/auth/login.ts  # Keep feature version

# After resolving, stage and commit
git add src/auth/login.ts
git commit
```

### Conflict Prevention Strategies

```bash
# 1. Keep feature branches small and short-lived
# 2. Rebase frequently onto main
git checkout feature/user-auth
git fetch origin
git rebase origin/main

# 3. Communicate with team about touching shared files
# 4. Use feature flags instead of long-lived branches
# 5. Review and merge PRs promptly
```

## Branch Management

### Naming Conventions

```
# Feature branches
feature/user-authentication
feature/JIRA-123-payment-integration

# Bug fixes
fix/login-redirect-loop
fix/456-null-pointer-exception

# Hotfixes (production issues)
hotfix/critical-security-patch
hotfix/database-connection-leak

# Releases
release/1.2.0
release/2024-01-hotfix

# Experiments/POCs
experiment/new-caching-strategy
poc/graphql-migration
```

### Branch Cleanup

```bash
# Delete local branches that are merged
git branch --merged main | grep -v "^\*\|main" | xargs -n 1 git branch -d

# Delete remote-tracking references for deleted remote branches
git fetch -p

# Delete local branch
git branch -d feature/user-auth  # Safe delete (only if merged)
git branch -D feature/user-auth  # Force delete

# Delete remote branch
git push origin --delete feature/user-auth
```

### Stash Workflow

```bash
# Save work in progress
git stash push -m "WIP: user authentication"

# List stashes
git stash list

# Apply most recent stash
git stash pop

# Apply specific stash
git stash apply stash@{2}

# Drop stash
git stash drop stash@{0}
```

## Release Management

### Semantic Versioning

```
MAJOR.MINOR.PATCH

MAJOR: Breaking changes
MINOR: New features, backward compatible
PATCH: Bug fixes, backward compatible

Examples:
1.0.0 → 1.0.1 (patch: bug fix)
1.0.1 → 1.1.0 (minor: new feature)
1.1.0 → 2.0.0 (major: breaking change)
```

### Creating Releases

```bash
# Create annotated tag
git tag -a v1.2.0 -m "Release v1.2.0

Features:
- Add user authentication
- Implement password reset

Fixes:
- Resolve login redirect issue

Breaking Changes:
- None"

# Push tag to remote
git push origin v1.2.0

# List tags
git tag -l

# Delete tag
git tag -d v1.2.0
git push origin --delete v1.2.0
```

### Changelog Generation

```bash
# Generate changelog from commits
git log v1.1.0..v1.2.0 --oneline --no-merges

# Or use conventional-changelog
npx conventional-changelog -i CHANGELOG.md -s
```

## Git Configuration

### Essential Configs

```bash
# User identity
git config --global user.name "Your Name"
git config --global user.email "your@email.com"

# Default branch name
git config --global init.defaultBranch main

# Pull behavior (rebase instead of merge)
git config --global pull.rebase true

# Push behavior (push current branch only)
git config --global push.default current

# Auto-correct typos
git config --global help.autocorrect 1

# Better diff algorithm
git config --global diff.algorithm histogram

# Color output
git config --global color.ui auto
```

### Useful Aliases

```bash
# Add to ~/.gitconfig
[alias]
    co = checkout
    br = branch
    ci = commit
    st = status
    unstage = reset HEAD --
    last = log -1 HEAD
    visual = log --oneline --graph --all
    amend = commit --amend --no-edit
    wip = commit -m "WIP"
    undo = reset --soft HEAD~1
    contributors = shortlog -sn
```

### Gitignore Patterns

```gitignore
# Dependencies
node_modules/
vendor/

# Build outputs
dist/
build/
*.o
*.exe

# Environment files
.env
.env.local
.env.*.local

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS files
.DS_Store
Thumbs.db

# Logs
*.log
logs/

# Test coverage
coverage/

# Cache
.cache/
*.tsbuildinfo
```

## Common Workflows

### Starting a New Feature

```bash
# 1. Update main branch
git checkout main
git pull origin main

# 2. Create feature branch
git checkout -b feature/user-auth

# 3. Make changes and commit
git add .
git commit -m "feat(auth): implement OAuth2 login"

# 4. Push to remote
git push -u origin feature/user-auth

# 5. Create Pull Request on GitHub/GitLab
```

### Updating a PR with New Changes

```bash
# 1. Make additional changes
git add .
git commit -m "feat(auth): add error handling"

# 2. Push updates
git push origin feature/user-auth
```

### Syncing Fork with Upstream

```bash
# 1. Add upstream remote (once)
git remote add upstream https://github.com/original/repo.git

# 2. Fetch upstream
git fetch upstream

# 3. Merge upstream/main into your main
git checkout main
git merge upstream/main

# 4. Push to your fork
git push origin main
```

### Undoing Mistakes

```bash
# Undo last commit (keep changes)
git reset --soft HEAD~1

# Undo last commit (discard changes)
git reset --hard HEAD~1

# Undo last commit pushed to remote
git revert HEAD
git push origin main

# Undo specific file changes
git checkout HEAD -- path/to/file

# Fix last commit message
git commit --amend -m "New message"

# Add forgotten file to last commit
git add forgotten-file
git commit --amend --no-edit
```

## Git Hooks

### Pre-Commit Hook

```bash
#!/bin/bash
# .git/hooks/pre-commit

# Run linting
npm run lint || exit 1

# Run tests
npm test || exit 1

# Check for secrets
if git diff --cached | grep -E '(password|api_key|secret)'; then
    echo "Possible secret detected. Commit aborted."
    exit 1
fi
```

### Pre-Push Hook

```bash
#!/bin/bash
# .git/hooks/pre-push

# Run full test suite
npm run test:all || exit 1

# Check for console.log statements
if git diff origin/main | grep -E 'console\.log'; then
    echo "Remove console.log statements before pushing."
    exit 1
fi
```

## Anti-Patterns

```
# BAD: Committing directly to main
git checkout main
git commit -m "fix bug"

# GOOD: Use feature branches and PRs

# BAD: Committing secrets
git add .env  # Contains API keys

# GOOD: Add to .gitignore, use environment variables

# BAD: Giant PRs (1000+ lines)
# GOOD: Break into smaller, focused PRs

# BAD: "Update" commit messages
git commit -m "update"
git commit -m "fix"

# GOOD: Descriptive messages
git commit -m "fix(auth): resolve redirect loop after login"

# BAD: Rewriting public history
git push --force origin main

# GOOD: Use revert for public branches
git revert HEAD

# BAD: Long-lived feature branches (weeks/months)
# GOOD: Keep branches short (days), rebase frequently

# BAD: Committing generated files
git add dist/
git add node_modules/

# GOOD: Add to .gitignore
```

## Quick Reference

| Task | Command |
|------|---------|
| Create branch | `git checkout -b feature/name` |
| Switch branch | `git checkout branch-name` |
| Delete branch | `git branch -d branch-name` |
| Merge branch | `git merge branch-name` |
| Rebase branch | `git rebase main` |
| View history | `git log --oneline --graph` |
| View changes | `git diff` |
| Stage changes | `git add .` or `git add -p` |
| Commit | `git commit -m "message"` |
| Push | `git push origin branch-name` |
| Pull | `git pull origin branch-name` |
| Stash | `git stash push -m "message"` |
| Undo last commit | `git reset --soft HEAD~1` |
| Revert commit | `git revert HEAD` |


---

# Finishing a Development Branch

## Overview

**Core principle:** Verify tests → Detect environment → Present options → Execute choice → Clean up.

**Announce at start:** "I'm using the git-workflow skill to complete this work."

## Step 1: Verify Tests

Run the project's full test suite (`npm test` / `cargo test` / `pytest` / `go test ./...`).

**If tests fail**, report the failures and stop — the menu comes after a green suite:

```
Tests failing (<N> failures). Must fix before completing:

[Show failures]
```

**If tests pass:** continue to Step 2.

## Step 2: Detect Environment

```bash
GIT_DIR=$(cd "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)
GIT_COMMON=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd -P)
# Capture now, while still inside the workspace — Step 5 changes directory
# before cleanup (Step 6) needs this value
WORKTREE_PATH=$(git rev-parse --show-toplevel)
```

This determines which menu to show and how cleanup works:

| State | Menu | Cleanup |
|-------|------|---------|
| `GIT_DIR == GIT_COMMON` (normal repo) | Standard 3 options | No worktree to clean up |
| `GIT_DIR != GIT_COMMON`, named branch | Standard 3 options | Provenance-based (see Step 6) |
| `GIT_DIR != GIT_COMMON`, detached HEAD | Reduced 2 options (no merge) | Externally managed — leave in place |

## Step 3: Determine Base Branch

The base branch is whatever this work forked from — usually named in the
plan, the conversation, or the branch's upstream. If it is not already
known, ask: "This branch split from <your best guess> - is that correct?"
Confirm before merging: merging into the wrong base is expensive to undo.

## Step 4: Present Options

**Normal repo and named-branch worktree — present exactly these 3 options:**

```
Implementation complete. What would you like to do?

1. Merge back to <base-branch> locally
2. Push and create a Pull Request
3. Keep the branch as-is (I'll handle it later)

Which option?
```

**Detached HEAD — present exactly these 2 options:**

```
Implementation complete. You're on a detached HEAD (externally managed workspace).

1. Push as new branch and create a Pull Request
2. Keep as-is (I'll handle it later)

Which option?
```

Present the menu exactly as written — concise, with every option coming
from the list above. Discarding the work happens only in response to your
human partner explicitly asking for it (see "If your human partner asks to
discard the work" below). Wait for their answer; the integration decision
is theirs.

## Step 5: Execute Choice

### Option 1: Merge Locally

```bash
# Get main repo root for CWD safety
MAIN_ROOT=$(git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel)
cd "$MAIN_ROOT"

# Merge first — verify success before removing anything
git checkout <base-branch>
git pull
git merge <feature-branch>

# Verify tests on merged result
<test command>
```

If tests fail on the merged result: stop, leave the worktree and branch in
place, and investigate — nothing has been pushed, so the merge is local
and recoverable.

Once the merged result is green: clean up the worktree (Step 6), then
delete the branch:

```bash
git branch -d <feature-branch>
```

### Option 2: Push and Create PR

```bash
git push -u origin <feature-branch>
# From a detached HEAD, name the new branch on the remote:
# git push origin HEAD:refs/heads/<new-branch>
```

Then create the pull/merge request against <base-branch> with the forge's
tooling — its CLI if one is available, or the creation URL most forges
print when you push — following the repo's PR template and conventions if
present, and report the URL to your human partner.

Keep the worktree — your human partner iterates on PR feedback there.

### Option 3: Keep As-Is

Report: "Keeping branch <name>. Worktree preserved at <path>."

### If your human partner asks to discard the work

This path exists only as a response to an explicit request to throw the
work away. Confirm first:

```
This will permanently delete:
- Branch <name>
- All commits: <commit-list>
- Worktree at <path>

Type 'discard' to confirm.
```

Wait for that exact confirmation. When it arrives:

```bash
MAIN_ROOT=$(git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel)
cd "$MAIN_ROOT"
```

Then clean up the worktree (Step 6) and force-delete the branch:

```bash
git branch -D <feature-branch>
```

## Step 6: Cleanup Workspace

**Runs for Option 1 and confirmed discards.** Options 2 and 3 always
preserve the worktree. Both callers have already changed directory to the
main repo root — worktree removal must run from outside the worktree —
and use the `GIT_DIR`/`GIT_COMMON`/`WORKTREE_PATH` values captured in
Step 2, from before that directory change.

**If `GIT_DIR == GIT_COMMON`:** Normal repo, no worktree to clean up. Done.

**If `WORKTREE_PATH` is under `.worktrees/` or `worktrees/`:** Superpowers
created this worktree — we own cleanup:

```bash
git worktree remove "$WORKTREE_PATH"
git worktree prune  # Self-healing: clean up any stale registrations
```

**If removal is refused** (`contains modified or untracked files`): the
worktree holds files that exist nowhere else — uncommitted plans, notes,
or scratch work. Never `--force` on your own initiative. Show your human
partner what is at stake and ask:

```bash
git -C "$WORKTREE_PATH" status --porcelain -uall
```

```
Worktree removal refused — these files were never committed:

<file list>

1. Commit them to <branch> before cleanup
2. Move them into <main repo root>
3. Delete them (unrecoverable)

Which?
```

Carry out the choice, then remove the worktree.

**Otherwise:** The host environment owns this workspace — leave it in
place. If your platform provides a workspace-exit tool, use it.

## Quick Reference

| Option | Merge | Push | Keep Worktree | Cleanup Branch |
|--------|-------|------|---------------|----------------|
| 1. Merge locally | yes | - | - | yes |
| 2. Create PR | - | yes | yes | - |
| 3. Keep as-is | - | - | yes | - |
| Discard (explicit request only) | - | - | - | yes (force) |

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Tests passed earlier this session" | Run the suite on the tree you are about to integrate. A green run only proves the tree it ran on. |
| "They obviously want it merged" | Integration is your human partner's decision. Present the menu and wait. |
| "They seem done with this feature — I'll offer to discard it" | The menu is complete as written. Discard happens only when your human partner asks for it in so many words. |
| "'Yeah, get rid of it' counts as confirmation" | Only the typed word `discard` authorizes deletion. |
| "The PR is up, so the worktree is clutter now" | PR feedback gets fixed in that worktree. It stays until the work lands. |
| "This other worktree looks stale — I'll clean it too" | Clean up only worktrees under `.worktrees/` or `worktrees/`. Everything else belongs to the host. |
| "Removal refused — `--force` is just finishing the cleanup" | The refusal means files exist only in that worktree. `--force` destroys them permanently. Show your human partner and ask. |
| "The merged-result failure is probably flaky" | A failing merged result stops everything. Branch and worktree stay put while you investigate. |
| "The base branch is obviously main" | Confirm the fork point or ask. Merging into the wrong base is expensive to undo. |
| "The push was rejected — force-push will fix it" | A rejected push means the remote moved. Investigate; force-push only on your human partner's explicit request. |
