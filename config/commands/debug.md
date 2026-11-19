---
description: Systematic 4-phase root-cause debugging workflow
agent: build
---

# /debug: Systematic Root-Cause Debugging

Diagnose and repair the reported issue: $ARGUMENTS

## The 4-Phase Debugging Protocol

### Phase 1: Intake & Evidence Gathering
- Capture the exact error message, stack trace, or unexpected behavior.
- Reproduce the failure with a minimal test or script before touching any application code.

### Phase 2: Root Cause Isolation
- Trace actual execution flow, variables, and state leading up to the failure point.
- Differentiate between the symptom and the actual underlying flaw.
- Never guess or apply speculative trial-and-error edits.

### Phase 3: Surgical Fix
- Apply the minimal, cleanest fix directly at the root cause.
- Avoid introducing unrequested architectural refactors or dependency churn.

### Phase 4: Verification & Regression Gate
- Re-run the reproduction to confirm the issue is resolved.
- Run the full test suite to guarantee zero regressions.
- Dispatch the `verifier` subagent to check for boundary cases and logic inversions.
