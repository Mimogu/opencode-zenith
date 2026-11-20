#!/usr/bin/env python3
"""
oclib.py — shared foundation for the OpenCode harness.

One source of truth for:
  * ladders.json (model rankings per agent category)
  * atomic, locked config rewrites that never clobber each other
  * model discovery from the live CLI
  * agent frontmatter synchronisation
  * rotating logs

Every other script in ~/.config/opencode imports this. Nothing writes
opencode.json or ladders.json directly any more.
"""

from __future__ import annotations

import contextlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import time
import urllib.parse
from datetime import datetime, timezone
from typing import Any, Callable

try:  # POSIX
    import fcntl
except ImportError:  # Windows
    fcntl = None
    import msvcrt

IS_WINDOWS = os.name == "nt"

# the config dir is wherever this file lives (~/.config/opencode here; elsewhere on Windows)
CONFIG_DIR = os.path.dirname(os.path.abspath(__file__))
STATE_DIR = os.path.join(CONFIG_DIR, "state")
AGENTS_DIR = os.path.join(CONFIG_DIR, "agents")
LADDERS_PATH = os.path.join(CONFIG_DIR, "ladders.json")
CONFIG_PATH = os.path.join(CONFIG_DIR, "opencode.json")
LEDGER_PATH = os.path.join(CONFIG_DIR, ".cooldown_state.json")
LAB_DB = os.path.join(STATE_DIR, "model_lab.db")
LAB_RESULTS = os.path.join(STATE_DIR, "lab_results.json")
# OpenCode's own data dir. The Windows installer records the real locations
# (from `opencode debug paths`) in paths.json; elsewhere the XDG default holds.
_PATHS = {}
try:
    with open(os.path.join(CONFIG_DIR, "paths.json"), encoding="utf-8-sig") as _fh:
        _PATHS = json.load(_fh) or {}
except Exception:
    pass
DATA_DIR = _PATHS.get("data") or os.path.join(
    os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share"), "opencode")
OPENCODE_DB = _PATHS.get("db") or os.path.join(DATA_DIR, "opencode.db")
OPENCODE_LOG = os.path.join(_PATHS.get("log") or os.path.join(DATA_DIR, "log"), "opencode.log")
OPENCODE_BIN = (shutil.which("opencode") or _PATHS.get("bin")
                or os.path.expanduser("~/.local/bin/opencode"))
# how to launch OpenCode. On Windows npm installs a .cmd shim, and arguments
# passed through cmd.exe get mangled (quotes, &, |), so the installer records
# the real entry point in paths.json as "cmd" (e.g. ["node", ".../bin/opencode"]).
_cmd = _PATHS.get("cmd")
OPENCODE_CMD = [_cmd] if isinstance(_cmd, str) else list(_cmd or [OPENCODE_BIN])
# the interpreter the plugins and prompts should name ("python3" is a Store stub on Windows)
PYTHON_CMD = "python" if IS_WINDOWS else "python3"
# keep background (pythonw) runs from flashing a console window per child process
NO_WINDOW: dict[str, Any] = {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0)} if IS_WINDOWS else {}

CATEGORIES = ("build", "plan", "explore", "review", "quick")

# agent markdown file -> category
AGENT_ROLES = {
    "build.md": "build",
    "build-error-resolver.md": "build",
    "refactor-cleaner.md": "build",
    "tdd-guide.md": "build",
    "e2e-runner.md": "build",
    "harness-optimizer.md": "build",
    "browser.md": "build",
    "architect.md": "plan",
    "planner.md": "plan",
    "explorer.md": "explore",
    "docs-lookup.md": "explore",
    "doc-updater.md": "explore",
    "verifier.md": "review",
    "code-reviewer.md": "review",
    "security-reviewer.md": "review",
    "database-reviewer.md": "review",
    "thermo-review.md": "review",
    "thermo-quality-review.md": "review",
    "comment-sicko.md": "review",
    "quick.md": "quick",
}


# ---------------------------------------------------------------- json + locks

@contextlib.contextmanager
def _locked(path: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    lock_path = path + ".lock"
    with open(lock_path, "a+") as fh:
        if fcntl is not None:
            fcntl.flock(fh, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(fh, fcntl.LOCK_UN)
            return
        # Windows: lock one byte; LK_LOCK retries for ~10 s, so loop for longer waits
        fh.seek(0)
        while True:
            try:
                msvcrt.locking(fh.fileno(), msvcrt.LK_LOCK, 1)
                break
            except OSError:
                time.sleep(0.2)
        try:
            yield
        finally:
            fh.seek(0)
            msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)


def load_json(path: str, default: Any = None) -> Any:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def atomic_write_json(path: str, data: Any) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.tmp.{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def update_config(mutator: Callable[[dict], None]) -> dict:
    """Read-modify-write opencode.json under a lock. Preserves every other key."""
    with _locked(CONFIG_PATH):
        cfg = load_json(CONFIG_PATH, {}) or {}
        mutator(cfg)
        atomic_write_json(CONFIG_PATH, cfg)
        return cfg


# ------------------------------------------------------------------- ladders

def default_ladders() -> dict:
    seeds = {
        "build": [
            "opencode/flint-40b-free",
            "opencode/deepseek-v4.1-flash-free",
            "opencode/nemotron-3.5-super-vl-free",
            "opencode/beam-free",
            "opencode/mimo-v2.6-flash-free",
            "opencode/nemotron-3.5-lightning-free",
            "opencode/glm-5.3-flash-free",
            "openrouter/nvidia/nemotron-3.5-super-vl:free",
            "omniroute/omni-code",
            "omniroute/auto/best-coding",
            "omniroute/antigravity/claude-sonnet-4-6",
        ],
        "plan": [
            "opencode/deepseek-v4.1-flash-free",
            "opencode/flint-40b-free",
            "opencode/nemotron-3.5-super-vl-free",
            "opencode/beam-free",
            "opencode/mimo-v2.6-flash-free",
            "opencode/nemotron-3.5-lightning-free",
            "opencode/glm-5.3-flash-free",
            "openrouter/nvidia/nemotron-3.5-super-vl:free",
            "omniroute/auto/best-reasoning",
            "omniroute/omni-review",
            "omniroute/antigravity/claude-opus-4-6-thinking",
        ],
        "explore": [
            "opencode/nemotron-3.5-super-vl-free",
            "opencode/beam-free",
            "opencode/flint-40b-free",
            "opencode/deepseek-v4.1-flash-free",
            "opencode/mimo-v2.6-flash-free",
            "opencode/glm-5.3-flash-free",
            "opencode/nemotron-3.5-lightning-free",
            "openrouter/nvidia/nemotron-3.5-super-vl:free",
            "omniroute/omni-explore",
            "omniroute/auto/fast",
            "omniroute/agnes/agnes-3.0-flash",
        ],
        "review": [
            "opencode/deepseek-v4.1-flash-free",
            "opencode/flint-40b-free",
            "opencode/nemotron-3.5-super-vl-free",
            "opencode/beam-free",
            "opencode/mimo-v2.6-flash-free",
            "opencode/nemotron-3.5-lightning-free",
            "opencode/glm-5.3-flash-free",
            "openrouter/nvidia/nemotron-3.5-super-vl:free",
            "omniroute/omni-review",
            "omniroute/auto/best-reasoning",
            "omniroute/antigravity/claude-opus-4-6-thinking",
        ],
        "quick": [
            "opencode/mimo-v2.6-flash-free",
            "opencode/beam-free",
            "opencode/flint-40b-free",
            "opencode/glm-5.3-flash-free",
            "opencode/nemotron-3.5-super-vl-free",
            "opencode/nemotron-3.5-lightning-free",
            "opencode/deepseek-v4.1-flash-free",
            "openrouter/nvidia/nemotron-3.5-lightning:free",
            "omniroute/omni-quick",
            "omniroute/auto/best-fast",
            "omniroute/antigravity/gemini-3.5-flash-lite",
        ],
    }
    return {
        "schema_version": 2,
        "updated": None,
        "categories": {cat: list(seeds[cat]) for cat in CATEGORIES},
        "scores": {},
    }


def load_ladders() -> dict:
    data = load_json(LADDERS_PATH)
    if not isinstance(data, dict) or "categories" not in data:
        data = default_ladders()
    for cat in CATEGORIES:
        data["categories"].setdefault(cat, [])
        # never leave a category empty
        if not data["categories"][cat]:
            data["categories"][cat] = list(default_ladders()["categories"][cat])
    data.setdefault("scores", {})
    return data


def save_ladders(data: dict) -> None:
    data["updated"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    with _locked(LADDERS_PATH):
        atomic_write_json(LADDERS_PATH, data)


def ladder_head(category: str) -> str:
    chain = load_ladders()["categories"].get(category) or []
    return chain[0] if chain else "opencode/deepseek-v4.1-flash-free"


# -------------------------------------------------------------- model listing

def list_models() -> list[str]:
    try:
        res = subprocess.run([*OPENCODE_CMD, "models"], capture_output=True, text=True, stdin=subprocess.DEVNULL,
                             timeout=20, **NO_WINDOW)
        if res.returncode == 0:
            return [ln.strip() for ln in res.stdout.splitlines() if "/" in ln.strip()]
    except Exception:
        pass
    return []


def is_free(model: str) -> bool:
    return model.endswith("-free") or ":free" in model


def free_models(models: list[str] | None = None) -> list[str]:
    models = models if models is not None else list_models()
    return [m for m in models if is_free(m)]


# ------------------------------------------------------------- agent sync

FRONTMATTER_MODEL_RE = re.compile(r"(?m)^model:\s*.*$")


def sync_agents(ladders: dict | None = None) -> int:
    ladders = ladders or load_ladders()
    changed = 0
    for filename, cat in AGENT_ROLES.items():
        path = os.path.join(AGENTS_DIR, filename)
        if not os.path.isfile(path):
            continue
        chain = ladders["categories"].get(cat) or []
        if not chain:
            continue
        lead = chain[0]
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        new = FRONTMATTER_MODEL_RE.sub(f"model: {lead}", content, count=1)
        if new != content:
            tmp = path + f".tmp.{os.getpid()}"
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(new)
            os.replace(tmp, path)
            changed += 1
    return changed


def sync_config_models(ladders: dict | None = None) -> None:
    ladders = ladders or load_ladders()

    def mutate(cfg: dict) -> None:
        cfg["model"] = ladders["categories"]["build"][0]
        cfg["small_model"] = ladders["categories"]["quick"][0]

    update_config(mutate)


# ------------------------------------------------------------------ ledger

def load_ledger() -> dict:
    return load_json(LEDGER_PATH, {}) or {}


def ledger_available(model: str) -> bool:
    info = load_ledger().get(model) or {}
    return time.time() >= float(info.get("cooldown_until", 0) or 0)


def ledger_record(model: str, ok: bool, error: str = "", retry_after: int | None = None) -> None:
    with _locked(LEDGER_PATH):
        state = load_json(LEDGER_PATH, {}) or {}
        if ok:
            state.pop(model, None)
        else:
            m = state.get(model, {"failures": 0, "backoff": 60})
            m["failures"] = int(m.get("failures", 0)) + 1
            backoff = 60 if m["failures"] == 1 else min(int(m.get("backoff", 60)) * 2, 900)
            if retry_after:
                backoff = max(backoff, retry_after)
            m["backoff"] = backoff
            m["cooldown_until"] = time.time() + backoff
            m["status"] = "cooling_down"
            m["last_error"] = str(error)[:160]
            m["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            state[model] = m
        atomic_write_json(LEDGER_PATH, state)


# --------------------------------------------------------------------- logs

def log(name: str, msg: str, max_bytes: int = 2 * 1024 * 1024, keep_lines: int = 2000) -> None:
    path = os.path.join(CONFIG_DIR, f"{name}.log")
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] [{name}] {msg}\n"
    print(line, end="", flush=True)
    try:
        if os.path.exists(path) and os.path.getsize(path) > max_bytes:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                tail = f.readlines()[-keep_lines:]
            with open(path, "w", encoding="utf-8") as f:
                f.writelines(tail)
        with open(path, "a", encoding="utf-8") as f:
            f.write(line)
    except Exception:
        pass


# -------------------------------------------------------------- token usage

def session_usage(session_id: str) -> dict:
    """Read token/cost accounting for a finished session."""
    if not session_id or not os.path.exists(OPENCODE_DB):
        return {"input": 0, "output": 0, "reasoning": 0, "cost": 0.0, "messages": 0}
    try:
        con = sqlite3.connect(f"file:{OPENCODE_DB}?mode=ro", uri=True, timeout=2)
        row = con.execute(
            "select coalesce(tokens_input,0), coalesce(tokens_output,0),"
            " coalesce(tokens_reasoning,0), coalesce(cost,0)"
            " from session_v2 where id = ? limit 1",
            (session_id,),
        ).fetchone()
        msgs = con.execute(
            "select count(*) from session_message where session_id = ? and type = 'assistant'",
            (session_id,),
        ).fetchone()
        con.close()
        if row:
            return {"input": row[0], "output": row[1], "reasoning": row[2],
                    "cost": row[3], "messages": int(msgs[0]) if msgs else 0}
    except Exception:
        pass
    return {"input": 0, "output": 0, "reasoning": 0, "cost": 0.0, "messages": 0}


def step_latency(since_s: float, min_steps: int = 6, until_s: float | None = None) -> dict[str, float]:
    """Median seconds per model step ("provider/model" -> s) in real sessions since `since_s`
    (epoch seconds), from OpenCode's own store, read-only. A step is one assistant message: the
    model's answer to one request, short replies dominate, so the median is what a user waits per
    step. 2026-11-06 the ladder head (deepseek-v4.1-flash-free) took 31 s/step over 123 steps
    while near-equal models took 2-5 s; the lab's task latencies never showed it."""
    out: dict[str, float] = {}
    if not os.path.exists(OPENCODE_DB):
        return out
    try:
        con = sqlite3.connect(f"file:{OPENCODE_DB}?mode=ro", uri=True, timeout=2)
        rows = con.execute(
            "select json_extract(data,'$.model.providerID')||'/'||json_extract(data,'$.model.id'),"
            " json_extract(data,'$.time.completed') - json_extract(data,'$.time.created')"
            " from session_message where type = 'assistant' and time_created >= ? and time_created < ?"
            " and json_extract(data,'$.time.completed') is not null",
            (int(since_s * 1000), int((until_s or time.time() + 60) * 1000)),
        ).fetchall()
        con.close()
    except Exception:
        return out
    per: dict[str, list[float]] = {}
    for model, ms in rows:
        if model and ms is not None and ms >= 0:
            per.setdefault(model, []).append(ms / 1000)
    for model, v in per.items():
        if len(v) >= min_steps:
            v.sort()
            out[model] = round(v[len(v) // 2], 1)
    return out


_LOC_FIRST_SEEN: dict[str, float] = {}


def evict_idle_locations(idle_s: float = 1800) -> list[str]:
    """Dispose OpenCode location instances (one per working directory, each with its own full set of
    MCP servers, ~200 MB) that have no running session and no session activity for `idle_s`. The
    service never disposes them: 2026-11-06 twenty benchmark folders held ~4 GB of MCP servers and
    the laptop ran out of memory. The next use of a folder starts its servers again."""
    def api(*args: str) -> str:
        try:
            r = subprocess.run([*OPENCODE_CMD, "api", *args], capture_output=True, text=True, timeout=60,
                               stdin=subprocess.DEVNULL)
            return r.stdout if r.returncode == 0 else ""
        except Exception:
            return ""
    try:
        locs = json.loads(api("GET", "/api/debug/location") or "[]")
        active = json.loads(api("GET", "/api/session/active") or "{}")
    except Exception:
        return []
    locs = locs.get("data", locs) if isinstance(locs, dict) else locs
    active_ids = set((active.get("data", active) or {}).keys()) if isinstance(active, dict) else set()
    evicted: list[str] = []
    try:
        con = sqlite3.connect(f"file:{OPENCODE_DB}?mode=ro", uri=True, timeout=2)
    except Exception:
        return []
    now_ms = time.time() * 1000
    for loc in locs or []:
        d = (loc or {}).get("directory")
        if not d:
            continue
        rows = con.execute("select id, max(time_updated, coalesce(time_idle, 0)) from session_v2 where directory = ?",
                           (d,)).fetchall()
        if any(r[0] in active_ids for r in rows):
            continue
        # a folder with no session yet (opened, first request still being typed): idle counts from when the
        # sentinel first saw it, not from 0 (2026-11-18 review: such folders were closed at once)
        last = max([r[1] or 0 for r in rows] or [0]) or _LOC_FIRST_SEEN.setdefault(d, now_ms)
        if now_ms - last < idle_s * 1000:
            continue
        api("DELETE", "/api/debug/location?location%5Bdirectory%5D=" + urllib.parse.quote(d, safe=""))
        evicted.append(d)
        _LOC_FIRST_SEEN.pop(d, None)
    con.close()
    return evicted


def run_model(model: str, prompt: str, cwd: str, timeout: int = 180,
              agent: str = "build", files: list[str] | None = None) -> dict:
    """Run one headless OpenCode turn. Returns text, session id, usage, timing."""
    env = dict(os.environ)
    env["OPENCODE_NO_FAILOVER"] = "1"  # benchmark the raw model, not the ladder
    env["OPENCODE_NO_SKILL_ROUTER"] = "1"  # and without skill hints that change its workload
    env.setdefault("OPENCODE_DISABLE_CLAUDE_CODE_SKILLS", "1")  # same skill set as interactive sessions
    # benches measure the model, not the injected memory/skills; keeps scores comparable
    env.setdefault("OPENCODE_CONTEXT_ENGINE", "0")
    # subprocess(cwd=...) does not update PWD; the CLI resolves the session
    # directory from PWD, so without this every tool call runs in the parent's
    # working directory instead of the isolated one.
    env["PWD"] = cwd
    env["OLDPWD"] = cwd
    cmd = [*OPENCODE_CMD, "run", "--standalone", "--auto",
           "--format", "json", "-m", model, "--agent", agent]
    for f in files or []:
        cmd += ["-f", f]
    cmd.append(prompt)
    t0 = time.time()
    try:
        # `opencode run` reads a non-TTY stdin to EOF before starting; an inherited
        # open pipe/socket (any non-systemd caller) hangs it until the timeout
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL,
                             cwd=cwd, env=env, encoding="utf-8", errors="replace", **NO_WINDOW)
    except subprocess.TimeoutExpired:
        return {"ok": False, "text": "", "session": "", "latency": timeout,
                "usage": {"input": 0, "output": 0, "reasoning": 0, "cost": 0.0},
                "error": "timeout", "error_kind": "timeout"}
    latency = time.time() - t0
    texts, session = [], ""
    err_from_events = []
    for line in res.stdout.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            ev = json.loads(line)
        except Exception:
            continue
        session = ev.get("sessionID") or session
        if ev.get("type") == "text":
            texts.append((ev.get("part") or {}).get("text", ""))
        elif ev.get("type") == "error":
            err_obj = ev.get("error") or {}
            err_msg = err_obj.get("message") or str(err_obj)
            err_from_events.append(err_msg)
    full_text = "\n".join(texts).strip()
    # Agents narrate before tool calls ("I'll read X first"); the answer is the
    # final text part, so graders and probes look at that, not the whole stream.
    finals = [t.strip() for t in texts if t and t.strip()]
    text = finals[-1] if finals else ""
    err = (res.stderr or "").strip()
    if err_from_events:
        err = ((err + " ") if err else "") + " ".join(err_from_events)
    # errors come from stderr and error events; the answer text is only searched for the free-tier cap
    # message, which some builds print as text. A correct answer that mentions "rate limit", "quota" or
    # "not available" is not an error (2026-11-18 review: such answers were scored as failures).
    err_l = err.lower()
    capped_text = text.lower().startswith(("free usage limit", "error: free usage limit"))

    kind = ""
    if "free usage limit" in err_l or "free-limit" in err_l or capped_text:
        kind = "free_limit"
    elif "rate limit" in err_l or "quota" in err_l or "429" in err_l:
        kind = "rate_limit"
    elif "model not found" in err_l or "unauthorized" in err_l or "not available" in err_l or "model unavailable" in err_l:
        kind = "unavailable"
    elif not text:
        # the CLI hides the account-wide free-tier cap in the server log
        if free_limit_since(t0):
            kind = "free_limit"
        elif res.returncode == 0:
            kind = "empty"

    return {
        "ok": res.returncode == 0 and bool(text) and not kind,
        "text": text,
        "full_text": full_text,
        "session": session,
        "latency": round(latency, 2),
        "usage": session_usage(session),
        "error": (err[:400] if err else ("free usage limit reached" if kind == "free_limit" else "")),
        "error_kind": kind,
    }


# -------------------------------------------------------------- free quota

FREE_LIMIT_MARKER = "Free usage limit reached"


def free_limit_since(since: float) -> bool:
    """True if the server logged the free-tier cap after `since` (epoch seconds).

    The CLI swallows this error: stdout has no text and stderr is empty, so the
    only reliable signal is the server log. Only the tail is read.
    """
    try:
        size = os.path.getsize(OPENCODE_LOG)
        with open(OPENCODE_LOG, "rb") as f:
            f.seek(max(0, size - 262144))
            tail = f.read().decode("utf-8", "replace")
    except Exception:
        return False

    for line in reversed(tail.splitlines()):
        if FREE_LIMIT_MARKER not in line:
            continue
        m = re.match(r"timestamp=(\S+)", line)
        if not m:
            return True
        try:
            ts = datetime.strptime(m.group(1)[:19], "%Y-%m-%dT%H:%M:%S") \
                .replace(tzinfo=timezone.utc).timestamp()
        except Exception:
            return True
        return ts >= since - 1
    return False


# ------------------------------------------------------------- model metadata

MODELS_DEV_URL = "https://models.dev/api.json"


def fetch_model_meta(timeout: int = 25) -> dict:
    """Context limits and pricing from models.dev, keyed provider/model."""
    import urllib.request

    meta: dict = {}
    data = None
    try:
        req = urllib.request.Request(
            MODELS_DEV_URL,
            headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) opencode-oclib/1.0",
                     "Accept": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception:
        # urllib is blocked at the edge for some user agents; curl is not
        try:
            out = subprocess.run(["curl", "-sSL", "-m", str(timeout), MODELS_DEV_URL],
                                 capture_output=True, text=True, timeout=timeout + 5)
            if out.returncode == 0 and out.stdout.strip().startswith("{"):
                data = json.loads(out.stdout)
        except Exception:
            data = None
    if not data:
        return meta

    for provider, pdata in (data or {}).items():
        for mid, m in ((pdata or {}).get("models") or {}).items():
            limits = m.get("limit") or {}
            cost = m.get("cost") or {}
            meta[f"{provider}/{mid}"] = {
                "context": limits.get("context") or 0,
                "output": limits.get("output") or 0,
                "cost_input": cost.get("input", 0),
                "cost_output": cost.get("output", 0),
                "reasoning": bool(m.get("reasoning")),
                "tool_call": bool(m.get("tool_call")),
                "attachment": bool(m.get("attachment")),
            }
    return meta


# ------------------------------------------------------------ memory index

MEMORY_DB = os.path.expanduser("~/.local/share/opencode/upgraded_memory/l2_memory.db")


def refresh_memory_index() -> dict:
    """Embed new/changed facts and index finished sessions (agy_recall). Never raises."""
    try:
        import sys as _sys
        config_lib = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib")
        if os.path.isdir(config_lib) and config_lib not in _sys.path:
            _sys.path.insert(0, config_lib)
        lib = os.path.expanduser("~/.local/lib")
        if lib not in _sys.path:
            _sys.path.insert(1, lib)
        import agy_recall
        bridge_script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tools", "claude_memory_bridge.py")
        if os.path.isfile(bridge_script):
            try:  # mirror Claude Code's memory files first, so this pass embeds them
                subprocess.run([_sys.executable, bridge_script],
                               capture_output=True, timeout=120)
            except Exception:
                pass
        return agy_recall.refresh(MEMORY_DB) if os.path.exists(MEMORY_DB) else {}
    except Exception as exc:
        return {"error": repr(exc)}


# --------------------------------------------------------------- autocommit

# Files the harness rewrites. ladders.json is machine-owned; the others are
# committed only when every changed line is a model assignment, so a manual
# edit in progress is never swept into an automatic commit.
_MODEL_LINE_RE = re.compile(r'^[+-]\s*("?(small_)?model"?\s*:)')


def _git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", CONFIG_DIR, *args], capture_output=True,
                          text=True, timeout=30, **NO_WINDOW)


def autocommit_models(reason: str = "routing") -> list[str]:
    """Commit harness-written model changes. Returns the committed paths."""
    if not os.path.isdir(os.path.join(CONFIG_DIR, ".git")) or not shutil.which("git"):
        return []
    try:
        changed = _git("diff", "--name-only").stdout.split()
        if _git("diff", "--cached", "--name-only").stdout.strip():
            return []  # the user is staging something; stay out of the way
        picks = []
        for path in changed:
            if path == "ladders.json":
                picks.append(path)
            elif path == "opencode.json" or (path.startswith("agents/") and path.endswith(".md")):
                lines = [l for l in _git("diff", "-U0", "--", path).stdout.splitlines()
                         if l[:1] in "+-" and not l.startswith(("+++", "---"))]
                if lines and all(_MODEL_LINE_RE.match(l) for l in lines):
                    picks.append(path)
        if not picks:
            return []
        _git("add", "--", *picks)
        r = _git("-c", "user.name=opencode-harness", "-c", "user.email=harness@localhost",
                 "commit", "-q", "--no-verify", "-m", f"auto: {reason} model update", "--", *picks)
        if r.returncode != 0:
            _git("reset", "-q", "--", *picks)
            return []
        return picks
    except Exception:
        return []


# --------------------------------------------------------------- pkg upgrade

def package_version_info() -> dict:
    """pacman-aware update check. This machine installs opencode via chaotic-aur."""
    out = {"installed": None, "available": None, "behind": False, "method": "pacman"}
    try:
        res = subprocess.run(["pacman", "-Q", "opencode-desktop-bin"],
                             capture_output=True, text=True, timeout=10)
        if res.returncode == 0 and res.stdout.strip():
            out["installed"] = res.stdout.split()[-1]
    except Exception:
        pass
    # repo packages: checkupdates is read-only and needs no root
    if shutil.which("checkupdates"):
        try:
            res = subprocess.run(["checkupdates"], capture_output=True, text=True, timeout=120)
            for line in res.stdout.splitlines():
                parts = line.split()
                if len(parts) >= 4 and parts[0] == "opencode-desktop-bin":
                    out["available"] = parts[3]
                    out["behind"] = True
                    return out
        except Exception:
            pass

    # AUR fallback
    for helper in ("yay", "paru"):
        if not shutil.which(helper):
            continue
        try:
            res = subprocess.run([helper, "-Qu", "opencode-desktop-bin"],
                                 capture_output=True, text=True, timeout=120)
            line = res.stdout.strip()
            if line:
                out["available"] = line.split()[-1]
                out["behind"] = True
            break
        except Exception:
            continue
    return out
