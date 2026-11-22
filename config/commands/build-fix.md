---
description: Fix build and compiler errors surgically one error at a time
agent: build-error-resolver
subtask: true
---

# Build Fix Command

Fix build, compiler, or TypeScript errors with surgical minimal changes: $ARGUMENTS

## State Machine Execution Loop

Follow this strict single-error iteration loop:

1. **DIAGNOSE**: Run the diagnostic/compiler command (`npx tsc --noEmit`, `cargo check`, `pyright`, or `npm run build`).
2. **ISOLATE**: Select ONLY error #1 from the diagnostic output. Ignore all subsequent errors for now.
3. **SURGICAL FIX**:
   - Make the smallest possible change to resolve error #1 (prefer 1-3 lines).
   - Strict constraints: NO refactoring, NO architecture modifications, NO adding `any` or `@ts-ignore`, NO changes to surrounding working code.
4. **RE-CHECK**: Re-run the diagnostic command.
   - If error #1 is resolved and no new errors appeared, advance to the next remaining error.
   - If new errors were introduced, IMMEDIATELY revert the edit and choose a more localized fix.
5. **CYCLE**: Repeat steps 2-4 until all errors are eliminated.
6. **FINAL VALIDATION**: Run full project build and test suite to verify zero regressions.
