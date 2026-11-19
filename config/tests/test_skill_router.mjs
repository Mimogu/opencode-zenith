// Offline tests for plugins/context-engine/router.mjs: node --test tests/test_skill_router.mjs
import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { fileURLToPath } from "url";
import { loadIndex, route, lastUserText, frontmatter, hintText } from "../plugins/context-engine/router.mjs";

const CFG = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const idx = loadIndex(path.join(CFG, "skills"), path.join(CFG, "skill-routes.json"));
const ids = (p, agent = "build") => route(p, idx, agent).map((m) => m.id);

const POSITIVE = [
  ["add a login page with jwt auth to the express api", "owasp-security"],
  ["write a migration that adds a column to the users table", "database-migrations"],
  ["make a slide deck about our q3 results", "pptx"],
  ["the tests are failing after the refactor, fix them", "test-quality"],
  ["the tests are failing after the refactor, fix them", "systematic-debugging"],
  ["review my diff before i merge", "code-review"],
  ["generate an image of a castle at sunset", "image-gen"],
  ["I have a merge conflict in package.json", "git-conflict-resolver"],
  ["my react app is so slow when rendering the table, profile it", "performance-profiling"],
  ["E 0:00:03 Invalid call. Nonexistent function in BattleController.gd", "godot4-dev"],
  ["fix the flexbox layout on the landing page", "modern-web-guidance"],
  ["optimize this Dockerfile, the image is 2GB", "docker-infra"],
  ["use the xlsx skill", "xlsx"],
];
const NEGATIVE = [
  "hi how are you?",
  "now rank for me all the gpus in terms of performance",
  "i want from you to completely migrate to godot",
  "can you use the browser to look for a top tier gaming laptop",
  "what does benchmark mean?",
  "give me a summary on what is done",
];

// a bundle may ship without some skills (the Windows build leaves out Linux-only ones)
const installed = new Set(idx.skills.map((s) => s.id));
for (const [p, want] of POSITIVE) {
  test(`routes "${p}" -> ${want}`, { skip: !installed.has(want) && `${want} not installed` },
    () => assert.ok(ids(p).includes(want), ids(p).join(",")));
}

test("negatives route to nothing unrelated", () => {
  const bad = { "now rank for me all the gpus in terms of performance": "performance-profiling",
                "i want from you to completely migrate to godot": "database-migrations",
                "can you use the browser to look for a top tier gaming laptop": "mcfunction-builder" };
  for (const p of NEGATIVE) for (const id of ids(p)) assert.notEqual(id, bad[p], `${p} -> ${id}`);
  assert.deepEqual(ids("hi how are you?"), []);
});

test("never-listed skills are not suggested", () => {
  assert.ok(!ids("orchestrate the SDLC phase router agentskills").includes("agentskills"));
});

test("opt-out token and skipped agents", () => {
  assert.deepEqual(ids("fix the bug #noskills"), []);
  assert.deepEqual(ids("fix the bug", "title"), []);
});

test("at most max_suggestions", () => {
  assert.ok(ids("fix the failing jest tests in the docker container login page css migration").length <= 3);
});

test("lastUserText skips synthetic reminders and reads text parts", () => {
  const msgs = [
    { id: "u1", role: "user", content: [{ type: "text", text: "fix the bug" }] },
    { id: "a1", role: "assistant", content: [] },
    { id: "s1", role: "user", content: [{ type: "text", text: "<system-reminder>plan mode</system-reminder>" }] },
  ];
  assert.deepEqual(lastUserText(msgs), { id: "u1", text: "fix the bug" });
});

test("frontmatter reads folded block scalars", () => {
  const fm = frontmatter("---\nname: x\ndescription: >\n  line one\n  line two\n---\nbody");
  assert.equal(fm.description, "line one line two");
});

test("hint names each skill once", () => {
  const h = hintText(route("review my diff before i merge", idx));
  assert.match(h, /`code-review`/);
  assert.equal(h.match(/`code-review`/g).length, 1);
});
