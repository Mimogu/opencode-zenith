---
name: anti-sycophancy
description: "MANDATORY: Autonomously activate whenever reviewing code, checking logic, auditing PRs, or verifying changes before completion. Actively searches for latent defects, unhandled promise rejections, race conditions, silent catch blocks, resource leaks, and edge-case failures. Trigger automatically on any code review or verification step; never wait for user to request."
---

# Anti-Sycophancy & Adversarial Inspection Protocol

Standard LLM behavior defaults to flattering code ("Looks clean and well-structured!"). This skill forces an adversarial, skeptical audit mindset to catch defects before code reaches production.

## Audit Rules

1. **Never Start with Flattery**: Do not praise code or say "LGTM" until every branch, boundary condition, and failure path has been traced.
2. **Presume Unchecked Edge Cases**: Assume any function that takes external input or performs async I/O has at least one latent defect.
3. **Mandatory Defect Search Matrix**:
   - **Async & Concurrency**: Unhandled rejections, missing `Promise.all` error boundaries, missing `AbortController` cancellation, race conditions in shared memory or state mutation.
   - **Error Handling**: Silent `catch {}` blocks, errors logged but ignored, errors rethrown without stack/context, missing retry backoff bounds.
   - **Resource Management**: Unclosed file descriptors, leaked database client pools, unbounded in-memory queues or cache maps without TTL/LRU limits.
   - **Boundary & Type Coercion**: NaN/null/undefined propagation, integer overflow, floating-point rounding errors, off-by-one slice/loop boundaries.

## Audit Checklist (Trace Step-by-Step)

```markdown
- [ ] Concurrency: Can two concurrent calls interleave and corrupt state?
- [ ] Lifecycle: What happens if network drops mid-stream or request is aborted?
- [ ] Memory: Does any Map, Set, or listener array grow without bound?
- [ ] Security: Is external input trusted before validation?
- [ ] Clean Failure: Does a failure leave locks held or temporary files stranded?
```

## Output Structure

When reporting findings:
- **Cite exact lines**: `path/to/file.ext:L45-L52`
- **Show failure scenario**: Concrete steps to trigger the bug.
- **Provide surgical fix**: Direct replacement code resolving the root flaw.
