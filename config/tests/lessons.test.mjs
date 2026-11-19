// bun test tests/lessons.test.mjs: the learning loop keeps good rules, drops bad ones, retires failures.
import { test, expect } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { Lessons, CORRECTION, ruleProblem, similar, turnTranscript } from "../plugins/context-engine/lessons.mjs";

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lessons-")), "lessons.json");
const reply = (rules) => async () => JSON.stringify({ rules });

test("rules that encode session details, broken-tool claims or environment one-offs are dropped", () => {
  expect(ruleProblem("Before recommending an SSD, check lspci/lsblk for an M.2 slot; SATA-only laptops cannot take NVMe.")).toBe("");
  expect(ruleProblem("On 2026-11-18 the user wanted Brave closed")).not.toBe("");
  expect(ruleProblem("The camofox browser is broken, use playwright instead of it always")).not.toBe("");
  expect(ruleProblem("Install ffmpeg first because ffmpeg: command not found happened")).not.toBe("");
  expect(ruleProblem("short")).not.toBe("");
});

test("learn adds scoped rules, notifies nothing in tests, and merges a repeat", async () => {
  const L = new Lessons({ file: tmp(), notify: false, chat: reply([
    { scope: "pb:own-machine", rule: "Before recommending hardware, read the machine's real slots with lspci and lsblk; laptops differ from the model's memory." },
    { scope: "pb:unknown", rule: "This rule has a scope that was not in use in the turn at all." },
  ]) });
  const added = await L.learn({ key: "s:1", turn: "USER: ssd?", scopes: ["pb:own-machine"] });
  expect(added.length).toBe(1);
  expect(L.active("pb:own-machine").length).toBe(1);
  L.chat = reply([{ scope: "pb:own-machine", rule: "Before recommending hardware read the machine's real slots with lspci and lsblk first." }]);
  expect((await L.learn({ key: "s:2", turn: "x", scopes: ["pb:own-machine"] })).length).toBe(0);
  expect(L.active("pb:own-machine")[0].support).toBe(2);
  expect(await L.learn({ key: "s:2", turn: "x", scopes: ["pb:own-machine"] })).toEqual([]); // same turn key: once
});

test("select injects the turn's scoped rules and related general ones, and records the turn", async () => {
  const L = new Lessons({ file: tmp(), notify: false, chat: reply([
    { scope: "general", rule: "When the user asks for a short answer, keep the whole reply under three sentences." },
    { scope: "skill:pptx", rule: "Render every slide to an image and look at it before saying the deck is done." },
  ]) });
  await L.learn({ key: "k", turn: "x", scopes: ["skill:pptx"] });
  const sel = L.select({ scopes: ["skill:pptx"], text: "make slides for my parents", turnKey: "s:u1" });
  expect(sel.block).toContain("Render every slide");
  expect(sel.block).not.toContain("short answer");
  expect(L.select({ scopes: [], text: "give me a short answer please, keep it short", turnKey: "s:u2" }).block).toContain("short answer");
  expect(L.select({ scopes: ["pb:other"], text: "unrelated request about rust", turnKey: "s:u3" })).toBeNull();
});

test("a rule whose turns keep going wrong is retired; a replaced rule too", async () => {
  const L = new Lessons({ file: tmp(), notify: false, chat: reply([{ scope: "pb:browser-task", rule: "Open the user's own browser in a new tab and close only that tab when the work is done." }]) });
  const [l] = await L.learn({ key: "k", turn: "x", scopes: ["pb:browser-task"] });
  for (let i = 0; i < 4; i++) { L.select({ scopes: ["pb:browser-task"], text: "", turnKey: `t${i}` }); L.outcome(`t${i}`, "continue"); }
  expect(L.data.lessons.find((x) => x.id === l.id).status).toBe("retired");
  L.chat = reply([{ scope: "pb:browser-task", rule: "Take a snapshot before every click in the user's browser so the ref is current.", replaces: "" }]);
  const [b] = await L.learn({ key: "k2", turn: "x", scopes: ["pb:browser-task"] });
  L.chat = reply([{ scope: "pb:browser-task", rule: "Take a fresh snapshot before each click or type; refs change after the page updates.", replaces: b.id }]);
  await L.learn({ key: "k3", turn: "x", scopes: ["pb:browser-task"] });
  expect(L.data.lessons.find((x) => x.id === b.id).status).toBe("retired");
  expect(L.active("pb:browser-task").length).toBe(1);
});

test("stale rules retire after 45 days", async () => {
  let now = 1_800_000_000_000;
  const L = new Lessons({ file: tmp(), notify: false, now: () => now, chat: reply([{ scope: "general", rule: "Quote the exact command output when you state a number to the user." }]) });
  await L.learn({ key: "k", turn: "x", scopes: [] });
  now += 46 * 86_400_000;
  L.curate();
  expect(L.active().length).toBe(0);
});

test("correction detection and transcript", () => {
  for (const t of ["no, i said the other folder", "that's wrong", "you forgot the tests", "it still doesn't work", "لا مش كده"]) expect(CORRECTION.test(t)).toBe(true);
  for (const t of ["now make it blue", "nothing else, thanks", "notes app please", "great, next task", "Don't use npm for this new project, use bun", "Stop the dev server and deploy", "no problem, next one", "I asked for a summary earlier, now do the charts"]) expect(CORRECTION.test(t)).toBe(false);
  const t = turnTranscript([{ type: "user", text: "fix cart" }, { type: "assistant", content: [{ type: "tool", name: "shell", state: { input: { command: "pytest" }, content: [{ text: "1 failed" }] } }, { type: "text", text: "Fixed." }] }, { type: "synthetic", text: "<system-reminder>not done</system-reminder>" }], { correction: "no, totals still wrong" });
  expect(t).toContain("TOOL shell");
  expect(t).toContain("CHECK (harness): not done");
  expect(t).toContain("USER'S NEXT MESSAGE");
  expect(similar("check lspci for an M.2 slot", "check lspci for M.2 slots")).toBeGreaterThan(0.5);
});

test("edits by oc-lessons (another writer) are kept, not overwritten", async () => {
  const file = tmp();
  const L = new Lessons({ file, notify: false, chat: reply([{ scope: "general", rule: "Quote the exact command output when you state a number to the user." }]) });
  const [l] = await L.learn({ key: "k", turn: "x", scopes: [] });
  const d = JSON.parse(fs.readFileSync(file, "utf-8"));
  d.lessons[0].status = "retired"; d.lessons[0].retired_why = "retired by the user";
  await new Promise((r) => setTimeout(r, 15));
  fs.writeFileSync(file, JSON.stringify(d));
  expect(L.select({ scopes: [], text: "state the number from the command output", turnKey: "t" })).toBeNull();
  expect(JSON.parse(fs.readFileSync(file, "utf-8")).lessons.find((x) => x.id === l.id).status).toBe("retired");
});

test("a rule retired for going wrong is not learned again; one retired as unused comes back as the same entry", async () => {
  const rule = { scope: "general", rule: "Quote the exact command output when you state a number to the user." };
  const L = new Lessons({ file: tmp(), notify: false, chat: reply([rule]) });
  const [l] = await L.learn({ key: "k1", turn: "x", scopes: [] });
  Object.assign(l, { status: "retired", retired_why: "turns went wrong 4 of 4 times" });
  expect(await L.learn({ key: "k2", turn: "x", scopes: [] })).toEqual([]);
  Object.assign(l, { retired_why: "unused for 45 days" });
  const back = await L.learn({ key: "k3", turn: "x", scopes: [] });
  expect(back[0].id).toBe(l.id);
  expect(L.data.lessons.filter((x) => x.id === l.id).length).toBe(1);
  expect(l.status).toBe("active");
});

// fake embedder: rules sharing a tag word in [brackets] point the same way
const fakeEmbed = async (texts) => texts.map((t) => {
  const tag = (t.match(/\[(\w+)\]/) || [, t])[1];
  const v = new Float32Array(8); for (let i = 0; i < tag.length; i++) v[tag.charCodeAt(i) % 8] += 1;
  const n = Math.hypot(...v) || 1; return v.map((x) => x / n);
});

test("by meaning: a reworded rule the user retired is refused, a different one is learned", async () => {
  const L = new Lessons({ file: tmp(), notify: false, embed: fakeEmbed, chat: reply([{ scope: "pb:fix-bug", rule: "Add a regression test file for every bug you fix [tests] so it stays fixed." }]) });
  const [l] = await L.learn({ key: "k1", turn: "x", scopes: ["pb:fix-bug"] });
  Object.assign(l, { status: "retired", retired_why: "retired by the user" });
  let prompt = "";
  L.chat = async (p) => { prompt = p; return JSON.stringify({ rules: [
    { scope: "pb:fix-bug", rule: "When fixing a defect, write persistent automated cases [tests] in the suite." },
    { scope: "pb:fix-bug", rule: "Reproduce the bug with the user's exact input [repro] before changing any code." },
  ] }); };
  const added = await L.learn({ key: "k2", turn: "x", scopes: ["pb:fix-bug"] });
  expect(prompt).toContain("REJECTED");
  expect(added.map((a) => a.rule)).toEqual(["Reproduce the bug with the user's exact input [repro] before changing any code."]);
});

test("without embeddings (Ollama down) it falls back to word overlap", async () => {
  const L = new Lessons({ file: tmp(), notify: false, embed: async () => null, chat: reply([{ scope: "general", rule: "Quote the exact command output when you state a number to the user." }]) });
  await L.learn({ key: "a", turn: "x", scopes: [] });
  L.chat = reply([{ scope: "general", rule: "Quote the exact command output whenever you state a number to the user." }]);
  expect(await L.learn({ key: "b", turn: "x", scopes: [] })).toEqual([]);
  expect(L.active()[0].support).toBe(2);
});

test("real embeddings: the reworded test rule from the live run counts as the same (skipped when Ollama is down)", async () => {
  const { embedDocs, ensureServer } = await import("../plugins/context-engine/embed.mjs");
  // skip unless embeddings really answer here (other test files stub fetch / point OLLAMA_HOST elsewhere)
  if (!(await ensureServer(15_000)) || !(await embedDocs(["probe"], 10_000))?.[0]) return;
  const L = new Lessons({ file: tmp(), notify: false, embed: (t) => embedDocs(t, 20_000), chat: reply([{ scope: "pb:fix-bug", rule: "Add persistent test cases in a dedicated test file rather than relying only on ad-hoc inline verification scripts, because bug fixes require permanent regression coverage." }]) });
  const [l] = await L.learn({ key: "r1", turn: "x", scopes: ["pb:fix-bug"] });
  Object.assign(l, { status: "retired", retired_why: "retired by the user" });
  L.chat = reply([
    { scope: "pb:fix-bug", rule: "Add or update automated test cases in the test suite when fixing a bug, because ad-hoc verification commands do not provide persistent regression coverage." },
    { scope: "pb:fix-bug", rule: "Read the full traceback and open the failing line before editing, because the crash site is often not the cause." },
  ]);
  const added = await L.learn({ key: "r2", turn: "x", scopes: ["pb:fix-bug"] });
  expect(added.map((a) => a.rule.slice(0, 25))).toEqual(["Read the full traceback a"]);
}, 60_000);
