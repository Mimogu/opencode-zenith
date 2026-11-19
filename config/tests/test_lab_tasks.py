#!/usr/bin/env python3
"""Offline checks for lab_tasks graders: the shipped fixtures score 0, a correct
answer scores 1, and the classic shortcuts score below 1. No model calls."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest

CFG = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, CFG)
import lab_tasks as L  # noqa: E402

FIXED = (L.INVENTORY
         .replace("if qty >= have:", "if qty > have:")
         .replace("sum(q + p for", "sum(q * p for")
         .replace("if q <= threshold)", "if q < threshold)")
         .replace("name, price, qty = line.split", "name, qty, price = line.split"))


class CodeMulti(unittest.TestCase):
    def run_with(self, src: str | None, edit_tests: bool = False) -> float:
        with tempfile.TemporaryDirectory() as d:
            ctx = L.setup_code_multi(d)
            if src is not None:
                with open(os.path.join(d, "inventory.py"), "w") as f:
                    f.write(src)
            if edit_tests:
                with open(os.path.join(d, "test_inventory.py"), "a") as f:
                    f.write("# nothing to see\n")
            return L.grade_code_multi(d, "DONE", ctx)[0]

    def test_shipped_scores_zero(self):
        self.assertEqual(self.run_with(None), 0.0)

    def test_reference_fix_scores_one(self):
        self.assertEqual(self.run_with(FIXED), 1.0)

    def test_partial_fix_gets_partial_credit(self):
        partial = L.INVENTORY.replace("sum(q + p for", "sum(q * p for")
        self.assertEqual(self.run_with(partial), 0.25)

    def test_editing_tests_is_penalised(self):
        self.assertEqual(self.run_with(FIXED, edit_tests=True), 0.5)

    def test_breaking_existing_behaviour_is_penalised(self):
        broken = FIXED.replace('raise ValueError("qty must be positive")', "pass")
        self.assertEqual(self.run_with(broken), 0.5)


class ReviewHunt(unittest.TestCase):
    def test_bug_lines_are_the_planted_ones(self):
        lines = L.REVIEW_CODE.splitlines()
        got = {lines[n - 1].strip() for n in L.REVIEW_BUG_LINES}
        self.assertEqual(got, {"start = page * per_page",
                               "return year % 4 == 0 and year % 100 != 0",
                               "return xs[-n:]"})

    def test_scores(self):
        want = ",".join(str(n) for n in sorted(L.REVIEW_BUG_LINES))
        self.assertEqual(L.grade_review_hunt("", want, {})[0], 1.0)
        one = str(min(L.REVIEW_BUG_LINES))
        self.assertAlmostEqual(L.grade_review_hunt("", one, {})[0], 1 / 3, places=2)
        # flagging every line is not a strategy
        every = ",".join(str(n) for n in range(1, 33))
        self.assertEqual(L.grade_review_hunt("", every, {})[0], 0.0)


class PlanPuzzle(unittest.TestCase):
    def test_answer_is_the_true_optimum(self):
        import functools
        import itertools
        T, DEP = L.PLAN_TASKS, {k: set(v) for k, v in L.PLAN_DEPS.items()}

        @functools.lru_cache(None)
        def solve(done, running, t):
            if len(done) == len(T):
                return t
            best, free, started = 10 ** 9, 2 - len(running), {x for _, x in running}
            ready = [x for x in T if x not in done and x not in started and DEP.get(x, set()) <= done]
            for k in range(min(free, len(ready)), -1, -1):
                for sub in itertools.combinations(sorted(ready), k):
                    run = tuple(sorted(running + tuple((t + T[x], x) for x in sub)))
                    if not run:
                        continue
                    nt = run[0][0]
                    fin = frozenset(x for f, x in run if f == nt)
                    best = min(best, solve(done | fin, tuple(r for r in run if r[0] != nt), nt))
            return best

        self.assertEqual(solve(frozenset(), (), 0), L.PLAN_ANSWER)

    def test_grading(self):
        self.assertEqual(L.grade_plan_puzzle("", "14", {})[0], 1.0)
        self.assertEqual(L.grade_plan_puzzle("", "Critical path is 12, but with 2 workers: 14", {})[0], 1.0)
        for shortcut in ("12", "13", "16"):
            self.assertEqual(L.grade_plan_puzzle("", shortcut, {})[0], 0.0)


class InstructionMulti(unittest.TestCase):
    def test_grading(self):
        self.assertEqual(L.grade_instruction_multi("", 'NRETNAL\n210\n{"a":1,"b":2}', {})[0], 1.0)
        self.assertAlmostEqual(L.grade_instruction_multi("", 'NRETNAL\n210\n{"a": 1, "b": 2}', {})[0], 2 / 3, places=2)
        self.assertLess(L.grade_instruction_multi("", 'Here you go:\nNRETNAL\n210\n{"a":1,"b":2}', {})[0], 0.5)


class ExploreTrace(unittest.TestCase):
    def test_grading(self):
        self.assertEqual(L.grade_explore_trace("", "shop/audit.py:_append", {})[0], 1.0)
        self.assertEqual(L.grade_explore_trace("", "`shop/audit.py:_append`", {})[0], 1.0)
        self.assertEqual(L.grade_explore_trace("", "shop/audit.py:write_log", {})[0], 0.0)
        self.assertEqual(L.grade_explore_trace("", "shop/audit.py:record_order", {})[0], 0.3)

    def test_fixture_really_reaches_append(self):
        with tempfile.TemporaryDirectory() as d:
            L.setup_explore_trace(d)
            log = os.path.join(d, "audit.jsonl")
            code = ("import sys; sys.path.insert(0, %r); import shop.audit as a; a.AUDIT_LOG = %r;"
                    "from shop.cart import checkout;"
                    "checkout([{'price': 2, 'qty': 3}], {'name': 'x'})") % (d, log)
            import subprocess
            subprocess.run([sys.executable, "-I", "-c", code], check=True, capture_output=True)
            with open(log) as f:
                self.assertIn('"stream": "orders"', f.read())


if __name__ == "__main__":
    unittest.main(verbosity=1)
