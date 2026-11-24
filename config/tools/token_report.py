#!/usr/bin/env python3
"""Measured prompt size per model request, before vs after the context engine.

    python3 tools/token_report.py              # since = 2026-11-03 10:15 local (context-engine install)
    python3 tools/token_report.py --since 2026-11-10

Per assistant step of real (titled, non-scratch, top-level) sessions: prompt tokens = input + cache
read. Medians, not means: one 450-step session would otherwise dominate. Different models and tasks
on each side make this an indicator, not a controlled experiment.
"""
from __future__ import annotations

import json
import os
import sqlite3
import statistics
import subprocess
import sys
import time

DB = os.path.expanduser("~/.local/share/opencode/opencode.db")
DEFAULT_SINCE = "2026-11-03 10:15"


def steps(con, since_ms: int):
    q = """SELECT s.id, m.time_created, m.data FROM session_message m JOIN session_v2 s ON s.id = m.session_id
           WHERE m.type = 'assistant' AND s.parent_id IS NULL AND s.title IS NOT NULL AND s.title != ''
             AND s.directory NOT LIKE '/tmp%' AND s.directory NOT LIKE '/var/tmp/%'"""
    before, after = [], []
    for sid, created, data in con.execute(q):
        t = json.loads(data).get("tokens") or {}
        prompt = (t.get("input") or 0) + ((t.get("cache") or {}).get("read") or 0)
        if prompt <= 0:
            continue
        (after if created >= since_ms else before).append((sid, prompt, t.get("output") or 0))
    return before, after


def summary(rows) -> str:
    if not rows:
        return "no steps yet"
    p = sorted(r[1] for r in rows)
    return (f"{len(rows):6} steps in {len({r[0] for r in rows}):4} sessions | prompt tokens/step median {statistics.median(p):>8,.0f}"
            f"  p90 {p[int(len(p) * .9) - 1]:>8,.0f} | output median {statistics.median(r[2] for r in rows):>6,.0f}")


def main() -> int:
    since = sys.argv[sys.argv.index("--since") + 1] if "--since" in sys.argv else DEFAULT_SINCE
    since_ms = int(time.mktime(time.strptime(since, "%Y-%m-%d %H:%M" if ":" in since else "%Y-%m-%d")) * 1000)
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    before, after = steps(con, since_ms)
    print(f"before {since}: {summary(before)}")
    print(f"after  {since}: {summary(after)}")
    if before and after:
        b, a = statistics.median(r[1] for r in before), statistics.median(r[1] for r in after)
        print(f"median prompt change: {a - b:+,.0f} tokens/step ({(a - b) / b * 100:+.0f}%)")
    log = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "context-engine.log")
    if os.path.exists(log):
        import re
        txt = open(log, encoding="utf-8", errors="replace").read()
        pruned = [int(x) for x in re.findall(r"pruned ~(\d+) tok", txt)]
        print(f"pruning: ~{sum(pruned):,} tokens removed over {len(pruned)} turns (log)")
    try:
        out = subprocess.run(["rtk", "gain"], capture_output=True, text=True, timeout=10, stdin=subprocess.DEVNULL).stdout
        line = next((l for l in out.splitlines() if "Tokens saved" in l), "")
        print(f"rtk: {line.strip() or 'no data'}")
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
