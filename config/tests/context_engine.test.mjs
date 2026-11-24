// Offline tests for plugins/context-engine: bun test tests/context_engine.test.mjs
// Ollama is pointed at a closed port, so this also covers the keyword-only fallback.
process.env.OLLAMA_HOST = "127.0.0.1:9";
delete process.env.OPENCODE_PRUNE_KEEP;
delete process.env.OPENCODE_SILENT_EVERY;
import { test, expect } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { Database } from "bun:sqlite";
// dynamic imports: static ones are hoisted above the OLLAMA_HOST assignment and would reach the real Ollama
const { compactCatalog, skillContent, loadedSkills, Skills, hintBlock } = await import("../plugins/context-engine/skills.mjs");
const { Recall, formatRecall, saveHint } = await import("../plugins/context-engine/memory.mjs");
const { normalize, dot, toBlob, fromBlob, EMBED_MODEL } = await import("../plugins/context-engine/embed.mjs");

const CFG = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ce-test-"));

test("catalog compaction keeps every skill and shrinks descriptions", () => {
  const long = "Use this skill whenever the user wants to do anything with PDF files. It also merges, splits and OCRs.";
  const text = `intro\n<available_skills>\n  <skill>\n    <id>pdf</id>\n    <name>pdf</name>\n    <description>${long}</description>\n  </skill>\n  <skill>\n    <id>x</id>\n    <name>x</name>\n    <description>MANDATORY: ${"word ".repeat(60)}</description>\n  </skill>\n</available_skills>`;
  const out = compactCatalog(text);
  expect(out).toContain("- pdf: Use this skill whenever the user wants to do anything with PDF files.\n");
  expect(out).toMatch(/\n- x: word word/);
  expect(out).toStartWith("intro\n");
  expect(out).toContain("<available_skills>");
  expect(out).not.toContain("MANDATORY");
  expect(out).not.toContain("<skill>");
  expect(out.length).toBeLessThan(text.length);
  expect(compactCatalog("no catalog here")).toBe("no catalog here");
});

test("injected skill matches the native skill tool shape", () => {
  const dir = path.join(TMP, "demo");
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts", "run.sh"), "echo hi");
  const c = skillContent({ id: "demo", dir, body: "Do the thing." });
  expect(c.startsWith('<skill_content name="demo">\n# Skill: demo\n\nDo the thing.')).toBe(true);
  expect(c).toContain(`Base directory for this skill: ${dir}`);
  expect(c).toContain(`<file>${path.join(dir, "scripts", "run.sh")}</file>`);
  expect(c.endsWith("</skill_content>")).toBe(true);
  expect([...loadedSkills([{ role: "tool", content: [{ type: "text", text: c }] }])]).toEqual(["demo"]);
});

test("named and routed skills are injected; oversize bodies fall back to a hint", async () => {
  const sk = new Skills({
    skillsDirs: [path.join(CFG, "skills")],
    routesPath: path.join(CFG, "skill-routes.json"),
    vectorCache: path.join(TMP, "vec.json"),
  });
  const a = await sk.select("I have a merge conflict in package.json", { sessionID: "s1" });
  expect(a.inject.map((i) => i.id)).toContain("git-conflict-resolver");
  const b = await sk.select("use the xlsx skill", { sessionID: "s2" });
  expect(b.inject.map((i) => i.id)).toEqual(["xlsx"]);
  const big = await sk.select("write an academic paper for my thesis with citations", { sessionID: "s3" });
  expect(big.inject.map((i) => i.id)).not.toContain("academic-paper"); // ~63k chars > budget
  expect(hintBlock(big.hint)).toContain("academic-paper");
  const none = await sk.select("hi how are you?", { sessionID: "s4" });
  expect(none.inject.length + none.hint.length).toBe(0);
  const opt = await sk.select("merge conflict in package.json #noskills", { sessionID: "s5" });
  expect(opt.inject.length).toBe(0);
});

test("short follow-ups keep the previous turn's skills; already-loaded skills are skipped", async () => {
  const sk = new Skills({ skillsDirs: [path.join(CFG, "skills")], routesPath: path.join(CFG, "skill-routes.json"), vectorCache: path.join(TMP, "vec2.json") });
  await sk.select("I have a merge conflict in package.json", { sessionID: "f" });
  const follow = await sk.select("ok go ahead", { sessionID: "f" });
  expect(follow.inject.map((i) => i.id)).toContain("git-conflict-resolver");
  const again = await sk.select("I have a merge conflict in package.json", { sessionID: "g", loaded: new Set(["git-conflict-resolver"]) });
  expect(again.inject.map((i) => i.id)).not.toContain("git-conflict-resolver");
});

function memoryDb(file) {
  const db = new Database(file);
  db.exec(`CREATE TABLE facts (id INTEGER PRIMARY KEY, domain TEXT, title TEXT, content TEXT, content_hash TEXT, origin TEXT,
             verified INTEGER DEFAULT 0, superseded_by INTEGER, deleted INTEGER DEFAULT 0, access_count INTEGER DEFAULT 0,
             last_accessed_at TEXT, created_at TEXT, updated_at TEXT);
           CREATE VIRTUAL TABLE facts_fts USING fts5(title, content, domain, content='facts', content_rowid='id');
           CREATE TRIGGER facts_ai AFTER INSERT ON facts BEGIN INSERT INTO facts_fts(rowid,title,content,domain) VALUES (new.id,new.title,new.content,new.domain); END;
           CREATE TABLE l1_promotion_queue (id INTEGER PRIMARY KEY, fact_id INTEGER UNIQUE, access_count INTEGER, status TEXT DEFAULT 'pending', reviewed_at TEXT, created_at TEXT);
           CREATE TABLE fact_vectors (fact_id INTEGER PRIMARY KEY, model TEXT, hash TEXT, vec BLOB);
           CREATE TABLE episodes (session_id TEXT PRIMARY KEY, directory TEXT, title TEXT, time_updated INTEGER, gist TEXT, hash TEXT, model TEXT, vec BLOB);`);
  const ins = db.query("INSERT INTO facts (id, domain, title, content, superseded_by, deleted) VALUES (?,?,?,?,?,?)");
  ins.run(1, "general", "omniroute gateway", "OmniRoute listens on port 20128 on localhost", null, 0);
  ins.run(2, "coding", "image prefs", "Generate images at 1024x1024 with the flux model", null, 0);
  ins.run(3, "general", "old omniroute port", "OmniRoute used port 9999", 1, 0);
  ins.run(4, "general", "deleted omniroute note", "OmniRoute gateway note", null, 1);
  return db;
}

test("keyword fallback: must cover the query, superseded/deleted excluded, access counted", async () => {
  const file = path.join(TMP, "mem.db");
  const db = memoryDb(file);
  const r = new Recall(file);
  const hit = await r.recall("which port does the omniroute gateway use", { sessionID: "x" });
  expect(hit.semantic).toBe(false);
  expect(hit.facts.map((f) => f.id)).toEqual([1]); // stop-words ("which", "does") are not required terms
  const miss = await r.recall("omniroute weather forecast", { sessionID: "y" });
  expect(miss.facts.map((f) => f.id)).toEqual([]); // "weather forecast" is most of the query and in no fact
  const exact = await r.recall("omniroute gateway port", { sessionID: "x" });
  expect(exact.facts.map((f) => f.id)).toEqual([1]);
  expect(db.query("SELECT access_count FROM facts WHERE id = 1").get().access_count).toBe(2);
  expect((await r.recall("hi there", {})).facts).toEqual([]);
  expect(formatRecall(exact)).toContain("[fact 1 · general] omniroute gateway");
  expect(formatRecall({ facts: [], episodes: [], core: [] })).toBe("");
});

test("semantic path ranks by cosine and gates weak matches", async () => {
  const file = path.join(TMP, "mem2.db");
  const db = memoryDb(file);
  const v = (xs) => normalize(Float32Array.from(xs));
  db.query("INSERT INTO fact_vectors VALUES (1,?,'h',?)").run(EMBED_MODEL, toBlob(v([1, 0, 0])));
  db.query("INSERT INTO fact_vectors VALUES (2,?,'h',?)").run(EMBED_MODEL, toBlob(v([0, 1, 0])));
  db.query("INSERT INTO episodes VALUES ('ses_a','/home/u','Gateway outage',1793000000000,'Gateway outage\nSummary: fixed retries','h',?,?)").run(EMBED_MODEL, toBlob(v([0.9, 0.1, 0])));
  db.query("INSERT INTO fact_vectors VALUES (4,'some-other-model','h',?)").run(toBlob(v([1, 0, 0]))); // must be ignored
  const r = new Recall(file);
  const embed = await import("../plugins/context-engine/embed.mjs");
  embed._testing.cache.set("omniroute port please", v([0.95, 0.05, 0]));
  const out = await r.recall("omniroute port please", { sessionID: "now" });
  expect(out.semantic).toBe(true);
  expect(out.facts.map((f) => f.id)).toEqual([1]);   // fact 2 is orthogonal -> gated out
  expect(out.episodes.map((e) => e.session_id)).toEqual(["ses_a"]);
  const self = await new Recall(file).recall("omniroute port please", { sessionID: "ses_a" });
  expect(self.episodes).toEqual([]);                 // never recall the current session
});

test("save hint fires on durable preferences only", () => {
  expect(saveHint("from now on always use pnpm")).toContain("memory_add");
  expect(saveHint("I prefer tabs over spaces")).toContain("memory_add");
  expect(saveHint("fix the login bug")).toBe("");
});

test("vector blob round-trip", () => {
  const a = normalize(Float32Array.from([3, 4]));
  expect(Array.from(fromBlob(toBlob(a)))).toEqual(Array.from(a));
  expect(dot(a, a)).toBeCloseTo(1, 5);
});

import { prune } from "../plugins/context-engine/prune.mjs";

const user = (id, text) => ({ id, role: "user", content: [{ type: "text", text }] });
const call = (id, name, input, reasoning = "") => ({
  id: "a" + id, role: "assistant",
  content: [...(reasoning ? [{ type: "reasoning", text: reasoning }] : []), { type: "tool-call", id, name, input }],
});
const result = (id, name, value) => ({ role: "tool", content: [{ type: "tool-result", id, name, result: { type: "text", value } }] });

test("prune: earlier turns; originals untouched; dedupe, trim, long reads head+tail", () => {
  const big = "x".repeat(20_000);
  const file = "y".repeat(20_000);
  const msgs = [
    user("u1", "check the repo"),
    call("c1", "shell", { command: "git status" }, "thinking ".repeat(100)),
    result("c1", "shell", "M a.py\n".repeat(60)),
    call("c2", "shell", { command: "journalctl -b" }),
    result("c2", "shell", big),
    call("c3", "read", { filePath: "/x.py" }),
    result("c3", "read", file),
    user("u2", "now again"),
    call("c4", "shell", { command: "git status" }, "current turn thinking"),
    result("c4", "shell", "clean"),
    call("c5", "shell", { command: "journalctl -b" }),
    result("c5", "shell", big),
  ];
  const before = JSON.stringify(msgs);
  const { messages, stats } = prune(msgs);
  expect(JSON.stringify(msgs)).toBe(before);                        // stored history untouched
  expect(messages[1].content.some((p) => p.type === "reasoning")).toBe(false);
  expect(messages[8].content.some((p) => p.type === "reasoning")).toBe(true); // current turn kept
  expect(messages[2].content[0].result.value).toContain("Output omitted");    // git status repeated later
  expect(messages[4].content[0].result.value).toContain("Output omitted");    // identical journalctl repeated
  expect(messages[6].content[0].result.value).toContain("trimmed to save context"); // old long read: head + tail
  expect(messages[11].content[0].result.value).toBe(big);                     // recent steps of the current turn untouched
  expect(stats.deduped).toBe(2);
  expect(stats.saved).toBeGreaterThan(20_000);
});

test("prune: large stale noisy output is cut to head and tail; reasoning-only message kept", () => {
  const big = "HEAD" + "z".repeat(30_000) + "TAIL";
  const msgs = [
    user("u1", "look at logs"),
    { id: "r", role: "assistant", content: [{ type: "reasoning", text: "only thinking" }] },
    call("c1", "shell", { command: "dmesg" }),
    result("c1", "shell", big),
    user("u2", "thanks, next"),
  ];
  const { messages, stats } = prune(msgs);
  const v = messages[3].content[0].result.value;
  expect(v.startsWith("HEAD")).toBe(true);
  expect(v.endsWith("TAIL")).toBe(true);
  expect(v.length).toBeLessThan(6_000);
  expect(stats.trimmed).toBe(1);
  expect(messages[1].content.length).toBe(1);                        // would be empty: left alone
  expect(prune([user("u", "hi")]).messages.length).toBe(1);
});

test("prune: current turn ages only old steps, in chunks; recent steps and signed reasoning untouched", () => {
  const msgs = [user("u1", "do a long task")];
  for (let k = 0; k < 30; k++) {
    const id = `s${k}`;
    msgs.push(call(id, k === 0 ? "write" : k === 1 ? "read" : "shell",
      k === 0 ? { filePath: "/w.py", content: "line\n".repeat(800) } : k === 1 ? { filePath: "/w.py" } : { command: `step ${k}` },
      `reasoning ${k} `.repeat(80)));
    msgs.push(result(id, k === 0 ? "write" : k === 1 ? "read" : "shell", k === 1 ? "r".repeat(9_000) : "o".repeat(6_000)));
  }
  msgs.push(call("e", "edit", { filePath: "/w.py", oldString: "a", newString: "b" })); // file edited later
  msgs.push(result("e", "edit", "ok"));
  msgs[3].content[0].providerMetadata = { anthropic: { signature: "sig" } };          // signed reasoning of step 1
  const { messages, stats } = prune(msgs, { keepRecent: 10, chunk: 8 });
  // 31 steps: (31 - 10) / 8 -> 16 aged steps
  expect(messages[1].content.find((p) => p.type === "tool-call").input.content).toContain("lines written earlier");
  expect(messages[4].content[0].result.value).toContain("edited or read again later");
  expect(messages[3].content[0].text).toBe(msgs[3].content[0].text);                // signed: byte-identical
  expect(messages[5].content[0].text).toContain("earlier reasoning shortened");
  expect(messages[6].content[0].result.value).toContain("trimmed to save context");
  const firstFresh = 1 + 2 * 16;                                                       // step 16 onward untouched
  expect(messages[firstFresh]).toBe(msgs[firstFresh]);
  expect(messages.at(-1)).toBe(msgs.at(-1));
  expect(stats.saved).toBeGreaterThan(60_000);
  // one more step inside the same chunk: the pruned prefix is byte-identical (prompt cache keeps hitting)
  const more = [...msgs, call("x", "shell", { command: "ls" }), result("x", "shell", "ok")];
  const again = prune(more, { keepRecent: 10, chunk: 8 }).messages;
  expect(JSON.stringify(again.slice(0, firstFresh))).toBe(JSON.stringify(messages.slice(0, firstFresh)));
});

test("prune: earlier-turn step with reasoning and a large write (part indexes stay right)", () => {
  const msgs = [
    user("u1", "write it"),
    call("w", "write", { filePath: "/a.py", content: "z\n".repeat(2_000) }, "plan ".repeat(50)),
    result("w", "write", "ok"),
    user("u2", "thanks"),
  ];
  const { messages } = prune(msgs);
  expect(messages[1].content.length).toBe(1);                                 // reasoning dropped
  expect(messages[1].content[0].input.content).toContain("lines written earlier");
});

test("prune: superseded catalog notices dropped, newest and incremental ones kept", () => {
  const sys = (text) => ({ role: "system", content: [{ type: "text", text }] });
  const cat = (n) => `The Code Mode tool catalog has changed. This catalog supersedes the previous Code Mode tool catalog.\n\n# Code Mode\n${"tool ".repeat(n)}`;
  const msgs = [
    user("u1", "go"),
    call("c1", "shell", { command: "a" }), result("c1", "shell", "x"),
    sys(cat(500) + "\nThe instructions from /AGENTS.md changed. Here's the diff:\n+ new rule"),
    call("c2", "shell", { command: "b" }), result("c2", "shell", "y"),
    sys("New skills are available in addition to those listed before:\n- foo"),
    sys(cat(600)),
    call("c3", "shell", { command: "c" }), result("c3", "shell", "z"),
  ];
  const { messages, stats } = prune(msgs);
  const texts = messages.filter((m) => m.role === "system").map((m) => m.content[0].text);
  expect(texts.length).toBe(3);
  expect(texts[0]).toStartWith("The instructions from /AGENTS.md changed"); // diff kept, old catalog cut out
  expect(texts[1]).toStartWith("New skills are available");                 // additive: kept
  expect(texts[2]).toBe(cat(600));                                           // newest catalog kept whole
  expect(stats.notices).toBe(1);
});

test("system Code Mode catalog replaced by a pointer only when a newer one is in the conversation", async () => {
  const { supersedeSystemCatalog } = await import("../plugins/context-engine/prune.mjs");
  const block = () => [{ type: "text", text: "# Code Mode\nintro\n\n## Code Mode tools (call only inside `execute`)\n\n" + "- tools.x()\n".repeat(200) + "\n\nSkills provide specialized instructions and workflows." }];
  const none = block();
  expect(supersedeSystemCatalog(none, [user("u", "hi")])).toBe(0);
  expect(none[0].text).toContain("tools.x()");
  const sys = block();
  const saved = supersedeSystemCatalog(sys, [user("u", "hi"), { role: "system", content: [{ type: "text", text: "The Code Mode tool catalog has changed. This catalog supersedes the previous Code Mode tool catalog." }] }]);
  expect(saved).toBeGreaterThan(1_000);
  expect(sys[0].text).not.toContain("tools.x()");
  expect(sys[0].text).toContain("Skills provide specialized instructions");
  expect(sys[0].text).toStartWith("# Code Mode\nintro");
});

test("concurrent identical queries share one embedding request", async () => {
  const embed = await import("../plugins/context-engine/embed.mjs");
  embed._testing.reset();
  const [a, b] = [embed.embedQuery("same text twice"), embed.embedQuery("same text twice")];
  expect(embed._testing.inflight.size).toBe(1);
  await Promise.all([a, b]);
  expect(embed._testing.inflight.size).toBe(0);
});

test("learning: a prompt after which the agent loaded a skill becomes an example for it", () => {
  const learned = path.join(TMP, "learned.json");
  const sk = new Skills({ skillsDirs: [path.join(CFG, "skills")], routesPath: path.join(CFG, "skill-routes.json"),
    vectorCache: path.join(TMP, "vec3.json"), learnedPath: learned });
  sk.refresh();
  expect(sk.learn("docker-infra", "my compose stack keeps restarting the web container")).toBe(true);
  expect(sk.learn("docker-infra", "my compose stack keeps restarting the web container")).toBe(false); // no duplicates
  expect(sk.learn("no-such-skill", "whatever prompt text here")).toBe(false);
  expect(sk.learn("docker-infra", "short")).toBe(false);
  const db = JSON.parse(fs.readFileSync(learned, "utf-8"));
  expect(db["docker-infra"]).toEqual(["my compose stack keeps restarting the web container"]);
  sk.refresh();
  expect(sk.texts("docker-infra", "desc")).toContain("my compose stack keeps restarting the web container");
});

test("playbooks: routed checklist appended to the right user message, request copy only", async () => {
  const { Playbooks, appendToUser } = await import("../plugins/context-engine/playbooks.mjs");
  const pb = new Playbooks(path.join(CFG, "playbooks.json"), path.join(TMP, "pbvec.json"));
  const machine = await pb.select("my laptop is slow when gaming, what should I do", "build");
  expect(machine.ids).toContain("own-machine");
  expect(machine.text).toContain("Look before answering");
  expect(machine.text).toContain("every part is answered"); // the "always" self-check
  expect((await pb.select("my laptop is slow", "explorer")).text).toBe(""); // subagents get none
  const plain = await pb.select("write a haiku about rain", "build");
  expect(plain.ids).toEqual([]);
  expect(plain.text).toContain("every part is answered");
  const msgs = [
    { id: "u1", role: "user", content: [{ type: "text", text: "first" }] },
    { id: "a1", role: "assistant", content: [] },
    { id: "u2", role: "user", content: [{ type: "text", text: "second" }] },
  ];
  const out = appendToUser(msgs, "u1", "REMINDER");
  expect(out[0].content.map((p) => p.text)).toEqual(["first", "REMINDER"]);
  expect(msgs[0].content.length).toBe(1); // stored messages untouched
  expect(appendToUser(msgs, "missing", "R")[2].content.at(-1).text).toBe("R");
});

test("injected AGENTS.md instructions are never routed as the user's request (2026-11-05)", async () => {
  const { lastUserText } = await import("../plugins/context-engine/router.mjs");
  const real = { role: "user", id: "u1", content: [{ type: "text", text: "make the picker nicer" }] };
  const instr = { role: "user", id: "i1", content: [{ type: "text", text: "Instructions from: /home/x/.config/opencode/AGENTS.md\n# Directive" }] };
  const meta = { role: "user", id: "i2", metadata: { instruction: { paths: ["/x/AGENTS.md"] } }, content: [{ type: "text", text: "# Directive" }] };
  expect(lastUserText([real, instr, meta]).id).toBe("u1");
});

test("OpenCode's failover resume note is not a new request (2026-11-07)", async () => {
  const { lastUserText } = await import("../plugins/context-engine/router.mjs");
  const real = { role: "user", id: "u1", content: [{ type: "text", text: "rank my browsers by resource use" }] };
  const resume = { role: "user", id: "r1", content: [{ type: "text", text: "The previous response was interrupted. Continue from where you left off without repeating completed content." }] };
  expect(lastUserText([real, resume, resume]).id).toBe("u1");
});

test("own-machine mode sticks to a session: follow-ups that do not name the app still get the checklist", async () => {
  const { ownMachineSession } = await import("../plugins/context-engine/index.js");
  const u = (text) => ({ role: "user", content: [{ type: "text", text }] });
  const first = u("Fix Discord and Vesktop so I can share a single window");
  const follow = "I just tried sharing and the picker doesn't look right: the entries are messy. Check it and fix what's wrong.";
  expect(ownMachineSession([first, u(follow)], follow)).toBe(true);
  expect(ownMachineSession([first, u("thanks, what is a mutex?")], "thanks, what is a mutex?")).toBe(false);
  expect(ownMachineSession([u("explain mutexes"), u(follow)], follow)).toBe(false);
});

test("video routes: quick clips -> video-gen, UI work -> no video skill; removed film skills stay removed", () => {
  const routes = JSON.parse(fs.readFileSync(new URL("../skill-routes.json", import.meta.url), "utf-8")).routes;
  const hit = (id, t) => (routes[id] || []).some((p) => new RegExp(p, "i").test(t));
  // 2026-11-24: lemo-opuscar and cartoon-3d-short were removed after their test films were not usable
  expect(routes["lemo-opuscar"]).toBeUndefined();
  expect(routes["cartoon-3d-short"]).toBeUndefined();
  expect(hit("video-gen", "generate a quick 5 second video clip of a cat surfing")).toBe(true);
  for (const t of ["make a react component that renders a video player", "create a video upload endpoint in express",
    "build an animation for the loading spinner in css", "add a fade-in animation to the modal"]) expect([t, hit("video-gen", t)]).toEqual([t, false]);
});

test("strong-model skills are configured, exist, and strong-start is shared by both triggers", () => {
  const settings = JSON.parse(fs.readFileSync(new URL("../skill-routes.json", import.meta.url), "utf-8")).settings;
  expect(Array.isArray(settings.strong_model_skills)).toBe(true);
  for (const id of settings.strong_model_skills) expect(fs.existsSync(path.join(os.homedir(), ".agents/skills", id)) || fs.existsSync(new URL(`../skills/${id}`, import.meta.url))).toBe(true);
  const src = fs.readFileSync(new URL("../plugins/context-engine/index.js", import.meta.url), "utf-8");
  expect(src.match(/await strongStart\(/g).length).toBe(3);
});

test("every playbook routes its own kind of request (2026-11-06: a git checkout had dropped browser-task, documents and skip)", async () => {
  const { Playbooks } = await import("../plugins/context-engine/playbooks.mjs");
  const pb = new Playbooks(path.join(CFG, "playbooks.json"), path.join(TMP, "pbvec2.json"));
  const want = {
    "open youtube in brave and play a lofi music video": "browser-task",
    "make a powerpoint about climate change with 8 slides": "documents",
    "where can i buy a ryzen 5 7500x3d in cairo": "research",
    "The cart totals in this project are wrong, customers are getting the wrong price. Fix it.": "fix-bug",
  };
  for (const [t, id] of Object.entries(want)) expect([t, (await pb.select(t, "build")).ids]).toEqual([t, expect.arrayContaining([id])]);
  expect((await pb.select("thanks that worked", "build")).ids).toEqual([]);
  expect((await pb.select("store this in memory: i prefer dark themes", "build")).ids).toEqual([]);
});

test("paths do not route skills: a file named poster.jpg is not a poster request", async () => {
  const { maskPaths } = await import("../plugins/context-engine/router.mjs");
  expect(maskPaths("Look at /home/u/Videos/x/poster.jpg and f2.jpg")).toBe("Look at file.jpg and file.jpg");
  expect(maskPaths("convert ~/Docs/report.pdf and fix ~/.agents/skills/a/SKILL.md")).toBe("convert report.pdf and fix SKILL.md");
  expect(maskPaths("edit src/app.tsx, use /pdf, ci/cd")).toBe("edit src/app.tsx, use /pdf, ci/cd");
  const src = fs.readFileSync(new URL("../plugins/context-engine/index.js", import.meta.url), "utf-8");
  expect(src).toMatch(/SKIP_AGENTS = new Set\(\[[^\]]*"vision"/);
  expect(src).not.toMatch(/await finder\.find/); // the skills.sh lookup never holds up a step
});

test("a compaction that is the last user message gets a continue-the-task note (2026-11-06 SSD search)", async () => {
  process.env.OPENCODE_NO_SKILL_ROUTER = "1"; process.env.OPENCODE_NO_RECALL = "1"; process.env.OPENCODE_NO_LINKCHECK = "1";
  process.env.OPENCODE_NO_ANSWER_CHECK = "1"; process.env.OPENCODE_NO_VISION = "1"; process.env.OPENCODE_NO_PLAYBOOKS = "1";
  const plugin = (await import("../plugins/context-engine/index.js")).default;
  const hooks = {};
  plugin.setup({ session: { hook: (name, fn) => { hooks[name] = fn; }, switchModel: async () => {} } });
  const ckpt = { id: "c1", role: "user", content: [{ type: "text", text: "<conversation-checkpoint>\nThe following is a summary...\n<summary>\n## Objective\n- Find the cheapest 1 TB SSD\n</summary>\n</conversation-checkpoint>" }] };
  const ev = { sessionID: "s-ckpt", agent: "build", system: [], messages: [ckpt] };
  await hooks.context(ev);
  const texts = ev.messages[0].content.map((p) => p.text).join("\n");
  expect(texts).toContain("Continue that task now");
  expect(ckpt.content.length).toBe(1); // stored message untouched
  const ev2 = { sessionID: "s-ckpt", agent: "build", system: [], messages: [ckpt, { id: "u2", role: "user", content: [{ type: "text", text: "thanks, now what about RAM?" }] }] };
  await hooks.context(ev2);
  expect(JSON.stringify(ev2.messages)).not.toContain("Continue that task now"); // a real request after it wins
  for (const k of ["OPENCODE_NO_SKILL_ROUTER", "OPENCODE_NO_RECALL", "OPENCODE_NO_LINKCHECK", "OPENCODE_NO_ANSWER_CHECK", "OPENCODE_NO_VISION", "OPENCODE_NO_PLAYBOOKS"]) delete process.env[k];
});

test("judgement playbooks (own machine, research/shopping) are marked strong; coding ones are not", async () => {
  const { Playbooks } = await import("../plugins/context-engine/playbooks.mjs");
  const pb = new Playbooks(path.join(CFG, "playbooks.json"), path.join(TMP, "pbvec3.json"));
  expect((await pb.select("where can i buy a ryzen 5 7500x3d in cairo", "build")).strong).toContain("research");
  expect((await pb.select("my laptop is slow when gaming, what should I do", "build")).strong).toContain("own-machine");
  expect((await pb.select("the build fails with undefined is not a function", "build")).strong).toEqual([]);
});

test("a subagent's result keeps the request's decision instead of being routed as a new request", async () => {
  const { CHECKPOINT } = await import("../plugins/context-engine/index.js");
  expect(CHECKPOINT.test('<subagent sessionID="ses_1" state="completed" description="Check frames">report')).toBe(true);
  expect(CHECKPOINT.test("<conversation-checkpoint>\nObjective: x")).toBe(true);
  expect(CHECKPOINT.test("please check the subagent output")).toBe(false);
});
