#!/usr/bin/env python3
"""
model_lab.py — quota-aware live capability bench for the OpenCode harness.

The OpenCode free tier is a shared daily message allowance, not a per-model
quota: once it is gone every free model returns an empty response while the
server logs "Free usage limit reached". A full seven-model x 7-task sweep cannot
fit in it, so the lab spends a small daily budget on a rotating subset and
scores each model from the last three weeks of measurements. Gateway models are
not part of the daily pool: they exist to keep sessions alive once the shared
free allowance is gone, and ranking them would promote a paid fallback over a
free primary on a day the primary was never measured.

Every task is checked objectively (filesystem, exact JSON, numeric answer);
no model judges another model.

  sanity       arithmetic                                   1 message
  instruction  exact-format JSON, no prose                  1 message
  reason       deterministic puzzle, single number          1 message
  bug_hunt     locate a defect by line number               2 messages
  code_fix     edit a broken file, run it, verify result    4 messages
  tool_use     create a file, shell out, report the size    3 messages
  context      retrieve a nonce buried in ~6k tokens        2 messages

Daily rotation:
  * 4 models get one cheap probe, cycling sanity/instruction/reason
  * up to 3 deep (model, task) pairs from a deterministic cycle
  * the run aborts cleanly on the first free-limit signal and keeps the
    ladders, so a quota hit can never fake a capability failure

Usage:
  ./model_lab.py --list                  candidates
  ./model_lab.py                         one budgeted daily round
  ./model_lab.py --smoke                 3 models, one cheap probe
  ./model_lab.py --full                  every task for every model (manual)
  ./model_lab.py --model X               full suite for one model
  ./model_lab.py --budget 25             spend more of today's allowance
  ./model_lab.py --no-apply              measure only
  ./model_lab.py --enable-paid           persist: also bench paid opencode models
  ./model_lab.py --enable-omniroute      persist: also bench gateway models
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import oclib  # noqa: E402
import lab_tasks  # noqa: E402

# --------------------------------------------------------------------- suite

BROKEN_CALC = """\
def average(nums):
    return sum(nums) / (len(nums) - 1)


def median(nums):
    s = sorted(nums)
    n = len(s)
    if n % 2:
        return s[n // 2]
    return (s[n // 2 - 1] + s[n // 2]) / 2


if __name__ == "__main__":
    print(average([2, 4, 6]))
"""

BUGGY = """def total(items):
    s = 0
    for i in range(len(items) - 1):
        s += items[i]
    return s


def mean(items):
    return total(items) / len(items)
"""
NONCE = "ORCHID-7731"

CONTEXT_DOC = "\n".join(
    f"Line {i:04d}: routine maintenance note, batch {i % 37}, "
    f"no action required, reference {i * 7919 % 104729}."
    for i in range(1, 900)
) + f"\n\nThe single value you must recover is {NONCE}. Nothing else matters.\n"


HARD = lab_tasks.HARD_TASKS

TASK_TIMEOUTS = {
    "sanity": 60,
    "instruction": 60,
    "reason": 90,
    "bug_hunt": 90,
    "tool_use": 120,
    "code_fix": 180,
    "context": 180,
    **{t: spec["timeout"] for t, spec in HARD.items()},
}

TASKS = ["sanity", "instruction", "reason", "bug_hunt", "code_fix", "tool_use", "context", *HARD]
# sanity/instruction/reason/bug_hunt saturate (every live model passes), so the
# daily rotation skips them; --full and --model still run the whole suite.
CHEAP_TASKS = ["instruction_multi", "plan_puzzle"]
DEEP_TASKS = ["code_multi", "review_hunt", "explore_trace", "code_fix", "tool_use", "context"]
ROTATION_TASKS = CHEAP_TASKS + DEEP_TASKS

# Estimated assistant messages each task consumes from the daily allowance.
TASK_COST = {
    "sanity": 1,
    "instruction": 1,
    "reason": 1,
    "bug_hunt": 2,
    "code_fix": 4,
    "tool_use": 3,
    "context": 2,
    **{t: spec["cost"] for t, spec in HARD.items()},
}

DEFAULT_BUDGET = 14          # assistant messages per daily round (opencode free tier)
# Each provider has its own quota, so benching one never spends another's.
# nvidia: NVIDIA NIM free API (40 req/min, 10,000 req/day per account), so its budget is not the constraint
DEFAULT_BUDGETS = {"opencode": 14, "openrouter": 20, "omniroute": 24, "nvidia": 60}
DEFAULT_PROVIDERS = ["opencode", "openrouter", "omniroute", "nvidia"]
# Added to a model's score when ranking, so a free OpenCode model wins near-ties.
# nvidia sits between: free with a daily cap high enough for all-day use, but prompts are logged by NVIDIA
DEFAULT_BIAS = {"opencode": 8.0, "omniroute": 0.0, "openrouter": -2.0, "nvidia": 4.0}
NON_CHAT = {"omniroute/omni-image"}
# classifiers, guards and embedders are listed as free models but cannot run an agent turn
NON_CHAT_RE = re.compile(r"(?i)(content-safety|guard|embed|moderation|rerank|whisper|tts|image-gen)")
CHEAP_MODELS_PER_DAY = 4
DEEP_PER_DAY = 3
REFRESH_DAYS = 5           # re-measure a (model, task) pair at most this often
WINDOW_DAYS = 21


def run_task(model: str, task: str, workdir: str) -> dict:
    """Execute one task. Returns {passed, score, detail, latency, usage, error, error_kind}."""
    if task in HARD:
        spec = HARD[task]
        ctx = spec["setup"](workdir) if spec["setup"] else {}
        files = [os.path.join(workdir, f) for f in spec.get("files", [])]
        r = oclib.run_model(model, spec["prompt"], workdir, timeout=spec["timeout"], files=files or None)
        score, detail = (spec["grade"](workdir, r["text"], ctx) if r["ok"] else (0.0, ""))
        return {"passed": score >= 0.999, "score": score, "detail": f"{detail} | {r['text'][:120]}",
                "latency": r["latency"], "usage": r["usage"], "error": r["error"],
                "error_kind": r["error_kind"]}

    if task == "code_fix":
        with open(os.path.join(workdir, "calc.py"), "w") as f:
            f.write(BROKEN_CALC)
        prompt = (
            "calc.py has a bug: average([2, 4, 6]) returns 6.0 instead of 4.0. "
            "Find it, edit calc.py to fix it, then run `" + oclib.PYTHON_CMD + " calc.py` and "
            "reply with the number it printed."
        )
        r = oclib.run_model(model, prompt, workdir, timeout=TASK_TIMEOUTS[task])
        passed = False
        if r["ok"]:
            try:
                out = subprocess.run(
                    [sys.executable, "-c", "import calc; print(calc.average([2,4,6]))"],
                    cwd=workdir, capture_output=True, text=True, timeout=20, **oclib.NO_WINDOW)
                passed = out.stdout.strip().startswith("4.0") and "4" in r["text"]
            except Exception:
                passed = False
        return {"passed": passed, "detail": r["text"][:200], "latency": r["latency"],
                "usage": r["usage"], "error": r["error"], "error_kind": r["error_kind"]}

    if task == "tool_use":
        prompt = (
            "Create a file named out.txt in the current directory whose entire "
            "content is the four characters PONG (no newline needed, but harmless). "
            "Then run `wc -c < out.txt`. Reply with only the resulting number."
        )
        r = oclib.run_model(model, prompt, workdir, timeout=TASK_TIMEOUTS[task])
        path = os.path.join(workdir, "out.txt")
        content = ""
        if os.path.exists(path):
            with open(path, "rb") as fh:
                content = fh.read().decode("utf-8", "replace")
        numbers = re.findall(r"\d+", r["text"])
        passed = content.strip() == "PONG" and "4" in numbers
        return {"passed": passed, "detail": f"file={content[:20]!r} text={r['text'][:60]!r}",
                "latency": r["latency"], "usage": r["usage"], "error": r["error"],
                "error_kind": r["error_kind"]}

    if task == "reason":
        prompt = (
            "A clock shows 3:15. What is the exact angle in degrees between the "
            "hour hand and the minute hand? Reply with only the number, no units."
        )
        r = oclib.run_model(model, prompt, workdir, timeout=TASK_TIMEOUTS[task])
        nums = re.findall(r"-?\d+(?:\.\d+)?", r["text"])
        passed = bool(nums) and abs(float(nums[0]) - 7.5) < 1e-6
        return {"passed": passed, "detail": r["text"][:80], "latency": r["latency"],
                "usage": r["usage"], "error": r["error"], "error_kind": r["error_kind"]}

    if task == "bug_hunt":
        path = os.path.join(workdir, "buggy.py")
        with open(path, "w") as f:
            f.write(BUGGY)
        prompt = (
            "buggy.py has a bug: total([1,2,3]) returns 3 instead of 6. "
            "Read the file and reply with only the line number (1-based) that "
            "contains the defect."
        )
        r = oclib.run_model(model, prompt, workdir, timeout=TASK_TIMEOUTS[task])
        text = (r["text"] or "").strip()
        passed = bug_hunt_answer(text)
        return {"passed": passed, "detail": text[:120], "latency": r["latency"],
                "usage": r["usage"], "error": r["error"], "error_kind": r["error_kind"]}

    if task == "instruction":
        prompt = (
            'Reply with exactly this JSON and nothing else, no code fence, no prose: '
            '{"model":"ok","n":7}'
        )
        r = oclib.run_model(model, prompt, workdir, timeout=TASK_TIMEOUTS[task])
        raw = r["text"].strip()
        passed = False
        try:
            passed = json.loads(raw) == {"model": "ok", "n": 7}
        except Exception:
            passed = False
        return {"passed": passed, "detail": raw[:100], "latency": r["latency"],
                "usage": r["usage"], "error": r["error"], "error_kind": r["error_kind"]}

    if task == "context":
        path = os.path.join(workdir, "notes.txt")
        with open(path, "w") as f:
            f.write(CONTEXT_DOC)
        prompt = (
            "Read notes.txt. It contains one unique identifier of the form "
            "WORD-NNNN. Reply with only that identifier."
        )
        r = oclib.run_model(model, prompt, workdir, timeout=TASK_TIMEOUTS[task], files=[path])
        passed = NONCE.lower() in r["text"].lower()
        return {"passed": passed, "detail": r["text"][:80], "latency": r["latency"],
                "usage": r["usage"], "error": r["error"], "error_kind": r["error_kind"]}

    if task == "sanity":
        r = oclib.run_model(model, "What is 17 * 23? Reply with only the number.",
                            workdir, timeout=TASK_TIMEOUTS[task])
        passed = bool(re.search(r"\b391\b", r["text"]))
        return {"passed": passed, "detail": r["text"][:60], "latency": r["latency"],
                "usage": r["usage"], "error": r["error"], "error_kind": r["error_kind"]}

    raise ValueError(task)


def bug_hunt_answer(text: str) -> bool:
    """True if the reply names line 3 and not some other line number."""
    return bool(
        re.search(r"(?i)\bline\s*(?:number\s*)?[:#]?\s*3\b", text)
        or re.search(r"(?i)\b3(?:rd)?\s+line\b", text)
        or re.fullmatch(r"3\s*[.)]?", text)
    )


# ------------------------------------------------------------------ scoring

WEIGHTS = {
    "code_fix": 2.0,
    "tool_use": 2.0,
    "reason": 1.5,
    "bug_hunt": 1.5,
    "instruction": 1.0,
    "context": 1.5,
    "sanity": 0.5,
    "code_multi": 3.0,
    "review_hunt": 3.0,
    "plan_puzzle": 3.0,
    "instruction_multi": 2.0,
    "explore_trace": 3.0,
}

CATEGORY_WEIGHTS = {
    "build":   {"code_multi": 2.0, "code_fix": 1.5, "tool_use": 1.5, "instruction_multi": 1.0,
                "explore_trace": 1.0, "review_hunt": 0.7, "plan_puzzle": 0.5, "context": 0.5},
    "plan":    {"plan_puzzle": 2.5, "reason": 1.5, "explore_trace": 1.0, "review_hunt": 1.0,
                "instruction_multi": 1.0, "code_multi": 0.5, "tool_use": 0.5},
    "explore": {"explore_trace": 2.5, "context": 2.0, "tool_use": 1.0, "review_hunt": 0.5,
                "code_multi": 0.3, "plan_puzzle": 0.5},
    "review":  {"review_hunt": 2.5, "bug_hunt": 1.5, "code_multi": 1.0, "plan_puzzle": 1.0,
                "explore_trace": 0.7, "instruction_multi": 0.7},
    "quick":   {"instruction_multi": 2.0, "instruction": 1.5, "sanity": 1.5, "code_multi": 0.2,
                "explore_trace": 0.2, "plan_puzzle": 0.5},
}


def task_value(res) -> float:
    """A measurement as 0..1: graded tasks store a score, legacy rows a pass flag."""
    if isinstance(res, dict):
        if res.get("score") is not None:
            return float(res["score"])
        return 1.0 if res.get("passed") else 0.0
    if isinstance(res, bool):
        return 1.0 if res else 0.0
    return float(res or 0.0)


def score_run(runs: dict, category: str, task_means: dict | None = None) -> float:
    """Weighted score in 0..100. A task this model was never given counts at the
    pool's mean for that task, so luck of the rotation (easy tasks vs hard ones)
    cannot decide the ranking."""
    num = den = 0.0
    tasks = set(runs) | set(task_means or {})
    for task in tasks:
        if task not in WEIGHTS:
            continue
        if task in runs:
            val = task_value(runs[task])
        else:
            val = (task_means or {}).get(task)
            if val is None:
                continue
        w = WEIGHTS[task] * CATEGORY_WEIGHTS.get(category, {}).get(task, 1.0)
        den += w
        num += w * val
    return round(100.0 * num / den, 1) if den else 0.0


def shrink(raw: float, measured: int) -> float:
    """Pull sparse evidence toward 50 so two lucky passes cannot outrank a
    model measured on the whole suite."""
    return round(50.0 + (raw - 50.0) * (measured / (measured + 3.0)), 1)


# ---------------------------------------------------------------- discovery

def provider(model: str) -> str:
    return model.split("/", 1)[0]


def lab_settings(ladders: dict | None = None) -> dict:
    st = dict((ladders or oclib.load_ladders()).get("settings") or {})
    st.setdefault("providers", list(DEFAULT_PROVIDERS))
    st["budgets"] = {**DEFAULT_BUDGETS, **(st.get("budgets") or {})}
    st["provider_bias"] = {**DEFAULT_BIAS, **(st.get("provider_bias") or {})}
    return st


def declared(prov: str) -> list[str]:
    """Models listed under providers.<prov>.models in opencode.json."""
    cfg = oclib.load_json(oclib.CONFIG_PATH, {}) or {}
    models = ((cfg.get("providers") or {}).get(prov) or {}).get("models") or {}
    return [f"{prov}/{m}" for m in models]


def declared_omniroute() -> list[str]:
    return declared("omniroute")


def declared_nvidia() -> list[str]:
    # OpenCode lists every NIM model for the key (guards, embedders, dead endpoints);
    # only the ones declared in opencode.json are benched and ranked
    return declared("nvidia")


def candidates(args) -> list[str]:
    """Every model the daily round may bench, grouped later by provider:
    free OpenCode models, free OpenRouter models, and the OmniRoute models
    declared in opencode.json. Each provider is spent from its own budget."""
    all_models = oclib.list_models()
    explicit = list(args.model or [])
    if explicit:
        return dedupe(explicit)

    ladders = oclib.load_ladders()
    settings = ladders.get("settings") or {}
    if args.enable_paid:
        settings["test_paid"] = True
    if args.enable_omniroute:
        settings["test_omniroute"] = True
        settings["providers"] = dedupe(list(settings.get("providers") or DEFAULT_PROVIDERS) + ["omniroute"])
    if args.enable_paid or args.enable_omniroute:
        ladders["settings"] = settings
        oclib.save_ladders(ladders)
    providers = set(lab_settings(ladders)["providers"])
    if args.include_omniroute or args.all_free:
        providers |= {"omniroute", "openrouter"}

    pool: list[str] = []
    # models the harness already trusts first, in ladder order
    for cat in oclib.CATEGORIES:
        pool += [m for m in ladders["categories"].get(cat, []) if provider(m) in providers]
    free = oclib.free_models(all_models)
    if "opencode" in providers:
        pool += [m for m in free if m.startswith("opencode/")]
    if "openrouter" in providers:
        pool += [m for m in free if m.startswith("openrouter/")]
    if "omniroute" in providers:
        pool += declared_omniroute()
    if "nvidia" in providers:
        pool += declared_nvidia()
    if args.include_paid or settings.get("test_paid"):
        pool += [m for m in all_models if m.startswith("opencode/") and not oclib.is_free(m)]

    live = set(all_models)
    return dedupe([m for m in pool if m in live and m not in NON_CHAT and not NON_CHAT_RE.search(m)])


def dedupe(items):
    seen, out = set(), []
    for x in items:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


# ------------------------------------------------------------------ storage

def init_db() -> sqlite3.Connection:
    os.makedirs(oclib.STATE_DIR, exist_ok=True)
    con = sqlite3.connect(oclib.LAB_DB, timeout=30)
    con.execute("""
        create table if not exists run (
            id integer primary key autoincrement,
            ts text not null,
            model text not null,
            task text not null,
            passed integer not null,
            latency real not null,
            tokens_in integer not null,
            tokens_out integer not null,
            cost real not null,
            detail text,
            error text,
            score real
        )""")
    cols = {r[1] for r in con.execute("pragma table_info(run)")}
    if "score" not in cols:
        con.execute("alter table run add column score real")
        con.execute("update run set score = passed")
    con.execute("create index if not exists run_model_ts on run(model, ts)")
    con.execute("delete from run where ts < ?",
                (time.strftime("%Y-%m-%dT%H:%M:%S",
                               time.gmtime(time.time() - (WINDOW_DAYS + 30) * 86400)),))
    con.commit()
    return con


def persist(con, model: str, task: str, res: dict) -> None:
    u = res.get("usage") or {}
    err = res.get("error") or ""
    if res.get("error_kind"):
        err = f"[{res['error_kind']}] {err}".strip()
    con.execute(
        "insert into run (ts,model,task,passed,latency,tokens_in,tokens_out,cost,detail,error,score)"
        " values (?,?,?,?,?,?,?,?,?,?,?)",
        (time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()), model, task,
         1 if res["passed"] else 0,
         res.get("latency", 0), int(u.get("input", 0)), int(u.get("output", 0)),
         float(u.get("cost", 0)), (res.get("detail") or "")[:400], err[:400],
         float(task_value(res))),
    )
    con.commit()


def last_tested(con) -> dict[tuple[str, str], str]:
    rows = con.execute("select model, task, max(ts) from run group by model, task").fetchall()
    return {(m, t): ts for m, t, ts in rows}


def latest_matrix(con, days: int = WINDOW_DAYS) -> dict[str, dict[str, float]]:
    """Latest score (0..1) per (model, task) inside the rolling window."""
    cutoff = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(time.time() - days * 86400))
    # rows dated in the future are not measurements (a simulation once wrote 104 of them,
    # all perfect scores, which inflated every pool mean): never count them
    horizon = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(time.time() + 3600))
    rows = con.execute(
        "select model, task, coalesce(score, passed) from run where ts >= ? and ts <= ? order by ts, id",
        (cutoff, horizon),
    ).fetchall()
    matrix: dict[str, dict[str, float]] = {}
    for model, task, score in rows:
        matrix.setdefault(model, {})[task] = float(score)
    return matrix


def task_means(matrix: dict[str, dict[str, float]]) -> dict[str, float]:
    sums: dict[str, list[float]] = {}
    for tasks in matrix.values():
        for task, val in tasks.items():
            sums.setdefault(task, []).append(task_value(val))
    return {t: sum(v) / len(v) for t, v in sums.items()}


def scores_from_matrix(matrix: dict[str, dict[str, float]]) -> dict[str, dict[str, float]]:
    means = task_means(matrix)
    return {
        model: {cat: shrink(score_run(tasks, cat, means), len(tasks)) for cat in oclib.CATEGORIES}
        for model, tasks in matrix.items()
    }


def model_facts(con, days: int = 7) -> dict:
    cutoff = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(time.time() - days * 86400))
    rows = con.execute(
        "select model, avg(latency), sum(tokens_in+tokens_out), sum(cost), count(*)"
        " from run where ts >= ? group by model", (cutoff,)
    ).fetchall()
    return {m: {"latency": round(lat or 0, 1), "tokens": t or 0,
                "cost": round(c or 0.0, 6), "runs": n} for m, lat, t, c, n in rows}


# ------------------------------------------------------------------ planner

def plan_round(con, models: list[str], budget: int) -> tuple[dict[str, list[str]], int]:
    """Pick today's (model, task) pairs so coverage grows without exhausting
    the shared daily allowance. Returns ({model: [tasks]}, remaining_budget)."""
    day = int(time.time() // 86400)
    last = last_tested(con)
    fresh_after = time.strftime("%Y-%m-%dT%H:%M:%S",
                                time.gmtime(time.time() - REFRESH_DAYS * 86400))

    def fresh(model: str, task: str) -> bool:
        ts = last.get((model, task))
        return bool(ts and ts >= fresh_after)

    plans: dict[str, list[str]] = {m: [] for m in models}
    remaining = budget

    # deep probes first, least recently measured first, so an expensive task is
    # never starved by cheap probes that already spent the day's budget
    order = {pair: i for i, pair in enumerate((m, t) for t in DEEP_TASKS for m in models)}
    n_pairs = max(len(order), 1)
    offset = (day * DEEP_PER_DAY) % n_pairs
    due = [(m, t) for (m, t) in order if not fresh(m, t)]
    due.sort(key=lambda p: (last.get(p, ""), (order[p] - offset) % n_pairs))
    picked = 0
    for m, t in due:
        if picked >= DEEP_PER_DAY or remaining <= 0:
            break
        cost = TASK_COST[t]
        if cost > remaining:
            continue
        plans[m].append(t)
        remaining -= cost
        picked += 1

    # cheap probes with what is left, least recently measured first; a fixed
    # rotating slice aliases with the task alternation when the pool size is a
    # multiple of the slice (8 models, 4/day: each half only ever saw one task)
    cheap_task = CHEAP_TASKS[day % len(CHEAP_TASKS)]
    n = len(models)
    if n:
        rank = {m: (i - day * CHEAP_MODELS_PER_DAY) % n for i, m in enumerate(models)}
        due = [m for m in models if not fresh(m, cheap_task) and cheap_task not in plans[m]]
        due.sort(key=lambda m: (last.get((m, cheap_task), ""), rank[m]))
        for m in due[:CHEAP_MODELS_PER_DAY]:
            if remaining < TASK_COST[cheap_task]:
                break
            plans[m].append(cheap_task)
            remaining -= TASK_COST[cheap_task]

    return {m: t for m, t in plans.items() if t}, remaining


def notify(title: str, body: str) -> None:
    """Desktop notification so a background recalibration is visible."""
    if not shutil.which("notify-send"):
        return
    try:
        subprocess.run(["notify-send", "-a", "opencode", "-i", "utilities-terminal",
                        title, body], timeout=5, capture_output=True)
    except Exception:
        pass


# -------------------------------------------------------------------- apply

SPEED_FREE_S = 4.0   # a step this fast costs nothing
SPEED_CAP_S = 40.0
SPEED_WEIGHT = {"build": 0.3, "plan": 0.3, "explore": 0.3, "review": 0.3, "quick": 0.6}  # points per second


def apply_ladders(scores: dict, facts: dict, models_alive: set[str],
                  catalog: set[str] | None = None, meta: dict | None = None,
                  steps: dict[str, float] | None = None) -> dict:
    """One ranking per category across every provider. A model's rank is its
    measured score minus a latency penalty plus its provider's bias, so a free
    OpenCode model wins near-ties but a clearly better gateway model can lead.
    Unmeasured models keep their previous relative order behind the measured ones."""
    ladders = oclib.load_ladders()
    previous = {cat: list(chain) for cat, chain in ladders["categories"].items()}
    bias = lab_settings(ladders)["provider_bias"]
    live = set(oclib.list_models()) or set(catalog or ()) | models_alive
    known = (catalog if catalog is not None else models_alive) | {m for c in previous.values() for m in c}

    # seconds per step in real sessions (last 3 days): what the user actually waits for. The lab's
    # task latency barely counted (0.05/s) and could not show a head model at 20-31 s/step next to
    # near-equal ones at 2-5 s (2026-11-06). Free above SPEED_FREE_S, capped at SPEED_CAP_S.
    if steps is None:
        steps = oclib.step_latency(time.time() - 3 * 86400, min_steps=6)
    for cat in oclib.CATEGORIES:
        prior = {m: i for i, m in enumerate(previous.get(cat, []))}
        ranked = []
        for model, per_cat in scores.items():
            if model not in models_alive or model not in live:
                continue
            base = per_cat.get(cat, 0.0)
            if model in steps:
                base -= SPEED_WEIGHT[cat] * max(0.0, min(steps[model], SPEED_CAP_S) - SPEED_FREE_S)
            else:
                lat = min(facts.get(model, {}).get("latency") or 30, 60)
                base -= lat * (0.35 if cat == "quick" else 0.05)
            if base <= 0:
                continue
            ranked.append((round(base + bias.get(provider(model), 0.0), 2), model))
        ranked.sort(key=lambda x: (-x[0], prior.get(x[1], 999), x[1]))

        chain = [m for _, m in ranked]
        seen = set(chain)
        # unmeasured but still-live models keep their old order behind the measured ones
        chain += [m for m in previous.get(cat, []) if m not in seen and m not in scores and m in live]
        seen = set(chain)
        chain += sorted(m for m in known if m not in seen and m not in scores and m in live
                        and m.startswith("opencode/") and oclib.is_free(m))
        ladders["categories"][cat] = chain

    ladders["scores"] = {
        m: {"per_category": s, **facts.get(m, {})} for m, s in scores.items()
    }
    if meta:
        merged = dict(ladders.get("meta") or {})
        merged.update({m: meta[m] for m in scores if m in meta})
        ladders["meta"] = merged
    oclib.save_ladders(ladders)
    return ladders


# --------------------------------------------------------------------- main

def spend(res: dict, task: str) -> int:
    used = int((res.get("usage") or {}).get("messages", 0) or 0)
    return max(used, TASK_COST.get(task, 1))


def run_round(con, plans: dict[str, list[str]], budget: int, prov: str) -> tuple[int, bool]:
    """Spend at most `budget` messages of one provider. Returns (spent, quota_hit)."""
    spent = 0
    quota_hit = False
    rate_limited = 0
    for model, task_list in plans.items():
        if quota_hit:
            break
        timeouts = 0
        with tempfile.TemporaryDirectory(prefix="oc-lab-") as workdir:
            for task in task_list:
                if spent >= budget:
                    return spent, quota_hit

                res = run_task(model, task, workdir)

                # retry one transient provider failure before writing anything
                if res.get("error_kind") in ("empty", "rate_limit"):
                    oclib.log("model_lab", f"{model:52} {task:12} {res['error_kind']} — retrying once")
                    time.sleep(5)
                    res = run_task(model, task, workdir)

                kind = res.get("error_kind") or ""
                if kind == "free_limit":
                    quota_hit = True
                    oclib.log("model_lab", f"{prov}: free tier exhausted — aborting this provider, ladders will use rolling data")
                    break
                if kind == "rate_limit":
                    rate_limited += 1
                    if rate_limited >= 2:
                        quota_hit = True
                        oclib.log("model_lab", f"{prov}: rate limited twice — stopping this provider for today")
                        break
                if kind in ("empty", "rate_limit", "unavailable"):
                    oclib.log("model_lab", f"{model:52} {task:12} skipped ({kind})")
                    continue

                persist(con, model, task, res)
                spent += spend(res, task)
                score = task_value(res)
                oclib.log("model_lab",
                          f"{model:52} {task:17} {'PASS' if res['passed'] else ('PART' if score > 0 else 'FAIL')}"
                          f" {score:4.2f} {res.get('latency', 0):6.1f}s {res.get('detail', '')[:60]!r}")

                if kind == "timeout":
                    timeouts += 1
                    if timeouts >= 2:
                        oclib.log("model_lab", f"{model:52} unresponsive — skipping remaining tasks")
                        break
                else:
                    timeouts = 0
    return spent, quota_hit


def main() -> int:
    ap = argparse.ArgumentParser(description="OpenCode model lab")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--smoke", action="store_true")
    ap.add_argument("--full", action="store_true")
    ap.add_argument("--all-free", action="store_true")
    ap.add_argument("--include-omniroute", action="store_true")
    ap.add_argument("--enable-paid", action="store_true",
                    help="persist test_paid=true so every daily run also benches paid opencode models")
    ap.add_argument("--enable-omniroute", action="store_true",
                    help="persist omniroute in settings.providers")
    ap.add_argument("--include-paid", action="store_true")
    ap.add_argument("--model", action="append")
    ap.add_argument("--provider", action="append",
                    help="only bench these providers this run (opencode, openrouter, omniroute, nvidia)")
    ap.add_argument("--budget", type=int, default=None,
                    help="messages to spend per provider this round (default: settings.budgets)")
    ap.add_argument("--no-apply", action="store_true")
    ap.add_argument("--rerank", action="store_true",
                    help="re-rank the ladders from stored results and current step speeds; runs no task")
    args = ap.parse_args()

    pool = candidates(args)
    if args.provider:
        pool = [m for m in pool if provider(m) in set(args.provider)]
    if args.list:
        for m in pool:
            print(m)
        print(f"\n{len(pool)} candidates")
        return 0

    if not pool:
        oclib.log("model_lab", "no candidates discovered — aborting")
        return 1

    con = init_db()
    settings = lab_settings()
    explicit = bool(args.model)

    by_provider: dict[str, list[str]] = {}
    for m in pool if not args.rerank else []:
        by_provider.setdefault(provider(m), []).append(m)

    total_spent, quota_any, all_plans = 0, False, {}
    for prov, models in by_provider.items():
        budget = args.budget if args.budget is not None else int(settings["budgets"].get(prov, DEFAULT_BUDGET))
        if args.smoke:
            plans = {m: [CHEAP_TASKS[int(time.time() // 86400) % len(CHEAP_TASKS)]] for m in models[:3]}
        elif explicit or args.full:
            plans = {m: list(TASKS) for m in models}
            budget = 10 ** 6
        else:
            plans, _ = plan_round(con, models, budget)
        if not plans:
            continue
        task_total = sum(len(t) for t in plans.values())
        oclib.log("model_lab", f"round[{prov}]: {len(plans)} models, {task_total} tasks, budget {budget}")
        spent, quota_hit = run_round(con, plans, budget, prov)
        total_spent += spent
        quota_any = quota_any or quota_hit
        all_plans.update(plans)

    con.close()

    con = init_db()
    matrix = latest_matrix(con)
    facts = model_facts(con)
    con.close()
    scores = scores_from_matrix(matrix)
    alive = {m for m, tasks in matrix.items() if any(task_value(v) > 0 for v in tasks.values())}

    if not args.rerank:  # a re-rank measured nothing: keep the last round's record
        with open(oclib.LAB_RESULTS, "w", encoding="utf-8") as f:
            json.dump({"ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
                       "quota_hit": quota_any, "spent": total_spent, "plans": all_plans,
                       "scores": scores, "facts": facts}, f, indent=2)

    if not all_plans and not args.rerank:
        oclib.log("model_lab", "nothing is due this round — ladders untouched")
        return 0

    if not scores:
        oclib.log("model_lab", "no measurements yet — ladders untouched")
        return 0

    if args.no_apply:
        oclib.log("model_lab", f"--no-apply: {len(scores)} models scored, ladders untouched")
        return 0

    meta = oclib.fetch_model_meta()
    if not meta:
        oclib.log("model_lab", "models.dev unreachable — keeping previous context metadata")
        meta = oclib.load_ladders().get("meta") or {}

    ladders = apply_ladders(scores, facts, alive, set(pool), meta)
    oclib.sync_agents(ladders)
    oclib.sync_config_models(ladders)
    oclib.autocommit_models("lab")

    heads =" | ".join(f"{c}:{ladders['categories'][c][0]}" for c in oclib.CATEGORIES)
    oclib.log("model_lab", f"applied ladders -> {heads}")

    pkg = oclib.package_version_info()
    if pkg.get("behind"):
        oclib.log("model_lab", f"opencode-desktop-bin {pkg['installed']} -> {pkg['available']} available (pacman)")
        notify("OpenCode update available",
               f"{pkg['installed']} -> {pkg['available']}\nyay -Syu opencode-desktop-bin")

    if quota_any:
        notify("OpenCode lab: a provider hit its quota",
               f"stopped after {total_spent} messages; ladders updated from rolling data")
    else:
        notify("OpenCode lab complete", heads.replace(" | ", "\n"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
