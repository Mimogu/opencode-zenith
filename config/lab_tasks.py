"""
lab_tasks.py — graded tasks for model_lab.py.

The original seven tasks are pass/fail and every strong free model passes all of
them, so they cannot rank models. These return a score in 0..1 with partial
credit, and each one has an answer that a shortcut (grep, a heuristic, a
plausible guess) gets wrong. Graders are pure functions of the work directory
and the reply text, so tests/test_lab_tasks.py can check them without a model.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys

PY = "python" if os.name == "nt" else "python3"

# ------------------------------------------------------------- code_multi

INVENTORY = '''\
class Inventory:
    """Stock keeping. items maps name -> (qty, unit_price)."""

    def __init__(self):
        self.items = {}

    def add(self, name, qty, price):
        """Add qty units at price. Re-adding an item sums qty and keeps the newest price.
        qty must be positive, otherwise ValueError."""
        if qty <= 0:
            raise ValueError("qty must be positive")
        if name in self.items:
            old_qty, _ = self.items[name]
            self.items[name] = (old_qty + qty, price)
        else:
            self.items[name] = (qty, price)

    def remove(self, name, qty):
        """Remove qty units. Removing all remaining stock deletes the item.
        Removing more than is in stock raises ValueError."""
        have, price = self.items[name]
        if qty >= have:
            raise ValueError("not enough stock")
        if have - qty == 0:
            del self.items[name]
        else:
            self.items[name] = (have - qty, price)

    def total_value(self):
        """Sum of qty * unit_price over all items."""
        return sum(q + p for q, p in self.items.values())

    def low_stock(self, threshold):
        """Names whose qty is strictly below threshold, sorted alphabetically."""
        return sorted(n for n, (q, _) in self.items.items() if q <= threshold)


def parse_line(line):
    """Parse 'name,qty,price' (spaces allowed around fields) -> (name, int qty, float price)."""
    name, price, qty = line.split(",")
    return name.strip(), int(qty), float(price)
'''

INVENTORY_TESTS = '''\
from inventory import Inventory, parse_line

inv = Inventory()
inv.add("apple", 2, 3.0)
inv.add("pear", 4, 0.5)
assert inv.total_value() == 8.0, inv.total_value()
inv.remove("pear", 4)
assert "pear" not in inv.items
print("ok")
'''

# Hidden checks: c1-c4 fail on the shipped code, c5-c6 pass and guard against regressions.
INVENTORY_HIDDEN = r'''
import json
from inventory import Inventory, parse_line
res = {}
def check(name, fn):
    try:
        res[name] = bool(fn())
    except Exception:
        res[name] = False
def c1():
    i = Inventory(); i.add("a", 3, 1.0); i.remove("a", 3); return "a" not in i.items
def c2():
    i = Inventory(); i.add("a", 2, 3.0); i.add("b", 4, 0.5); return abs(i.total_value() - 8.0) < 1e-9
def c3():
    i = Inventory(); i.add("z", 4, 1.0); i.add("m", 5, 1.0); i.add("b", 1, 1.0); return i.low_stock(5) == ["b", "z"]
def c4():
    return parse_line("apple, 3, 0.5") == ("apple", 3, 0.5)
def c5():
    i = Inventory(); i.add("a", 2, 1.0); i.add("a", 3, 2.0); return i.items["a"] == (5, 2.0)
def c6():
    i = Inventory(); i.add("a", 1, 1.0)
    for bad in (lambda: i.remove("a", 2), lambda: i.add("b", 0, 1.0)):
        try:
            bad(); return False
        except ValueError:
            pass
    return True
for n, f in [("c1", c1), ("c2", c2), ("c3", c3), ("c4", c4), ("c5", c5), ("c6", c6)]:
    check(n, f)
print(json.dumps(res))
'''


def setup_code_multi(workdir: str) -> dict:
    with open(os.path.join(workdir, "inventory.py"), "w", encoding="utf-8", newline="\n") as f:
        f.write(INVENTORY)
    with open(os.path.join(workdir, "test_inventory.py"), "w", encoding="utf-8", newline="\n") as f:
        f.write(INVENTORY_TESTS)
    return {"tests_sha": hashlib.sha256(INVENTORY_TESTS.encode("utf-8")).hexdigest()}


def hidden_checks(workdir: str) -> dict:
    try:
        out = subprocess.run([sys.executable, "-I", "-c",
                              f"import sys; sys.path.insert(0, {workdir!r});" + INVENTORY_HIDDEN],
                             cwd=workdir, capture_output=True, text=True, timeout=20,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0)
        return json.loads(out.stdout.strip().splitlines()[-1])
    except Exception:
        return {}


def grade_code_multi(workdir: str, text: str, ctx: dict) -> tuple[float, str]:
    res = hidden_checks(workdir)
    fixed = sum(res.get(c, False) for c in ("c1", "c2", "c3", "c4"))
    intact = all(res.get(c, False) for c in ("c5", "c6"))
    score = fixed / 4 * (1.0 if intact else 0.5)
    try:
        with open(os.path.join(workdir, "test_inventory.py"), "r", encoding="utf-8", errors="replace") as f:
            content = f.read().replace("\r\n", "\n")
            if hashlib.sha256(content.encode("utf-8")).hexdigest() != ctx["tests_sha"]:
                score *= 0.5  # edited the tests instead of the code
    except OSError:
        score *= 0.5
    return round(score, 3), f"fixed={fixed}/4 intact={intact} {json.dumps(res)}"


PROMPT_CODE_MULTI = (
    "inventory.py has several bugs; its docstrings are the spec. `" + PY + " test_inventory.py` "
    "currently fails, and it does not cover every bug. Fix inventory.py so every docstring "
    "holds and the test passes. Do not edit test_inventory.py. Reply DONE when finished."
)

# ------------------------------------------------------------- review_hunt

_REVIEW_SRC = [
    ("def paginate(items, page, per_page):", False),
    ('    """Return the given 1-based page of items."""', False),
    ("    start = page * per_page", True),
    ("    return items[start:start + per_page]", False),
    ("", False),
    ("", False),
    ("def clamp(x, lo, hi):", False),
    ('    """Clamp x into [lo, hi]."""', False),
    ("    return max(lo, min(x, hi))", False),
    ("", False),
    ("", False),
    ("def is_leap(year):", False),
    ('    """Gregorian calendar leap year."""', False),
    ("    return year % 4 == 0 and year % 100 != 0", True),
    ("", False),
    ("", False),
    ("def mean(xs):", False),
    ('    """Arithmetic mean; raises ValueError on empty input."""', False),
    ("    if not xs:", False),
    ('        raise ValueError("empty")', False),
    ("    return sum(xs) / len(xs)", False),
    ("", False),
    ("", False),
    ("def last_n(xs, n):", False),
    ('    """Return the last n elements of xs, for any n >= 0."""', False),
    ("    return xs[-n:]", True),
    ("", False),
    ("", False),
    ("def dedupe(xs):", False),
    ('    """Remove duplicates, keeping first-seen order."""', False),
    ("    seen = set()", False),
    ("    return [x for x in xs if not (x in seen or seen.add(x))]", False),
]
REVIEW_CODE = "\n".join(line for line, _ in _REVIEW_SRC) + "\n"
REVIEW_BUG_LINES = {i + 1 for i, (_, bug) in enumerate(_REVIEW_SRC) if bug}


def setup_review_hunt(workdir: str) -> dict:
    with open(os.path.join(workdir, "utils.py"), "w") as f:
        f.write(REVIEW_CODE)
    return {}


def grade_review_hunt(workdir: str, text: str, ctx: dict) -> tuple[float, str]:
    nums = {int(n) for n in re.findall(r"\b\d{1,3}\b", text or "") if 0 < int(n) <= len(_REVIEW_SRC)}
    hits = len(nums & REVIEW_BUG_LINES)
    false_pos = len(nums - REVIEW_BUG_LINES)
    score = max(0.0, (hits - 0.5 * false_pos) / len(REVIEW_BUG_LINES))
    return round(score, 3), f"said={sorted(nums)} want={sorted(REVIEW_BUG_LINES)}"


PROMPT_REVIEW_HUNT = (
    "Review utils.py against each function's docstring. Some lines contain defects, some "
    "functions are correct. Reply with only the line numbers that contain a defect, "
    "comma-separated, nothing else."
)

# ------------------------------------------------------------- plan_puzzle

PLAN_TASKS = {"A": 4, "B": 2, "C": 4, "D": 6, "E": 3, "F": 1, "G": 6}
PLAN_DEPS = {"B": ["A"], "C": ["A", "B"], "D": ["A"], "F": ["E"], "G": ["B", "F"]}
PLAN_ANSWER = 14  # exhaustive search; greedy alphabetical gives 16, critical path 12, work/2 13

PROMPT_PLAN_PUZZLE = (
    "Seven jobs, durations in hours: "
    + ", ".join(f"{k}={v}" for k, v in PLAN_TASKS.items())
    + ". Dependencies (a job can start only after all listed jobs finish): "
    + "; ".join(f"{k} after {' and '.join(v)}" for k, v in PLAN_DEPS.items())
    + ". Jobs without dependencies can start at time 0. Two identical workers; each worker "
    "runs one job at a time and a job cannot be split or paused. What is the minimum number of "
    "hours to finish all jobs? Reply with only the number."
)


def grade_plan_puzzle(workdir: str, text: str, ctx: dict) -> tuple[float, str]:
    nums = re.findall(r"-?\d+(?:\.\d+)?", (text or "").strip())
    if not nums:
        return 0.0, "no number"
    val = float(nums[-1])  # a model that shows working still ends on its answer
    return (1.0 if val == PLAN_ANSWER else 0.0), f"said={val} want={PLAN_ANSWER}"

# ------------------------------------------------------------- instruction_multi

PROMPT_INSTRUCTION_MULTI = (
    "Reply with exactly three lines and nothing else (no code fence, no labels):\n"
    "Line 1: the word lantern reversed, in uppercase.\n"
    "Line 2: the sum of the integers from 1 to 20.\n"
    'Line 3: a JSON object mapping "b" to 2 and "a" to 1, with keys sorted alphabetically '
    "and no spaces anywhere."
)
INSTRUCTION_EXPECT = ["NRETNAL", "210", '{"a":1,"b":2}']


def grade_instruction_multi(workdir: str, text: str, ctx: dict) -> tuple[float, str]:
    lines = [ln.strip() for ln in (text or "").strip().splitlines() if ln.strip()]
    correct = sum(1 for i, want in enumerate(INSTRUCTION_EXPECT) if i < len(lines) and lines[i] == want)
    score = correct / 3
    if len(lines) != 3:
        score *= 0.5
    return round(score, 3), f"lines={lines[:4]}"

# ------------------------------------------------------------- explore_trace

SHOP = {
    "shop/__init__.py": "",
    "shop/cart.py": (
        "from shop.pricing import apply_discounts\n"
        "from shop.orders import place_order\n\n\n"
        "def checkout(cart, user):\n"
        "    total = apply_discounts(cart, user)\n"
        "    return place_order(user, total)\n"
    ),
    "shop/pricing.py": (
        "def apply_discounts(cart, user):\n"
        "    total = sum(item['price'] * item['qty'] for item in cart)\n"
        "    return total * 0.9 if user.get('vip') else total\n"
    ),
    "shop/orders.py": (
        "import itertools\n"
        "from shop.events import emit\n\n"
        "_ids = itertools.count(1)\n\n\n"
        "def place_order(user, total):\n"
        "    order = {'id': next(_ids), 'user': user['name'], 'total': total}\n"
        "    emit('order.placed', order)\n"
        "    return order\n"
    ),
    "shop/events.py": (
        "from shop import hooks\n\n\n"
        "def emit(kind, payload):\n"
        "    for handler in hooks.HANDLERS.get(kind, []):\n"
        "        handler(payload)\n"
    ),
    "shop/hooks.py": (
        "from shop import audit, notify\n\n"
        "HANDLERS = {\n"
        "    'order.placed': [notify.send_receipt, audit.record_order],\n"
        "    'order.refunded': [audit.write_log],\n"
        "}\n"
    ),
    "shop/notify.py": (
        "def send_receipt(order):\n"
        "    print(f\"receipt for order {order['id']}\")\n"
    ),
    "shop/audit.py": (
        "import json\n\n"
        "AUDIT_LOG = '/var/log/shop/audit.jsonl'\n\n\n"
        "def write_log(record):\n"
        "    # legacy path, only used for refunds\n"
        "    with open(AUDIT_LOG, 'a') as fh:\n"
        "        fh.write(json.dumps(record) + '\\n')\n\n\n"
        "def record_order(order):\n"
        "    _append('orders', order)\n\n\n"
        "def _append(stream, record):\n"
        "    with open(AUDIT_LOG, 'a') as fh:\n"
        "        fh.write(json.dumps({'stream': stream, **record}) + '\\n')\n"
    ),
}

PROMPT_EXPLORE_TRACE = (
    "This directory contains a small Python package `shop`. When checkout() in shop/cart.py "
    "runs, which function actually opens and writes the audit log file? Trace the real call "
    "path. Reply with only path:function, for example shop/x.py:fn."
)


def setup_explore_trace(workdir: str) -> dict:
    for rel, body in SHOP.items():
        path = os.path.join(workdir, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(body)
    return {}


def grade_explore_trace(workdir: str, text: str, ctx: dict) -> tuple[float, str]:
    t = (text or "").strip().strip("`").lower()
    if re.search(r"audit(\.py)?\s*[:.]\s*_append\b", t):
        return 1.0, t[:80]
    if re.search(r"\b_append\b", t) and "write_log" not in t:
        return 0.7, t[:80]
    if "record_order" in t and "write_log" not in t:
        return 0.3, t[:80]
    return 0.0, t[:80]

# ------------------------------------------------------------------ registry

HARD_TASKS = {
    "code_multi": {"prompt": PROMPT_CODE_MULTI, "setup": setup_code_multi,
                   "grade": grade_code_multi, "cost": 6, "timeout": 300},
    "review_hunt": {"prompt": PROMPT_REVIEW_HUNT, "setup": setup_review_hunt,
                    "grade": grade_review_hunt, "cost": 2, "timeout": 150, "files": ["utils.py"]},
    "plan_puzzle": {"prompt": PROMPT_PLAN_PUZZLE, "setup": None,
                    "grade": grade_plan_puzzle, "cost": 1, "timeout": 240},
    "instruction_multi": {"prompt": PROMPT_INSTRUCTION_MULTI, "setup": None,
                          "grade": grade_instruction_multi, "cost": 1, "timeout": 90},
    "explore_trace": {"prompt": PROMPT_EXPLORE_TRACE, "setup": setup_explore_trace,
                      "grade": grade_explore_trace, "cost": 4, "timeout": 240},
}
