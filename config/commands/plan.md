---
description: Create implementation plan with change-impact blast-radius analysis
agent: planner
subtask: true
---

# Plan Command

Create a detailed implementation plan and change-impact analysis for: $ARGUMENTS

## Your Task

1. **Restate Requirements** - Clarify what needs to be built or changed.
2. **Change Impact & Blast Radius Preflight**:
   - Trace call paths: Which modules or callers depend on the files being touched?
   - Schema & API contracts: Will any public functions, types, or data structures change?
   - Test impact: Which test suites verify this area?
   - Mark any unknown dependency as `unverified`.
3. **Identify Risks** - Surface potential breaking changes, blockers, or edge cases.
4. **Atomic Step Plan** - Break down implementation into numbered, verifiable steps.
5. **Wait for Confirmation** - MUST receive user approval before modifying any files.

## Output Format

### Requirements Restatement
[Clear, concise restatement of the goal]

### Change Impact Surface
| Area | Files Affected | Blast Radius (Low/Med/High) | Test Coverage |
| :--- | :--- | :--- | :--- |

### Implementation Steps
1. [Atomic step 1 - file to edit, exact change]
2. [Atomic step 2 - test to add or update]
3. [Atomic step 3 - verification command]

### Risk Assessment
- Critical / High: [Blockers, breaking API risks]
- Medium / Low: [Edge cases, performance considerations]

**WAITING FOR CONFIRMATION**: Proceed with this plan? (yes/no/modify)

---

**CRITICAL**: Do NOT write or edit any code until the user explicitly confirms with "yes", "proceed", or similar affirmative response.
