#!/usr/bin/env python3
"""Recall benchmark for the memory engine.

    python3 tools/recall_eval.py                       # current model
    python3 tools/recall_eval.py nomic-embed-text embeddinggemma all-minilm
    python3 tools/recall_eval.py --json out.json ...   # machine-readable results

Embeds every active fact and episode with each model (no writes to the store),
ranks them for 45 paraphrased questions with known answers and 15 questions that
must recall nothing, and reports hit@1, hit@3, MRR, the score threshold that
maximises F1 (precision on accepted top-1 results vs coverage), and latency.
"""
from __future__ import annotations

import json
import os
import sqlite3
import statistics
import sys
import time
import urllib.request

DB = os.path.expanduser("~/.local/share/opencode/upgraded_memory/l2_memory.db")
OLLAMA = "http://" + os.environ.get("OLLAMA_HOST", "127.0.0.1:11434").replace("http://", "")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "lib"))
import agy_recall as R  # noqa: E402  (PREFIXES lives there so eval and engine agree)

# query -> acceptable targets: "F<id>" for facts, last 8 chars of session id for episodes
POSITIVE = [
    ("which port does my AI gateway listen on", {"F3"}),
    ("how should anime character pictures look when you generate them for me", {"F2", "uO7v65U3"}),
    ("why were way too many tools loaded in claude", {"F4"}),
    ("can opencode update itself or do I go through the package manager", {"F7", "eso2Orf2"}),
    ("the cli puts my sessions in the wrong folder", {"F8", "TjeL1v6h"}),
    ("how are the per-category model rankings organised in my harness", {"F9"}),
    ("the free models stopped answering for the rest of the day", {"F10", "QVu2UQ6s"}),
    ("what order should I build my frames and weapons in", {"F15", "SexGNan6"}),
    ("my whole desktop died and dropped me to a text console", {"hpKz5shY", "CWF2vFgf", "RcWvG1uJ"}),
    ("recording my screen made the graphical session crash", {"RcWvG1uJ", "hpKz5shY", "CWF2vFgf"}),
    ("screensharing does not work under my wayland compositor", {"V5HF6uQP"}),
    ("notebook turns off when I pull the power cable", {"9Cn6nSTN"}),
    ("printer refuses to print a test page over usb", {"G8nYbn3l"}),
    ("godot script says a node is null when getting children", {"qELa2guN"}),
    ("theme database returns nothing in my game data script", {"LB2hVAJR", "5q4v1FfI"}),
    ("make the hero ultimate cutscene look like saber's excalibur", {"0IHPg2A4", "dF8LMB8H", "7Bw0pClj", "CiBz1URv", "yDkGpeFK"}),
    ("black rendering on the ghast harness when shaders are on", {"Cfxmhcy9", "3pogqSAz"}),
    ("my steel path damage is way too low", {"5kxd4k9i"}),
    ("warframe crashed on me this afternoon", {"d2DRtxL9"}),
    ("streaming works in vesktop but not in the official discord client", {"Dhtb3ycn", "CD5SKVip", "tESdC9sT"}),
    ("vesktop is not showing what game I am playing", {"PZ3wLzJd"}),
    ("find me an affordable laptop for video editing in egypt", {"dknPczh3", "sAfc5g3t"}),
    ("is the SSD I bought genuine or fake", {"zW5OAMmk"}),
    ("the gateway gives up after too many retries", {"nBPk110v"}),
    ("router skips every target before dispatching the request", {"iCW3FOjc"}),
    ("the web ui throws a file not found path error", {"9K2ILSe7"}),
    ("connection reset errors keep retrying in opencode", {"iYxr3ME4"}),
    ("cloudflare tunnel keeps disconnecting", {"hQtMt6V0"}),
    ("make Helium my default web browser", {"XWSV8xqT", "5Vi4o53U"}),
    ("use super+tab instead of alt+tab to switch windows", {"1APXR8ne"}),
    ("keyboard shortcuts stopped working after a reboot", {"6Tj2AS9R"}),
    ("xfce will not start after I updated the system", {"7pDRF4Gj", "u9cLL6vg"}),
    ("the pdf toolkit appimage crashes with an EGL error", {"h0g959gr"}),
    ("build a cherry blossom treehouse in minecraft", {"ovcUqjIH", "dCnxwHJ4", "I5tn5XmE", "ARMQV8lC"}),
    ("procedural leaves for voxel trees", {"GNr4nGQN", "7E2OrpSi"}),
    ("real time voice translation with very low delay", {"NDzTwObN"}),
    ("run the windows-only BI tool through my windows vm apps", {"cT0HRB1M"}),
    ("make my budget spreadsheet look professional", {"ePwDGOUP"}),
    ("what did the audit of my memory system find", {"PNPshgYV", "C56AYhFG", "JLrkr97J", "o6nLWNuO", "MzK2Kbx1"}),
    ("split screen co-op for transformers war for cybertron", {"vOXxrpXW"}),
    ("minecraft launcher could not download the fabric loader", {"a2EPbKdW", "6Qh9uEA3"}),
    ("which lightweight web browser should I use", {"P2fYhQdM"}),
    ("spoofdpi is eating my cpu", {"2WaPXcdg"}),
    ("how much disk space does roblox take on linux", {"D29li6LC"}),
    ("teach me c++ from zero", {"rmNWC7k3"}),
    # auto-extracted facts (ids from extraction on 2026-11-03; update if they get superseded)
    ("what kind of software budget do I have", {"F17"}),
    ("do I pay for any AI subscriptions or only use free stuff", {"F17"}),
    ("did I move off claude code to something else", {"F18"}),
]
NEGATIVE = [
    "what's the weather in paris", "hi", "write a haiku about autumn", "convert 5 miles to km",
    "explain quantum entanglement simply", "what is the capital of australia",
    "sort this list in python: 3,1,2", "recommend a good sci-fi novel", "thanks that's all",
    "how do I boil an egg", "translate hello to spanish", "what time is it in tokyo",
    "give me a random number", "explain recursion", "who won the world cup in 2022",
    # hard negatives: technical, plausible for this user, but nothing stored is about them
    "make the container image smaller", "write a python function to parse csv", "how do I center a div",
    "explain big O notation", "set up a github action that runs the tests", "what is a mutex",
    "rust borrow checker error on a vec", "rename this variable everywhere", "bump the version in package.json",
    "convert this loop to a list comprehension",
]


# skill matching: (prompt, acceptable skills); written independently of skill-examples.json
SKILL_POSITIVE = [
    ("my react table is janky when I scroll it", {"performance-profiling", "modern-web-guidance"}),
    ("set up docker compose with postgres and redis for local dev", {"docker-infra", "deployment-patterns"}),
    ("there's a conflict while rebasing my feature branch", {"git-conflict-resolver", "git-workflow"}),
    ("validate the signup form input and add rate limiting to the login endpoint", {"owasp-security"}),
    ("write unit tests for the parser module", {"test-quality"}),
    ("why does this function sometimes return undefined", {"systematic-debugging"}),
    ("put our quarterly results into a slide deck", {"pptx"}),
    ("fill in this pdf form for me", {"pdf"}),
    ("build a budget spreadsheet with formulas", {"xlsx"}),
    ("write this report up as a word document", {"docx"}),
    ("draw me a picture of a dragon over a castle", {"image-gen"}),
    ("make a short video clip of ocean waves", {"video-gen"}),
    ("audit my whole branch for bugs, security and code quality", {"thermos", "thermo-nuclear-review"}),
    ("what else might break if I rename this public API", {"blast-radius"}),
    ("strip the ai slop out of this diff", {"deslop", "unslop"}),
    ("delete the pointless comments in these files", {"no-comments"}),
    ("research the best budget GPUs with sources", {"deep-research"}),
    ("my godot signal never fires when the button is pressed", {"godot4-dev"}),
    ("add a column to the users table without downtime", {"database-migrations"}),
    ("turn this json payload into typescript types", {"schema-to-type"}),
    ("our node service leaks memory until it gets OOM killed", {"performance-profiling"}),
    ("build an MCP server that wraps my REST api", {"mcp-builder"}),
    ("design a poster for my band's gig", {"canvas-design", "algorithmic-art"}),
    ("scrape prices from this javascript-heavy shop", {"browser-automation"}),
    ("click the play button in the app on my screen", {"desktop-control"}),
    ("I just joined this repo, walk me through how it's organised", {"codebase-onboarding"}),
    ("this module has duplicated helpers and dead code, consolidate it", {"ponytail", "ponytail-debt", "deslop"}),
    ("write a minecraft function that gives every player a diamond sword", {"mcfunction-builder"}),
    ("is my reviewer just agreeing with me? challenge the fix", {"anti-sycophancy"}),
    ("get the latest docs for the react router loader api", {"documentation-lookup"}),
]
SKILL_NEGATIVE = [
    "hi", "thanks, that's all", "what's 2+2", "tell me a joke", "what is the capital of france",
    "rank all the gpus by performance", "summarize this paragraph for me", "how was your day",
    # hard negatives: coding requests no installed skill is specifically about
    "write a python function to parse csv", "rename this variable everywhere", "add a print statement here",
    "what does this regex match", "implement binary search in go", "convert this loop to a list comprehension",
    "bump the version in package.json", "write a bash one-liner that counts files", "explain what a closure is",
    "add type hints to this function",
]


def embed(model: str, texts: list[str], kind: str, timeout: float = 300) -> list[list[float]]:
    pq, pd = R.PREFIXES.get(model, ("", ""))
    pre = pq if kind == "query" else pd
    body = json.dumps({"model": model, "input": [pre + t[:6000] for t in texts], "keep_alive": "20m", "truncate": True}).encode()
    req = urllib.request.Request(f"{OLLAMA}/api/embed", body, {"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return [R._norm(e) for e in json.load(r)["embeddings"]]


def corpus() -> list[tuple[str, str]]:
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    docs = [(f"F{i}", f"{t}\n{c}") for i, t, c in con.execute(
        "SELECT id, title, content FROM facts WHERE superseded_by IS NULL AND deleted = 0")]
    docs += [(sid[-8:], g) for sid, g in con.execute("SELECT session_id, gist FROM episodes")]
    return docs


def evaluate(model: str, docs) -> dict:
    t0 = time.time()
    dv = []
    for i in range(0, len(docs), 16):
        dv += embed(model, [d for _, d in docs[i:i + 16]], "doc")
    index_s = time.time() - t0
    embed(model, ["warm up"], "query")
    lat, ranked = [], []
    for q in [p[0] for p in POSITIVE] + NEGATIVE:
        t = time.perf_counter()
        qv = embed(model, [q], "query")[0]
        lat.append((time.perf_counter() - t) * 1000)
        scores = sorted(((R.dot(qv, v), docs[j][0]) for j, v in enumerate(dv)), reverse=True)
        ranked.append(scores)
    pos, neg = ranked[:len(POSITIVE)], ranked[len(POSITIVE):]
    hit1 = sum(1 for (q, tg), s in zip(POSITIVE, pos) if s[0][1] in tg) / len(POSITIVE)
    hit3 = sum(1 for (q, tg), s in zip(POSITIVE, pos) if any(x[1] in tg for x in s[:3])) / len(POSITIVE)
    mrr = statistics.mean(next((1 / (k + 1) for k, x in enumerate(s) if x[1] in tg), 0) for (q, tg), s in zip(POSITIVE, pos))
    # threshold sweep on the top-1 score: accept iff score >= thr
    best = None
    for thr in [x / 1000 for x in range(50, 951, 5)]:
        tp = sum(1 for (q, tg), s in zip(POSITIVE, pos) if s[0][0] >= thr and s[0][1] in tg)
        fp_pos = sum(1 for (q, tg), s in zip(POSITIVE, pos) if s[0][0] >= thr and s[0][1] not in tg)
        fp_neg = sum(1 for s in neg if s[0][0] >= thr)
        prec = tp / (tp + fp_pos + fp_neg) if tp + fp_pos + fp_neg else 1.0
        rec = tp / len(POSITIVE)
        f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0
        # prefer precision: a wrong memory is worse than a missing one
        f05 = 1.25 * prec * rec / (0.25 * prec + rec) if prec + rec else 0
        if best is None or f05 > best["f05"]:
            best = {"thr": thr, "precision": prec, "recall": rec, "f1": f1, "f05": f05, "neg_leaks": fp_neg}
    at = {}
    for thr in (0.58, 0.60, 0.64, 0.66, 0.68):  # recall at fixed thresholds, for comparing with production
        at[thr] = sum(1 for (q, tg), s in zip(POSITIVE, pos) if s[0][0] >= thr and s[0][1] in tg) / len(POSITIVE)
    margin = statistics.mean(s[0][0] for s in pos) - max(s[0][0] for s in neg)

    # what production injects: up to 4 facts + 2 sessions above the floor AND within `gap` of the best
    def injected(s, thr, gap):
        best = s[0][0]
        keep = [x for x in s if x[0] >= thr and x[0] >= best - gap]
        facts = [x for x in keep if x[1].startswith("F")][:4]
        eps = [x for x in keep if not x[1].startswith("F")][:2]
        return facts + eps
    thr = best["thr"]
    gaps = []
    for gap in [x / 100 for x in range(2, 21)]:
        items = [(x[1] in tg) for (q, tg), sc in zip(POSITIVE, pos) for x in injected(sc, thr, gap)]
        noise_neg = sum(len(injected(sc, thr, gap)) for sc in neg)
        found = sum(1 for (q, tg), sc in zip(POSITIVE, pos) if any(x[1] in tg for x in injected(sc, thr, gap))) / len(POSITIVE)
        prec = sum(items) / (len(items) + noise_neg) if items or noise_neg else 1.0
        gaps.append({"gap": gap, "item_precision": prec, "found": found, "items_per_query": len(items) / len(POSITIVE)})
    # widest gap that keeps injected items >= 90% relevant
    pick = max((g for g in gaps if g["item_precision"] >= 0.90), key=lambda g: g["gap"], default=min(gaps, key=lambda g: -g["item_precision"]))
    return {"gap": pick, "gaps": gaps,"model": model, "docs": len(docs), "hit1": hit1, "hit3": hit3, "mrr": mrr, "best": best,
            "neg_max": max(s[0][0] for s in neg), "pos_mean_top": statistics.mean(s[0][0] for s in pos),
            "margin": margin, "lat_p50_ms": statistics.median(lat), "lat_p95_ms": sorted(lat)[int(len(lat) * .95) - 1],
            "index_s": index_s, "recall_at": at,
            "misses": [q for (q, tg), s in zip(POSITIVE, pos) if s[0][1] not in tg]}


def skill_corpus() -> list[tuple[str, str]]:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import skill_examples as SE
    ex = json.load(open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "skill-examples.json")))
    docs = []
    for sid, desc in SE.skills().items():
        docs.append((sid, f"{sid.replace('-', ' ')}: {desc}"))
        docs += [(sid, e) for e in ex.get(sid, {}).get("examples", [])[:8]]
    return docs


def evaluate_skills(model: str, docs) -> dict:
    dv = []
    for i in range(0, len(docs), 16):
        dv += embed(model, [d for _, d in docs[i:i + 16]], "doc")
    def best(q):
        qv = embed(model, [q], "query")[0]
        per = {}
        for (sid, _), v in zip(docs, dv):
            per[sid] = max(per.get(sid, -1), R.dot(qv, v))
        return sorted(((c, s) for s, c in per.items()), reverse=True)
    # hubness correction, identical to skills.mjs: subtract each skill's mean similarity to neutral prompts
    neutral = json.load(open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "skill-neutral-prompts.json")))["prompts"]
    sums: dict = {}
    for q in neutral:
        for c, sid in best(q):
            sums[sid] = sums.get(sid, 0) + c
    bias = {sid: v / len(neutral) for sid, v in sums.items()}
    raw_best = best
    best = lambda q: sorted(((c - bias.get(sid, 0), sid) for c, sid in raw_best(q)), reverse=True)  # noqa: E731
    pos = [(tg, best(q)) for q, tg in SKILL_POSITIVE]
    neg = [best(q) for q in SKILL_NEGATIVE]
    top1 = sum(1 for tg, r in pos if r[0][1] in tg) / len(pos)
    top3 = sum(1 for tg, r in pos if any(x[1] in tg for x in r[:3])) / len(pos)
    def prec_at(thr):
        acc = [(r[0][1] in tg) for tg, r in pos if r[0][0] >= thr] + [False for r in neg if r[0][0] >= thr]
        return (sum(acc) / len(acc) if acc else 1.0), sum(acc) / len(pos)
    grid = [x / 1000 for x in range(-200, 951, 5)]
    hint = next((t for t in grid if prec_at(t)[0] >= 0.85), grid[-1])      # suggestions: 85% precise
    inject = next((t for t in grid if prec_at(t)[0] >= 0.97), grid[-1])    # auto-load: 97% precise
    leads = [r[0][0] - r[1][0] for tg, r in pos if r[0][1] in tg]
    return {"top1": top1, "top3": top3, "hint": hint, "hint_pr": prec_at(hint), "inject": inject,
            "inject_pr": prec_at(inject), "lead_median": statistics.median(leads) if leads else 0,
            "neg_max": max(r[0][0] for r in neg),
            "misses": [(sorted(tg)[0], r[0][1]) for tg, r in pos if r[0][1] not in tg]}


def calibration(r: dict, sk: dict | None) -> dict:
    thr, margin = r["best"]["thr"], r["margin"]
    out = {
        "fact_min": round(thr, 3), "episode_min": round(thr, 3), "rel_gap": r["gap"]["gap"],
        "duplicate": round(thr + 0.75 * (1 - thr), 3), "related": round(thr + 0.15 * (1 - thr), 3),
        "measured": {"hit1": r["hit1"], "precision": r["best"]["precision"], "recall": r["best"]["recall"],
                     "item_precision": round(r["gap"]["item_precision"], 3), "items_per_query": round(r["gap"]["items_per_query"], 2),
                     "query_ms_p50": round(r["lat_p50_ms"])},
    }
    if sk:
        out.update({"skill_hint": round(sk["hint"], 3), "skill_only_hint": round(max(sk["hint"] + 0.02, sk["neg_max"] + 0.01), 3),
                    "skill_inject": round(sk["inject"], 3), "skill_margin": round(max(0.02, sk["lead_median"] / 2), 3)})
        out["measured"].update({"skill_top1": sk["top1"], "skill_top3": sk["top3"]})
    return out


def dump_cases(path: str) -> None:
    """Export the question sets for tools/recall_e2e.mjs (end-to-end eval of the shipped plugin code)."""
    json.dump({"positive": [[q, sorted(t)] for q, t in POSITIVE], "negative": NEGATIVE,
               "skill_positive": [[q, sorted(t)] for q, t in SKILL_POSITIVE], "skill_negative": SKILL_NEGATIVE},
              open(path, "w"), indent=1)


def main() -> int:
    if "--dump-cases" in sys.argv:
        dump_cases(sys.argv[sys.argv.index("--dump-cases") + 1])
        return 0
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    out = sys.argv[sys.argv.index("--json") + 1] if "--json" in sys.argv else None
    if out in args:
        args.remove(out)
    models = args or [R.EMBED_MODEL]
    docs = corpus()
    results = []
    for m in models:
        try:
            r = evaluate(m, docs)
        except Exception as e:  # model not pulled, Ollama down
            print(f"{m}: {e}")
            continue
        results.append(r)
        b = r["best"]
        print(f"{m:28} hit@1 {r['hit1']:.2f}  hit@3 {r['hit3']:.2f}  MRR {r['mrr']:.2f}  | thr {b['thr']:.3f} "
              f"P {b['precision']:.2f} R {b['recall']:.2f} leaks {b['neg_leaks']}  | margin {r['margin']:+.3f}  "
              f"| query p50 {r['lat_p50_ms']:.0f} ms p95 {r['lat_p95_ms']:.0f} ms | index {r['index_s']:.0f}s")
        g = r["gap"]
        print(f"{'':28} injected: gap {g['gap']:.2f} -> {g['items_per_query']:.1f} items/query, {g['item_precision']:.0%} relevant, "
              f"{g['found']:.0%} of questions get a correct item")
        if "-v" in sys.argv:
            for q in r["misses"]:
                print("    miss:", q)
        sk = None
        if "--skills" in sys.argv or "--write" in sys.argv:
            sk = evaluate_skills(m, skill_corpus())
            r["skills"] = sk
            print(f"{'':28} skills top1 {sk['top1']:.2f} top3 {sk['top3']:.2f} | hint>={sk['hint']:.3f} "
                  f"(P {sk['hint_pr'][0]:.2f} R {sk['hint_pr'][1]:.2f}) inject>={sk['inject']:.3f} "
                  f"(P {sk['inject_pr'][0]:.2f} R {sk['inject_pr'][1]:.2f}) lead {sk['lead_median']:.3f} neg_max {sk['neg_max']:.3f}")
            if "-v" in sys.argv:
                for want, got in sk["misses"]:
                    print(f"    skill miss: wanted {want}, got {got}")
        r["calibration"] = calibration(r, sk)
        if "--write" in sys.argv:
            path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "memory-calibration.json")
            cal = json.load(open(path)) if os.path.exists(path) else {}
            # merge: keeps values set by the end-to-end sweep (kw_relief, measured_e2e)
            cal[m] = {**cal.get(m, {}), **r["calibration"], "calibrated": time.strftime("%Y-%m-%d")}
            json.dump(cal, open(path, "w"), indent=1)
            print(f"{'':28} wrote calibration for {m} -> {path}")
    if out:
        json.dump(results, open(out, "w"), indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
