#!/usr/bin/env python3
"""
sentinel.py — per-category health watchdog and failback for the model ladders.

Every POLL_SECONDS it works out, for each category (build, plan, explore,
review, quick), the first model in that category's ladder that is usable right
now, and points the category's agents (and the default/small model) at it:

  * a model with a ledger entry (recent 429/5xx/timeout) is skipped until its
    backoff ends and a probe succeeds; the probe clears the entry
  * while the OpenCode shared free allowance is exhausted, every opencode/*-free
    model is skipped, so new sessions start on the gateway instead of failing first
  * models ranked above the current pick are probed (at most once per
    PROBE_INTERVAL each, MAX_PROBES per loop); a healthy probe moves the
    category back up the ladder

The ladders themselves are owned by model_lab.py; this only chooses where in
each ladder to start. All writes go through oclib's locked updaters.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import oclib  # noqa: E402

POLL_SECONDS = 60
MEMORY_INDEX_SECONDS = 600
LOCATION_IDLE_SECONDS = 1800  # a folder with no session activity this long gets its MCP servers closed
PROBE_INTERVAL = 900   # per model
MAX_PROBES = 3         # per loop, so a recovering provider cannot burn quota in a burst
PROBE_TIMEOUT = 90
CAP_LOOKBACK = 1800    # a free-limit marker this recent means the cap is still on
# live speed: a pick whose real-session steps (last SLOW_WINDOW s, at least SLOW_MIN_STEPS) have a
# median of SLOW_S or more is passed over for SLOW_HOLD s, then tried again. 2026-11-06 the build
# head answered in 31 s/step for hours while near-equal models took 2-5 s.
SLOW_S = 20.0
SLOW_WINDOW = 1800
SLOW_MIN_STEPS = 5
SLOW_HOLD = 1200
# strong routes (the models own-machine work, research and the reply reviewer run on): when every one
# has stayed in the failover ledger this long, tell the user. 2026-11-07 OmniRoute's Antigravity
# client version was rejected ("This version of Antigravity is no longer supported") from 00:37;
# sessions silently fell back to weak free models for 11 h and the ledger only said "stream ended
# without finish_reason".
STRONG_PROBE_S = 600  # at most one re-test of an expired strong route per 10 min
STRONG_DOWN_ALERT_S = 1800
STRONG_NAME = re.compile(r"\bclaude-(sonnet|opus)|^omniroute/omni-code$")
GATEWAY = "http://127.0.0.1:20128/v1/chat/completions"
# never let a probe write into the config dir
PROBE_DIR = ("/var/tmp/pip-scratch/opencode" if os.path.isdir("/var/tmp/pip-scratch")
             else os.path.join(__import__("tempfile").gettempdir(), "opencode-probe"))


def is_opencode_free(model: str) -> bool:
    return model.startswith("opencode/") and oclib.is_free(model)


def probe(model: str) -> str:
    """'ok', 'fail' or 'capped'."""
    os.makedirs(PROBE_DIR, exist_ok=True)
    r = oclib.run_model(model, "Reply with the single word OK.", PROBE_DIR,
                        timeout=PROBE_TIMEOUT, agent="build")
    if r.get("error_kind") == "free_limit":
        return "capped"  # account-wide: not this model's fault, do not poison the ledger
    ok = r["ok"] and "ok" in (r["text"] or "").lower()
    oclib.ledger_record(model, ok, r.get("error", "probe failed"))
    return "ok" if ok else "fail"


class State:
    def __init__(self) -> None:
        self.capped = False
        self.cap_cleared_at = 0.0  # a probe found the cap gone: older free-limit markers no longer count
        self.last_probe: dict[str, float] = {}
        self.last_cap_probe = 0.0  # the cap is account-wide: one probe per PROBE_INTERVAL in total
        self.last_effective: dict[str, str] = {}
        self.slow_until: dict[str, float] = {}
        self.strong_down_since = 0.0
        self.strong_alerted = False
        self.strong_probe_at = 0.0


def usable(model: str, st: State, ledger: dict) -> bool:
    """No ledger entry = healthy. An entry means it failed and has not been
    re-verified since; a successful probe deletes it (oclib.ledger_record)."""
    if st.capped and is_opencode_free(model):
        return False
    return model not in ledger


def backoff_over(model: str, ledger: dict, now: float) -> bool:
    return now >= float((ledger.get(model) or {}).get("cooldown_until", 0) or 0)


def pick(chain: list[str], st: State, ledger: dict, now: float | None = None) -> str:
    now = now or time.time()
    for fast_only in (True, False):  # a slow model only when nothing else is usable
        for m in chain:
            if usable(m, st, ledger) and not (fast_only and st.slow_until.get(m, 0) > now):
                return m
    return chain[0] if chain else ""


def mark_slow(st: State, now: float, recent: dict[str, float]) -> None:
    for m, sec in recent.items():
        if sec >= SLOW_S and st.slow_until.get(m, 0) <= now:
            st.slow_until[m] = now + SLOW_HOLD
            oclib.log("sentinel", f"{m}: {sec:.0f} s per step over the last {SLOW_WINDOW // 60} min; "
                                  f"new sessions use the next model for {SLOW_HOLD // 60} min")


def strong_routes(cfg: dict) -> list[str]:
    """Same pool as context-engine/strong-model.mjs: declared gateway models of Claude Sonnet/Opus
    class, omni-code, and reviewer-ranked >= 0.8."""
    declared = {f"omniroute/{m}" for m in ((cfg.get("providers") or {}).get("omniroute") or {}).get("models") or {}}
    ranked = set()
    try:
        r = oclib.load_json(os.path.join(oclib.CONFIG_DIR, "state/reviewer-ranking.json"), {}) or {}
        ranked = {f"omniroute/{x['model']}" for x in r.get("ranking") or [] if x.get("score", 0) >= 0.8}
    except Exception:
        pass
    return sorted(m for m in declared if STRONG_NAME.search(m) or m in ranked)


def gateway_says(model: str) -> str:
    """What the gateway answers right now (status + first words): the ledger's error is often a
    generic stream error that hides the provider's real message."""
    key = os.environ.get("OMNIROUTE_API_KEY", "")
    body = json.dumps({"model": model.split("/", 1)[1], "max_tokens": 20,
                       "messages": [{"role": "user", "content": "Reply with just: OK"}]}).encode()
    req = urllib.request.Request(GATEWAY, body, {"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            d = json.load(r)
        text = ((d.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        return f"answered: {text.strip()[:160]}"
    except urllib.error.HTTPError as e:
        try:
            msg = json.load(e).get("error", {}).get("message", "")
        except Exception:
            msg = ""
        return f"HTTP {e.code}: {str(msg)[:160]}"
    except Exception as e:
        return f"unreachable: {e!r}"[:180]


def notify(summary: str, body: str, urgency: str = "critical") -> None:
    try:
        subprocess.run(["notify-send", "-a", "OpenCode", "-u", urgency, "-h",
                        "string:x-dunst-stack-tag:opencode-strong-models", summary, body], timeout=10)
    except Exception as exc:
        oclib.log("sentinel", f"notify failed: {exc!r}")


def check_strong(st: State, cfg: dict, ledger: dict, now: float) -> None:
    """Desktop alert when every strong route has been failing for STRONG_DOWN_ALERT_S, and when one
    works again. A ledger entry stays until a success, so "in the ledger" = not working."""
    routes = strong_routes(cfg)
    if not routes:
        return
    # Strong routes sit below the ladder pick, so the failback probes never reach them and their entries
    # stayed for good (2026-11-18 review: four routes 14.6 h past their cooldown, ALERTs followed by
    # "answered: OK"). When every one looks down, re-test one whose cooldown is over.
    if all(m in ledger for m in routes) and now - st.strong_probe_at >= STRONG_PROBE_S:
        expired = [m for m in routes if float((ledger.get(m) or {}).get("cooldown_until", 0) or 0) <= now]
        if expired:
            st.strong_probe_at = now
            said = gateway_says(expired[0])
            if said.startswith("answered:") and re.search(r"\bOK\b", said, re.I):
                oclib.ledger_record(expired[0], True)
                ledger = {k: v for k, v in ledger.items() if k != expired[0]}
                oclib.log("sentinel", f"strong probe: {expired[0]} {said[:60]}; cleared from the ledger")
    down = all(m in ledger for m in routes)
    if not down:
        if st.strong_alerted:
            ok = [m for m in routes if m not in ledger]
            oclib.log("sentinel", f"strong models back: {', '.join(ok)}")
            notify("OpenCode: strong models are back", f"{', '.join(ok)} answered again.", "normal")
        st.strong_down_since, st.strong_alerted = 0.0, False
        return
    st.strong_down_since = st.strong_down_since or now
    if st.strong_alerted or now - st.strong_down_since < STRONG_DOWN_ALERT_S:
        return
    st.strong_alerted = True
    sample = gateway_says(routes[0])
    since = time.strftime("%H:%M", time.localtime(st.strong_down_since))
    oclib.log("sentinel", f"ALERT every strong route failing since {since} ({len(routes)} routes); {routes[0]} {sample}")
    notify("OpenCode: strong models are down",
           f"Since {since} every strong route fails, so sessions and reply reviews run on weak free models.\n"
           f"{routes[0]} {sample}\nCheck: omniroute logs / oc-status.py")


def tick(st: State, now: float | None = None) -> dict[str, str]:
    now = now or time.time()
    ladders = oclib.load_ladders()
    cats = ladders.get("categories") or {}
    cfg = oclib.load_json(oclib.CONFIG_PATH, {}) or {}
    if cfg.get("pin_model"):
        return st.last_effective

    if not st.capped and oclib.free_limit_since(max(now - CAP_LOOKBACK, st.cap_cleared_at)):
        st.capped = True
        oclib.log("sentinel", "OpenCode free allowance exhausted — routing new sessions past opencode/*-free")

    ledger = oclib.load_ledger()
    try:
        check_strong(st, cfg, ledger, now)
    except Exception as exc:
        oclib.log("sentinel", f"strong check error: {exc!r}")
    mark_slow(st, now, oclib.step_latency(now - SLOW_WINDOW, SLOW_MIN_STEPS))
    effective = {cat: pick(cats.get(cat) or [], st, ledger, now) for cat in oclib.CATEGORIES}

    # failback: probe the best-ranked models currently being skipped
    wanted: list[str] = []
    for cat in oclib.CATEGORIES:
        chain = cats.get(cat) or []
        eff = effective.get(cat)
        if eff in chain:
            for m in chain[:chain.index(eff)]:
                if m not in wanted:
                    wanted.append(m)
    probes = 0
    capped_probe_done = False
    for m in wanted:
        if probes >= MAX_PROBES:
            break
        if now - st.last_probe.get(m, 0) < PROBE_INTERVAL:
            continue
        capped_free = st.capped and is_opencode_free(m)
        if not capped_free and not backoff_over(m, ledger, now):
            continue  # still inside its backoff
        if capped_free:
            if capped_probe_done or now - st.last_cap_probe < PROBE_INTERVAL:
                continue  # the cap is account-wide: one probe answers for every free model
            capped_probe_done = True
            st.last_cap_probe = now
        st.last_probe[m] = now
        probes += 1
        res = probe(m)
        if res == "capped":
            st.capped = True
            oclib.log("sentinel", f"probe {m}: free tier still capped")
        elif res == "ok":
            if is_opencode_free(m) and st.capped:
                st.capped = False
                st.cap_cleared_at = now
                oclib.log("sentinel", "OpenCode free allowance is back")
            oclib.log("sentinel", f"probe {m}: healthy")
        else:
            oclib.log("sentinel", f"probe {m}: still failing")
    if probes:
        ledger = oclib.load_ledger()
        effective = {cat: pick(cats.get(cat) or [], st, ledger, now) for cat in oclib.CATEGORIES}

    apply(effective, ladders, cfg, st)
    return effective


def apply(effective: dict[str, str], ladders: dict, cfg: dict, st: State) -> None:
    if effective == st.last_effective and cfg.get("model") == effective.get("build") \
            and cfg.get("small_model") == effective.get("quick"):
        return
    rotated = {
        **ladders,
        "categories": {cat: [effective[cat]] + [m for m in chain if m != effective[cat]]
                       for cat, chain in (ladders.get("categories") or {}).items()
                       if effective.get(cat)},
    }
    oclib.sync_agents(rotated)
    if cfg.get("model") != effective.get("build") or cfg.get("small_model") != effective.get("quick"):
        oclib.sync_config_models(rotated)
    for cat, m in effective.items():
        prev = st.last_effective.get(cat)
        if prev and prev != m:
            head = (ladders["categories"].get(cat) or [m])[0]
            direction = "back to head" if m == head else "failover"
            oclib.log("sentinel", f"{cat}: {prev} -> {m} ({direction})")
    st.last_effective = dict(effective)


def run_loop() -> None:
    write_pid()
    oclib.log("sentinel", f"started (pid {os.getpid()}) — ladder: {oclib.LADDERS_PATH}")
    st = State()
    last_index = 0.0
    try:
        while True:
            try:
                tick(st)
                oclib.autocommit_models("sentinel")
                if time.time() - last_index >= MEMORY_INDEX_SECONDS:
                    last_index = time.time()
                    gone = oclib.evict_idle_locations(LOCATION_IDLE_SECONDS)
                    if gone:
                        oclib.log("sentinel", f"closed {len(gone)} idle folder instance(s) and their MCP servers: "
                                              + ", ".join(os.path.basename(g) or g for g in gone)[:300])
                    res = oclib.refresh_memory_index()
                    if res.get("error") or res.get("facts") or res.get("indexed"):
                        oclib.log("sentinel", f"memory index: {res}")
            except KeyboardInterrupt:
                break
            except Exception as exc:  # never die on a transient error
                oclib.log("sentinel", f"loop error: {exc!r}")
            time.sleep(POLL_SECONDS)
    finally:
        remove_pid()


def is_sentinel(pid: int) -> bool:
    """True only if pid is a running sentinel.py. PIDs are reused (quickly on
    Windows), so a stale pid file must never make us kill an unrelated process."""
    try:
        if os.path.isdir("/proc"):
            with open(f"/proc/{pid}/cmdline", "rb") as fh:
                return b"sentinel.py" in fh.read()
        if oclib.IS_WINDOWS:
            import subprocess
            out = subprocess.run(
                ["powershell", "-NoProfile", "-Command",
                 f"(Get-CimInstance Win32_Process -Filter 'ProcessId={int(pid)}').CommandLine"],
                capture_output=True, text=True, timeout=15, **oclib.NO_WINDOW).stdout
            return "sentinel.py" in out
    except Exception:
        return False
    return False


def write_pid() -> None:
    pid_file = os.path.join(oclib.CONFIG_DIR, "sentinel.pid")
    try:
        if os.path.exists(pid_file):
            try:
                old = int(open(pid_file).read().strip())
                if old != os.getpid() and is_sentinel(old):
                    os.kill(old, 15)
                    time.sleep(0.5)
            except Exception:
                pass
        with open(pid_file, "w") as f:
            f.write(str(os.getpid()))
    except Exception:
        pass


def remove_pid() -> None:
    try:
        os.remove(os.path.join(oclib.CONFIG_DIR, "sentinel.pid"))
    except Exception:
        pass


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "probe":
        model = sys.argv[2] if len(sys.argv) > 2 else oclib.ladder_head("build")
        res = probe(model)
        print(f"Probe {model}: {res.upper()}")
        sys.exit(0 if res == "ok" else 1)
    run_loop()
