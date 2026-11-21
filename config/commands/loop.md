---
description: Run an autonomous execution loop or schedule a recurring cadence (/loop [interval] <task>, or /loop stop)
agent: build
---

# /loop: Autonomous Loop & Periodic Execution

Manage and execute recurring or self-paced autonomous tasks: $ARGUMENTS

## Mission Protocol

1. **Parse Arguments ($ARGUMENTS)**:
   - **Stop Request (`stop`)**:
     Execute `opencode-loop stop`. Report that any active recurring loops have been stopped.
   - **Status Request (`status`)**:
     Execute `opencode-loop status` and display current loop state, interval, and run history.
   - **Interval Cadence (`/loop <interval> <task>`, e.g., `/loop 30m <task>`, `/loop 5m <task>`, `/loop 1h <task>`)**:
     The user wants this task executed repeatedly on a fixed timer (e.g., periodic health scan, repository watcher, metric logger).
     Set up and launch the recurring loop via:
     `opencode-loop start <interval> "<task>"`
     Confirm the scheduled interval, process ID, and report log location (`~/.local/state/opencode/loop.log`).
   - **Self-Paced Autonomous Mode (`<task>` without interval)**:
     Execute the objective thoroughly and continuously in the current session:
     - Execute all steps via tool calls without yielding intermediate conversational text until verified complete.
     - Verify completion objectively with test/diagnostic commands.

2. **Execution Rules**:
   - For recurring tasks, always use `opencode-loop` to manage the background cadence.
   - For self-paced single tasks, never stop or yield on plain text until the goal is achieved.
   - Append `#noreview` when running fast interactive cycles.
