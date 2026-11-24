#!/usr/bin/env python3
"""Rebuild state/model_lab.db (and state/lab_results.json) from model_lab.log.

Every lab measurement is also logged as
  [YYYY-mm-dd HH:MM:SS] [model_lab] <model> <task> PASS|FAIL [score] <latency>s '<detail>'
(older lines have no score: PASS = 1.0, FAIL = 0.0). Log times are local, the DB stores UTC.
Rows dated in the future (test runs with a fake clock) are dropped.

    python3 tools/lab_restore_from_log.py            # dry run: counts only
    python3 tools/lab_restore_from_log.py --write    # replace the DB (old one kept as model_lab.db.bak-<time>)
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sys
import time
from datetime import datetime, timezone

CFG = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, CFG)
import oclib  # noqa: E402
import model_lab  # noqa: E402

LINE = re.compile(r"^\[(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\] \[model_lab\] (\S+) +(\S+) +(PASS|FAIL) +(?:(\d+\.\d+) +)?(\d+(?:\.\d+)?)s +(.*)$")


def parse(path: str) -> list[tuple]:
    rows, now = [], datetime.now(timezone.utc)
    for line in open(path, encoding="utf-8", errors="replace"):
        m = LINE.match(line.rstrip("\n"))
        if not m:
            continue
        local, model, task, verdict, score, latency, detail = m.groups()
        ts = datetime.strptime(local, "%Y-%m-%d %H:%M:%S").astimezone().astimezone(timezone.utc)
        if ts > now:
            continue
        passed = verdict == "PASS"
        sc = float(score) if score is not None else (1.0 if passed else 0.0)
        rows.append((ts.strftime("%Y-%m-%dT%H:%M:%S"), model, task, int(passed), float(latency), 0, 0, 0.0,
                     detail.strip("'")[:500], None, sc))
    return rows


def main() -> int:
    rows = parse(os.path.join(CFG, "model_lab.log"))
    print(f"{len(rows)} measurements in model_lab.log, {len({r[1] for r in rows})} models, "
          f"{rows[0][0] if rows else '-'} .. {rows[-1][0] if rows else '-'} UTC")
    if "--write" not in sys.argv:
        return 0
    if os.path.exists(oclib.LAB_DB):
        shutil.copy2(oclib.LAB_DB, f"{oclib.LAB_DB}.bak-{time.strftime('%Y%m%d-%H%M%S')}")
        os.remove(oclib.LAB_DB)
    con = model_lab.init_db()
    con.executemany("insert into run (ts,model,task,passed,latency,tokens_in,tokens_out,cost,detail,error,score)"
                    " values (?,?,?,?,?,?,?,?,?,?,?)", rows)
    con.commit()
    matrix = model_lab.latest_matrix(con)
    facts = model_lab.model_facts(con)
    con.close()
    with open(oclib.LAB_RESULTS, "w", encoding="utf-8") as f:
        json.dump({"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "rebuilt_from_log": True, "quota_hit": False,
                   "spent": 0, "plans": {}, "scores": model_lab.scores_from_matrix(matrix), "facts": facts}, f, indent=2)
    print(f"wrote {oclib.LAB_DB} and {oclib.LAB_RESULTS}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
