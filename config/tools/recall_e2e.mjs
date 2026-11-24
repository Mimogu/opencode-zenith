#!/usr/bin/env bun
// End-to-end eval of the shipped context engine (plugins/context-engine), not a simulation:
//   python3 tools/recall_eval.py --dump-cases state/eval-cases.json && bun tools/recall_e2e.mjs
// Memory: a question is "found" when at least one injected item is a correct target; precision is over
// every injected item (facts + sessions), counting anything injected for a negative question as wrong.
// Skills: semantic picks (inject or hint) for the skill cases, routes included, exactly as the plugin decides.
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { Recall } from "../plugins/context-engine/memory.mjs";
import { Skills } from "../plugins/context-engine/skills.mjs";
import { EMBED_MODEL } from "../plugins/context-engine/embed.mjs";

const CFG = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cases = JSON.parse(fs.readFileSync(path.join(CFG, "state/eval-cases.json"), "utf-8"));
const recall = new Recall(path.join(os.homedir(), ".local/share/opencode/upgraded_memory/l2_memory.db"));
const skills = new Skills({
  skillsDirs: [path.join(CFG, "skills"), path.join(os.homedir(), ".agents/skills")],
  routesPath: path.join(CFG, "skill-routes.json"), vectorCache: path.join(CFG, "state/skill-vectors.json"),
  examplesPath: path.join(CFG, "skill-examples.json"), learnedPath: path.join(CFG, "state/skill-learned.json"),
  neutralPath: path.join(CFG, "skill-neutral-prompts.json"),
});
skills.refresh();
if (skills.embedding) await skills.embedding;

const key = (x) => (x.session_id ? x.session_id.slice(-8) : `F${x.id}`);
let found = 0, good = 0, items = 0, leaks = 0;
const lat = [], misses = [], noise = [];
for (const [q, targets] of cases.positive) {
  const t = performance.now();
  const r = await recall.recall(q, { sessionID: "eval" });
  lat.push(performance.now() - t);
  const got = [...r.facts, ...r.episodes].map(key);
  items += got.length;
  const ok = got.filter((g) => targets.includes(g)).length;
  good += ok;
  if (ok) found++; else misses.push(q);
  if (got.length > ok) noise.push(`${q} -> ${got.filter((g) => !targets.includes(g)).join(",")}`);
}
for (const q of cases.negative) {
  const r = await recall.recall(q, { sessionID: "eval" });
  const n = r.facts.length + r.episodes.length;
  leaks += n;
  if (n) noise.push(`NEG ${q} -> ${[...r.facts, ...r.episodes].map(key).join(",")}`);
}
lat.sort((a, b) => a - b);
console.log(`model ${EMBED_MODEL}`);
console.log(`memory  found ${found}/${cases.positive.length} (${(found / cases.positive.length * 100).toFixed(0)}%)  ` +
  `item precision ${(good / Math.max(1, items + leaks) * 100).toFixed(0)}%  items/q ${(items / cases.positive.length).toFixed(2)}  ` +
  `negatives with injections ${cases.negative.filter((_, i) => true).length ? leaks : 0}  recall p50 ${lat[lat.length >> 1].toFixed(1)} ms (cached embeddings excluded: first call includes embed)`);

let sOk = 0, sAny = 0, sFalse = 0;
const sMiss = [];
for (const [q, targets] of cases.skill_positive) {
  const d = await skills.select(q, { sessionID: `e${q}` });
  const picked = [...d.inject.map((x) => x.id), ...d.hint.map((x) => x.id)];
  if (picked.length) sAny++;
  if (picked.some((p) => targets.includes(p))) sOk++; else sMiss.push(`${q} -> ${picked.join(",") || "-"}`);
}
for (const q of cases.skill_negative) {
  const d = await skills.select(q, { sessionID: `n${q}` });
  const picked = [...d.inject.map((x) => x.id), ...d.hint.map((x) => x.id)];
  if (picked.length) { sFalse++; sMiss.push(`NEG ${q} -> ${picked.join(",")}`); }
}
console.log(`skills  correct ${sOk}/${cases.skill_positive.length}  any-pick ${sAny}  false picks on negatives ${sFalse}/${cases.skill_negative.length}`);
if (process.argv.includes("-v")) {
  for (const m of misses) console.log("  memory miss:", m);
  for (const n of noise) console.log("  memory noise:", n);
  for (const m of sMiss) console.log("  skill:", m);
}
