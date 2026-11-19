#!/usr/bin/env python3
"""
Offline tests for model_lab.py and the quota helpers. No model calls, so these
never spend the shared free-tier allowance.

    python3 ~/.config/opencode/tests/test_lab.py
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import time as real_time
import unittest

CFG = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, CFG)
import oclib  # noqa: E402
import model_lab  # noqa: E402

_REAL_TIME = model_lab.time


class FakeTime:
    """Deterministic clock for plan/persist/matrix tests."""

    def __init__(self, now: float):
        self.now = now

    def time(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += seconds

    def gmtime(self, t=None):
        return real_time.gmtime(self.now if t is None else t)

    def strftime(self, fmt, t=None):
        return real_time.strftime(fmt, self.gmtime() if t is None else t)


# Isolated at import, not in setUpModule: a runner that skips module fixtures (loading one test case
# directly) used to run against the real state/ — 2026-11-17 reset_db() deleted the real model_lab.db
# and lab_results.json and filled the DB with 116 fake future-dated rows.
_TMP = tempfile.mkdtemp(prefix="labtest-")
oclib.STATE_DIR = _TMP
oclib.LAB_DB = os.path.join(_TMP, "lab.db")
oclib.LAB_RESULTS = os.path.join(_TMP, "lab_results.json")
oclib.LADDERS_PATH = os.path.join(_TMP, "ladders.json")
oclib.LEDGER_PATH = os.path.join(_TMP, "ledger.json")
oclib.CONFIG_DIR = _TMP  # oclib.log writes <CONFIG_DIR>/<name>.log; keep test rounds out of the real log
shutil.copy(os.path.join(CFG, "ladders.json"), oclib.LADDERS_PATH)


def setUpModule() -> None:
    model_lab.time = FakeTime(real_time.time())


def tearDownModule() -> None:
    model_lab.time = _REAL_TIME
    if _TMP:
        shutil.rmtree(_TMP, ignore_errors=True)


def read_results() -> dict:
    with open(oclib.LAB_RESULTS, encoding="utf-8") as f:
        return json.load(f)


def reset_db() -> None:
    for p in (oclib.LAB_DB, oclib.LAB_RESULTS):
        assert p.startswith(_TMP), f"refusing to delete {p}: not the test's temp dir"
    if os.path.exists(oclib.LAB_DB):
        os.remove(oclib.LAB_DB)
    if os.path.exists(oclib.LAB_RESULTS):
        os.remove(oclib.LAB_RESULTS)


def fake_ok(model, task, workdir):
    return {"passed": True, "detail": "ok", "latency": 1.0,
            "usage": {"input": 10, "output": 2, "cost": 0.0,
                      "messages": model_lab.TASK_COST[task]},
            "error": "", "error_kind": ""}


class RotationTest(unittest.TestCase):
    def test_rotation_covers_every_pair_within_budget(self):
        reset_db()
        model_lab.time = FakeTime(real_time.time())
        # The daily pool is the live OpenCode tier; gateway fallbacks must never
        # consume rotation slots.
        live = set(oclib.list_models())  # a model OpenCode dropped stays in the ladder until the next lab run
        models = [m for m in oclib.load_ladders()["categories"]["build"]
                  if m.startswith("opencode/") and (not live or m in live)]
        self.assertTrue(models)
        con = model_lab.init_db()
        seen: dict[str, set[str]] = {}

        # a full cycle: every deep pair at DEEP_PER_DAY per day (21 days for the original 10-model pool), +1 slack
        days = max(21, -(-len(models) * len(model_lab.DEEP_TASKS) // model_lab.DEEP_PER_DAY) + 1)
        for _ in range(days):
            plans, _remaining = model_lab.plan_round(con, models, 14)
            cost = sum(model_lab.TASK_COST[t] for tasks in plans.values() for t in tasks)
            self.assertLessEqual(cost, 14)
            for model, tasks in plans.items():
                for task in tasks:
                    model_lab.persist(con, model, task, fake_ok(model, task, _TMP))
                    seen.setdefault(model, set()).add(task)
            model_lab.time.now += 86400

        con.close()
        self.assertEqual(sum(len(v) for v in seen.values()), len(models) * len(model_lab.ROTATION_TASKS))
        for model in models:
            self.assertEqual(seen[model], set(model_lab.ROTATION_TASKS), model)


class MainLoopTest(unittest.TestCase):
    def setUp(self):
        reset_db()
        model_lab.time = FakeTime(real_time.time())
        self.models = ["opencode/glm-5.3-flash-free", "opencode/deepseek-v4.1-flash-free"]
        self._candidates = model_lab.candidates
        self._run_task = model_lab.run_task
        model_lab.candidates = lambda args: self.models
        self._argv = sys.argv

    def tearDown(self):
        model_lab.candidates = self._candidates
        model_lab.run_task = self._run_task
        sys.argv = self._argv

    def rows(self) -> int:
        if not os.path.exists(oclib.LAB_DB):
            return 0
        con = sqlite3.connect(oclib.LAB_DB)
        n = con.execute("select count(*) from run").fetchone()[0]
        con.close()
        return n

    def test_budget_round_persists_and_scores(self):
        model_lab.run_task = fake_ok
        sys.argv = ["model_lab.py", "--budget", "6", "--no-apply"]
        self.assertEqual(model_lab.main(), 0)
        res = read_results()
        self.assertEqual(res["quota_hit"], False)
        planned = sum(model_lab.TASK_COST[t] for ts in res["plans"].values() for t in ts)
        self.assertEqual(res["spent"], planned)
        self.assertLessEqual(res["spent"], 6)
        # the planner may spend the whole budget on one expensive overdue task
        self.assertEqual(self.rows(), sum(len(ts) for ts in res["plans"].values()))
        self.assertGreaterEqual(self.rows(), 1)
        self.assertTrue(res["scores"])

    def test_quota_hit_aborts_without_writing(self):
        model_lab.run_task = lambda m, t, w: {
            "passed": False, "detail": "", "latency": 1.0, "usage": {},
            "error": "free usage limit reached", "error_kind": "free_limit"}
        sys.argv = ["model_lab.py", "--budget", "6", "--no-apply"]
        self.assertEqual(model_lab.main(), 0)
        res = read_results()
        self.assertTrue(res["quota_hit"])
        self.assertEqual(self.rows(), 0)

    def test_transient_empty_is_retried_once(self):
        calls = {"n": 0}

        def flaky(model, task, workdir):
            calls["n"] += 1
            if calls["n"] == 1:
                return {"passed": False, "detail": "", "latency": 1.0, "usage": {},
                        "error": "", "error_kind": "empty"}
            return fake_ok(model, task, workdir)

        model_lab.run_task = flaky
        sys.argv = ["model_lab.py", "--budget", "6", "--no-apply"]
        self.assertEqual(model_lab.main(), 0)
        planned = sum(len(ts) for ts in read_results()["plans"].values())
        self.assertEqual(self.rows(), planned)
        self.assertEqual(calls["n"], planned + 1)  # exactly one retry for the one empty reply
        self.assertTrue(model_lab.time.now >= real_time.time())


class ApplyLadderTest(unittest.TestCase):
    def test_reranks_and_keeps_unmeasured_models(self):
        ladders = oclib.load_ladders()
        before = list(ladders["categories"]["build"])
        winner = "opencode/deepseek-v4.1-flash-free"
        loser = "opencode/glm-5.3-flash-free"
        scores = {
            winner: {c: 90.0 for c in oclib.CATEGORIES},
            loser: {c: 20.0 for c in oclib.CATEGORIES},
        }
        facts = {winner: {"latency": 5.0}, loser: {"latency": 40.0}}
        out = model_lab.apply_ladders(scores, facts, {winner, loser}, set(before), steps={})
        for cat in oclib.CATEGORIES:
            self.assertEqual(out["categories"][cat][0], winner)
        live = set(oclib.list_models())  # models OpenCode no longer offers are dropped, by design
        self.assertEqual(set(out["categories"]["build"]), {m for m in before if not live or m in live})


class TierTest(unittest.TestCase):
    def setUp(self):
        # apply_ladders writes the temp ladders; every tier test starts from the
        # shipped file rather than the previous test's ranking.
        shutil.copy(os.path.join(CFG, "ladders.json"), oclib.LADDERS_PATH)

    def test_shipped_settings_bench_every_provider_on_its_own_budget(self):
        with open(os.path.join(CFG, "ladders.json"), encoding="utf-8") as f:
            shipped = json.load(f)
        st = model_lab.lab_settings(shipped)
        self.assertEqual(set(st["providers"]), {"opencode", "openrouter", "omniroute", "nvidia"})
        for prov in st["providers"]:
            self.assertGreater(st["budgets"][prov], 0, prov)
        self.assertGreater(st["provider_bias"]["opencode"], st["provider_bias"]["omniroute"])
        for cat in oclib.CATEGORIES:
            chain = shipped["categories"][cat]
            self.assertTrue(any(m.startswith("opencode/") for m in chain), cat)
            self.assertTrue(any(not m.startswith("opencode/") for m in chain), cat)

    def _pool(self, providers):
        fake = ["opencode/glm-5.3-flash-free", "opencode/beam-free", "opencode/paid-model",
                "omniroute/omni-code", "omniroute/omni-image",
                "openrouter/nvidia/nemotron-3.5-super-vl:free", "openrouter/some/paid-model"]
        lad = oclib.load_ladders()
        lad["settings"]["providers"] = providers
        oclib.save_ladders(lad)
        original, original_decl = oclib.list_models, model_lab.declared_omniroute
        oclib.list_models = lambda: fake
        model_lab.declared_omniroute = lambda: ["omniroute/omni-code", "omniroute/omni-image"]
        try:
            args = argparse.Namespace(model=None, enable_paid=False, enable_omniroute=False,
                                      include_omniroute=False, all_free=False, include_paid=False)
            return model_lab.candidates(args)
        finally:
            oclib.list_models, model_lab.declared_omniroute = original, original_decl

    def test_candidates_cover_every_enabled_provider(self):
        pool = self._pool(["opencode", "openrouter", "omniroute"])
        self.assertCountEqual(pool, ["opencode/glm-5.3-flash-free", "opencode/beam-free",
                                     "omniroute/omni-code", "openrouter/nvidia/nemotron-3.5-super-vl:free"])

    def test_nvidia_pool_is_the_declared_models_only(self):
        # OpenCode lists every NIM model for the key; only declared ones are benched
        fake = ["opencode/beam-free", "nvidia/nvidia/nemotron-3-ultra-550b-a55b", "nvidia/meta/llama-guard-4-12b"]
        lad = oclib.load_ladders()
        lad["settings"]["providers"] = ["opencode", "nvidia"]
        oclib.save_ladders(lad)
        original, original_decl = oclib.list_models, model_lab.declared_nvidia
        oclib.list_models = lambda: fake
        model_lab.declared_nvidia = lambda: ["nvidia/nvidia/nemotron-3-ultra-550b-a55b", "nvidia/gone/model"]
        try:
            args = argparse.Namespace(model=None, enable_paid=False, enable_omniroute=False,
                                      include_omniroute=False, all_free=False, include_paid=False)
            pool = model_lab.candidates(args)
        finally:
            oclib.list_models, model_lab.declared_nvidia = original, original_decl
        self.assertCountEqual([m for m in pool if m.startswith("nvidia/")], ["nvidia/nvidia/nemotron-3-ultra-550b-a55b"])

    def test_candidates_respect_provider_setting(self):
        self.assertCountEqual(self._pool(["opencode"]),
                              ["opencode/glm-5.3-flash-free", "opencode/beam-free"])

    def test_unified_ranking_with_provider_bias(self):
        free_a, free_b = "opencode/glm-5.3-flash-free", "opencode/beam-free"
        gw = "omniroute/omni-code"
        catalog = {free_a, free_b, gw}
        original = oclib.list_models
        oclib.list_models = lambda: sorted(catalog)
        try:
            # near-tie: the OpenCode bias keeps the free model on top
            scores = {free_a: {c: 70.0 for c in oclib.CATEGORIES},
                      gw: {c: 74.0 for c in oclib.CATEGORIES},
                      free_b: {c: 40.0 for c in oclib.CATEGORIES}}
            out = model_lab.apply_ladders(scores, {}, set(scores), catalog, steps={})
            self.assertEqual(out["categories"]["build"][:3], [free_a, gw, free_b])
            # clearly better gateway leads, and the weak free model still stays in the chain
            scores[gw] = {c: 95.0 for c in oclib.CATEGORIES}
            out = model_lab.apply_ladders(scores, {}, set(scores), catalog, steps={})
            self.assertEqual(out["categories"]["build"][:3], [gw, free_a, free_b])
            # near-equal free models: the one users wait 20 s per step for drops behind the 3 s one
            # (2026-11-06: deepseek-v4.1-flash-free 20.7 s/step led nemotron-lightning at 3.8 s)
            scores = {free_a: {c: 61.2 for c in oclib.CATEGORIES}, free_b: {c: 60.6 for c in oclib.CATEGORIES}}
            out = model_lab.apply_ladders(scores, {}, set(scores), catalog, steps={free_a: 20.7, free_b: 3.8})
            self.assertEqual(out["categories"]["build"][:2], [free_b, free_a])
            # a clearly better model still leads despite being slower
            scores[free_a] = {c: 75.0 for c in oclib.CATEGORIES}
            out = model_lab.apply_ladders(scores, {}, set(scores), catalog, steps={free_a: 20.7, free_b: 3.8})
            self.assertEqual(out["categories"]["build"][0], free_a)
        finally:
            oclib.list_models = original


class BugHuntMatcherTest(unittest.TestCase):
    def test_accepts_line_three(self):
        for text in ("3", "3.", "Line 3", "line: 3", "**Line 3**",
                     "The defect is on line 3.", "the 3rd line of total()"):
            self.assertTrue(model_lab.bug_hunt_answer(text), text)

    def test_rejects_other_numbers_and_paths(self):
        for text in ("", "line 13", "Lines 3 and 4",
                     "The working directory is /var/tmp/oc-lab-abc3"):
            self.assertFalse(model_lab.bug_hunt_answer(text), text)


class FreeLimitTest(unittest.TestCase):
    def setUp(self):
        self._log = oclib.OPENCODE_LOG
        self.log = os.path.join(_TMP, "fake-opencode.log")
        oclib.OPENCODE_LOG = self.log

    def tearDown(self):
        oclib.OPENCODE_LOG = self._log

    def write(self, ts: str) -> None:
        with open(self.log, "w") as f:
            f.write(f'timestamp={ts} level=ERROR message="Failed to drain Session" '
                    'cause="AI.Error: Free usage limit reached"\n')

    def test_recent_marker_is_detected(self):
        now = real_time.time()
        self.write(real_time.strftime("%Y-%m-%dT%H:%M:%S", real_time.gmtime(now)))
        self.assertTrue(oclib.free_limit_since(now - 60))

    def test_old_marker_is_ignored(self):
        now = real_time.time()
        self.write(real_time.strftime("%Y-%m-%dT%H:%M:%S", real_time.gmtime(now - 86400)))
        self.assertFalse(oclib.free_limit_since(now - 60))

    def test_missing_log_is_not_a_cap(self):
        oclib.OPENCODE_LOG = os.path.join(_TMP, "nope.log")
        self.assertFalse(oclib.free_limit_since(real_time.time() - 60))


if __name__ == "__main__":
    unittest.main(verbosity=2)
