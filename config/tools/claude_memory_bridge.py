#!/usr/bin/env python3
"""Mirror Claude Code's memory (~/.claude/projects/*/memory/*.md) into OpenCode's fact store.

Claude Code keeps one markdown file per memory (frontmatter: name, description, metadata.type).
Each file the policy accepts becomes one OpenCode fact; when the file changes the fact is
superseded, when the file is deleted the fact is forgotten. Facts written here are tracked in
state/claude-memory-bridge.json and only those are ever changed: OpenCode's own facts are not touched.

    python3 tools/claude_memory_bridge.py            sync
    python3 tools/claude_memory_bridge.py --dry-run  show what would change
The sentinel runs it with the memory index refresh (oclib.refresh_memory_index).
"""
from __future__ import annotations

import glob
import hashlib
import json
import os
import re
import sys

CFG = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(CFG, "lib"))
from agy_memory_engine import AGYMemoryEngine, VOLATILE_RE, is_secret  # noqa: E402

DATA_DIR = os.path.expanduser("~/.local/share/opencode/upgraded_memory")
STATE = os.path.join(CFG, "state", "claude-memory-bridge.json")
SOURCES = os.path.expanduser("~/.claude/projects/*/memory/*.md")
MAX_CONTENT = 700


def parse(path: str) -> dict | None:
    text = open(path, encoding="utf-8").read()
    m = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n?", text, re.S)
    if not m:
        return None
    fm, body = m.group(1), text[m.end():]
    def get(k: str) -> str:
        hit = re.search(rf"(?m)^\s*{k}:\s*(.+)$", fm)
        return hit.group(1).strip().strip('"').strip("'").replace('\\"', '"') if hit else ""
    return {"name": get("name") or os.path.basename(path)[:-3], "description": get("description"),
            "type": get("type"), "body": body.strip(), "path": path}


def policy(mem: dict) -> tuple[str, str] | None:
    """Decide whether a Claude memory becomes an OpenCode fact.

    mem: {"name", "description", "type" (user|feedback|project|reference), "body", "path"}
    Return (origin, domain) to import it, or None to leave it out.
      origin: "user-statement" (the user said it) or "verified-fact" (observed on the machine)
      domain: one of coding, documents, media, images, academic, web, gamedev, general
    """
    # memories about OpenCode itself: HARNESS.md is the accurate, current record of that
    if "opencode" in mem["name"] or mem["type"] == "reference":
        return None
    text = f"{mem['name']} {mem['description']}".lower()
    domain = ("gamedev" if re.search(r"game|godot|minecraft|mod|bastion|warframe", text) else
              "coding" if re.search(r"attribution|commit|hyprland|dotfile|shell", text) else "general")
    if mem["type"] == "feedback":  # rules the user gave
        return "user-statement", domain
    if mem["type"] in ("user", "project"):  # who the user is, what they are working on
        return "verified-fact", domain
    return None


def to_fact(mem: dict) -> tuple[str, str]:
    title = mem["description"].split(";")[0].split(" — ")[0].strip()[:110] or mem["name"]
    body = re.sub(r"\[\[([^\]]+)\]\]", r"\1", mem["body"])
    body = re.sub(r"\*\*(Why|How to apply):\*\*", r"\1:", body)
    body = re.sub(r"\s+", " ", body).strip()
    content = body if len(body) <= MAX_CONTENT else body[:MAX_CONTENT].rsplit(" ", 1)[0] + " …"
    return title, content + f" (from Claude Code memory '{mem['name']}')"


def main() -> int:
    dry = "--dry-run" in sys.argv
    try:
        state = json.load(open(STATE, encoding="utf-8"))
    except Exception:
        state = {}
    eng = AGYMemoryEngine(DATA_DIR)
    seen, report = set(), []
    for path in sorted(glob.glob(SOURCES)):
        if os.path.basename(path) == "MEMORY.md":
            continue
        mem = parse(path)
        if not mem:
            continue
        decision = policy(mem)
        if not decision:
            continue
        origin, domain = decision
        title, content = to_fact(mem)
        if is_secret(title + content) or VOLATILE_RE.search(title + " " + content):
            report.append(f"skip {mem['name']}: secret-like or volatile text")
            continue
        key = mem["name"]
        seen.add(key)
        h = hashlib.sha256(f"{origin}|{domain}|{title}|{content}".encode()).hexdigest()[:16]
        prev = state.get(key)
        if prev and prev["hash"] == h:
            continue
        evidence = f"Claude Code memory file {path.replace(os.path.expanduser('~'), '~')}"
        if dry:
            report.append(f"{'update' if prev else 'add'} {key} -> [{origin}/{domain}] {title}")
            continue
        try:
            if prev:
                fid = eng.supersede_fact(prev["id"], domain, title, content, origin=origin, verified=1, evidence=evidence)
            else:
                fid = eng.add_fact(domain, title, content, origin=origin, verified=1, evidence=evidence)
        except ValueError as exc:  # fact superseded or deleted in OpenCode meanwhile: start a new one
            if not prev:
                report.append(f"skip {key}: {exc}")
                continue
            fid = eng.add_fact(domain, title, content, origin=origin, verified=1, evidence=evidence)
        state[key] = {"id": fid, "hash": h}
        report.append(f"{'updated' if prev else 'added'} {key} -> fact {fid}")
    for key in sorted(set(state) - seen):
        report.append(f"{'would forget' if dry else 'forgot'} {key} (gone from Claude Code or excluded)")
        if not dry:
            eng.soft_delete_fact(state.pop(key)["id"], reason="claude memory removed or excluded")
    if not dry:
        os.makedirs(os.path.dirname(STATE), exist_ok=True)
        json.dump(state, open(STATE, "w", encoding="utf-8"), indent=1, sort_keys=True)
    print("\n".join(report) or "claude memory bridge: nothing to do")
    return 0


if __name__ == "__main__":
    sys.exit(main())
