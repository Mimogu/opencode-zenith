// Learning loop: short rules learned from the harness's own sessions, added to later turns of the same kind.
// Idea from Hermes Agent's background review + curator (MIT, Nous Research) and ACE (ICLR 2026: grow a
// playbook by small itemised additions; rewriting it whole loses detail, "context collapse").
//
// When: a turn the reviewer or answer check sent back (the fix shows what was missed), or a user message
//   that corrects the previous turn ("no, …", "I said …", "that's wrong"). Never subagents or benchmark runs.
// What: one model call reads that turn and returns at most 3 rules, each scoped to the playbook or skill
//   that was in use (or "general"). Mechanical filters drop session narratives, dates, negative claims
//   about tools ("X is broken" hardens into refusals) and environment one-offs (Hermes's do-not-capture list).
// Use: active rules for the turn's playbooks/skills (max 6) go into the turn's context block, decided once
//   per user message so the prompt prefix stays stable.
// Duplicates by meaning (local embeddings, embed.mjs), word overlap when Ollama is down. Measured on rule
//   pairs 2026-11-18: same meaning 0.64-0.89, different rules 0.39-0.65 (embeddinggemma), so: a rule close to
//   one retired as wrong or by the user (>= 0.70) is refused, two active rules merge only at >= 0.80.
// Outcome: every turn a rule was injected into records the turn's final review verdict. A rule whose turns
//   go wrong much more often than right is retired automatically; so is one unused for 45 days. Retired
//   rules stay in the file (status "retired") and `oc-lessons restore <id>` brings one back.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";

// a reply that says the previous turn was wrong; plain new instructions ("Don't use npm for this…", "Stop the
// dev server and deploy") are not corrections
export const CORRECTION = /^\s*(?:(?:no+|nope|wrong)\s*[,.!:]|no+,? (?:that|this|it)\b|that'?s (?:not (?:it|right|what)|wrong)\b|not what i (?:asked|wanted|said)\b|you (?:didn'?t|did not|forgot|missed|broke|ignored)\b|i (?:said|told you)\b|why did you\b|it (?:still )?(?:doesn'?t|does not|didn'?t) work\b|still (?:broken|not working|the same|wrong)\b|(?:لا|مش كده|غلط|قلتلك|انا قلت)(?=$|[\s,.،!؟?]))/i;
const BAD_RULE = [
  /\b(20\d\d-\d\d-\d\d|ses_[A-Za-z0-9]+|#\d{2,}|PR \d+|today|yesterday|this session|in this conversation)\b/i,
  /\b(is|are|was|were) (broken|not working|unavailable|down)\b|\b(does|do|did)n'?t work\b|\bcannot be used\b|\bnever works\b/i, // negative tool claims
  /\b(command not found|not installed|no such file|missing (binary|package|dependency)|api key)\b/i, // environment one-offs
];
const MAX_RULE = 280;
export const SEM_REJECT = 0.70, SEM_MERGE = 0.80;
const MAX_PER_SCOPE = 8;
const STALE_DAYS = 45;
const sha = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 10);
const STOP = new Set("the and for with that this from your you are was were have has had not but all any can will just into than then them they their there when what which while who how why its it's also only very more most some such each every before after about over under again use using make please want need like".split(" "));
const words = (s) => new Set((String(s).toLowerCase().match(/[a-z0-9][a-z0-9+#.-]{2,}/g) || []).filter((w) => !STOP.has(w)));
export function similar(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}

export function ruleProblem(rule) {
  const r = String(rule || "").trim();
  if (r.length < 25) return "too short";
  if (r.length > MAX_RULE) return "too long";
  const bad = BAD_RULE.find((re) => re.test(r));
  return bad ? `matches ${bad.source.slice(0, 40)}` : "";
}

export const LEARN_PROMPT = `You maintain a short list of rules that make an AI agent do a CLASS of task right the first time for this user. Below is one turn of its work that went wrong at first: the user corrected it, or an independent check sent it back. Find what it should have done from the start.

Write at most 3 rules. Each rule:
- is general for this class of task (it must make sense without this conversation): an imperative instruction + one short clause of why;
- names concrete commands, tools, checks or preferences when they are the point;
- belongs to one scope from SCOPES (the playbook or skill in use), or "general" if it applies to every task.
Do NOT write rules about: environment problems the user can fix (missing binaries, packages, keys, paths); a tool being broken or unusable (these harden into refusals after the tool is fixed); transient errors that a retry solved; one-off task details (names, dates, numbers, IDs); things the agent did right. If the turn teaches nothing reusable, return no rules — that is a fine answer.
Existing rules for these scopes are listed under EXISTING: do not repeat them; if a new rule refines one, return it with "replaces": "<id>".

SCOPES: {{SCOPES}}
EXISTING:
{{EXISTING}}

TURN:
{{TURN}}

Reply with JSON only: {"rules":[{"scope":"<scope>","rule":"<rule>","replaces":"<id or empty>"}]}`;

export class Lessons {
  constructor({ file, log = () => {}, chat = null, embed = null, notify = true, now = () => Date.now() }) {
    this.file = file; this.log = log; this.chat = chat; this.embed = embed; this.notify = notify; this.now = now;
    this.vecs = new Map(); // rule text -> vector (memory only)
    this.data = this.load();
    this.pending = new Map(); // turn key -> timer
    this.done = new Set();
  }
  mtimeOf() { try { return fs.statSync(this.file).mtimeMs; } catch { return 0; } }
  load() {
    this.mtime = this.mtimeOf();
    try { const d = JSON.parse(fs.readFileSync(this.file, "utf-8")); return { lessons: d.lessons || [], turns: d.turns || {}, curated: d.curated || 0 }; }
    catch { return { lessons: [], turns: {}, curated: 0 }; }
  }
  /** `oc-lessons` and other OpenCode processes edit the same file: re-read it before every change. */
  sync() { if (this.mtimeOf() !== this.mtime) this.data = this.load(); }
  save() {
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); const tmp = `${this.file}.tmp.${process.pid}`; fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1)); fs.renameSync(tmp, this.file); this.mtime = this.mtimeOf(); } catch (e) { this.log(`lessons: save failed: ${e.message}`); }
  }
  active(scope) { return this.data.lessons.filter((l) => l.status === "active" && (!scope || l.scope === scope)); }

  /** Rules for a turn: those of its playbooks/skills, then general ones sharing words with the request. */
  select({ scopes = [], text = "", sessionID = "", turnKey = "" } = {}) {
    this.sync();
    const picked = [];
    for (const s of scopes) picked.push(...this.active(s).sort((a, b) => (b.support || 1) - (a.support || 1)).slice(0, 4));
    const general = this.active("general").map((l) => ({ l, sim: similar(l.rule, text) })).filter((x) => x.sim >= 0.15).sort((a, b) => b.sim - a.sim).slice(0, 2).map((x) => x.l);
    const out = [...new Set([...picked, ...general])].slice(0, 6);
    if (!out.length) return null;
    const at = this.now();
    for (const l of out) { l.hits = (l.hits || 0) + 1; l.last_hit = at; }
    if (turnKey) { this.data.turns[turnKey] = { ids: out.map((l) => l.id), at }; this.trimTurns(); }
    this.save();
    return { ids: out.map((l) => l.id), block: `# Lessons from earlier sessions (harness, not the user; follow them, do not mention them)\n${out.map((l) => `- ${l.rule}`).join("\n")}` };
  }
  trimTurns() {
    const keys = Object.keys(this.data.turns);
    if (keys.length > 400) for (const k of keys.sort((a, b) => this.data.turns[a].at - this.data.turns[b].at).slice(0, keys.length - 300)) delete this.data.turns[k];
  }

  /** Final review verdict of a turn that had lessons: done = good, continue/revise = bad. */
  outcome(turnKey, verdict) {
    this.sync();
    const t = this.data.turns[turnKey];
    if (!t || t.verdict) return;
    t.verdict = verdict;
    const good = verdict === "done";
    for (const id of t.ids) {
      const l = this.data.lessons.find((x) => x.id === id);
      if (!l) continue;
      if (good) l.good = (l.good || 0) + 1; else l.bad = (l.bad || 0) + 1;
    }
    this.curate();
    this.save();
  }

  /** Similarity of `rule` to each candidate (by meaning when embeddings work, else word overlap). */
  async closeness(rule, candidates) {
    if (this.embed && candidates.length) {
      try {
        const need = [rule, ...candidates.map((l) => l.rule)].filter((t) => !this.vecs.has(t));
        if (need.length) {
          const vs = await this.embed(need);
          if (vs && vs.length === need.length && vs.every(Boolean)) need.forEach((t, i) => this.vecs.set(t, vs[i]));
        }
        const a = this.vecs.get(rule);
        if (a && candidates.every((l) => this.vecs.has(l.rule))) {
          if (this.vecs.size > 2000) this.vecs.clear();
          return candidates.map((l) => { const b = this.vecs.get(l.rule); let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i]; return { l, sim: d, by: "meaning" }; });
        }
      } catch (e) { this.log(`lessons: embeddings failed (${e.message}), comparing words`); }
    }
    return candidates.map((l) => ({ l, sim: similar(l.rule, rule), by: "words" }));
  }

  add({ scope, rule, replaces = "", source = "" }, scopes, near = []) {
    const why = ruleProblem(rule);
    if (why) return { ok: false, why };
    if (scope !== "general" && !scopes.includes(scope)) return { ok: false, why: `unknown scope ${scope}` };
    const id = `L${sha(scope + rule)}`;
    // `near`: closeness() of this rule to the lessons of its scope; without it, word overlap
    const sims = near.length ? near : this.data.lessons.filter((l) => l.scope === scope).map((l) => ({ l, sim: similar(l.rule, rule), by: "words" }));
    const cut = (x, sem) => x.by === "meaning" ? x.sim >= sem : x.sim >= 0.7;
    // a rule retired because its turns went wrong, or by the user, is not learned again, also reworded
    const rejected = sims.find((x) => x.l.status !== "active" && /went wrong|by the user/.test(x.l.retired_why || "") && (x.l.id === id || cut(x, SEM_REJECT)))?.l;
    if (rejected) return { ok: false, why: `retired before as ${rejected.id} (${rejected.retired_why})` };
    const same = sims.filter((x) => x.l.id === id || cut(x, SEM_MERGE)).map((x) => x.l);
    const dup = same.find((l) => l.status === "active");
    if (dup) { dup.support = (dup.support || 1) + 1; return { ok: false, why: `same as ${dup.id}`, merged: dup.id }; }
    const at = this.now();
    // retired only for being unused or over the cap: seen again, so it comes back (one entry per id)
    const back = same.find((l) => l.id === id);
    if (back) { Object.assign(back, { status: "active", last_hit: at, support: (back.support || 1) + 1 }); delete back.retired_why; delete back.retired_at; return { ok: true, lesson: back }; }
    const old = replaces && this.data.lessons.find((l) => l.id === replaces && l.status === "active");
    if (old) { old.status = "retired"; old.retired_why = "replaced"; old.retired_at = at; }
    const l = { id, scope, rule: rule.trim(), source, created: at, status: "active", support: old ? (old.support || 1) : 1, hits: 0, good: 0, bad: 0 };
    this.data.lessons.push(l);
    return { ok: true, lesson: l };
  }

  /** No model: retire rules whose turns mostly went wrong, stale ones, and the weakest past the cap. */
  curate() {
    const at = this.now();
    for (const l of this.active()) {
      if ((l.bad || 0) >= 4 && (l.bad || 0) > 2 * (l.good || 0)) { l.status = "retired"; l.retired_why = `turns went wrong ${l.bad} of ${l.bad + (l.good || 0)} times`; l.retired_at = at; this.log(`lessons: retired ${l.id} (${l.retired_why})`); continue; }
      const last = l.last_hit || l.created;
      if (at - last > STALE_DAYS * 86_400_000) { l.status = "retired"; l.retired_why = `unused for ${STALE_DAYS} days`; l.retired_at = at; }
    }
    const byScope = new Map();
    for (const l of this.active()) (byScope.get(l.scope) || byScope.set(l.scope, []).get(l.scope)).push(l);
    for (const [, ls] of byScope) {
      if (ls.length <= MAX_PER_SCOPE) continue;
      const score = (l) => (l.support || 1) + (l.good || 0) - (l.bad || 0);
      for (const l of ls.sort((a, b) => score(a) - score(b) || a.created - b.created).slice(0, ls.length - MAX_PER_SCOPE)) { l.status = "retired"; l.retired_why = "over the per-scope cap"; l.retired_at = at; }
    }
    this.data.curated = at;
  }

  /** Learn from one turn (background). `turn` = compact transcript text. */
  async learn({ key, turn, scopes = [], source = "" }) {
    if (!this.chat || this.done.has(key)) return [];
    this.done.add(key);
    this.sync();
    if (this.done.size > 1000) this.done.clear();
    const inScope = (l) => l.scope === "general" || scopes.includes(l.scope);
    const existing = this.data.lessons.filter((l) => l.status === "active" && inScope(l));
    const rejected = this.data.lessons.filter((l) => l.status !== "active" && inScope(l) && /went wrong|by the user/.test(l.retired_why || ""));
    const prompt = LEARN_PROMPT.replace("{{SCOPES}}", ["general", ...scopes].join(", "))
      .replace("{{EXISTING}}", (existing.map((l) => `${l.id} [${l.scope}] ${l.rule}`).join("\n") || "(none)")
        + (rejected.length ? `\nREJECTED (switched off; never propose these or rewordings of them):\n${rejected.map((l) => `[${l.scope}] ${l.rule}`).join("\n")}` : ""))
      .replace("{{TURN}}", turn.slice(0, 14000));
    let raw = "";
    try { raw = await this.chat(prompt); } catch (e) { this.log(`lessons: learn call failed: ${e.message}`); return []; }
    let rules = [];
    try {
      const clean = raw.replace(/```(?:json)?/gi, "").trim();
      const start = clean.indexOf("{");
      if (start >= 0) {
        for (let end = clean.lastIndexOf("}"); end > start; end = clean.lastIndexOf("}", end - 1)) {
          try {
            const parsed = JSON.parse(clean.slice(start, end + 1));
            if (Array.isArray(parsed?.rules)) { rules = parsed.rules; break; }
          } catch {}
        }
      }
      if (!rules.length && clean.includes('"rules"')) {
        rules = JSON.parse(clean.match(/\{[\s\S]*\}/)?.[0] || "{}").rules || [];
      }
    } catch { this.log(`lessons: no JSON in the reply (${raw.slice(0, 80)})`); return []; }
    if (!rules.length) { this.log(`lessons: no rules array in the reply (${raw.slice(0, 80)})`); return []; }
    this.sync();
    const added = [];
    for (const r of rules.slice(0, 3)) {
      const scope = String(r.scope || "general"), rule = String(r.rule || "");
      const near = ruleProblem(rule) ? [] : await this.closeness(rule, this.data.lessons.filter((l) => l.scope === scope));
      const res = this.add({ scope, rule, replaces: String(r.replaces || ""), source }, scopes, near);
      if (res.ok) added.push(res.lesson); else this.log(`lessons: dropped "${String(r.rule || "").slice(0, 70)}" (${res.why})`);
    }
    if (added.length) {
      this.curate();
      this.save();
      for (const l of added) this.log(`lessons: learned ${l.id} [${l.scope}] ${l.rule}`);
      if (this.notify) try { execFile("notify-send", ["-a", "OpenCode", "OpenCode learned", added.map((l) => `• ${l.rule}`).join("\n").slice(0, 400)], () => {}); } catch {}
    }
    return added;
  }
}

/** Compact transcript of the turn ending at the last row: request, steps, checks, final reply. */
export function turnTranscript(rows, { correction = "" } = {}) {
  const lines = [];
  for (const m of rows) {
    if (m.type === "user") lines.push(`USER: ${String(m.text || "").slice(0, 1500)}`);
    else if (m.type === "synthetic") lines.push(`CHECK (harness): ${String(m.text || "").replace(/<\/?system-reminder>/g, "").slice(0, 900)}`);
    else if (m.type === "assistant") for (const p of m.content || []) {
      if (p?.type === "text" && p.text?.trim()) lines.push(`AGENT: ${p.text.slice(0, 1200)}`);
      if (p?.type === "tool") {
        const input = JSON.stringify(p.state?.input || {}).slice(0, 300);
        const out = (p.state?.content || []).map((c) => c?.text || "").join(" ").replace(/\s+/g, " ");
        const err = p.state?.status === "error" ? ` ERROR ${String(p.state?.error?.message || p.state?.error || "").slice(0, 200)}` : "";
        lines.push(`TOOL ${p.name} ${input}${err} -> ${out.slice(0, 260)}`);
      }
    }
  }
  if (correction) lines.push(`USER'S NEXT MESSAGE (a correction): ${correction.slice(0, 1200)}`);
  let t = lines.join("\n");
  if (t.length > 14000) t = `${t.slice(0, 5000)}\n…\n${t.slice(-8500)}`;
  return t;
}
