"""
agy_recall: semantic + episodic layer on top of the AGY memory store.

Writer side of the context engine. The OpenCode plugin (Bun) only reads these
tables; this module is the one place that embeds and indexes:

  fact_vectors   one embedding per active fact (refreshed when the fact changes)
  episodes       one gist per past OpenCode session (title + compaction summary
                 or first request / last answer), with FTS5 and an embedding
  kv             indexer watermarks

Embeddings come from a local Ollama model. Every function degrades to keyword
search when Ollama is unavailable; nothing here may raise into a caller.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import sqlite3
import struct
import time
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from agy_keywords import KeywordIndex, tokenize  # noqa: E402
from typing import Any, Iterable

# realpath: mem, memory_mcp and the sentinel import this file through the ~/.local/lib symlink,
# and the calibration file lives next to the real file in the harness repo
def _active_model() -> str:
    """Embedding model: $OPENCODE_EMBED_MODEL, else "_active" in memory-calibration.json (the one
    place the choice is recorded; the plugin reads the same key), else embeddinggemma."""
    if os.environ.get("OPENCODE_EMBED_MODEL"):
        return os.environ["OPENCODE_EMBED_MODEL"]
    try:
        f = os.path.join(os.path.dirname(os.path.dirname(os.path.realpath(__file__))), "memory-calibration.json")
        with open(f, encoding="utf-8") as _f:
            return json.load(_f).get("_active") or "embeddinggemma"
    except Exception:
        return "embeddinggemma"


EMBED_MODEL = _active_model()
OLLAMA = "http://" + os.environ.get("OLLAMA_HOST", "127.0.0.1:11434").replace("http://", "").replace("https://", "")
OPENCODE_DB = os.path.expanduser("~/.local/share/opencode/opencode.db")

# Sessions started by the harness itself (lab, sentinel probes, scratch work)
# are noise for recall.
SKIP_DIR_RE = re.compile(r"^(/tmp|/var/tmp|/private/tmp)(/|$)")

SCHEMA = """
CREATE TABLE IF NOT EXISTS fact_vectors (
    fact_id INTEGER PRIMARY KEY,
    model   TEXT NOT NULL,
    hash    TEXT NOT NULL,
    vec     BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS episodes (
    session_id   TEXT PRIMARY KEY,
    directory    TEXT,
    title        TEXT,
    time_updated INTEGER,
    gist         TEXT NOT NULL,
    hash         TEXT NOT NULL,
    model        TEXT,
    vec          BLOB
);
CREATE INDEX IF NOT EXISTS idx_episodes_updated ON episodes(time_updated);
CREATE VIRTUAL TABLE IF NOT EXISTS episodes_fts USING fts5(
    title, gist, content='episodes', content_rowid='rowid', prefix='2 3 4'
);
CREATE TRIGGER IF NOT EXISTS episodes_ai AFTER INSERT ON episodes BEGIN
    INSERT INTO episodes_fts(rowid, title, gist) VALUES (new.rowid, new.title, new.gist);
END;
CREATE TRIGGER IF NOT EXISTS episodes_ad AFTER DELETE ON episodes BEGIN
    INSERT INTO episodes_fts(episodes_fts, rowid, title, gist) VALUES ('delete', old.rowid, old.title, old.gist);
END;
CREATE TRIGGER IF NOT EXISTS episodes_au AFTER UPDATE OF title, gist ON episodes BEGIN
    INSERT INTO episodes_fts(episodes_fts, rowid, title, gist) VALUES ('delete', old.rowid, old.title, old.gist);
    INSERT INTO episodes_fts(rowid, title, gist) VALUES (new.rowid, new.title, new.gist);
END;
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
"""


def ensure_schema(con: sqlite3.Connection) -> None:
    con.executescript(SCHEMA)


# ------------------------------------------------------------------ vectors

def pack(vec: list[float]) -> bytes:
    return struct.pack(f"<{len(vec)}f", *vec)


def unpack(blob: bytes | None) -> list[float] | None:
    if not blob:
        return None
    return list(struct.unpack(f"<{len(blob) // 4}f", blob))


def _norm(v: list[float]) -> list[float]:
    n = sum(x * x for x in v) ** 0.5 or 1.0
    return [x / n for x in v]


# (query prefix, document prefix) each model was trained with; keep in sync with embed.mjs
PREFIXES = {
    "nomic-embed-text": ("search_query: ", "search_document: "),
    "embeddinggemma": ("task: search result | query: ", "title: none | text: "),
    "embeddinggemma:300m-qat-q8_0": ("task: search result | query: ", "title: none | text: "),
    "embeddinggemma:300m-qat-q4_0": ("task: search result | query: ", "title: none | text: "),
    "qwen3-embedding:0.6b": ("Instruct: Given a user's message to a coding assistant, retrieve the stored "
                             "memories and past conversations relevant to it\nQuery: ", ""),
    "granite-embedding:278m": ("", ""),
    "all-minilm": ("", ""),
}


# per-model thresholds from memory-calibration.json (tools/recall_eval.py --write); the
# plugin reads the same file. Defaults are the nomic-embed-text calibration.
CALIBRATION_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.realpath(__file__))), "memory-calibration.json")


def calibration(model: str = EMBED_MODEL) -> dict:
    cal = {"fact_min": 0.58, "episode_min": 0.58, "rel_gap": 0.08, "duplicate": 0.895, "related": 0.643,
           "kw_relief": 0.0, "kw_cover": 0.5, "kw_only_cover": 0.6, "kw_only_rel": 0.5}
    try:
        with open(CALIBRATION_FILE, encoding="utf-8") as _f:
            allcal = json.load(_f)
        cal.update(allcal.get("_keyword", {}))  # model-independent keyword-only thresholds
        cal.update(allcal.get(model, {}))
    except Exception:
        pass
    return cal


_CAL = calibration()
FACT_MIN_COS = _CAL["fact_min"]
FACT_REL_GAP = _CAL["rel_gap"]
EPISODE_MIN_COS = _CAL["episode_min"]


_QUERY_CACHE: dict[str, list[float]] = {}


def embed(texts: list[str], kind: str = "doc", timeout: float = 60.0) -> list[list[float]] | None:
    """Normalized embeddings, or None when Ollama is unavailable. Single queries are cached, so a
    search over facts and then sessions embeds the question once."""
    if not texts:
        return []
    if kind == "query" and len(texts) == 1 and texts[0] in _QUERY_CACHE:
        return [_QUERY_CACHE[texts[0]]]
    pq, pd = PREFIXES.get(EMBED_MODEL, ("", ""))
    prefix = pq if kind == "query" else pd
    body = json.dumps({"model": EMBED_MODEL, "input": [prefix + t[:6000] for t in texts],
                       "keep_alive": "20m", "truncate": True}).encode()
    req = urllib.request.Request(f"{OLLAMA}/api/embed", body, {"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.load(r)
        out = [_norm(e) for e in data.get("embeddings", [])]
        if kind == "query" and len(texts) == 1 and out:
            if len(_QUERY_CACHE) > 256:
                _QUERY_CACHE.pop(next(iter(_QUERY_CACHE)))
            _QUERY_CACHE[texts[0]] = out[0]
        return out
    except Exception:
        return None


def dot(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


def fact_hash(title: str, content: str) -> str:
    return hashlib.sha256(f"{EMBED_MODEL}\n{title}\n{content}".encode()).hexdigest()[:24]


def index_facts(con: sqlite3.Connection, batch: int = 32) -> int:
    """Embed active facts whose vector is missing or stale. Returns count embedded."""
    ensure_schema(con)
    rows = con.execute("""
        SELECT f.id, f.title, f.content, v.hash
        FROM facts f LEFT JOIN fact_vectors v ON v.fact_id = f.id
        WHERE f.superseded_by IS NULL AND f.deleted = 0
    """).fetchall()
    todo = [(r[0], r[1], r[2]) for r in rows if r[3] != fact_hash(r[1], r[2])]
    done = 0
    for i in range(0, len(todo), batch):
        chunk = todo[i:i + batch]
        vecs = embed([f"{t}\n{c}" for _, t, c in chunk])
        if not vecs:
            break
        con.executemany(
            "INSERT INTO fact_vectors(fact_id, model, hash, vec) VALUES (?,?,?,?) "
            "ON CONFLICT(fact_id) DO UPDATE SET model=excluded.model, hash=excluded.hash, vec=excluded.vec",
            [(fid, EMBED_MODEL, fact_hash(t, c), pack(v)) for (fid, t, c), v in zip(chunk, vecs)])
        done += len(chunk)
    # vectors of facts that are no longer active are dead weight
    con.execute("""DELETE FROM fact_vectors WHERE fact_id IN
                   (SELECT id FROM facts WHERE superseded_by IS NOT NULL OR deleted = 1)""")
    con.commit()
    return done


# ----------------------------------------------------------------- episodes

def _text_parts(data: dict) -> str:
    if isinstance(data.get("text"), str):
        return data["text"]
    out = []
    for p in data.get("content") or []:
        if isinstance(p, dict) and p.get("type") == "text" and isinstance(p.get("text"), str):
            out.append(p["text"])
    return "\n".join(out)


_SECRET_RES = [
    re.compile(r"-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?(?:-----END[ A-Z]*PRIVATE KEY-----|$)"),
    re.compile(r"\b(?:sk|pk|rk)-[A-Za-z0-9_\-]{16,}"),
    re.compile(r"\b(?:fal_sk|hf|ghp|gho|ghs|github_pat|glpat|xox[abpr]|AIza|nvapi|gsk|xai)[_-][A-Za-z0-9_:\-]{16,}"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"(?i)\bbearer\s+[A-Za-z0-9_\-.=]{20,}"),
]
# NAME=value where NAME looks like a credential; the name is kept for context
_SECRET_ASSIGN = re.compile(r"(?i)\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD))(\s*[=:]\s*)[\"']?[^\s\"']{8,}")
_LONG_TOKEN = re.compile(r"[A-Za-z0-9+_\-:]{28,}")


def _entropy(t: str) -> float:
    return -sum(t.count(c) / len(t) * math.log2(t.count(c) / len(t)) for c in set(t))


def _looks_random(t: str) -> bool:
    # hex digests (commits, checksums) stay below 4.3 bits/char; random keys mix cases and digits
    return _entropy(t) > 4.3 and any(c.isdigit() for c in t) and any(c.isalpha() for c in t)


def redact(text: str) -> str:
    """Replace credentials with [REDACTED] before anything reaches the index."""
    for rx in _SECRET_RES:
        text = rx.sub("[REDACTED]", text)
    text = _SECRET_ASSIGN.sub(lambda m: f"{m.group(1)}{m.group(2)}[REDACTED]", text)
    return _LONG_TOKEN.sub(lambda m: "[REDACTED]" if _looks_random(m.group(0)) else m.group(0), text)


def _clip(s: str, n: int) -> str:
    s = re.sub(r"\s+", " ", s or "").strip()
    return s if len(s) <= n else s[: n - 1] + "…"


def build_gist(src: sqlite3.Connection, session_id: str, title: str) -> str | None:
    """Title + newest compaction summary, else first request + last answer."""
    if not (title or "").strip():
        return None  # interactive sessions always get a title; untitled ones are bench/probe runs
    summary = src.execute(
        "SELECT data FROM session_message WHERE session_id=? AND type='compaction' "
        "ORDER BY seq DESC LIMIT 1", (session_id,)).fetchone()
    if summary and not (json.loads(summary[0]).get("summary") or "").strip():
        summary = None
    first = src.execute(
        "SELECT data FROM session_message WHERE session_id=? AND type='user' ORDER BY seq LIMIT 1",
        (session_id,)).fetchone()
    if not first and not summary:
        return None
    if not summary:
        # one-shot probes ("add2 function for a+b": 1-2 replies) are recall noise;
        # a real task, even from a single request, takes several assistant steps
        steps = src.execute("SELECT count(*) FROM session_message WHERE session_id=? AND type='assistant'",
                            (session_id,)).fetchone()[0]
        if steps < 4:
            return None
    parts = [title or ""]
    if first:
        parts.append("Request: " + _clip(_text_parts(json.loads(first[0])), 500))
    if summary:
        parts.append("Summary: " + _clip(json.loads(summary[0]).get("summary", ""), 1400))
    else:
        last = src.execute(
            "SELECT data FROM session_message WHERE session_id=? AND type='assistant' "
            "ORDER BY seq DESC LIMIT 3", (session_id,)).fetchall()
        answer = next((t for t in (_text_parts(json.loads(r[0])) for r in last) if t.strip()), "")
        if answer:
            parts.append("Outcome: " + _clip(answer, 700))
    if not summary and first and len(_text_parts(json.loads(first[0])).strip()) < 40:
        return None  # "say OK in 1 word" probes
    gist = redact("\n".join(p for p in parts if p))
    return gist if len(gist) > 40 else None


def index_episodes(con: sqlite3.Connection, src_path: str = OPENCODE_DB,
                   max_sessions: int = 400, settle_ms: int = 10 * 60 * 1000) -> dict:
    """Incrementally index finished top-level sessions. A session counts as
    finished once it has been quiet for `settle_ms`; later activity re-indexes it."""
    ensure_schema(con)
    stats = {"indexed": 0, "embedded": 0}
    # vectors from another embedding model are not comparable: queue them for re-embedding
    con.execute("UPDATE episodes SET vec = NULL, model = NULL WHERE vec IS NOT NULL AND model IS NOT ?", (EMBED_MODEL,))
    if not os.path.exists(src_path):
        return stats
    mark = int((con.execute("SELECT value FROM kv WHERE key='episodes_watermark'").fetchone() or ["0"])[0])
    cutoff = int(time.time() * 1000) - settle_ms
    src = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True, timeout=10)
    try:
        rows = src.execute("""
            SELECT id, directory, title, time_updated FROM session_v2
            WHERE parent_id IS NULL AND time_updated > ? AND time_updated <= ?
            ORDER BY time_updated LIMIT ?""", (mark, cutoff, max_sessions)).fetchall()
        new_mark = mark
        for sid, directory, title, updated in rows:
            new_mark = max(new_mark, updated or 0)
            if directory and SKIP_DIR_RE.match(directory):
                continue
            gist = build_gist(src, sid, title or "")
            if not gist:
                continue
            h = hashlib.sha256(f"{EMBED_MODEL}\n{gist}".encode()).hexdigest()[:24]
            con.execute("""
                INSERT INTO episodes(session_id, directory, title, time_updated, gist, hash)
                VALUES (?,?,?,?,?,?)
                ON CONFLICT(session_id) DO UPDATE SET directory=excluded.directory, title=excluded.title,
                  time_updated=excluded.time_updated, gist=excluded.gist, hash=excluded.hash,
                  vec=CASE WHEN episodes.hash=excluded.hash THEN episodes.vec ELSE NULL END""",
                        (sid, directory, title, updated, gist, h))
            stats["indexed"] += 1
        con.execute("INSERT INTO kv(key,value) VALUES('episodes_watermark',?) "
                    "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (str(new_mark),))
        con.commit()
    finally:
        src.close()

    pending = con.execute("SELECT session_id, gist FROM episodes WHERE vec IS NULL LIMIT 512").fetchall()
    for i in range(0, len(pending), 16):
        chunk = pending[i:i + 16]
        vecs = embed([g for _, g in chunk])
        if not vecs:
            break
        con.executemany("UPDATE episodes SET vec=?, model=? WHERE session_id=?",
                        [(pack(v), EMBED_MODEL, sid) for (sid, _), v in zip(chunk, vecs)])
        stats["embedded"] += len(chunk)
    con.commit()
    return stats


# ------------------------------------------------------------- extraction

GATEWAY = os.environ.get("OMNIROUTE_URL", "http://127.0.0.1:20128/v1")
EXTRACT_MODEL = os.environ.get("MEMORY_EXTRACT_MODEL", "omni-quick")
EXTRACT_PER_PASS = 5
# cosine above DUPLICATE: same fact, skip; between RELATED and DUPLICATE: ask the judge
DUPLICATE_COS = _CAL["duplicate"]
RELATED_COS = _CAL["related"]
JUDGE_PROMPT = """Two memory entries about the same user. OLD was stored earlier; NEW comes from a later conversation.
OLD: {old}
NEW: {new}
Answer with exactly one word:
UPDATE    - both describe the SAME attribute (e.g. which desktop, which default browser, a stated limit)
            and NEW gives a different or corrected value for it; a related but different topic is NOT an update
DUPLICATE - NEW says nothing OLD does not already say
DIFFERENT - they are about different things and both should be kept"""
EXTRACT_PROMPT = """You maintain a coding assistant's long-term memory about ONE user.
From the conversation excerpt below (the user's own messages, then the session summary), extract
at most 3 facts that will still be true and useful in future, unrelated sessions:
- the user's stated preferences and working style ("prefers X", "never wants Y")
- decisions the user made or confirmed about their setup, tools or projects
- durable facts about their machine, accounts or environment the user stated or that were verified
Rules: no secrets, keys, tokens or passwords; nothing about the task in progress, file contents,
file paths, package or plugin names, config values, code structure, error messages or one-off steps
(those go stale and the repo records them); no prices, stock, shop listings or purchase
recommendations (market data goes stale within days); no guesses. User messages often paste a
prompt or brief written for another agent: a device, account or plan named there is the user's own
only if the user says so (they may be helping a friend), so leave such facts out unless the user's
own words make ownership clear. Write each fact self-contained in one or two sentences. This conversation took place on {date}: date any decision "as of {date}", never with another date.
If nothing qualifies, return an empty list. Answer with JSON only:
{{"facts": [{{"domain": "coding|documents|media|images|academic|web|gamedev|general", "title": "<= 8 words", "content": "..."}}]}}

--- excerpt ---
{excerpt}"""


def _session_excerpt(src: sqlite3.Connection, session_id: str, limit: int = 6000) -> str:
    users = [_text_parts(json.loads(d)) for (d,) in src.execute(
        "SELECT data FROM session_message WHERE session_id=? AND type='user' ORDER BY seq", (session_id,))]
    summary = src.execute("SELECT data FROM session_message WHERE session_id=? AND type='compaction' "
                          "ORDER BY seq DESC LIMIT 1", (session_id,)).fetchone()
    parts = ["User: " + _clip(u, 700) for u in users if u.strip()]
    text = "\n".join(parts)[: limit - 1500]
    if summary:
        text += "\n\nSummary: " + _clip(json.loads(summary[0]).get("summary", ""), 1500)
    return redact(text)


def _chat(prompt: str, timeout: float = 90, max_tokens: int = 700) -> str | None:
    key = os.environ.get("OMNIROUTE_API_KEY")
    if not key:
        return None
    body = json.dumps({"model": EXTRACT_MODEL, "temperature": 0, "max_tokens": max_tokens,
                       "messages": [{"role": "user", "content": prompt}]}).encode()
    req = urllib.request.Request(f"{GATEWAY}/chat/completions", body,
                                 {"content-type": "application/json", "authorization": f"Bearer {key}"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)["choices"][0]["message"]["content"] or ""
    except Exception:
        return None


def _parse_facts(text: str) -> list[dict]:
    m = re.search(r"\{[\s\S]*\}", text or "")
    if not m:
        return []
    try:
        facts = json.loads(m.group(0)).get("facts", [])
    except Exception:
        return []
    out = []
    for f in facts[:3]:
        if not isinstance(f, dict):
            continue
        title, content = str(f.get("title", "")).strip(), str(f.get("content", "")).strip()
        if 3 <= len(title) <= 120 and 15 <= len(content) <= 600:
            out.append({"domain": f.get("domain") if f.get("domain") in ("coding", "documents", "media", "images",
                        "academic", "web", "gamedev", "general") else "general", "title": title, "content": content})
    return out


def _set_source(db_path: str, fact_id: int, session_id: str) -> None:
    """Record which session an auto fact came from, so it can be checked against what the user said."""
    con = sqlite3.connect(db_path, timeout=10)
    if "source_session" not in {r[1] for r in con.execute("PRAGMA table_info(facts)")}:
        con.execute("ALTER TABLE facts ADD COLUMN source_session TEXT")
    con.execute("UPDATE facts SET source_session = ? WHERE id = ?", (session_id, fact_id))
    con.commit()
    con.close()


def extract_facts(db_path: str, src_path: str = OPENCODE_DB, per_pass: int = EXTRACT_PER_PASS) -> dict:
    """Turn finished sessions into durable facts with a small gateway model.
    Each session is processed once; duplicates of existing facts are skipped."""
    stats = {"sessions": 0, "added": 0, "duplicates": 0, "rejected": 0}
    if not os.environ.get("OMNIROUTE_API_KEY") or not os.path.exists(src_path):
        return stats
    con = sqlite3.connect(db_path, timeout=10)
    con.execute("CREATE TABLE IF NOT EXISTS extraction_log (session_id TEXT PRIMARY KEY, at INTEGER, added INTEGER, status TEXT)")
    # oldest first, so a later session's fact supersedes an earlier one
    todo = con.execute("""SELECT e.session_id, e.time_updated FROM episodes e LEFT JOIN extraction_log x ON x.session_id = e.session_id
                          WHERE x.session_id IS NULL ORDER BY e.time_updated ASC LIMIT ?""", (per_pass,)).fetchall()
    con.close()
    if not todo:
        return stats
    import agy_memory_engine as E
    eng = E.AGYMemoryEngine(os.path.dirname(db_path))
    src = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True, timeout=10)
    for sid, updated in todo:
        date = time.strftime("%Y-%m-%d", time.localtime((updated or 0) / 1000))
        reply = _chat(EXTRACT_PROMPT.format(date=date, excerpt=_session_excerpt(src, sid)))
        if reply is None:
            break  # gateway down or rate-limited: retry this session next pass
        stats["sessions"] += 1
        added = 0
        for f in _parse_facts(reply):
            if E.VOLATILE_RE.search(f"{f['title']} {f['content']}"):
                stats["rejected"] += 1  # prices/stock/recommendations are not durable facts
                continue
            con = sqlite3.connect(db_path, timeout=10)
            near = hybrid_facts(con, f"{f['title']}\n{f['content']}", limit=1)
            con.close()
            cos = near[0].get("cos", 0) if near else 0
            if cos >= DUPLICATE_COS:
                stats["duplicates"] += 1
                continue
            verdict = "DIFFERENT"
            if cos >= RELATED_COS:
                old = near[0]
                verdict = (_chat(JUDGE_PROMPT.format(old=f"{old['title']}: {old['content']}",
                                                     new=f"{f['title']}: {f['content']}"), timeout=45) or "").strip().upper()
                verdict = next((v for v in ("UPDATE", "DUPLICATE", "DIFFERENT") if v in verdict[:20]), "DIFFERENT")
            try:
                if verdict == "DUPLICATE":
                    stats["duplicates"] += 1
                    continue
                # user-stated and checked facts are never overwritten automatically
                if verdict == "UPDATE" and near[0].get("origin") not in ("user-statement", "verified-fact"):
                    fid = eng.supersede_fact(near[0]["id"], f["domain"], f["title"], f["content"], origin="auto-extracted", verified=0)
                    stats["superseded"] = stats.get("superseded", 0) + 1
                else:
                    fid = eng.add_fact(f["domain"], f["title"], f["content"], origin="auto-extracted", verified=0)
                _set_source(db_path, fid, sid)
                added += 1
            except ValueError:
                stats["rejected"] += 1  # secret scanner or validation refused it
        stats["added"] += added
        con = sqlite3.connect(db_path, timeout=10)
        con.execute("INSERT OR REPLACE INTO extraction_log VALUES (?,?,?,?)", (sid, int(time.time()), added, "ok"))
        con.commit()
        con.close()
    src.close()
    return stats


def refresh(db_path: str, extract: bool = True) -> dict:
    """One indexing pass: facts, episodes, then fact extraction. Safe to call from a loop."""
    con = sqlite3.connect(db_path, timeout=10)
    try:
        con.execute("PRAGMA journal_mode=WAL")
        out = {"facts": index_facts(con)}
        out.update(index_episodes(con))
    finally:
        con.close()
    if extract:
        out["extracted"] = extract_facts(db_path)
    return out


# ------------------------------------------------------------------- search



_KW_CACHE: dict[str, tuple[tuple, KeywordIndex]] = {}


def _kw_index(con: sqlite3.Connection, kind: str, sql: str, params: tuple, stamp_sql: str) -> tuple[KeywordIndex, dict]:
    """Keyword index over facts or episodes, rebuilt only when the rows change (long-lived MCP/sentinel)."""
    stamp = (sql, params, tuple(con.execute(stamp_sql).fetchone()))
    hit = _KW_CACHE.get(kind)
    if hit and hit[0] == stamp:
        return hit[1]
    rows = {r[0]: dict(r) for r in con.execute(sql, params)}  # first column is the key (id / session_id)
    field = "content" if kind == "facts" else "gist"
    built = (KeywordIndex([(k, f"{r['title']}\n{r['title']}\n{r[field]}\n{r.get('domain') or ''}") for k, r in rows.items()]), rows)
    _KW_CACHE[kind] = (stamp, built)
    return built


def _kw_gate(query: str, hits: list[dict], semantic: bool) -> list[dict]:
    """Keyword-only results must explain most of the query and sit near the best score (as memory.mjs)."""
    if semantic or not hits:
        return hits
    top, need = hits[0]["score"], min(2, len(tokenize(query)))
    return [h for h in hits if h["cover"] >= _CAL["kw_only_cover"] and len(h["terms"]) >= need
            and h["score"] >= top * _CAL["kw_only_rel"]]


def hybrid_facts(con: sqlite3.Connection, query: str, domain: str | None = None,
                 limit: int = 5, qvec: list[float] | None = None) -> list[dict[str, Any]]:
    """Reciprocal-rank fusion of BM25 (agy_keywords) and cosine. Without embeddings, only keyword
    matches that explain most of the query are returned, so weak hits never pad the result."""
    ensure_schema(con)
    con.row_factory = sqlite3.Row
    where = "f.superseded_by IS NULL AND f.deleted = 0" + (" AND f.domain = ?" if domain else "")
    dparams: tuple = (domain,) if domain else ()
    if qvec is None:
        got = embed([query], kind="query", timeout=5)
        qvec = got[0] if got else None

    fused: dict[int, float] = {}
    index, cached = _kw_index(con, "facts", f"SELECT f.* FROM facts f WHERE {where}", dparams,
                              "SELECT count(*), max(id), total(superseded_by), total(deleted), total(length(content)) FROM facts")
    rows: dict[int, dict] = {k: dict(v) for k, v in cached.items()}
    hits = _kw_gate(query, index.search(query, 20), bool(qvec))
    strong = {h["id"] for h in hits if h["cover"] >= _CAL["kw_cover"]}
    for rank, h in enumerate(hits):
        fused[h["id"]] = fused.get(h["id"], 0) + 1 / (60 + rank)
    if qvec:
        scored = []
        for r in con.execute(f"SELECT f.*, v.vec AS _vec FROM facts f JOIN fact_vectors v ON v.fact_id = f.id "
                             f"AND v.model = ? WHERE {where}", (EMBED_MODEL, *dparams)):
            cos = dot(qvec, unpack(r["_vec"]) or [])
            d = dict(r)
            d.pop("_vec", None)
            d["cos"] = round(cos, 3)
            rows.setdefault(d["id"], d)["cos"] = d["cos"]
            scored.append((cos, d["id"]))
        scored.sort(reverse=True)
        for rank, (cos, fid) in enumerate(scored[:20]):
            fused[fid] = fused.get(fid, 0) + 1 / (60 + rank)
        # semantic gate: close in meaning, or slightly less close but backed by a meaningful keyword
        best = scored[0][0] if scored else 0.0
        relief = _CAL["kw_relief"]
        fused = {fid: s for fid, s in fused.items()
                 if rows[fid].get("cos", 0) >= max(FACT_MIN_COS - (relief if fid in strong else 0), best - FACT_REL_GAP)}
    order = sorted(fused, key=lambda i: -fused[i])[:limit]
    return [rows[i] for i in order]


def search_episodes(con: sqlite3.Connection, query: str, limit: int = 3,
                    qvec: list[float] | None = None) -> list[dict[str, Any]]:
    ensure_schema(con)
    con.row_factory = sqlite3.Row
    if qvec is None:
        got = embed([query], kind="query", timeout=5)
        qvec = got[0] if got else None
    out = []
    if qvec:
        for r in con.execute("SELECT session_id, directory, title, time_updated, gist, vec FROM episodes "
                             "WHERE vec IS NOT NULL AND model = ?", (EMBED_MODEL,)):
            cos = dot(qvec, unpack(r["vec"]) or [])
            if cos >= EPISODE_MIN_COS:
                d = dict(r)
                d.pop("vec")
                d["cos"] = round(cos, 3)
                out.append(d)
        out.sort(key=lambda d: -d["cos"])
        return out[:limit]
    index, eps = _kw_index(con, "episodes", "SELECT session_id, directory, title, time_updated, gist FROM episodes", (),
                           "SELECT count(*), max(time_updated), total(length(gist)) FROM episodes")
    return [dict(eps[h["id"]]) for h in _kw_gate(query, index.search(query, 20), False)[:limit]]


def embed_fact_now(db_path: str, fact_ids: Iterable[int]) -> None:
    """Best-effort immediate embedding after a write so recall sees it at once."""
    try:
        con = sqlite3.connect(db_path, timeout=5)
        ensure_schema(con)
        ids = list(fact_ids)
        rows = con.execute(f"SELECT id, title, content FROM facts WHERE id IN ({','.join('?' * len(ids))})",
                           ids).fetchall()
        vecs = embed([f"{t}\n{c}" for _, t, c in rows], timeout=15)
        if vecs:
            con.executemany(
                "INSERT INTO fact_vectors(fact_id, model, hash, vec) VALUES (?,?,?,?) "
                "ON CONFLICT(fact_id) DO UPDATE SET model=excluded.model, hash=excluded.hash, vec=excluded.vec",
                [(fid, EMBED_MODEL, fact_hash(t, c), pack(v)) for (fid, t, c), v in zip(rows, vecs)])
        con.execute("""DELETE FROM fact_vectors WHERE fact_id IN
                       (SELECT id FROM facts WHERE superseded_by IS NOT NULL OR deleted = 1)""")
        con.commit()
        con.close()
    except Exception:
        pass
