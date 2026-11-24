#!/usr/bin/env bun
// Rank gateway models as the verify-claims reviewer, on real sessions with a known right verdict.
//
//   bun tools/reviewer_eval.mjs                 test candidates, write state/reviewer-ranking.json
//   bun tools/reviewer_eval.mjs m1 m2 ...       test only these gateway models
//   bun tools/reviewer_eval.mjs --show          print the current ranking
//
// Cases: state/reviewer-cases/*.json = {expect: "done"|"continue"|"revise", turn: [...]} (real
// session turns from `opencode api GET /api/session/<id>/context`; add one whenever the reviewer
// gets something wrong). A model's score = share of cases with the right verdict; for "revise"
// cases it must also quote the flawed sentence. Ranking: score, then median latency. Candidates:
// every chat model the gateway offers now whose name suggests a strong reasoning model, plus the
// lab's review-ranked models, so new gateway models are picked up without editing this file.
// verify-claims reads the ranking (models scoring >= 0.8, best first) and re-runs this when stale.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { review, reviewerEndpoint } from "../plugins/verify-claims/index.js";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CASES = path.join(DIR, "state/reviewer-cases");
const OUT = path.join(DIR, "state/reviewer-ranking.json");
const NOT_CHAT = /embed|rerank|whisper|tts|image|video|guard|moderation|vision$|^no-think\//i;
const STRONG = /opus|sonnet|gpt-5|gpt-oss-120b|gemini-(pro|3\.[5-9]|[4-9])|deepseek|kimi|glm|qwen3|reasoning|review|code/i;

function key() {
  const env = fs.readFileSync(path.join(DIR, "free-models.env"), "utf-8");
  return (env.match(/^OMNIROUTE_API_KEY=(.*)$/m)?.[1] || "").trim().replace(/^["']|["']$/g, "");
}

async function candidates() {
  const r = await fetch("http://127.0.0.1:20128/v1/models", { headers: { Authorization: `Bearer ${key()}` } });
  const ids = ((await r.json()).data || []).map((m) => m.id).filter((m) => !NOT_CHAT.test(m));
  // drop effort variants (-low/-medium/-high) when the base model is offered
  const base = new Set(ids);
  return ids.filter((m) => STRONG.test(m) && !(/-(low|medium|high)$/.test(m) && base.has(m.replace(/-(low|medium|high)$/, "")))
    && !/^auto\/(cheap|thrifty|chaos|best-chaos|offline|fast|best-fast|coding:fast|coding:cheap)/.test(m));
}

if (process.argv.includes("--show")) {
  const r = JSON.parse(fs.readFileSync(OUT, "utf-8"));
  for (const m of r.ranking) console.log(`${m.model.padEnd(42)} score ${m.score.toFixed(2)}  median ${(m.median_ms / 1000).toFixed(1)}s  ${m.wrong.join(", ")}`);
  console.log(`(measured ${r.at} on ${r.cases} cases)`);
  process.exit(0);
}

const cases = fs.readdirSync(CASES).filter((f) => f.endsWith(".json")).map((f) => ({ name: f.slice(0, -5), ...JSON.parse(fs.readFileSync(path.join(CASES, f), "utf-8")) }));
const models = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const pool = models.length ? models : await candidates();
console.log(`${cases.length} cases x ${pool.length} models`);
async function alive(model) {
  try {
    const ep = reviewerEndpoint(model); // "<provider>:<model>" = that provider directly, else the gateway
    const r = await fetch(ep.url, {
      method: "POST", headers: { Authorization: `Bearer ${ep.key || key()}`, "Content-Type": "application/json" },
      // thinking models spend a 5-token budget before they answer, and a busy gateway takes >20 s:
      // 2026-11-06 both reviewers in use "did not answer" while they were serving reviews
      body: JSON.stringify({ model: ep.model, max_tokens: 200, messages: [{ role: "user", content: `Reply OK ${Math.random()}` }] }),
      signal: AbortSignal.timeout(90000),
    });
    return r.ok && !!(await r.json())?.choices?.[0];
  } catch { return false; }
}

// earlier results survive a crash or timeout: they are merged and saved after every model
let prev = [];
try { prev = models.length ? JSON.parse(fs.readFileSync(OUT, "utf-8")).ranking || [] : []; } catch {}
let ranking = prev.filter((r) => !pool.includes(r.model));
const save = () => {
  ranking.sort((a, b) => b.score - a.score || a.median_ms - b.median_ms);
  fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), cases: cases.length, ranking }, null, 1));
};
const live = [];
await Promise.all(pool.map(async (m) => { if (await alive(m)) live.push(m); }));
console.log(`${live.length}/${pool.length} models answer: ${live.join(", ")}`);
// a model that did not answer the probe keeps its last measured row: 2026-11-06 the gateway was
// slow for a minute and an explicit run of the two reviewers in use wiped both from the ranking
ranking = prev.filter((r) => !live.includes(r.model));

// models run 4 at a time; each model's cases run in order
const queue = [...live];
async function worker() {
  for (let model; (model = queue.shift()); ) {
    let ok = 0;
    const lat = [];
    const wrong = [];
    for (const c of cases) {
      const turn = JSON.parse(JSON.stringify(c.turn));
      turn[0].text = `${turn[0].text}\u200b${Math.random().toString(36).slice(2, 6)}`;
      const t0 = Date.now();
      const v = await review(turn, [model]).catch(() => null);
      lat.push(Date.now() - t0);
      const right = v?.verdict === c.expect && (c.expect !== "revise" || (v.unsupported || []).length > 0);
      if (right) ok++; else wrong.push(`${c.name}:${v?.verdict ?? "error"}`);
    }
    lat.sort((a, b) => a - b);
    // a model that mostly did not answer (gateway asleep, quota spent) was not measured: keep its last
    // row (2026-11-17: Opus 0/15 "error" with OmniRoute stopped left no reviewer >= 0.8)
    const errors = wrong.filter((w) => w.endsWith(":error")).length;
    if (errors > cases.length / 2) {
      const old = prev.find((r) => r.model === model);
      if (old) ranking.push(old);
      console.log(`${model.padEnd(42)} not measured: ${errors}/${cases.length} cases got no answer; ${old ? `kept its last score ${old.score.toFixed(2)}` : "not ranked"}`);
      save();
      continue;
    }
    const row = { model, score: ok / cases.length, median_ms: lat[Math.floor(lat.length / 2)], wrong };
    ranking.push(row);
    save();
    console.log(`${model.padEnd(42)} ${ok}/${cases.length}  median ${(row.median_ms / 1000).toFixed(1)}s  ${wrong.join(", ")}`);
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
save();
console.log(`ranking -> ${OUT}; reviewer now: ${ranking.filter((r) => r.score >= 0.8).map((r) => r.model).slice(0, 3).join(", ") || "(none >= 0.8: lab fallback)"}`);
