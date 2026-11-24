#!/usr/bin/env python3
"""Generate example user requests per skill for the context engine's semantic matcher.

    python3 tools/skill_examples.py            # only skills whose description changed
    python3 tools/skill_examples.py --all      # regenerate everything

Writes skill-examples.json (versioned): {skill_id: {"hash": <desc hash>, "examples": [...]}}.
Uses the OmniRoute gateway (OMNIROUTE_API_KEY), not the OpenCode free tier.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys

CFG = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(CFG, "lib"))
import agy_recall as R  # noqa: E402

OUT = os.path.join(CFG, "skill-examples.json")
DIRS = [os.path.join(CFG, "skills"), os.path.expanduser("~/.agents/skills")]
PROMPT = """A coding assistant has a skill named "{name}":
{desc}

Write 6 different requests a real user might type that should trigger this skill. Vary the wording,
length and context (casual, terse, detailed, describing a symptom instead of naming the task). Do not
repeat the skill name in most of them. Write them in English, the language this user types in, even when the
description also uses another language (at most one example in that language). Answer with JSON only: {{"examples": ["...", "..."]}}"""


def frontmatter(src: str) -> dict:
    m = re.match(r"^---\r?\n([\s\S]*?)\r?\n---", src)
    out, lines = {}, (m.group(1).splitlines() if m else [])
    i = 0
    while i < len(lines):
        kv = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", lines[i])
        if kv:
            key, val = kv.groups()
            if re.match(r"^[>|][-+]?$", val.strip()):
                buf = []
                while i + 1 < len(lines) and (lines[i + 1].startswith((" ", "\t")) or not lines[i + 1].strip()):
                    i += 1
                    buf.append(lines[i].strip())
                val = " ".join(buf)
            out[key] = val.strip().strip('"').strip("'")
        i += 1
    return out


def skills() -> dict[str, str]:
    found = {}
    for d in DIRS:
        for name in sorted(os.listdir(d)) if os.path.isdir(d) else []:
            f = os.path.join(d, name, "SKILL.md")
            if os.path.exists(f):
                fm = frontmatter(open(f, encoding="utf-8").read())
                sid = fm.get("name") or name
                found.setdefault(sid, fm.get("description", ""))
    return found


def main() -> int:
    cache = {}
    if os.path.exists(OUT) and "--all" not in sys.argv:
        cache = json.load(open(OUT))
    done = failed = 0
    installed = skills()
    # a removed skill's examples would keep matching requests for a skill that no longer exists
    gone = [sid for sid in cache if sid not in installed]
    for sid in gone:
        del cache[sid]
    if gone:
        tmp = OUT + ".tmp"
        json.dump(cache, open(tmp, "w"), indent=1, ensure_ascii=False)
        os.replace(tmp, OUT)
        print(f"pruned {len(gone)} removed skill(s): {', '.join(gone)}")
    for sid, desc in installed.items():
        h = hashlib.sha256(f"{sid}\n{desc}".encode()).hexdigest()[:16]
        if cache.get(sid, {}).get("hash") == h:
            continue
        reply = R._chat(PROMPT.format(name=sid, desc=desc[:1500]), timeout=90, max_tokens=1200)
        m = re.search(r"\{[\s\S]*\}", reply or "")
        try:
            ex = [str(x).strip() for x in json.loads(m.group(0))["examples"] if 8 <= len(str(x).strip()) <= 300][:6]
        except Exception:  # truncated JSON: keep the complete quoted examples
            ex = [x for x in re.findall(r'"((?:[^"\\]|\\.){8,300})"\s*[,\]]', reply or "") if x != "examples"][:6]
        if not ex:
            failed += 1
            print(f"  failed: {sid}")
            continue
        cache[sid] = {"hash": h, "examples": ex}
        done += 1
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        tmp = OUT + ".tmp"
        json.dump(cache, open(tmp, "w"), indent=1, ensure_ascii=False)
        os.replace(tmp, OUT)
    print(f"generated {done}, failed {failed}, total {len(cache)} skills with examples -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
