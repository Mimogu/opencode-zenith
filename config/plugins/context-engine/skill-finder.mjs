// skill-finder: when no installed skill fits a request, look for one on skills.sh, install it and
// use it in the same turn.
//
// Per user message, only when the local router found nothing (no inject, no hint) and the message
// reads like a task:
//   1. one fast gateway call: does it need a specialist skill, and a 2-4 keyword query (most stop here)
//   1b. skills.sh search with that query (the same API as `skills find`), ~0.4 s
//   2. drop installed names, sources that are not GitHub owner/repo, and skills with few installs
//   3. description of the top candidates (skills.sh page meta), embedded and compared to the request
//   4. a second gateway call judges whether one candidate is about the same technology and task
//   5. `bin/oc-skills add` installs it (skillspector scan; flagged = removed again), the router
//      re-indexes, and the body is injected for this turn with a one-line note for the user
// Every step is time-boxed; a negative result is cached per request text for a day, so retries
// and follow-ups cost nothing. Settings: "auto_install" in skill-routes.json.
//   OPENCODE_NO_SKILL_INSTALL=1  off        "#noinstall" in a prompt: off for that message
import { execFile } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { embedDocs, embedQuery, dot } from "./embed.mjs";

const DEFAULTS = {
  enabled: true,
  min_installs: 200,         // popularity floor (every install is also security-scanned)
  min_similarity: 0.30,      // request vs skill description (cosine); only a coarse filter, the judge decides
  max_candidates: 4,
  max_per_day: 8,
  plan_model: "auto/best-fast",       // gateway models (OmniRoute routes and fails over itself)
  judge_model: "auto/best-fast",
  search_timeout_ms: 4000,
  install_timeout_ms: 90000,
  min_words: 5,
};
const GITHUB_SOURCE = /^[\w.-]+\/[\w.-]+$/;
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);

function gatewayKey() {
  if (process.env.OMNIROUTE_API_KEY) return process.env.OMNIROUTE_API_KEY;
  try {
    const env = fs.readFileSync(path.join(process.env.HOME, ".config/opencode/free-models.env"), "utf-8");
    return (env.match(/^OMNIROUTE_API_KEY=(.*)$/m)?.[1] || "").trim().replace(/^["']|["']$/g, "");
  } catch { return ""; }
}

export class SkillFinder {
  constructor({ dir, routesPath, statePath, log }) {
    this.dir = dir;
    this.routesPath = routesPath;
    this.statePath = statePath;
    this.log = log || (() => {});
    try { this.state = JSON.parse(fs.readFileSync(statePath, "utf-8")); } catch { this.state = { negative: {}, installs: [] }; }
  }

  settings() {
    try { return { ...DEFAULTS, ...(JSON.parse(fs.readFileSync(this.routesPath, "utf-8")).auto_install || {}) }; } catch { return DEFAULTS; }
  }

  save() {
    try {
      const day = Date.now() - 86_400_000;
      for (const [k, t] of Object.entries(this.state.negative)) if (t < day) delete this.state.negative[k];
      this.state.installs = this.state.installs.filter((i) => i.at > Date.now() - 30 * 86_400_000);
      fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
      fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 1));
    } catch {}
  }

  taskLike(text, cfg) {
    const words = text.replace(/https?:\/\/\S+/g, " ").match(/[a-z][a-z0-9+#.-]*/gi) || [];
    if (words.length < cfg.min_words) return false;
    if (/^\s*(hi|hello|hey|thanks|thank you|ok|okay|yes|no|lol)\b/i.test(text) && words.length < 10) return false;
    return true;
  }

  async chat(model, prompt, maxTokens, timeoutMs) {
    const key = gatewayKey();
    if (!key) throw new Error("no gateway key");
    const r = await fetch("http://127.0.0.1:20128/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0, messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) throw new Error(`${model} ${r.status}`);
    const d = await r.json();
    return String(d?.choices?.[0]?.message?.content || "");
  }

  // One fast call: does this request need specialised instructions, and what would a skill for it
  // be called? skills.sh search matches topics, not sentences, so this also writes the query.
  async plan(text, cfg) {
    const out = await this.chat(cfg.plan_model, `Request to a coding/computer assistant:\n"""${text.slice(0, 1200)}"""\n\n` +
      `Would an expert instruction package ("skill") for a specific technology, tool, file format or workflow materially help with this request? ` +
      `Answer no for general knowledge, chit-chat, simple edits, or anything a capable assistant does well without special instructions.\n` +
      `Reply with JSON only: {"needs_skill": true|false, "query": "2-4 keywords: the technology/tool + the task, e.g. 'stripe webhooks' or 'terraform aws s3'"}`, 80, 12000);
    try { return JSON.parse(out.match(/\{[\s\S]*\}/)[0]); } catch { return { needs_skill: false }; }
  }

  async search(query, cfg) {
    const r = await fetch(`https://skills.sh/api/search?q=${encodeURIComponent(query)}&limit=10`, { signal: AbortSignal.timeout(cfg.search_timeout_ms) });
    if (r.status === 429) { this.backoffUntil = Date.now() + 120_000; throw new Error("skills.sh rate limit; pausing 2 min"); }
    if (!r.ok) throw new Error(`search ${r.status}`);
    return (await r.json()).skills || [];
  }

  async describe(c, cfg) {
    const r = await fetch(`https://skills.sh/${c.id}`, { signal: AbortSignal.timeout(cfg.search_timeout_ms), redirect: "follow" });
    const html = await r.text();
    const m = html.match(/<meta name="description" content="([^"]+)"/);
    return m ? m[1].replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&") : "";
  }

  async judge(text, cands, cfg) {
    const list = cands.map((c, i) => `${i + 1}. ${c.skillId} (${c.source}): ${c.desc}`).join("\n");
    const out = await this.chat(cfg.judge_model, `A coding/computer assistant got this request:\n"""${text.slice(0, 1200)}"""\n\nInstallable skills (instruction packages):\n${list}\n\n` +
      `Which ONE skill is specifically about the technology/tool and task of this request? It must cover the same technology ` +
      `(a React Native/Expo skill does not fit a SwiftUI request; a skill for another stack or a loosely related topic does not fit). ` +
      `Reply with the number only, or 0 if none clearly fits.`, 5, 20000);
    const n = parseInt(out.match(/\d+/)?.[0] || "0", 10);
    return n >= 1 && n <= cands.length ? n : 0;
  }

  install(c, cfg) {
    return new Promise((resolve) => {
      execFile(path.join(this.dir, "bin/oc-skills"), ["add", c.source, c.skillId], {
        timeout: cfg.install_timeout_ms, env: { ...process.env, OC_SKILLS_AUTO: "1" },
      }, (err, out, errOut) => resolve({ ok: !err, out: `${out}${errOut}`.slice(-600) }));
    });
  }

  /** installedIds: Set of skill ids present now. Returns {id, source, installs} or null. */
  async find(text, installedIds, { dryRun = false } = {}) {
    const cfg = this.settings();
    if (!cfg.enabled || process.env.OPENCODE_NO_SKILL_INSTALL === "1" || text.includes("#noinstall")) return null;
    if (!this.taskLike(text, cfg)) return null;
    const key = sha(text.trim().toLowerCase());
    if (this.state.negative[key]) return null;
    const today = this.state.installs.filter((i) => i.at > Date.now() - 86_400_000).length;
    if (today >= cfg.max_per_day) return null;
    const t0 = performance.now();
    const stamp = (what) => { this.log(`skill-finder ${Math.round(performance.now() - t0)}ms ${what} | ${text.slice(0, 80).replace(/\s+/g, " ")}`); };
    if (this.backoffUntil && Date.now() < this.backoffUntil) return null;
    try {
      const plan = await this.plan(text, cfg);
      if (!plan.needs_skill || !plan.query) { this.state.negative[key] = Date.now(); this.save(); stamp("no skill needed"); return null; }
      // skills.sh returns nothing for over-specific queries: drop the last word until something comes back
      const ok = (c) => !installedIds.has(c.skillId) && !installedIds.has(c.name) && GITHUB_SOURCE.test(c.source) && (c.installs || 0) >= cfg.min_installs;
      let words = String(plan.query).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5);
      let found = [];
      for (let tries = 0; words.length && tries < 3 && !found.length; tries++, words = words.slice(0, -1)) {
        found = (await this.search(words.join(" "), cfg)).filter(ok);
        if (!found.length) await new Promise((r) => setTimeout(r, 300));
      }
      let cands = found
        .sort((a, b) => (b.installs || 0) - (a.installs || 0))
        .slice(0, cfg.max_candidates);
      if (!cands.length) { this.state.negative[key] = Date.now(); this.save(); stamp(`no candidates (q="${plan.query}")`); return null; }
      const descs = await Promise.all(cands.map((c) => this.describe(c, cfg).catch(() => "")));
      cands = cands.map((c, i) => ({ ...c, desc: descs[i] })).filter((c) => c.desc);
      const q = await embedQuery(text);
      const vecs = q && cands.length ? await embedDocs(cands.map((c) => `${c.skillId}: ${c.desc}`), 8000) : null;
      if (vecs) cands = cands.map((c, i) => ({ ...c, sim: vecs[i] ? dot(q, vecs[i]) : 0 })).filter((c) => c.sim >= cfg.min_similarity).sort((a, b) => b.sim - a.sim);
      if (!cands.length) { this.state.negative[key] = Date.now(); this.save(); stamp(`below similarity (q="${plan.query}")`); return null; }
      const n = await this.judge(text, cands.slice(0, 3), cfg);
      if (!n) { this.state.negative[key] = Date.now(); this.save(); stamp(`judge: none of ${cands.slice(0, 3).map((c) => `${c.skillId}(${c.sim?.toFixed(2)})`).join(",")}`); return null; }
      const pick = cands[n - 1];
      if (dryRun) { stamp(`dry-run pick ${pick.id} (q="${plan.query}")`); return { id: pick.skillId, source: pick.source, installs: pick.installs, query: plan.query, dryRun: true }; }
      const res = await this.install(pick, cfg);
      if (!res.ok) { this.state.negative[key] = Date.now(); this.save(); stamp(`install failed ${pick.id}: ${res.out.replace(/\s+/g, " ").slice(-200)}`); return null; }
      this.state.installs.push({ id: pick.skillId, source: pick.source, installs: pick.installs, at: Date.now(), for: text.slice(0, 120) });
      this.save();
      stamp(`installed ${pick.id} (${pick.installs} installs, sim ${pick.sim?.toFixed(2)})`);
      return { id: pick.skillId, source: pick.source, installs: pick.installs };
    } catch (e) {
      stamp(`error ${e.message}`);
      return null;
    }
  }
}
