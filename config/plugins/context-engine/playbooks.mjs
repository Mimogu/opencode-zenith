// Task playbooks (playbooks.json): short checklists of the steps a top model takes unprompted,
// picked per user message by regex route or by similarity to example requests, and appended right
// after the user's message in the request view, where weak models actually follow them.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { embedDocs, embedQuery, dot, EMBED_MODEL } from "./embed.mjs";

export class Playbooks {
  constructor(file, vectorCache) {
    this.file = file;
    this.vectorCache = vectorCache;
    this.stamp = "";
    this.cfg = { playbooks: {}, always: "", agents: [], threshold: 1, max: 2 };
    this.vectors = new Map(); // id -> Float32Array[]
    this.embedding = null;
  }

  refresh() {
    let st = "";
    try { st = String(fs.statSync(this.file).mtimeMs); } catch { return this.cfg; }
    if (st === this.stamp) return this.cfg;
    this.stamp = st;
    try { this.cfg = { ...this.cfg, ...JSON.parse(fs.readFileSync(this.file, "utf-8")) }; } catch { return this.cfg; }
    for (const p of Object.values(this.cfg.playbooks)) {
      p._routes = (p.routes || []).flatMap((r) => { try { return [new RegExp(r, "i")]; } catch { return []; } });
    }
    this.loadVectors();
    return this.cfg;
  }

  loadVectors() {
    const texts = Object.entries(this.cfg.playbooks).flatMap(([id, p]) => (p.examples || []).map((t) => [id, t]));
    const hash = crypto.createHash("sha256").update(`${EMBED_MODEL}\n${texts.map((x) => x.join("\t")).join("\n")}`).digest("hex").slice(0, 16);
    try {
      const c = JSON.parse(fs.readFileSync(this.vectorCache, "utf-8"));
      if (c.hash === hash) {
        this.vectors = new Map(Object.entries(c.vectors).map(([id, vs]) => [id, vs.map((v) => Float32Array.from(v))]));
        return;
      }
    } catch {}
    this.vectors = new Map();
    this.embedding ??= embedDocs(texts.map((x) => x[1])).then((vecs) => {
      this.embedding = null;
      if (!vecs) return;
      texts.forEach(([id], i) => { if (!this.vectors.has(id)) this.vectors.set(id, []); this.vectors.get(id).push(vecs[i]); });
      try {
        fs.mkdirSync(path.dirname(this.vectorCache), { recursive: true });
        const out = Object.fromEntries([...this.vectors].map(([id, vs]) => [id, vs.map((v) => Array.from(v, (x) => Math.round(x * 1e5) / 1e5))]));
        fs.writeFileSync(this.vectorCache, JSON.stringify({ hash, vectors: out }));
      } catch {}
    }).catch(() => { this.embedding = null; });
  }

  /** { ids, why, text } for one user message; text is "" when nothing applies. */
  /** force: playbook ids picked regardless of routes/similarity (e.g. own-machine for a change to an installed app). */
  async select(text, agent = "", { force = [] } = {}) {
    const cfg = this.refresh();
    if (agent && cfg.agents.length && !cfg.agents.includes(agent)) return { ids: [], why: [], text: "", strong: [] };
    // acknowledgements and memory requests need no checklist; similarity on 1-3 words is noise
    const skip = (cfg.skip || []).some((r) => { try { return new RegExp(r, "i").test(text); } catch { return false; } });
    const words = text.trim().split(/\s+/).length;
    const qvec = !skip && words >= 4 && this.vectors.size ? await embedQuery(text) : null;
    // regex routes, plus the single most similar playbook when it clears the threshold: absolute
    // scores overlap between classes, but the top-ranked class is usually right
    const all = Object.entries(cfg.playbooks).map(([id, p]) => ({
      id, p, routed: !skip && (force.includes(id) || p._routes.some((r) => r.test(text))),
      sem: qvec && this.vectors.has(id) ? Math.max(...this.vectors.get(id).map((v) => dot(qvec, v))) : 0,
    }));
    const top = all.reduce((a, b) => (b.sem > a.sem ? b : a), all[0]);
    // a playbook may raise its own bar: "measure" (strong start) matched lag complaints and web errands at 0.34-0.45
    const scored = all.filter((x) => x.routed || (x === top && x.sem >= (x.p.threshold ?? cfg.threshold)))
      .map((x) => ({ ...x, score: (x.routed ? 1 : 0) + x.sem, why: x.routed ? "route" : `sem:${x.sem.toFixed(2)}` }))
      .sort((a, b) => b.score - a.score);
    const picks = scored.slice(0, cfg.max);
    const lines = [];
    for (const { p } of picks) lines.push(`${p.title}:`, ...p.checklist.map((c) => `- ${c}`));
    if (cfg.always) lines.push(cfg.always);
    return {
      ids: picks.map((x) => x.id),
      // playbooks marked "strong" need judgement more than speed: the session starts on the strong model
      strong: picks.filter((x) => x.p.strong).map((x) => x.id),
      why: picks.map((x) => `${x.id}(${x.why})`),
      text: lines.length ? `<system-reminder>\nHow to handle this request (from the harness, not the user; do not mention it):\n${lines.join("\n")}\n</system-reminder>` : "",
    };
  }
}

/** Request view only: a copy of `messages` with `text` appended to the user message `id`
 *  (the one the decision was made for; lastUserText's id), else to the last user message. */
export function appendToUser(messages, id, text) {
  if (!text || !Array.isArray(messages)) return messages;
  let i = messages.findIndex((m, k) => m?.role === "user" && (m.id || String(k)) === id);
  if (i < 0) i = messages.findLastIndex((m) => m?.role === "user");
  if (i >= 0) {
    const m = messages[i];
    const content = Array.isArray(m.content) ? m.content : [{ type: "text", text: String(m.content ?? "") }];
    const out = messages.slice();
    out[i] = { ...m, content: [...content, { type: "text", text }] };
    return out;
  }
  return messages;
}
