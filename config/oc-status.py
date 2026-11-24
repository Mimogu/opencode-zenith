#!/usr/bin/env python3
"""oc-status — one-screen state of the OpenCode harness."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import oclib  # noqa: E402


def sh(cmd: list[str]) -> str:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=10, **oclib.NO_WINDOW)
        return r.stdout.strip()
    except Exception:
        return ""


def main() -> int:
    ladders = oclib.load_ladders()
    cfg = oclib.load_json(oclib.CONFIG_PATH, {}) or {}
    ledger = oclib.load_ledger()
    now = time.time()

    print(f"opencode   {sh([*oclib.OPENCODE_CMD, '--version']) or '?'}")
    pkg = oclib.package_version_info()
    up = f"update available {pkg['installed']} -> {pkg['available']}" if pkg.get("behind") \
        else f"{pkg.get('installed') or '?'} (pacman, current)"
    print(f"package    {up}")

    active = [name for name in ("opencode-sentinel", "camofox-browser", "omniroute")
              if sh(["systemctl", "--user", "is-active", name]) == "active"]
    print(f"services   {', '.join(active) or 'none active'}")
    mcp = cfg.get('mcp') or {}
    mcp = mcp.get('servers', mcp) if isinstance(mcp.get('servers'), dict) else mcp   # v2 nests them under "servers"
    print(f"mcp        {len(mcp)} configured, "
          f"{sum(1 for v in mcp.values() if isinstance(v, dict) and v.get('enabled', True))} enabled: {', '.join(sorted(mcp))}")

    # Gateway & Provider checks
    omni_ok = False
    try:
        import urllib.request
        req = urllib.request.Request("http://127.0.0.1:20128/v1/models",
                                     headers={"Authorization": "Bearer " + os.environ.get("OMNIROUTE_API_KEY", "")})
        with urllib.request.urlopen(req, timeout=2) as resp:
            omni_ok = resp.status == 200
    except Exception:
        pass
    print(f"gateway    OmniRoute: {'healthy (127.0.0.1:20128)' if omni_ok else 'UNREACHABLE'}")

    print("\ncategory   lead                                  chain")
    print("-" * 78)
    for cat in oclib.CATEGORIES:
        chain = ladders["categories"].get(cat) or []
        lead = chain[0] if chain else "-"
        fallback = next((m for m in chain if not m.startswith("opencode/")), "-")
        print(f"{cat:<10} {lead:<37} {len(chain)} models -> {fallback}")

    pinned = " [PINNED]" if cfg.get("pin_model") else ""
    hours = [m for m in ("build", "plan", "explore", "review", "quick")
             if cfg.get("model") == (ladders["categories"].get(m) or [None])[0]]
    print(f"\ndefault    {cfg.get('model')}  ({'head of ' + hours[0] if hours else 'custom'}{pinned})")
    print(f"small      {cfg.get('small_model')}")

    live = [(m, v) for m, v in ledger.items()
            if float(v.get("cooldown_until", 0) or 0) > now]
    if live:
        print("\ncooldown")
        for m, v in sorted(live):
            print(f"  {m:<50} {int(v['cooldown_until'] - now):>5}s  {v.get('last_error','')[:40]}")
    else:
        print("\ncooldown   none")

    results = oclib.load_json(oclib.LAB_RESULTS, {}) or {}
    if results:
        quota = "quota hit" if results.get("quota_hit") else "complete"
        scored = results.get("scores") or {}
        print(f"\nlast lab   {results.get('ts')}  spent={results.get('spent', '?')}  "
              f"{quota}  models={len(scored)}")
        best = sorted(scored.items(), key=lambda kv: -max(kv[1].values()))[:5]
        for model, sc in best:
            top = max(sc, key=sc.get)
            print(f"  {model:<48} best={sc[top]:5.1f} ({top})")
    else:
        print("\nlast lab   never run — ./model_lab.py --smoke")

    memory_status()
    return 0


def memory_status() -> None:
    """Memory store, indexer, extraction and context-engine latency."""
    import re
    import sqlite3
    import statistics
    import urllib.request
    db = os.path.expanduser("~/.local/share/opencode/upgraded_memory/l2_memory.db")
    print("\nmemory")
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        q = lambda sql: con.execute(sql).fetchone()[0]  # noqa: E731
        active = "superseded_by IS NULL AND deleted = 0"
        auto = q(f"SELECT count(*) FROM facts WHERE {active} AND origin = 'auto-extracted'")
        print(f"  facts      {q(f'SELECT count(*) FROM facts WHERE {active}')} active ({auto} auto-extracted), "
              f"{q(f'SELECT count(*) FROM facts f WHERE {active} AND NOT EXISTS (SELECT 1 FROM fact_vectors v WHERE v.fact_id = f.id)')} without vector")
        print(f"  sessions   {q('SELECT count(*) FROM episodes')} indexed, "
              f"{q('SELECT count(*) FROM episodes WHERE vec IS NULL')} waiting for an embedding")
        try:
            done = q("SELECT count(*) FROM extraction_log")
            last = q("SELECT max(at) FROM extraction_log")
            backlog = q("SELECT count(*) FROM episodes e WHERE NOT EXISTS (SELECT 1 FROM extraction_log x WHERE x.session_id = e.session_id)")
            when = time.strftime("%Y-%m-%d %H:%M", time.localtime(last)) if last else "never"
            print(f"  extraction {done} sessions processed, {backlog} in backlog, last {when}")
        except sqlite3.OperationalError:
            print("  extraction not started yet")
        con.close()
    except Exception as e:
        print(f"  store unreadable: {e}")
    try:
        sys.path.insert(0, os.path.join(oclib.CONFIG_DIR, "lib"))
        import agy_recall as R
        cal = R.calibration()
        m = cal.get("measured", {})
        print(f"  model      {R.EMBED_MODEL}  thresholds fact/session {cal['fact_min']}/{cal['episode_min']}"
              + (f"  (eval: hit@1 {m['hit1']:.2f}, P {m['precision']:.2f}, R {m['recall']:.2f})" if m else "  (uncalibrated defaults)"))
    except Exception:
        pass
    try:
        with urllib.request.urlopen("http://127.0.0.1:11434/api/ps", timeout=2) as r:
            loaded = [x["name"] for x in json.load(r).get("models", [])]
        print(f"  ollama     up, loaded: {', '.join(loaded) or 'none (starts/loads on first OpenCode message)'}")
    except Exception:
        print("  ollama     stopped (OpenCode starts it on demand)")
    log = os.path.join(oclib.CONFIG_DIR, "context-engine.log")
    try:
        lines = open(log, encoding="utf-8", errors="replace").read().splitlines()[-400:]
        ms = [int(x) for x in re.findall(r" (\d+)ms ", "\n".join(lines))]
        if ms:
            ms.sort()
            print(f"  decisions  last {len(ms)}: p50 {statistics.median(ms):.0f} ms, p95 {ms[int(len(ms) * .95) - 1] if len(ms) > 1 else ms[0]} ms")
        learned = sum(1 for l in lines if "learned:" in l)
        pruned = [int(x) for x in re.findall(r"pruned ~(\d+) tok", "\n".join(lines))]
        if pruned or learned:
            print(f"  savings    pruned ~{sum(pruned)} tok over {len(pruned)} turns; {learned} skill prompts learned")
    except OSError:
        pass


if __name__ == "__main__":
    sys.exit(main())
