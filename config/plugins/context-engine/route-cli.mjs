#!/usr/bin/env bun
// Dry-run the context engine: bun route-cli.mjs "your prompt" [agent]
//   SHOW=1  print the exact blocks that would be injected
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { Skills, hintBlock, injectedNote } from "./skills.mjs";
import { Recall, formatRecall, saveHint } from "./memory.mjs";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const prompt = process.argv[2] || "";
const agent = process.argv[3] || "build";
const skills = new Skills({
  skillsDirs: [path.join(DIR, "skills"), path.join(os.homedir(), ".agents/skills")],
  routesPath: path.join(DIR, "skill-routes.json"),
  vectorCache: path.join(DIR, "state/skill-vectors.json"),
  examplesPath: path.join(DIR, "skill-examples.json"),
  learnedPath: path.join(DIR, "state/skill-learned.json"),
  neutralPath: path.join(DIR, "skill-neutral-prompts.json"),
});
skills.refresh();
if (skills.embedding) await skills.embedding;
const recall = new Recall(path.join(os.homedir(), ".local/share/opencode/upgraded_memory/l2_memory.db"));

const t0 = performance.now();
const [sk, mem] = await Promise.all([skills.select(prompt, { agent }), recall.recall(prompt, { directory: process.cwd() })]);
const ms = (performance.now() - t0).toFixed(0);

console.log(`decision in ${ms} ms`);
for (const s of sk.scored.slice(0, 6)) {
  const mark = sk.inject.some((i) => i.id === s.id) ? "INJECT" : sk.hint.some((h) => h.id === s.id) ? "hint  " : "      ";
  console.log(`  ${mark} ${s.id.padEnd(28)} sem=${s.sem.toFixed(3)} ${s.why}`);
}
for (const f of mem.facts) console.log(`  fact   #${f.id} ${f.title.slice(0, 50)} cos=${(f.cos ?? 0).toFixed(3)}`);
for (const e of mem.episodes) console.log(`  past   ${e.title?.slice(0, 50)} cos=${e.cos.toFixed(3)}`);
if (process.env.SHOW) {
  const blocks = [formatRecall(mem), saveHint(prompt), sk.inject.length ? injectedNote(sk.inject.map((i) => i.id)) : "",
    ...sk.inject.map((i) => i.content.slice(0, 600) + (i.content.length > 600 ? "\n…" : "")), hintBlock(sk.hint)].filter(Boolean);
  console.log("\n" + blocks.join("\n\n"));
}
