// The one keyword engine for memory and skills: tokenizer + light stemmer, BM25 ranking,
// typo/word-family tolerance and synonyms. lib/agy_keywords.py is a line-for-line twin
// (tests/test_keywords.py checks they tokenize identically); both read keyword-lexicon.json.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const LEX_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "keyword-lexicon.json");
let LEX = { stop: [], keep_short: [], synonyms: [] };
try { LEX = { ...LEX, ...JSON.parse(fs.readFileSync(LEX_FILE, "utf-8")) }; } catch {}
export const STOP = new Set(LEX.stop);
const KEEP_SHORT = new Set(LEX.keep_short);

const VOWEL = /[aeiouy]/;

/** Light suffix stripper. It only has to map word forms onto the same key, not produce real roots. */
export function stem(w) {
  if (w.length <= 3 || !/^[a-z]+$/.test(w)) return w;
  let s = w;
  if (s.endsWith("ies") && s.length > 4) s = s.slice(0, -3) + "y";
  else if (s.endsWith("sses")) s = s.slice(0, -2);
  else if (s.endsWith("s") && !/(ss|us|is)$/.test(s)) s = s.slice(0, -1);
  const m = /(ing|ed)$/.exec(s);
  if (m) {
    const base = s.slice(0, -m[1].length);
    if (base.length >= 3 && VOWEL.test(base)) {
      s = base;
      if (/([^aeiouslz])\1$/.test(s)) s = s.slice(0, -1); // running -> run, but install stays
    }
  } else if (s.endsWith("ly") && s.length > 5) s = s.slice(0, -2);
  if (s.length > 3 && s.endsWith("e")) s = s.slice(0, -1);
  if (s.length > 3 && s.endsWith("y")) s = s.slice(0, -1) + "i";
  return s;
}

const keepRaw = (t) => !STOP.has(t) && (t.length >= 3 || KEEP_SHORT.has(t)) && !/^\d{1,2}$/.test(t);

/** Meaningful stems of `text`, in order, repeats kept (term frequency matters to BM25). */
export function tokenize(text) {
  const out = [];
  for (let t of String(text || "").toLowerCase().replace(/[’']/g, "").match(/[a-z0-9][a-z0-9+#.-]*[a-z0-9+#]|[a-z0-9]/g) || []) {
    t = t.replace(/\.+$/, "");
    const parts = /[.-]/.test(t) ? t.split(/[.-]+/) : [];
    if (keepRaw(t)) out.push(stem(t));
    for (const p of parts) if (p && keepRaw(p)) out.push(stem(p));
  }
  return out;
}

const SYN = new Map();
for (const group of LEX.synonyms) {
  const stems = [...new Set(group.map((w) => stem(w.toLowerCase())))];
  for (const s of stems) SYN.set(s, [...new Set([...(SYN.get(s) || []), ...stems.filter((x) => x !== s)])]);
}

/** Optimal-string-alignment distance, giving up once it exceeds `max`. */
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

const W_SYN = 0.7;    // a synonym is weaker evidence than the word itself
const W_FAMILY = 0.8; // configur / configurat, transl / translat
const W_TYPO = 0.8;   // retreival / retrieval
const K1 = 1.2, B = 0.75;

export class KeywordIndex {
  /** docs: [{ id, text }] */
  constructor(docs) {
    this.ids = docs.map((d) => d.id);
    this.post = new Map(); // term -> Map(docIndex -> tf)
    this.len = [];
    docs.forEach((d, i) => {
      const toks = tokenize(d.text);
      this.len.push(toks.length);
      for (const t of toks) {
        let p = this.post.get(t);
        if (!p) this.post.set(t, (p = new Map()));
        p.set(i, (p.get(i) || 0) + 1);
      }
    });
    this.N = docs.length;
    this.avg = this.len.reduce((a, b) => a + b, 0) / Math.max(1, this.N) || 1;
    this.byFirst = new Map();
    for (const t of this.post.keys()) {
      const k = t[0];
      if (!this.byFirst.has(k)) this.byFirst.set(k, []);
      this.byFirst.get(k).push(t);
    }
    this.maxIdf = Math.log(1 + (this.N + 0.5) / 0.5);
  }

  idf(t) {
    const df = this.post.get(t)?.size || 0;
    return Math.log(1 + (this.N - df + 0.5) / (df + 0.5));
  }

  /** Index terms a query term stands for: [[term, weight]]. */
  expand(q) {
    const out = new Map();
    if (this.post.has(q)) out.set(q, 1);
    for (const s of SYN.get(q) || []) if (this.post.has(s) && !out.has(s)) out.set(s, W_SYN);
    if (!out.has(q) && q.length >= 5 && /^[a-z]+$/.test(q)) {
      const maxEd = q.length >= 8 ? 2 : 1;
      for (const v of this.byFirst.get(q[0]) || []) {
        if (out.has(v) || v.length < 4) continue;
        const [short, long] = q.length <= v.length ? [q, v] : [v, q];
        if (short.length >= 5 && long.startsWith(short) && long.length - short.length <= 4) out.set(v, W_FAMILY);
        else if (editDistance(q, v, maxEd) <= maxEd) out.set(v, W_TYPO);
      }
    }
    return [...out.entries()];
  }

  /**
   * Ranked matches: [{ id, score, cover, terms }]. `cover` is the share of the query's information
   * (IDF mass) the document explains, 0..1; unknown query words count as rare, so a query about
   * something the corpus never mentions cannot look well covered.
   */
  search(query, limit = 20) {
    const qterms = [...new Set(tokenize(query))];
    if (!qterms.length || !this.N) return [];
    const score = new Map(), covered = new Map(), terms = new Map();
    let mass = 0;
    for (const q of qterms) {
      const exp = this.expand(q);
      // a compound the corpus never uses ("per-category") is still counted through its parts
      if (!exp.length && /[.-]/.test(q)) continue;
      const qIdf = this.post.has(q) ? this.idf(q) : exp.length ? Math.max(...exp.map(([v]) => this.idf(v))) : this.maxIdf;
      mass += qIdf;
      const best = new Map(); // doc -> strongest weight this query term reached in it
      for (const [v, w] of exp) {
        const idf = this.idf(v);
        for (const [d, tf] of this.post.get(v)) {
          score.set(d, (score.get(d) || 0) + w * idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * this.len[d] / this.avg)));
          if (w > (best.get(d) || 0)) best.set(d, w);
        }
      }
      for (const [d, w] of best) {
        covered.set(d, (covered.get(d) || 0) + w * qIdf);
        if (!terms.has(d)) terms.set(d, []);
        terms.get(d).push(q);
      }
    }
    return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)
      .map(([d, s]) => ({ id: this.ids[d], score: s, cover: mass ? covered.get(d) / mass : 0, terms: terms.get(d) }));
  }
}
