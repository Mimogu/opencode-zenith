// Skill selection: curated regex routes + BM25 keywords (router.mjs, keywords.mjs) fused with
// semantic similarity. Confident matches are injected directly as the native
// <skill_content> block, which saves the model a `skill` tool round-trip (one
// full-context request) and works even when a weak model ignores hints.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { loadIndex, route } from "./router.mjs";
import { KeywordIndex } from "./keywords.mjs";
import { embedDocs, embedQuery, dot, EMBED_MODEL } from "./embed.mjs";
import { calibration } from "./calibration.mjs";

// Thresholds come from memory-calibration.json (tools/recall_eval.py --write), per model.
// Curated regex routes stay authoritative; semantics adds paraphrase coverage.
const CAL = calibration();
export const SEM_INJECT = CAL.skill_inject;
export const SEM_HINT = CAL.skill_hint;
const SEM_MARGIN = CAL.skill_margin;       // top semantic match must lead the runner-up by this much to auto-inject
const SEM_ONLY_HINT = CAL.skill_only_hint; // no route or keyword support: needs a clearer match to be worth a hint
const MAX_INJECT = 2;
const INJECT_BUDGET = 48_000;      // chars of skill bodies per turn (~12k tokens)
const STICKY_TURNS = 2;            // short follow-ups ("ok do it") keep the previous turn's skills
const STICKY_MAX_CHARS = 160;

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);

function stripFrontmatter(src) {
  return src.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

function sampleFiles(dir, limit = 10) {
  const out = [];
  const walk = (d, depth) => {
    if (out.length >= limit || depth > 2) return;
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= limit) return;
      if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "__pycache__") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name !== "SKILL.md") out.push(p);
    }
  };
  walk(dir, 0);
  return out;
}

/** Same shape the built-in skill tool returns (opencode 2.2.x Skill.prepare). */
export function skillContent(skill) {
  return [
    `<skill_content name="${skill.id}">`,
    `# Skill: ${skill.id}`,
    "",
    skill.body,
    "",
    `Base directory for this skill: ${skill.dir}`,
    "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
    "Note: file list is sampled.",
    "",
    "<skill_files>",
    ...sampleFiles(skill.dir).map((f) => `<file>${f}</file>`),
    "</skill_files>",
    "</skill_content>",
  ].join("\n");
}

export class Skills {
  constructor({ skillsDirs, routesPath, vectorCache, examplesPath = "", learnedPath = "", neutralPath = "" }) {
    this.neutralPath = neutralPath;   // generic prompts for the per-skill baseline (hubness correction)
    this.bias = new Map();            // id -> mean similarity to neutral prompts; subtracted from scores
    this.dirs = skillsDirs;
    this.routesPath = routesPath;
    this.vectorCache = vectorCache;
    this.examplesPath = examplesPath; // generated example requests per skill (tools/skill_examples.py)
    this.learnedPath = learnedPath;   // real prompts after which the agent loaded a skill itself
    this.key = "";
    this.index = null;
    this.meta = new Map();     // id -> { dir, file, body, hash }
    this.vectors = new Map();  // id -> Float32Array[] (description + examples + learned prompts)
    this.embedding = null;
    this.sticky = new Map();   // sessionID -> { picks, left }
  }

  stamp() {
    let k = "";
    for (const p of [this.routesPath, this.examplesPath, this.learnedPath, ...this.dirs]) {
      try { k += fs.statSync(p).mtimeMs + ":"; } catch { k += "x:"; }
    }
    return k;
  }

  /** Rebuild when a skills dir or skill-routes.json changes (cheap stat). */
  refresh() {
    const k = this.stamp();
    if (this.index && k === this.key) return this.index;
    this.key = k;
    const merged = { skills: [], settings: null };
    const seen = new Set();
    this.meta.clear();
    for (const d of this.dirs) {
      const idx = loadIndex(d, this.routesPath);
      merged.settings ??= idx.settings;
      for (const s of idx.skills) {
        if (seen.has(s.id)) continue; // first dir wins, like OpenCode's own precedence
        seen.add(s.id);
        merged.skills.push(s);
        const dir = this.findDir(d, s.id);
        if (dir) {
          const src = fs.readFileSync(path.join(dir, "SKILL.md"), "utf-8");
          this.meta.set(s.id, { dir, body: stripFrontmatter(src), hash: sha(`${EMBED_MODEL}\n${s.id}\n${s.desc}`) });
        }
      }
    }
    merged.settings ??= { max_suggestions: 3, min_keyword_cover: 0.5, skip_agents: [], opt_out_token: "#noskills" };
    this.index = merged;
    this.loadVectors();
    // keyword side sees the same example and learned requests as the semantic side
    merged.kw = new KeywordIndex(merged.skills.map((s) => ({ id: s.id, text: [s.kwText, ...this.texts(s.id, s.desc).slice(1)].join("\n") })));
    return merged;
  }

  findDir(root, id) {
    const direct = path.join(root, id);
    if (fs.existsSync(path.join(direct, "SKILL.md"))) return fs.realpathSync(direct);
    try {
      for (const name of fs.readdirSync(root)) {
        const f = path.join(root, name, "SKILL.md");
        if (fs.existsSync(f) && new RegExp(`^name:\\s*["']?${id}["']?\\s*$`, "m").test(fs.readFileSync(f, "utf-8").slice(0, 800))) {
          return fs.realpathSync(path.join(root, name));
        }
      }
    } catch {}
    return null;
  }

  texts(id, desc) {
    const ex = (this.examples?.[id]?.examples || []).slice(0, 8);
    const learned = (this.learned?.[id] || []).slice(-8);
    return [`${id.replace(/-/g, " ")}: ${desc}`, ...ex, ...learned];
  }

  /** Per-skill baseline: mean best-similarity to generic prompts. Same formula as tools/recall_eval.py. */
  async computeBias(cached) {
    const neutral = (() => { try { return JSON.parse(fs.readFileSync(this.neutralPath, "utf-8")).prompts || []; } catch { return []; } })();
    if (!neutral.length) return false;
    const h = sha(`${EMBED_MODEL}\n${neutral.join("\n")}\n${[...this.meta.values()].map((m) => m.vhash).sort().join(",")}`);
    if (cached?._bias?.hash === h) { this.bias = new Map(Object.entries(cached._bias.bias)); return false; }
    const sums = new Map();
    for (const q of neutral) {
      const qv = await embedQuery(q);
      if (!qv) return false;
      for (const [id, vs] of this.vectors) sums.set(id, (sums.get(id) || 0) + Math.max(...vs.map((v) => dot(qv, v))));
    }
    this.bias = new Map([...sums].map(([id, v]) => [id, v / neutral.length]));
    this.biasRecord = { hash: h, bias: Object.fromEntries([...this.bias].map(([k, v]) => [k, Math.round(v * 1e5) / 1e5])) };
    return true;
  }

  writeCache() {
    const out = {};
    for (const [id, vs] of this.vectors) {
      const m = this.meta.get(id);
      if (m) out[id] = { hash: m.vhash, vecs: vs.map((v) => Array.from(v, (x) => Math.round(x * 1e5) / 1e5)) };
    }
    if (this.biasRecord) out._bias = this.biasRecord;
    try {
      fs.mkdirSync(path.dirname(this.vectorCache), { recursive: true });
      const tmp = `${this.vectorCache}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(out));
      fs.renameSync(tmp, this.vectorCache);
    } catch {}
  }

  loadVectors() {
    const read = (p) => { try { return p ? JSON.parse(fs.readFileSync(p, "utf-8")) : {}; } catch { return {}; } };
    const cached = read(this.vectorCache);
    this.examples = read(this.examplesPath);
    this.learned = read(this.learnedPath);
    this.vectors.clear();
    const missing = [];
    for (const s of this.index.skills) {
      const m = this.meta.get(s.id);
      if (!m) continue;
      const texts = this.texts(s.id, s.desc);
      m.vhash = sha(`${EMBED_MODEL}\n${texts.join("\n")}`);
      const c = cached[s.id];
      if (c && c.hash === m.vhash && Array.isArray(c.vecs)) this.vectors.set(s.id, c.vecs.map((v) => Float32Array.from(v)));
      else missing.push({ id: s.id, texts });
    }
    if (!this.embedding) {
      this.embedding = (async () => {
        let changed = false;
        if (missing.length) {
          const flat = missing.flatMap((x) => x.texts);
          const vecs = await embedDocs(flat);
          if (vecs) {
            let k = 0;
            for (const x of missing) { this.vectors.set(x.id, vecs.slice(k, k + x.texts.length)); k += x.texts.length; }
            changed = true;
          }
        }
        if (this.vectors.size && (await this.computeBias(cached))) changed = true;
        if (changed) this.writeCache();
        this.embedding = null;
      })();
    }
  }

  /** Record that the agent loaded `id` itself for this prompt, so similar prompts match next time. */
  learn(id, prompt) {
    const p = String(prompt || "").replace(/\s+/g, " ").trim();
    if (!this.learnedPath || !this.meta.has(id) || p.length < 12 || p.length > 400) return false;
    const db = (() => { try { return JSON.parse(fs.readFileSync(this.learnedPath, "utf-8")); } catch { return {}; } })();
    const list = db[id] || [];
    if (list.includes(p)) return false;
    db[id] = [...list, p].slice(-8);
    try {
      fs.mkdirSync(path.dirname(this.learnedPath), { recursive: true });
      const tmp = `${this.learnedPath}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
      fs.renameSync(tmp, this.learnedPath);
    } catch { return false; }
    this.key = ""; // re-index (and re-embed just this skill) on the next refresh
    return true;
  }

  /**
   * Decide skills for one user message.
   * Returns { inject: [{id, why, content}], hint: [{id, summary, why}], scored }.
   */
  async select(text, { agent = "", sessionID = "", loaded = new Set() } = {}) {
    const idx = this.refresh();
    const base = route(text, { ...idx, settings: { ...idx.settings, max_suggestions: 8 } }, agent);
    if (!text.trim() || (idx.settings.opt_out_token && text.includes(idx.settings.opt_out_token))
        || (agent && (idx.settings.skip_agents || []).includes(agent))) {
      return { inject: [], hint: [], scored: [] };
    }
    const qvec = this.vectors.size ? await embedQuery(text) : null;
    const sem = new Map();
    if (qvec) for (const [id, vs] of this.vectors) sem.set(id, Math.max(...vs.map((v) => dot(qvec, v))) - (this.bias.get(id) || 0));

    const byId = new Map(idx.skills.map((s) => [s.id, s]));
    const cand = new Map();
    for (const b of base) cand.set(b.id, { id: b.id, rule: b.score, why: b.why, summary: b.summary });
    const semSorted = [...sem.entries()].sort((a, b) => b[1] - a[1]);
    for (const [id, c] of semSorted.slice(0, 5)) {
      if (c < SEM_HINT || cand.has(id) || !byId.has(id)) continue;
      cand.set(id, { id, rule: 0, why: "", summary: byId.get(id).summary });
    }
    const topSem = semSorted[0]?.[1] ?? 0;
    const secondSem = semSorted[1]?.[1] ?? 0;
    const scored = [...cand.values()].map((c) => {
      const s = sem.get(c.id) ?? 0;
      const named = /\bnamed\b/.test(c.why);
      const routed = /\broute\b/.test(c.why);
      const semLead = s >= SEM_INJECT && (s === topSem ? s - secondSem >= SEM_MARGIN : false);
      const confident = named || routed || semLead;
      return { ...c, sem: Math.round(s * 1000) / 1000, confident,
               score: (named ? 100 : 0) + c.rule + (s >= SEM_HINT ? 20 * (s - SEM_HINT + 0.05) : 0),
               why: [c.why, s >= SEM_HINT ? `sem:${s.toFixed(2)}` : ""].filter(Boolean).join(" ") };
    }).filter((c) => c.rule > 0 || c.sem >= SEM_ONLY_HINT).sort((a, b) => b.score - a.score);

    // a semantic-only near-miss next to a confident pick is noise
    const anyConfident = scored.some((c) => c.confident);
    let picks = scored.filter((c) => c.confident || c.rule > 0 || !anyConfident).slice(0, idx.settings.max_suggestions);
    // sticky follow-ups
    const st = this.sticky.get(sessionID);
    if (!picks.length && st && st.left > 0 && text.length <= STICKY_MAX_CHARS) {
      st.left--;
      picks = st.picks.map((p) => ({ ...p, why: `${p.why} sticky` }));
    } else if (picks.length) {
      this.sticky.set(sessionID, { picks: picks.filter((p) => p.confident), left: STICKY_TURNS });
      if (this.sticky.size > 300) this.sticky.delete(this.sticky.keys().next().value);
    }

    const inject = [];
    const hint = [];
    let budget = INJECT_BUDGET;
    for (const p of picks) {
      const m = this.meta.get(p.id);
      if (loaded.has(p.id)) continue; // already in the conversation
      if (p.confident && m && inject.length < MAX_INJECT && m.body.length <= budget) {
        budget -= m.body.length;
        inject.push({ id: p.id, why: p.why, content: skillContent({ id: p.id, dir: m.dir, body: m.body }) });
      } else {
        hint.push(p);
      }
    }
    return { inject, hint, scored };
  }
}

export function hintBlock(hint) {
  if (!hint.length) return "";
  return [
    "# Skill router",
    "These installed skills may fit the user's latest request. Load each one that genuinely fits with the `skill` tool before starting; skip the rest and never mention this note.",
    ...hint.map((h) => `- \`${h.id}\`: ${h.summary}`),
  ].join("\n");
}

export function injectedNote(ids) {
  return `# Skills preloaded\nThe skill router matched the user's request and preloaded ${ids.map((i) => `\`${i}\``).join(", ")} below as <skill_content>. Follow those instructions; do not call the skill tool for them again.`;
}

/** Skills already present in the conversation (loaded by tool or injected earlier). */
export function loadedSkills(messages) {
  const out = new Set();
  if (!Array.isArray(messages)) return out;
  const re = /<skill_content name="([^"]+)">/g;
  for (const m of messages) {
    const parts = Array.isArray(m?.content) ? m.content : [{ text: m?.content }];
    for (const p of parts) {
      const t = typeof p?.text === "string" ? p.text : typeof p?.output === "string" ? p.output : "";
      for (const x of t.matchAll(re)) out.add(x[1]);
    }
  }
  return out;
}

// ------------------------------------------------------------ catalog trim

const catalogCache = new Map();

/** Abridge <available_skills> descriptions to one short sentence each. The
 * router already matched the request against the full text, so the model only
 * needs enough to pick a skill on its own. ~31k chars -> ~8k chars per step. */
export function compactCatalog(text, maxLen = 110) {
  if (!text.includes("<available_skills>")) return text;
  const hit = catalogCache.get(text);
  if (hit) return hit;
  // one line per skill instead of four lines of XML (the tags were ~half the catalog), first
  // sentence of the description only; ids are unchanged, so the skill tool works exactly as before
  const short = (d) => {
    const clean = d.replace(/^(MANDATORY|IMPORTANT):\s*/i, "").replace(/\s+/g, " ").trim();
    let first = clean.split(/(?<=[.!?])\s/)[0] || clean;
    if (first.length > maxLen) first = first.slice(0, maxLen - 1).replace(/\s+\S*$/, "") + "…";
    return first;
  };
  const out = text.replace(/<available_skills>([\s\S]*?)<\/available_skills>/g, (block, body) => {
    const lines = [];
    for (const m of body.matchAll(/<skill>([\s\S]*?)<\/skill>/g)) {
      const field = (k) => (new RegExp(`<${k}>([\\s\\S]*?)</${k}>`).exec(m[1]) || [])[1]?.trim() || "";
      const id = field("id") || field("name");
      if (!id) return block; // unknown shape: leave the catalog as OpenCode wrote it
      const name = field("name");
      lines.push(`- ${id}${name && name !== id ? ` (${name})` : ""}: ${short(field("description"))}`);
    }
    return `Skill catalog (id: abridged description; matching skills are usually preloaded for you as <skill_content>):\n<available_skills>\n${lines.join("\n")}\n</available_skills>`;
  });
  catalogCache.set(text, out);
  if (catalogCache.size > 8) catalogCache.delete(catalogCache.keys().next().value);
  return out;
}
