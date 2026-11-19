---
name: performance-profiling
description: "MANDATORY: Autonomously activate whenever diagnosing or fixing memory leaks, CPU bottlenecks, event loop lag, slow I/O queries, or OOM errors across Node.js, Bun, Python, and Go. Trigger automatically on performance degradation, lag, or memory issues; never wait for user to request."
---

# Performance Profiling & Optimization Protocol

Provides structured methods to profile and diagnose high CPU usage, heap exhaustion, event-loop lag, and slow database queries.

## 1. Node.js & Bun Memory Leak Diagnosis

- **Heap Snapshot Inspection**:
  - Run with `--inspect` or take programmatic snapshots via `v8.writeHeapSnapshot()`.
  - Look for "detached DOM trees", growing listener arrays (`emitter.on` without `.off`), and unbounded caches.
- **Event Loop Lag**:
  - Check for synchronous blocking operations (`fs.readFileSync`, heavy regex parsing, synchronous crypto).
  - Use `perf_hooks.monitorEventLoopDelay()`.

## 2. Python Profiling

- **CPU Profiling**:
  ```bash
  python3 -m cProfile -s tottime script.py | head -25
  ```
- **Memory Profiling**:
  ```bash
  python3 -m tracemalloc ...
  ```

## 3. Database Query Profiling

- **PostgreSQL**:
  ```sql
  EXPLAIN (ANALYZE, BUFFERS, VERBOSE) SELECT ...;
  ```
  - Look for `Seq Scan` on tables with >1,000 rows.
  - Check if index scans use index conditions or fall back to filtering.
- **SQLite**:
  ```sql
  EXPLAIN QUERY PLAN SELECT ...;
  ```
  - Ensure queries show `USING INDEX` instead of `SCAN TABLE`.

## Optimization Checklist
1. Replace synchronous file/crypto APIs with asynchronous streams or worker threads.
2. Add pagination / batching to queries that could return unbounded row counts.
3. Replace O(N^2) nested lookups with `Set` or `Map` index lookups (O(1)).
