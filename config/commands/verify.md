---
description: Run 6-phase mechanical verification pipeline with raw exit codes
agent: verifier
subtask: true
---

# Verify Command

Run mechanical verification loop to validate recent work: $ARGUMENTS

## Verification Protocol

Execute the 6-phase verification sequence using real shell commands with `set -o pipefail`. Do not guess or skip phases.

1. **Phase 1: Build Verification**
   - Run the project build command (`npm run build`, `bun run build`, `cargo build`, or `make`).
2. **Phase 2: Static Type Check**
   - Run type analysis (`npx tsc --noEmit`, `pyright`, or `mypy`).
3. **Phase 3: Linter & Formatting**
   - Run linter checks (`npm run lint`, `eslint`, `ruff check`, or `cargo clippy`).
4. **Phase 4: Test Suite & Coverage**
   - Run test suite (`bun test`, `npm test`, `pytest`, or `cargo test`). Confirm all test cases pass.
5. **Phase 5: Security Grep**
   - Grep git diff for accidental secret leaks, debug `console.log`, disabled auth checks, or insecure deserialization.
6. **Phase 6: Diff Review**
   - Inspect `git diff --stat` and `git diff` to confirm diff is surgical and contains no unintended changes.

## Verification Gate Requirement

Every phase must pass with exit code 0. Do NOT declare PASS if any command was skipped or emitted unresolved errors. Rationalizations such as "tests assumed to pass" or "compilation should succeed" are strictly rejected.

Output a final table:

| Phase | Command Executed | Exit Code | Status | Notes |
|-------|------------------|-----------|--------|-------|
| 1. Build | `<command>` | `0` | PASS/FAIL | ... |
| 2. Typecheck | `<command>` | `0` | PASS/FAIL | ... |
| 3. Lint | `<command>` | `0` | PASS/FAIL | ... |
| 4. Tests | `<command>` | `0` | PASS/FAIL | ... |
| 5. Security | `<command>` | `0` | PASS/FAIL | ... |
| 6. Diff | `git diff` | `0` | PASS/FAIL | ... |

Final Status: PASS if all exit codes are 0; otherwise FAIL with actionable remediation steps.
