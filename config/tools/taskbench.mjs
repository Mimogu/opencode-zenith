#!/usr/bin/env bun
// taskbench: real tasks through the running OpenCode service, graded automatically.
//
//   bun tools/taskbench.mjs                 run every task (3 at a time), write state/taskbench/<ts>.json
//   bun tools/taskbench.mjs cart-fix ram    run only these tasks
//   bun tools/taskbench.mjs --quick         skip the slow tasks (web research, slides)
//   bun tools/taskbench.mjs --show          print the last run next to the one before it
//   TASKBENCH_MODEL=<provider/model> bun tools/taskbench.mjs --quick   pin every task to one model
//
// Each task gets a fresh folder under /var/tmp/pip-scratch/opencode/taskbench/<run>/<task>, a prompt
// written the way the user writes, and a grader that checks the result itself (hidden tests, the
// machine's real numbers, live web data, files on disk): score 0..1 plus notes. A run records per
// task the score, seconds to the answer and to the end of all review rounds, steps, models used and
// the harness nudges (answer-check, verify-claims). Add a task whenever a real session goes wrong.
// It uses the user's service and free-model quota: ~14 tasks, 20-40 min.
import fs from "fs";
import os from "os";
import path from "path";
import { execSync, spawn, spawnSync } from "child_process";
import { fileURLToPath } from "url";

const CFG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(CFG, "state/taskbench");
const LOG = path.join(CFG, "context-engine.log");
const ROOT = "/var/tmp/pip-scratch/opencode/taskbench";
const CONCURRENCY = 3;
const MAX_MS = 40 * 60_000;

const sh = (cmd, cwd) => spawnSync("bash", ["-c", cmd], { cwd, encoding: "utf-8", timeout: 120_000, maxBuffer: 64 << 20 });
const write = (dir, files) => { for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), c); } };
const gitInit = (dir) => sh("git init -q . && git add -A && git -c user.email=b@b -c user.name=bench commit -qm init", dir);
const words = (t) => t.replace(/```[\s\S]*?```/g, " ").split(/\s+/).filter((w) => /\w/.test(w)).length;
const has = (t, re) => re.test(t);

// ---------------------------------------------------------------- tasks
const TASKS = [
  {
    id: "cart-fix", kind: "code",
    prompt: "My shop's checkout totals are wrong: customers with 2 of the same item only pay for one, and the discounts look off too. The code is in this folder. Fix it.",
    setup(dir) {
      write(dir, {
        "cart.py": `"""Shopping cart totals."""\n\n\ndef subtotal(items):\n    """Sum of price * qty for every item."""\n    return sum(i["price"] for i in items)\n\n\ndef discount(total, code):\n    """SAVE10 = 10% off, SAVE20 = 20% off (only for totals of 100 or more), else nothing."""\n    if code == "SAVE10":\n        return total * 0.1\n    if code == "SAVE20" and total > 100:\n        return total * 0.2\n    return 0\n\n\ndef total(items, code=None, tax=0.14):\n    """Subtotal minus discount, then tax added on the discounted amount; rounded to 2 places."""\n    s = subtotal(items)\n    d = discount(s, code)\n    return round(s - d * (1 + tax), 2)\n`,
        "test_cart.py": `from cart import total\n\ndef test_simple():\n    assert total([{"price": 10, "qty": 1}], tax=0) == 10\n`,
      });
      gitInit(dir);
    },
    grade(dir) {
      const r = sh(`python3 -c '
import cart
c = [cart.subtotal([{"price":10,"qty":2}]) == 20,
     cart.total([{"price":100,"qty":1}], "SAVE20", 0) == 80,
     cart.total([{"price":100,"qty":1}], "SAVE10", 0.14) == 102.6,
     cart.total([{"price":60,"qty":2}], "SAVE20", 0.14) == 109.44,
     cart.total([{"price":50,"qty":1}], "SAVE10", 0) == 45]
print(sum(c), len(c))'`, dir);
      const [ok, n] = (r.stdout.trim().split(" ").map(Number));
      const tests = (sh("grep -c '^def test_' test_cart.py", dir).stdout.trim() | 0);
      return { score: n ? ok / n : 0, notes: `${ok}/${n} hidden checks; ${tests} test function(s) in test_cart.py${tests > 1 ? "" : " (none added)"}` };
    },
  },
  {
    id: "js-slug", kind: "code",
    prompt: "the links on my blog look wrong. a post called 'Hello  World!' gets the slug 'Hello--World-' instead of 'hello-world'. the code is in this folder, fix it please",
    setup(dir) {
      write(dir, {
        "slug.js": `// Turn a post title into a URL slug: lowercase words joined by single dashes.\nexport function slugify(title) {\n  return title.replace(/[^A-Za-z0-9]/g, "-");\n}\n`,
        "package.json": `{"name":"blog","type":"module","version":"1.0.0"}\n`,
      });
      gitInit(dir);
    },
    grade(dir) {
      const cases = [["Hello  World!", "hello-world"], ["  Rust & Go: 2026 ", "rust-go-2026"], ["Already-a-slug", "already-a-slug"], ["Ünïcode Café", null]];
      const js = `import { slugify } from "./slug.js"; const c = ${JSON.stringify(cases)}; let ok = 0, n = 0;
        for (const [a, b] of c) { if (b === null) continue; n++; if (slugify(a) === b) ok++; } console.log(ok, n);`;
      fs.writeFileSync(path.join(dir, ".grade.mjs"), js);
      const r = sh("node .grade.mjs", dir);
      fs.rmSync(path.join(dir, ".grade.mjs"), { force: true });
      const [ok, n] = r.stdout.trim().split(" ").map(Number);
      return { score: n ? ok / n : 0, notes: `${ok}/${n} slug cases${r.stderr ? ` (${r.stderr.trim().split("\n").pop().slice(0, 80)})` : ""}` };
    },
  },
  {
    id: "rename", kind: "code",
    prompt: "rename the function calc_total to compute_total everywhere in this project and make sure everything still works",
    setup(dir) {
      write(dir, {
        "shop/__init__.py": "",
        "shop/pricing.py": `def calc_total(prices, tax=0.1):\n    return round(sum(prices) * (1 + tax), 2)\n`,
        "shop/invoice.py": `from shop.pricing import calc_total\n\n\ndef invoice_line(name, prices):\n    return f"{name}: {calc_total(prices)}"\n`,
        "shop/report.py": `from shop import pricing\n\n\ndef report(orders):\n    # calc_total is applied per order\n    return [pricing.calc_total(o) for o in orders]\n`,
        "main.py": `from shop.invoice import invoice_line\nfrom shop.report import report\n\nprint(invoice_line("a", [10, 20]))\nprint(report([[1, 2], [3]]))\n`,
      });
      gitInit(dir);
    },
    grade(dir) {
      const left = sh("grep -rn 'calc_total' --include=*.py . | grep -v '^./.git' | wc -l", dir).stdout.trim() | 0;
      const run = sh("python3 main.py", dir);
      const imp = sh("python3 -c 'from shop.pricing import compute_total; print(compute_total([10], 0))'", dir);
      const s = (run.stdout.includes("a: 33.0") && run.stdout.includes("[3.3, 3.3]") ? 0.4 : 0) + (imp.stdout.trim() === "10" ? 0.3 : 0) + (left === 0 ? 0.3 : 0);
      return { score: s, notes: `main.py ${run.status === 0 ? "runs" : "fails"}, compute_total ${imp.status === 0 ? "importable" : "missing"}, ${left} calc_total left` };
    },
  },
  {
    id: "crash-fix", kind: "code",
    prompt: "my report script crashes when the data file is empty:\n\nTraceback (most recent call last):\n  File \"report.py\", line 9, in <module>\n    print(f\"average: {sum(vals) / len(vals):.2f}\")\nZeroDivisionError: division by zero\n\nfix it so it handles that properly. it's in this folder",
    setup(dir) {
      write(dir, {
        "report.py": `import sys\n\nvals = []\nwith open(sys.argv[1]) as f:\n    for line in f:\n        if line.strip():\n            vals.append(float(line))\n\nprint(f"average: {sum(vals) / len(vals):.2f}")\n`,
        "data.txt": "3\n4\n5\n",
        "empty.txt": "",
      });
      gitInit(dir);
    },
    grade(dir) {
      const e = sh("python3 report.py empty.txt", dir);
      const n = sh("python3 report.py data.txt", dir);
      const s = (e.status === 0 && !/Traceback/.test(e.stderr) ? 0.6 : 0) + (n.stdout.includes("4.00") ? 0.4 : 0);
      return { score: s, notes: `empty: exit ${e.status} "${(e.stdout + e.stderr).trim().slice(0, 60)}"; data: "${n.stdout.trim()}"` };
    },
  },
  {
    id: "top-words", kind: "code",
    prompt: "write me a small python command line tool in this folder that shows the 5 most common words in a text file (ignore case and punctuation). there's a sample.txt to try it on",
    setup(dir) {
      write(dir, { "sample.txt": "The quick brown fox.\nThe lazy dog sleeps, the fox runs!\n\nA fox is quick.\n" });
      gitInit(dir);
    },
    grade(dir) {
      const tool = fs.readdirSync(dir).find((f) => f.endsWith(".py") && !f.startsWith("test"));
      if (!tool) return { score: 0, notes: "no .py tool written" };
      fs.writeFileSync(path.join(dir, ".hidden.txt"), "Apple banana APPLE. apple, cherry! banana; Date date DATE date egg\n");
      const r = sh(`python3 ${tool} .hidden.txt`, dir);
      fs.rmSync(path.join(dir, ".hidden.txt"), { force: true });
      const out = r.stdout.toLowerCase();
      const pos = ["date", "apple", "banana"].map((w) => out.indexOf(w));
      const ordered = pos.every((p) => p >= 0) && pos[0] < pos[1] && pos[1] < pos[2];
      return { score: ordered ? 1 : pos.filter((p) => p >= 0).length / 6, notes: `${tool}: ${ordered ? "date>apple>banana right" : `output "${out.trim().replace(/\s+/g, " ").slice(0, 80)}"`}` };
    },
  },
  {
    id: "cleanup", kind: "own-folder",
    prompt: "this project folder takes too much space. remove the build output and caches but don't touch my source code or notes",
    setup(dir) {
      const big = "x".repeat(200_000);
      write(dir, {
        "src/app.js": "console.log('app');\n", "src/util.js": "export const u = 1;\n", "notes.md": "# my notes\nkeep this\n",
        "package.json": `{"name":"p","scripts":{"build":"node build.js"}}\n`,
        "dist/app.min.js": big, "dist/app.min.js.map": big, ".cache/chunk-1": big, ".cache/chunk-2": big,
        "build/output.bin": big,
      });
      gitInit(dir);
    },
    grade(dir) {
      const keep = ["src/app.js", "src/util.js", "notes.md", "package.json"].filter((f) => fs.existsSync(path.join(dir, f))).length;
      const gone = ["dist", ".cache", "build"].filter((f) => !fs.existsSync(path.join(dir, f))).length;
      const s = keep < 4 ? 0 : gone / 3;
      return { score: s, notes: `${keep}/4 source files kept, ${gone}/3 build/cache folders removed` };
    },
  },
  {
    id: "ram", kind: "own-machine",
    prompt: "how much ram does my laptop have and how much of it is free right now?",
    setup() {},
    grade(dir, text) {
      const tot = Number(sh("free -b | awk '/^Mem/{print $2}'").stdout) / 2 ** 30;
      const nums = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(GiB|GB|G)\b/gi)].map((m) => Number(m[1]));
      // usable total within free -h rounding (15.5 GiB shows as "15Gi"), or the installed size (16 GB)
      const installed = Math.pow(2, Math.ceil(Math.log2(tot)));
      const right = nums.some((n) => Math.abs(n - tot) < 0.6 || Math.abs(n - installed) < 0.01);
      const avail = /\b(available|free)\b/i.test(text);
      return { score: (right ? 0.7 : 0) + (avail ? 0.3 : 0), notes: `total ${tot.toFixed(1)} GiB ${right ? "stated" : "NOT stated"}; free/available ${avail ? "mentioned" : "missing"}` };
    },
  },
  {
    id: "disk", kind: "own-machine",
    prompt: "my laptop keeps saying the disk is almost full. how much space do i actually have left and what's taking up the most? don't delete anything",
    setup() {},
    grade(dir, text) {
      const avail = Number(sh("df -B1 --output=avail / | tail -1").stdout) / 1e9;
      const nums = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(GiB|GB|G)\b/gi)].map((m) => Number(m[1]));
      const free = nums.some((n) => Math.abs(n - avail) <= Math.max(3, avail * 0.15) || Math.abs(n - avail / 1.074) <= 3);
      const outside = /\/usr|\/var|outside (your )?home|system (files|folders)|root/i.test(text);
      const homeBig = /steam|\.local/i.test(text);
      return { score: (free ? 0.4 : 0) + (homeBig ? 0.3 : 0) + (outside ? 0.3 : 0), notes: `free ${avail.toFixed(0)} GB ${free ? "right" : "wrong/missing"}; biggest (Steam/.local) ${homeBig ? "named" : "missing"}; outside /home ${outside ? "covered" : "not covered"}` };
    },
  },
  {
    id: "mutex-short", kind: "answer",
    prompt: "In one sentence: what is a mutex?",
    setup() {},
    grade(dir, text) {
      const w = words(text);
      const right = /\block|exclusi|one thread|only one/i.test(text);
      return { score: (right ? 0.5 : 0) + (w <= 78 ? 0.5 : 0), notes: `${w} words, ${right ? "correct idea" : "idea missing"}` };
    },
  },
  {
    id: "bun-short", kind: "web",
    prompt: "what's the newest stable version of bun right now and what changed in it? keep it short",
    setup() {},
    grade(dir, text) {
      const v = sh("npm view bun version").stdout.trim();
      const w = words(text);
      return { score: (v && text.includes(v) ? 0.6 : 0) + (w <= 195 ? 0.4 : 0), notes: `latest ${v} ${text.includes(v) ? "named" : "NOT named"}; ${w} words` };
    },
  },
  {
    id: "hn-top3", kind: "browser",
    prompt: "open https://news.ycombinator.com in a browser and tell me the titles of the top 3 stories right now",
    setup() {},
    async grade(dir, text) {
      const ids = await (await fetch("https://hacker-news.firebaseio.com/v0/topstories.json")).json();
      const titles = await Promise.all(ids.slice(0, 5).map(async (i) => (await (await fetch(`https://hacker-news.firebaseio.com/v0/item/${i}.json`)).json()).title));
      // the front page moves while the task runs: any of the current top 5 counts
      const n = titles.filter((t) => t && text.toLowerCase().includes(t.toLowerCase().slice(0, 30))).length;
      return { score: Math.min(1, n / 3), notes: `${n} of the current top-5 titles in the answer` };
    },
  },
  {
    id: "slides", kind: "document", slow: true,
    prompt: "make a 3 slide presentation for my parents about why backing up their photos matters. save it in this folder",
    setup() {},
    grade(dir) {
      const f = fs.readdirSync(dir).find((x) => x.endsWith(".pptx"));
      if (!f) return { score: 0, notes: "no .pptx" };
      const list = sh(`unzip -l "${f}"`, dir).stdout;
      const n = (list.match(/ppt\/slides\/slide\d+\.xml/g) || []).length;
      const txt = sh(`unzip -p "${f}" 'ppt/slides/*.xml'`, dir).stdout;
      const topical = /backup|back up|photo/i.test(txt);
      return { score: (n === 3 ? 0.7 : 0) + (topical ? 0.3 : 0), notes: `${f}: ${n} slides, ${topical ? "on topic" : "topic words missing"}` };
    },
  },
  {
    id: "ssd-judgement", kind: "research", slow: true,
    prompt: "i want to buy a 1TB NVMe SSD for my laptop in egypt. what's the cheapest good one i can actually buy right now and where?",
    setup() {},
    grade(dir, text) {
      // the user's Dell Inspiron 15-3567 has a 2.5" SATA bay and no M.2 slot (lspci/lsblk, Dell)
      const sata = /\bSATA\b/.test(text);
      const warns = /(no|without|doesn'?t have|does not have|lacks?)\b.{0,30}\b(M\.2|NVMe)|\b(can'?t|cannot|won'?t|will not|doesn'?t|does not)\b.{0,40}\b(NVMe|M\.2)|SATA[- ]only|only (a |one )?(2\.5|SATA)/i.test(text);
      const price = /\b\d[\d,]{2,}\s*(EGP|LE|جنيه)/i.test(text);
      return { score: (warns ? 0.5 : 0) + (sata ? 0.25 : 0) + (price ? 0.25 : 0), notes: `no-M.2 warning ${warns ? "given" : "MISSING"}; SATA ${sata ? "recommended" : "not mentioned"}; EGP price ${price ? "given" : "missing"}` };
    },
  },
  {
    id: "remember", kind: "memory",
    prompt: "please remember that my favourite editor font is JetBrains Mono, size 13",
    setup() {},
    grade(dir, text, run) {
      const db = path.join(os.homedir(), ".local/share/opencode/upgraded_memory/l2_memory.db");
      const r = sh(`sqlite3 -readonly "${db}" "select id from facts where deleted=0 and superseded_by is null and content like '%JetBrains Mono%' and created_at >= datetime(${Math.floor(run.started / 1000)}, 'unixepoch')"`);
      const ids = r.stdout.trim().split("\n").filter(Boolean);
      for (const id of ids) sh(`mem forget --id ${id} --reason "taskbench cleanup" 2>/dev/null || true`);
      return { score: ids.length ? 1 : 0, notes: ids.length ? `saved as fact ${ids.join(",")} (removed again)` : "nothing saved" };
    },
  },
];

// ---------------------------------------------------------------- running
function api(args, file) {
  const r = spawnSync("bash", ["-c", `timeout 60 opencode api ${args} > "${file}" 2>/dev/null`]);
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return null; }
}
const data = (x) => (x && x.data !== undefined ? x.data : x);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runTask(t, runDir) {
  const dir = path.join(runDir, t.id);
  fs.mkdirSync(dir, { recursive: true });
  t.setup(dir);
  // a pinned run must stay on its model (strong start / escalation read this marker)
  if (process.env.TASKBENCH_MODEL) fs.writeFileSync(path.join(dir, ".pinned-model"), process.env.TASKBENCH_MODEL + "\n");
  const started = Date.now();
  const client = spawn("bash", ["-c", `timeout ${MAX_MS / 1000} opencode run ${process.env.TASKBENCH_MODEL ? "-m \"$TASKBENCH_MODEL\" " : ""}"$P" </dev/null >"${dir}/.client.txt" 2>&1`], { cwd: dir, env: { ...process.env, PWD: dir, P: t.prompt } });
  let sid = "";
  for (let i = 0; i < 40 && !sid; i++) {
    await sleep(3000);
    const list = data(api("GET /api/session", path.join(dir, ".sessions.json"))) || [];
    sid = list.find((s) => s.location?.directory === dir && s.time?.created >= started - 2000 && !s.parentID)?.id || "";
  }
  if (!sid) return { id: t.id, kind: t.kind, score: 0, notes: "no session started", error: true };
  // done = idle, the review for that idle has been logged, and nothing new for 10 s
  let ctx = [];
  while (Date.now() - started < MAX_MS) {
    await sleep(10_000);
    ctx = data(api(`GET /api/session/${sid}/context`, path.join(dir, ".ctx.json"))) || [];
    const last = ctx.at(-1);
    if (last?.type !== "idle") continue;
    const lastA = ctx.filter((m) => m.type === "assistant").at(-1);
    const lastATime = lastA?.time?.completed || lastA?.time?.created || last?.time?.created || started;
    const since = new Date(Math.min(last.time.created, lastATime) - 2000).toISOString();
    const logged = fs.readFileSync(LOG, "utf-8").split("\n").some((l) => l.includes(`verify-claims ${sid}`) && l.slice(1, 25) >= since);
    if (!logged && Date.now() - last.time.created < 240_000) continue;
    await sleep(10_000);
    const again = data(api(`GET /api/session/${sid}/context`, path.join(dir, ".ctx.json"))) || [];
    if (again.at(-1)?.id === last.id) { ctx = again; break; }
  }
  client.kill();
  const A = ctx.filter((m) => m.type === "assistant");
  const text = (A.at(-1)?.content || []).filter((p) => p.type === "text").map((p) => p.text).join("\n");
  const syn = ctx.filter((m) => m.type === "synthetic");
  const firstNudge = syn[0]?.time?.created;
  const answerAt = A.filter((m) => !firstNudge || m.time.created < firstNudge).at(-1)?.time?.completed;
  let g;
  try { g = await t.grade(dir, text, { started, sid }); } catch (e) { g = { score: 0, notes: `grader error: ${e.message}` }; }
  // each task folder is its own OpenCode location with a full set of MCP servers (~200 MB): close it
  api(`DELETE "/api/debug/location?location%5Bdirectory%5D=${encodeURIComponent(dir)}"`, path.join(dir, ".evict.json"));
  return {
    id: t.id, kind: t.kind, sid, score: Math.round(g.score * 100) / 100, notes: g.notes,
    s_answer: answerAt ? Math.round((answerAt - started) / 1000) : null,
    s_total: Math.round(((ctx.at(-1)?.time?.created || Date.now()) - started) / 1000),
    steps: A.length, models: [...new Set(A.map((m) => m.model?.id))],
    nudges: syn.map((m) => m.metadata?.source || "?"), compacted: ctx.some((m) => m.type === "compaction"),
    words: words(text),
  };
}

function table(res, prev) {
  const p = new Map((prev?.results || []).map((r) => [r.id, r]));
  const rows = res.results.map((r) => {
    const o = p.get(r.id);
    const d = o ? ` (${r.score >= o.score ? "+" : ""}${(r.score - o.score).toFixed(2)})` : "";
    return `${r.id.padEnd(14)} ${r.score.toFixed(2)}${d.padEnd(8)} ${String(r.s_answer ?? "-").padStart(5)}s ${String(r.s_total).padStart(5)}s  ${String(r.steps).padStart(3)} steps  ${(r.nudges.join(",") || "-").padEnd(28)} ${r.notes}`;
  });
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };
  return [
    `task           score         answer  total  steps  nudges                       notes`,
    ...rows,
    `-- mean score ${avg(res.results.map((r) => r.score)).toFixed(2)}${prev ? ` (was ${avg(prev.results.map((r) => r.score)).toFixed(2)})` : ""}, median total ${med(res.results.map((r) => r.s_total))}s${prev ? ` (was ${med(prev.results.map((r) => r.s_total))}s)` : ""}, ${res.at}`,
  ].join("\n");
}

const runs = () => (fs.existsSync(OUT_DIR) ? fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".json")).sort() : []);
if (process.argv.includes("--show")) {
  const r = runs();
  if (!r.length) { console.log("no runs yet"); process.exit(0); }
  const load = (f) => JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), "utf-8"));
  console.log(table(load(r.at(-1)), r.length > 1 ? load(r.at(-2)) : null));
  process.exit(0);
}

if (process.argv.includes("--selftest")) {
  // graders on the untouched fixtures: every code task must score low, or its grader is broken
  const dir0 = fs.mkdtempSync(path.join(os.tmpdir(), "taskbench-self-"));
  for (const t of TASKS.filter((x) => ["code", "own-folder", "document"].includes(x.kind))) {
    const d = path.join(dir0, t.id); fs.mkdirSync(d, { recursive: true }); t.setup(d);
    const g = await t.grade(d, "", { started: Date.now(), sid: "" });
    console.log(`${t.id.padEnd(14)} ${g.score.toFixed(2)}  ${g.notes}`);
  }
  process.exit(0);
}

const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const quick = process.argv.includes("--quick");
const todo = TASKS.filter((t) => (only.length ? only.includes(t.id) : !(quick && t.slow)));
const at = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const runDir = path.join(ROOT, at);
fs.mkdirSync(runDir, { recursive: true });
console.log(`taskbench ${at}: ${todo.length} tasks, ${CONCURRENCY} at a time -> ${runDir}`);
const results = [];
const queue = [...todo];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (let t; (t = queue.shift()); ) {
    const r = await runTask(t, runDir).catch((e) => ({ id: t.id, kind: t.kind, score: 0, notes: `runner error: ${e.message}`, error: true, nudges: [], steps: 0, s_total: 0 }));
    results.push(r);
    console.log(`  ${r.id}: ${r.score} in ${r.s_total}s (${r.notes})`);
  }
}));
results.sort((a, b) => TASKS.findIndex((t) => t.id === a.id) - TASKS.findIndex((t) => t.id === b.id));
const prevFile = runs().at(-1);
const res = { at, tasks: todo.map((t) => t.id), results };
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, `${at}.json`), JSON.stringify(res, null, 1));
console.log("\n" + table(res, prevFile ? JSON.parse(fs.readFileSync(path.join(OUT_DIR, prevFile), "utf-8")) : null));
