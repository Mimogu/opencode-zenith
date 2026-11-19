---
name: publishing-release
description: "Use when code is tested, verified, and ready to publish, deploy, or release. Handles semantic version bumping, changelog generation, pre-release safety checks, git tags, GitHub/GitLab releases, and package publishing (npm, PyPI, Cargo, Docker)."
---

# Publishing & Release Management

## Overview
**Core principle:** Clean tree → Full test pass → Semver bump → Changelog update → Tag & Release → Safe publication.

**Announce at start:** "I'm using the publishing-release skill to manage this release safely."

---

## Step 1: Pre-Release Safety Checklist
Never cut a release from an unverified or dirty state:
1. **Working Tree**: `git status --porcelain` must be clean (or uncommitted changes confirmed intentionally).
2. **Current Branch**: Verify you are on the primary release branch (`main`, `master`, or release branch).
3. **Up to date**: `git pull --rebase` to ensure no upstream commits are missing.
4. **Test Suite**: Run the full project test suite (`pytest`, `npm test`, `cargo test`, `go test ./...`). If tests fail, **abort immediately**.

---

## Step 2: Determine Semantic Version Bump
Inspect git commits since last tag:
```bash
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [ -n "$LAST_TAG" ]; then
  git log ${LAST_TAG}..HEAD --oneline
else
  git log --oneline -n 20
fi
```

Apply Semantic Versioning (`MAJOR.MINOR.PATCH`):
- **PATCH** (`x.y.Z+1`): Backward-compatible bug fixes, minor internal refactors, documentation.
- **MINOR** (`x.Y+1.0`): New backward-compatible features, deprecation warnings.
- **MAJOR** (`X+1.0.0`): Breaking changes, API incompatibilities, removed deprecated features.

---

## Step 3: Update Package Manifests
Update the version string in the appropriate project manifest:
- **Node.js**: `npm version <patch|minor|major> --no-git-tag-version` (or edit `package.json`).
- **Python (pyproject.toml / poetry / hatch / flit)**: Update `version = "..."` or run `poetry version <bump>`.
- **Rust (Cargo.toml)**: Update `version = "..."` in `[package]`.
- **Go**: Version tags control modules (`vX.Y.Z`).

---

## Step 4: Generate or Update Changelog
Update `CHANGELOG.md` following [Keep a Changelog](https://keepachangelog.com/) format:
```markdown
## [vX.Y.Z] - YYYY-MM-DD

### Added
- New feature description

### Fixed
- Bug fix description

### Changed / Breaking
- Breaking changes or API modifications (if any)
```

---

## Step 5: Git Commit & Annotated Tag
```bash
git add .
git commit -m "chore(release): vX.Y.Z"
git tag -a "vX.Y.Z" -m "Release vX.Y.Z"
```

---

## Step 6: Push & Forge Release
1. Push commit and tag:
   ```bash
   git push origin <branch> --follow-tags
   ```
2. If `gh` CLI is installed and authenticated:
   ```bash
   gh release create "vX.Y.Z" --title "vX.Y.Z" --notes-file <(git tag -l --format='%(contents)' "vX.Y.Z")
   ```

---

## Step 7: Registry Publishing (Safe Dry-Run First)
Always dry-run package publication before live publishing:
- **npm**: `npm publish --dry-run` then confirm before `npm publish`
- **PyPI**: `python -m build && twine check dist/*` then confirm before `twine upload dist/*`
- **Cargo**: `cargo publish --dry-run` then confirm before `cargo publish`
- **Docker**: `docker build -t <image>:vX.Y.Z .` then confirm before push
