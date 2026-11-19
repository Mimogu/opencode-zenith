"""Python twin of plugins/context-engine/keywords.mjs: same lexicon, tokenizer, stemmer and BM25
scoring, so `mem`, the memory MCP and the plugin agree on what a keyword match is.
tests/test_keywords.py checks the two tokenize identically."""
from __future__ import annotations

import json
import math
import os
import re
from functools import lru_cache

_LEX_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.realpath(__file__))), "keyword-lexicon.json")
try:
    with open(_LEX_FILE, encoding="utf-8") as _f:
        _LEX = json.load(_f)
except Exception:
    _LEX = {}
STOP = set(_LEX.get("stop", []))
KEEP_SHORT = set(_LEX.get("keep_short", []))

_TOKEN = re.compile(r"[a-z0-9][a-z0-9+#.-]*[a-z0-9+#]|[a-z0-9]")
_VOWEL = re.compile(r"[aeiouy]")


@lru_cache(maxsize=65536)
def stem(w: str) -> str:
    if len(w) <= 3 or not re.fullmatch(r"[a-z]+", w):
        return w
    s = w
    if s.endswith("ies") and len(s) > 4:
        s = s[:-3] + "y"
    elif s.endswith("sses"):
        s = s[:-2]
    elif s.endswith("s") and not re.search(r"(ss|us|is)$", s):
        s = s[:-1]
    m = re.search(r"(ing|ed)$", s)
    if m:
        base = s[: -len(m.group(1))]
        if len(base) >= 3 and _VOWEL.search(base):
            s = base
            if re.search(r"([^aeiouslz])\1$", s):
                s = s[:-1]
    elif s.endswith("ly") and len(s) > 5:
        s = s[:-2]
    if len(s) > 3 and s.endswith("e"):
        s = s[:-1]
    if len(s) > 3 and s.endswith("y"):
        s = s[:-1] + "i"
    return s


def _keep(t: str) -> bool:
    return t not in STOP and (len(t) >= 3 or t in KEEP_SHORT) and not re.fullmatch(r"\d{1,2}", t)


def tokenize(text: str) -> list[str]:
    out: list[str] = []
    for t in _TOKEN.findall(re.sub(r"[’']", "", str(text or "").lower())):
        t = re.sub(r"\.+$", "", t)
        parts = re.split(r"[.-]+", t) if re.search(r"[.-]", t) else []
        if _keep(t):
            out.append(stem(t))
        out.extend(stem(p) for p in parts if p and _keep(p))
    return out


_SYN: dict[str, list[str]] = {}
for _group in _LEX.get("synonyms", []):
    _stems = list(dict.fromkeys(stem(w.lower()) for w in _group))
    for _s in _stems:
        _SYN[_s] = list(dict.fromkeys(_SYN.get(_s, []) + [x for x in _stems if x != _s]))


def _edit_distance(a: str, b: str, mx: int) -> int:
    if abs(len(a) - len(b)) > mx:
        return mx + 1
    prev2, prev = None, list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        cur = [i]
        for j in range(1, len(b) + 1):
            v = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] != b[j - 1]))
            if prev2 and i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                v = min(v, prev2[j - 2] + 1)
            cur.append(v)
        if min(cur) > mx:
            return mx + 1
        prev2, prev = prev, cur
    return prev[len(b)]


W_SYN, W_FAMILY, W_TYPO = 0.7, 0.8, 0.8
K1, B = 1.2, 0.75


class KeywordIndex:
    def __init__(self, docs: list[tuple[object, str]]):
        self.ids = [d[0] for d in docs]
        self.post: dict[str, dict[int, int]] = {}
        self.len: list[int] = []
        for i, (_, text) in enumerate(docs):
            toks = tokenize(text)
            self.len.append(len(toks))
            for t in toks:
                p = self.post.setdefault(t, {})
                p[i] = p.get(i, 0) + 1
        self.N = len(docs)
        self.avg = (sum(self.len) / max(1, self.N)) or 1
        self.by_first: dict[str, list[str]] = {}
        for t in self.post:
            self.by_first.setdefault(t[0], []).append(t)
        self.max_idf = math.log(1 + (self.N + 0.5) / 0.5)

    def idf(self, t: str) -> float:
        df = len(self.post.get(t, {}))
        return math.log(1 + (self.N - df + 0.5) / (df + 0.5))

    def expand(self, q: str) -> list[tuple[str, float]]:
        out: dict[str, float] = {}
        if q in self.post:
            out[q] = 1
        for s in _SYN.get(q, []):
            if s in self.post and s not in out:
                out[s] = W_SYN
        if q not in out and len(q) >= 5 and re.fullmatch(r"[a-z]+", q):
            mx = 2 if len(q) >= 8 else 1
            for v in self.by_first.get(q[0], []):
                if v in out or len(v) < 4:
                    continue
                short, long = (q, v) if len(q) <= len(v) else (v, q)
                if len(short) >= 5 and long.startswith(short) and len(long) - len(short) <= 4:
                    out[v] = W_FAMILY
                elif _edit_distance(q, v, mx) <= mx:
                    out[v] = W_TYPO
        return list(out.items())

    def search(self, query: str, limit: int = 20) -> list[dict]:
        qterms = list(dict.fromkeys(tokenize(query)))
        if not qterms or not self.N:
            return []
        score: dict[int, float] = {}
        covered: dict[int, float] = {}
        terms: dict[int, list[str]] = {}
        mass = 0.0
        for q in qterms:
            exp = self.expand(q)
            if not exp and re.search(r"[.-]", q):
                continue
            q_idf = self.idf(q) if q in self.post else (max(self.idf(v) for v, _ in exp) if exp else self.max_idf)
            mass += q_idf
            best: dict[int, float] = {}
            for v, w in exp:
                idf = self.idf(v)
                for d, tf in self.post[v].items():
                    score[d] = score.get(d, 0) + w * idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * self.len[d] / self.avg))
                    if w > best.get(d, 0):
                        best[d] = w
            for d, w in best.items():
                covered[d] = covered.get(d, 0) + w * q_idf
                terms.setdefault(d, []).append(q)
        ranked = sorted(score.items(), key=lambda x: -x[1])[:limit]
        return [{"id": self.ids[d], "score": s, "cover": covered[d] / mass if mass else 0, "terms": terms[d]} for d, s in ranked]
