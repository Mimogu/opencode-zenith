#!/usr/bin/env python3
"""
cooldown.py — CLI over the shared cooldown ledger.

The ledger itself lives in oclib (locked read-modify-write), so the plugin,
the router, the sentinel and the lab can no longer race each other:

  cooldown.py check <model>   exit 0 if usable, 1 + remaining seconds if not
  cooldown.py fail <model> [error] [retry_after]
  cooldown.py ok <model>
  cooldown.py status
  cooldown.py clear [model]   one model, or the whole ledger
"""

from __future__ import annotations

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import oclib  # noqa: E402


def print_status() -> None:
    state = oclib.load_ledger()
    now = time.time()
    print("Model Cooldown Ledger Status:")
    print("-" * 75)
    print(f"{'Model':<40} {'Status':<15} {'Remaining':<12} {'Failures'}")
    print("-" * 75)
    if not state:
        print("  All models are healthy. No active cooldowns.")
        print("-" * 75)
        return
    for model, info in sorted(state.items()):
        rem = max(0, int(float(info.get("cooldown_until", 0) or 0) - now))
        status = "COOLING DOWN" if rem > 0 else "READY (PROBE)"
        print(f"{model:<40} {status:<15} {f'{rem}s':<12} {info.get('failures', 0)}")
    print("-" * 75)


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help"):
        print("Usage: cooldown.py [check|fail|ok|status|clear] [model] [error] [retry_after]")
        return 0

    cmd = sys.argv[1].lower()

    if cmd == "status":
        print_status()
        return 0

    if cmd == "clear":
        if len(sys.argv) > 2:
            model = sys.argv[2]
            had = model in oclib.load_ledger()
            oclib.ledger_record(model, True)  # ok drops just this model's entry, under the lock
            print(f"Cleared {model}." if had else f"{model} had no cooldown entry.")
            return 0
        oclib.atomic_write_json(oclib.LEDGER_PATH, {})
        print("Cooldown ledger cleared.")
        return 0

    if len(sys.argv) < 3:
        print("error: model argument required", file=sys.stderr)
        return 2

    model = sys.argv[2]

    if cmd == "check":
        info = oclib.load_ledger().get(model) or {}
        remaining = int(float(info.get("cooldown_until", 0) or 0) - time.time())
        if remaining > 0:
            print(f"cooldown:{remaining}", file=sys.stderr)
            return 1
        return 0

    if cmd == "fail":
        err = sys.argv[3] if len(sys.argv) > 3 else "Rate limit exceeded"
        retry = int(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4].isdigit() else None
        oclib.ledger_record(model, False, err, retry)
        info = oclib.load_ledger().get(model) or {}
        print(f"cooling_down:{int(info.get('backoff', 60))}s", file=sys.stderr)
        return 0

    if cmd == "ok":
        oclib.ledger_record(model, True)
        return 0

    print(f"unknown command: {cmd}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
