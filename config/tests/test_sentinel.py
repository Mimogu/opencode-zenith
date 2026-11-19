#!/usr/bin/env python3
"""Offline tests for sentinel.tick: per-category failover, free-cap routing,
probe-verified failback and probe throttling. No model calls."""

from __future__ import annotations

import os
import sys
import unittest

CFG = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, CFG)
import oclib  # noqa: E402
import sentinel  # noqa: E402

F1, F2 = "opencode/a-free", "opencode/b-free"
GW, OR = "omniroute/omni-code", "openrouter/x/y:free"
LADDERS = {"categories": {
    "build": [F1, F2, GW], "plan": [F2, F1, GW], "explore": [F1, GW],
    "review": [F2, GW], "quick": [F1, OR, GW]}}


class Env:
    def __init__(self):
        self.ledger: dict = {}
        self.cap = False
        self.probe_results: dict[str, str] = {}
        self.probed: list[str] = []
        self.agents: dict = {}
        self.config: dict = {"model": F1, "small_model": F1}

    def install(self, tc: unittest.TestCase):
        saved = {n: getattr(oclib, n) for n in (
            "load_ladders", "load_json", "load_ledger", "free_limit_since",
            "sync_agents", "sync_config_models", "log", "ledger_record")}
        saved_probe = sentinel.probe
        tc.addCleanup(lambda: [setattr(oclib, n, f) for n, f in saved.items()])
        tc.addCleanup(lambda: setattr(sentinel, "probe", saved_probe))
        oclib.load_ladders = lambda: {"categories": {k: list(v) for k, v in LADDERS["categories"].items()}}
        oclib.load_json = lambda path, default=None: dict(self.config)
        oclib.load_ledger = lambda: dict(self.ledger)
        oclib.free_limit_since = lambda since: self.cap
        oclib.sync_agents = lambda lad: self.agents.update({c: ch[0] for c, ch in lad["categories"].items()})
        oclib.sync_config_models = lambda lad: self.config.update(
            model=lad["categories"]["build"][0], small_model=lad["categories"]["quick"][0])
        oclib.log = lambda *a, **k: None
        self.steps = {}
        oclib.step_latency = lambda since, min_steps=6, until_s=None: dict(self.steps)

        def fake_probe(model):
            self.probed.append(model)
            res = self.probe_results.get(model, "ok")
            if res == "ok":
                self.ledger.pop(model, None)
            return res
        sentinel.probe = fake_probe


class SentinelTest(unittest.TestCase):
    def setUp(self):
        self.env = Env()
        self.env.install(self)
        self.st = sentinel.State()

    def test_all_healthy_uses_every_head(self):
        eff = sentinel.tick(self.st, now=1000)
        self.assertEqual(eff, {c: ch[0] for c, ch in LADDERS["categories"].items()})
        self.assertEqual(self.env.probed, [])
        self.assertEqual(self.env.config["model"], F1)

    def test_failed_model_is_skipped_in_every_category(self):
        self.env.ledger[F1] = {"cooldown_until": 5000}
        eff = sentinel.tick(self.st, now=1000)
        self.assertEqual(eff["build"], F2)
        self.assertEqual(eff["explore"], GW)
        self.assertEqual(eff["quick"], OR)
        self.assertEqual(eff["plan"], F2)
        self.assertEqual(self.env.probed, [], "no probe while still inside the backoff")
        self.assertEqual(self.env.agents["build"], F2)

    def test_slow_head_is_passed_over_then_tried_again(self):
        self.env.steps = {F1: 31.0, F2: 3.0}
        eff = sentinel.tick(self.st, now=1000)
        self.assertEqual(eff["build"], F2, "31 s/step: new sessions go to the next model")
        self.assertEqual(self.env.config["model"], F2)
        self.env.steps = {F2: 3.0}  # no new steps on F1 while it is passed over
        eff = sentinel.tick(self.st, now=1000 + sentinel.SLOW_HOLD + 1)
        self.assertEqual(eff["build"], F1, "after the hold it is tried again")
        self.env.steps = {F1: 25.0, F2: 30.0}
        eff = sentinel.tick(sentinel.State(), now=1000)
        self.assertEqual(eff["build"], GW, "both free models slow: the next one in the chain")
        self.env.steps = {F1: 25.0, F2: 30.0, GW: 40.0}
        eff = sentinel.tick(sentinel.State(), now=1000)
        self.assertEqual(eff["build"], F1, "everything slow: the head, never none")

    def test_recovers_only_after_a_successful_probe(self):
        self.env.ledger[F1] = {"cooldown_until": 5000}
        sentinel.tick(self.st, now=1000)
        self.env.probe_results[F1] = "fail"
        eff = sentinel.tick(self.st, now=6000)  # backoff over, probe fails
        self.assertEqual(self.env.probed, [F1])
        self.assertEqual(eff["build"], F2)
        self.env.probe_results[F1] = "ok"
        eff = sentinel.tick(self.st, now=6000 + sentinel.PROBE_INTERVAL + 1)
        self.assertEqual(eff["build"], F1, "back to the head once it probes healthy")
        self.assertEqual(self.env.config["model"], F1)

    def test_probe_throttled_per_model(self):
        self.env.ledger[F1] = {"cooldown_until": 0}
        self.env.probe_results[F1] = "fail"
        sentinel.tick(self.st, now=1000)
        sentinel.tick(self.st, now=1060)
        self.assertEqual(self.env.probed, [F1])

    def test_free_cap_routes_every_category_past_opencode_free(self):
        self.env.cap = True
        self.env.probe_results = {F1: "capped", F2: "capped"}
        eff = sentinel.tick(self.st, now=1000)
        for cat, m in eff.items():
            self.assertFalse(sentinel.is_opencode_free(m), (cat, m))
        self.assertEqual(len(self.env.probed), 1, "one probe answers for the whole account-wide cap")
        self.assertEqual(self.env.config["model"], GW)

    def test_capped_probes_are_throttled_account_wide(self):
        self.env.cap = True
        self.env.probe_results = {F1: "capped", F2: "capped"}
        for minute in range(10):
            sentinel.tick(self.st, now=1000 + 60 * minute)
        self.assertEqual(len(self.env.probed), 1, self.env.probed)
        sentinel.tick(self.st, now=1000 + sentinel.PROBE_INTERVAL + 1)
        self.assertEqual(len(self.env.probed), 2)

    def test_cap_lifts_when_a_free_probe_succeeds(self):
        self.env.cap = True
        self.env.probe_results = {F1: "capped"}
        sentinel.tick(self.st, now=1000)
        self.env.cap = False
        self.env.probe_results = {F1: "ok"}
        eff = sentinel.tick(self.st, now=1000 + sentinel.PROBE_INTERVAL + 1)
        self.assertEqual(eff["build"], F1)
        self.assertFalse(self.st.capped)

    def test_pin_freezes_routing(self):
        self.env.config["pin_model"] = True
        self.env.ledger[F1] = {"cooldown_until": 5000}
        sentinel.tick(self.st, now=1000)
        self.assertEqual(self.env.agents, {})


class StrongAlertTest(unittest.TestCase):
    """Every strong route failing for STRONG_DOWN_ALERT_S -> one alert with the gateway's own words;
    one working again -> one 'back' note. 2026-11-07: 11 h on weak models without a word."""
    def setUp(self):
        self.sent, self.logs = [], []
        saved = (sentinel.notify, sentinel.gateway_says, sentinel.strong_routes, oclib.log)
        self.addCleanup(lambda: setattr(sentinel, "notify", saved[0]) or setattr(sentinel, "gateway_says", saved[1])
                        or setattr(sentinel, "strong_routes", saved[2]) or setattr(oclib, "log", saved[3]))
        sentinel.notify = lambda summary, body, urgency="critical": self.sent.append((summary, body))
        sentinel.gateway_says = lambda m: "answered: This version of Antigravity is no longer supported."
        self.real_routes = saved[2]
        sentinel.strong_routes = lambda cfg: ["omniroute/agy/claude-sonnet-4-6", GW]
        oclib.log = lambda name, msg: self.logs.append(msg)

    def test_alert_after_threshold_once_then_back(self):
        st, down = sentinel.State(), {"omniroute/agy/claude-sonnet-4-6": {}, GW: {}}
        sentinel.check_strong(st, {}, down, 1000.0)
        sentinel.check_strong(st, {}, down, 1000.0 + sentinel.STRONG_DOWN_ALERT_S - 1)
        self.assertEqual(self.sent, [])
        sentinel.check_strong(st, {}, down, 1000.0 + sentinel.STRONG_DOWN_ALERT_S)
        sentinel.check_strong(st, {}, down, 1000.0 + sentinel.STRONG_DOWN_ALERT_S + 60)
        self.assertEqual(len(self.sent), 1)
        self.assertIn("no longer supported", self.sent[0][1])
        sentinel.check_strong(st, {}, {GW: {}}, 9999.0)
        self.assertEqual(len(self.sent), 2)
        self.assertIn("back", self.sent[1][0])

    def test_expired_strong_entries_are_retested_not_alerted(self):
        """2026-11-18 review: entries 14 h past their cooldown kept raising 'every strong route failing'."""
        cleared, saved = [], oclib.ledger_record
        self.addCleanup(lambda: setattr(oclib, "ledger_record", saved))
        oclib.ledger_record = lambda m, ok, *a, **k: cleared.append((m, ok))
        sentinel.gateway_says = lambda m: "answered: OK"
        st, down = sentinel.State(), {"omniroute/agy/claude-sonnet-4-6": {"cooldown_until": 10.0}, GW: {"cooldown_until": 10.0}}
        for t in range(1000, 1000 + 2 * sentinel.STRONG_DOWN_ALERT_S, 60):
            sentinel.check_strong(st, {}, down, float(t))
        self.assertEqual(self.sent, [])
        self.assertEqual(cleared[0], ("omniroute/agy/claude-sonnet-4-6", True))

    def test_one_route_working_means_no_alert(self):
        st = sentinel.State()
        for t in range(0, 7200, 60):
            sentinel.check_strong(st, {}, {GW: {}}, float(t))
        self.assertEqual(self.sent, [])

    def test_strong_routes_pool(self):
        cfg = {"providers": {"omniroute": {"models": {"omni-code": {}, "agy/claude-sonnet-4-6": {},
               "omni-quick": {}, "antigravity/claude-opus-4-6-thinking": {}}}}}
        saved = oclib.load_json
        self.addCleanup(lambda: setattr(oclib, "load_json", saved))
        oclib.load_json = lambda path, default=None: {"ranking": []}
        self.assertEqual(self.real_routes(cfg), ["omniroute/agy/claude-sonnet-4-6",
                         "omniroute/antigravity/claude-opus-4-6-thinking", "omniroute/omni-code"])


if __name__ == "__main__":
    unittest.main(verbosity=1)
