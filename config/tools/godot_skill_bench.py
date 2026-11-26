#!/usr/bin/env python3
"""Godot add-on skill bench: one realistic job per Godot skill, graded automatically.

    python3 tools/godot_skill_bench.py                 # all five skills
    python3 tools/godot_skill_bench.py jolt effekseer  # some
    python3 tools/godot_skill_bench.py --grade DIR     # re-grade an earlier run

Each job gets a fresh Godot 4 project, a request that names the skill with @<id> (manual mode), and
`opencode run --standalone --archived`. Grading never trusts the model's reply: files, project.godot
settings, scene contents, `godot --check-only` on every script and a headless import decide. It also
records whether the skill was loaded, tool calls, web fetches and minutes, from OpenCode's own database.
Results: <out>/results.json and <out>/results.md (default out: ~/Videos/skill-tests/godot-bench/<time>).
"""
import json, os, re, sqlite3, subprocess, sys, time
from pathlib import Path

HOME = Path.home()
GODOT = os.environ.get("GODOT", "godot")
DB = HOME / ".local/share/opencode/opencode.db"
LOG = HOME / ".config/opencode/context-engine.log"
OPENCODE = str(HOME / ".local/bin/opencode")
TIMEOUT = int(os.environ.get("BENCH_TIMEOUT", "1500"))

PROJECT = """; Engine configuration file.
config_version=5

[application]

config/name="Skill Bench"
run/main_scene="res://main.tscn"
config/features=PackedStringArray("4.7")
"""
MAIN = '[gd_scene format=3]\n\n[node name="Main" type="Node3D"]\n'

JOBS = {
    "effekseer": ("godot-effekseer",
        "@godot-effekseer This is a Godot 4.7 project. Install Effekseer into it and enable its plugin. Add res://vfx.gd "
        "(extends Node) with func spawn_vfx(effect: EffekseerEffect, at: Vector3) that plays the effect once at that "
        "position and frees the emitter when it finishes. Make sure the project loads without errors."),
    "jolt": ("godot-jolt-physics",
        "@godot-jolt-physics This is a Godot 4.7 project. Switch it to Jolt physics and add res://player.gd for a "
        "CharacterBody3D player with gravity, jumping and floor snapping that works on slopes. Make sure the script has no errors."),
    "navigation": ("godot-navigation-recast",
        "@godot-navigation-recast This is a Godot 4.7 project. Add res://enemy.gd for a CharacterBody3D enemy that chases a "
        "target Node3D using NavigationAgent3D, and res://nav_level.tscn with a NavigationRegion3D (with a NavigationMesh) "
        "over a floor, the enemy and a target. Make sure the scripts have no errors and the scene loads."),
    "terrain3d": ("godot-terrain3d",
        "@godot-terrain3d This is a Godot 4.7 project. Install Terrain3D and enable its plugin. Create res://world.tscn with a "
        "Terrain3D node whose data directory is res://terrain_data, and res://terrain_probe.gd that prints the terrain height "
        "at x=0, z=0 when the scene starts. Make sure the project loads without errors."),
    "voxel": ("godot-voxel-tools",
        "@godot-voxel-tools This is a Godot 4.7 project. Install the Voxel Tools extension and create res://voxel_world.tscn "
        "with a VoxelTerrain that uses a blocky mesher and a noise-based generator, plus a VoxelViewer, so a block world "
        "appears around the viewer. Make sure the project loads without errors."),
}

def sh(cmd, cwd=None, timeout=300):
    try:
        r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except subprocess.TimeoutExpired:
        return 124, "timeout"

def new_project(d: Path):
    d.mkdir(parents=True, exist_ok=True)
    (d / "project.godot").write_text(PROJECT)
    (d / "main.tscn").write_text(MAIN)
    sh([GODOT, "--headless", "--path", str(d), "--import"], timeout=180)

def import_errors(d: Path):
    _, out = sh([GODOT, "--headless", "--path", str(d), "--import"], timeout=240)
    return [l.strip() for l in out.splitlines() if re.search(r"\b(ERROR|SCRIPT ERROR|Parse Error|Failed to)\b", l)][:6]

def script_errors(d: Path):
    bad = {}
    for f in sorted(d.rglob("*.gd")):
        if "addons" in f.parts or ".godot" in f.parts:
            continue
        rel = "res://" + str(f.relative_to(d))
        _, out = sh([GODOT, "--headless", "--path", str(d), "--check-only", "--script", rel], timeout=120)
        # only the script's own errors: add-ons may print shutdown noise (Effekseer: "Attempt to disconnect a nonexistent connection")
        errs = [l.strip() for l in out.splitlines() if re.search(r"(SCRIPT ERROR|Parse Error|Compile Error|Identifier .* not declared)", l)]
        if errs:
            bad[rel] = errs[:3]
    return bad

def read(d: Path, name: str) -> str:
    p = d / name
    return p.read_text(errors="replace") if p.exists() else ""

def scene_with_resources(d: Path, name: str) -> str:
    """A scene's text plus the text of the .tres/.tscn files it references (resources saved separately are fine)."""
    txt = read(d, name)
    for ref in re.findall(r'path="res://([^"]+\.(?:tres|tscn))"', txt):
        txt += "\n" + read(d, ref)
    return txt

def plugin_enabled(d: Path, cfg: str) -> bool:
    return f'"{cfg}"' in read(d, "project.godot")

def grade(job: str, d: Path) -> list:
    """[(check, ok, detail)]"""
    c = []
    add = lambda name, ok, detail="": c.append((name, bool(ok), detail))
    if job == "effekseer":
        add("add-on installed", (d / "addons/effekseer/plugin.cfg").exists())
        add("plugin enabled", plugin_enabled(d, "res://addons/effekseer/plugin.cfg"))
        src = read(d, "vfx.gd")
        add("vfx.gd has spawn_vfx", "func spawn_vfx" in src)
        add("frees the emitter when done", bool(re.search(r"autofree\s*=\s*true|finished.*queue_free|queue_free", src)))
    elif job == "jolt":
        m = re.search(r'3d/physics_engine\s*=\s*"([^"]*)"', read(d, "project.godot"))
        add('physics_engine = "Jolt Physics"', m and m.group(1) == "Jolt Physics", m.group(1) if m else "not set")
        src = read(d, "player.gd")
        add("player.gd extends CharacterBody3D", "extends CharacterBody3D" in src)
        snap = re.search(r"floor_snap_length\s*=\s*([0-9.]+)", src)
        add("floor snap 0.2-0.5 for slopes", snap and 0.2 <= float(snap.group(1)) <= 0.5, snap.group(1) if snap else "not set")
        add("uses move_and_slide", "move_and_slide()" in src)
    elif job == "navigation":
        src = read(d, "enemy.gd"); scn = scene_with_resources(d, "nav_level.tscn")
        add("enemy.gd uses NavigationAgent3D", "NavigationAgent3D" in src and "get_next_path_position" in src)
        add("scene has NavigationRegion3D + NavigationMesh", "NavigationRegion3D" in scn and "NavigationMesh" in scn)
        add("scene has the enemy and a target", "enemy.gd" in scn and scn.count("[node") >= 4)
    elif job == "terrain3d":
        add("add-on installed", (d / "addons/terrain_3d/plugin.cfg").exists())
        add("plugin enabled", plugin_enabled(d, "res://addons/terrain_3d/plugin.cfg"))
        scn = scene_with_resources(d, "world.tscn")
        add("world.tscn has Terrain3D", 'type="Terrain3D"' in scn)
        add("data directory res://terrain_data", "res://terrain_data" in scn)
        src = read(d, "terrain_probe.gd")
        add("probe reads the height", bool(re.search(r"get_height", src)))
    elif job == "voxel":
        add("extension installed", (d / "addons/zylann.voxel/voxel.gdextension").exists())
        scn = scene_with_resources(d, "voxel_world.tscn")
        add("VoxelTerrain", 'type="VoxelTerrain"' in scn or "VoxelLodTerrain" in scn)
        add("blocky mesher", "VoxelMesherBlocky" in scn)
        add("noise generator", bool(re.search(r"VoxelGenerator\w*(Noise|Graph)", scn)))
        add("VoxelViewer", 'type="VoxelViewer"' in scn)
    exts = [f.name for f in (d / "addons").rglob("*.gdextension")] if (d / "addons").exists() else []
    plugs = [str(f.parent.relative_to(d)) for f in (d / "addons").rglob("plugin.cfg")] if (d / "addons").exists() else []
    dup = sorted({n for n in exts if exts.count(n) > 1})
    add("each add-on installed once", not dup and all(p.count("/") == 1 for p in plugs), ", ".join(dup) or ", ".join(p for p in plugs if p.count("/") != 1))
    se = script_errors(d)
    add("all scripts compile", not se, json.dumps(se)[:300] if se else "")
    ie = import_errors(d)
    add("project imports without errors", not ie, " / ".join(ie)[:300])
    return c

def session_stats(title: str, skill: str, since: float) -> dict:
    st = {"skill_loaded": False, "tools": 0, "webfetch": 0}
    if not DB.exists():
        return st
    db = sqlite3.connect(str(DB))
    row = db.execute("select id from session_v2 where title=? order by rowid desc limit 1", (title,)).fetchone()
    if not row:
        return st
    sid = row[0]
    for (d,) in db.execute("select data from session_part where session_id=?", (sid,)):
        try: p = json.loads(d)
        except Exception: continue
        if p.get("type") == "tool":
            n = p.get("tool") or p.get("name"); st["tools"] += 1
            if n == "webfetch": st["webfetch"] += 1
            if n == "skill" and skill in json.dumps(p.get("state", {}).get("input", {})): st["skill_loaded"] = True
    try:
        for line in LOG.read_text(errors="replace").splitlines()[-4000:]:
            if sid in line and f"+{skill}(" in line:
                st["skill_loaded"] = True
    except OSError:
        pass
    st["session"] = sid
    return st

def run_job(job: str, out: Path) -> dict:
    skill, prompt = JOBS[job]
    d = out / job
    new_project(d)
    title = f"bench-{job}-{int(time.time())}"
    env = dict(os.environ)
    t0 = time.time()
    try:
        r = subprocess.run([OPENCODE, "run", "--standalone", "--archived", "--title", title, prompt], cwd=d, env=env,
                           stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=TIMEOUT)
        rc, reply = r.returncode, r.stdout + r.stderr
    except subprocess.TimeoutExpired as e:
        rc, reply = 124, (e.stdout or b"").decode(errors="replace") if isinstance(e.stdout, bytes) else (e.stdout or "")
    mins = (time.time() - t0) / 60
    (out / f"{job}.reply.txt").write_text(re.sub(r"\x1b\[[0-9;]*m", "", reply or ""))
    checks = grade(job, d)
    return {"job": job, "skill": skill, "rc": rc, "minutes": round(mins, 1), **session_stats(title, skill, t0),
            "passed": sum(ok for _, ok, _ in checks), "total": len(checks), "checks": checks}

def report(results: list, out: Path):
    (out / "results.json").write_text(json.dumps(results, indent=1))
    lines = ["| job | skill loaded | checks | minutes | tool calls | web fetches | failed checks |", "|---|---|---|---|---|---|---|"]
    for r in results:
        failed = "; ".join(f"{n} ({d})" if d else n for n, ok, d in r["checks"] if not ok) or "-"
        lines.append(f"| {r['job']} | {'yes' if r.get('skill_loaded') else 'NO'} | {r['passed']}/{r['total']} | {r.get('minutes','-')} | {r.get('tools','-')} | {r.get('webfetch','-')} | {failed} |")
    (out / "results.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))

def main(argv):
    if argv[:1] == ["--grade"]:
        out = Path(argv[1]); res = []
        for job in JOBS:
            if (out / job).exists():
                checks = grade(job, out / job)
                res.append({"job": job, "skill": JOBS[job][0], "passed": sum(ok for _, ok, _ in checks), "total": len(checks), "checks": checks})
        report(res, out); return
    jobs = [j for j in argv if j in JOBS] or list(JOBS)
    out = Path(os.environ.get("BENCH_OUT") or HOME / "Videos/skill-tests/godot-bench" / time.strftime("%Y%m%d-%H%M"))
    out.mkdir(parents=True, exist_ok=True)
    results = []
    for job in jobs:
        print(f"[{time.strftime('%H:%M')}] {job} ...", flush=True)
        results.append(run_job(job, out))
        report(results, out)
    print(f"results: {out}/results.md")

if __name__ == "__main__":
    main(sys.argv[1:])
