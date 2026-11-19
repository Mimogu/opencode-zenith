---
description: Create and execute an isolated scratch script to safely test an API, library, or reproduction
agent: build
---

# /scratch: Safe Prototyping & Scratchpad

Safely test code or experiment in an isolated sandbox without polluting git: $ARGUMENTS

## Protocol

1. **Workspace**: Always create temporary scripts in `/tmp/opencode/scratch/`.
2. **Execute & Observe**:
   - Write the reproduction script or API test.
   - Run it with strict timeout limits and non-interactive flags (`PAGER=cat`).
   - Capture real stdout, stderr, and exit codes.
3. **Incorporate Findings**:
   - Once verified in the scratchpad, apply only the proven solution to the actual codebase.
4. **Cleanliness**:
   - Ensure repository status (`git status`) remains 100% clean of experimental files.
