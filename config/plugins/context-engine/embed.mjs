// Local embeddings through Ollama. Every caller must tolerate `null`: when
// Ollama is down or slow, recall degrades to keyword search instead of blocking.
// embeddinggemma won tools/recall_eval.py on this machine (2026-11-03): hit@1 0.98 vs 0.96 (nomic),
// twice the relevant/irrelevant margin, better skill matching, ~57 ms/query; the QAT q8 build was 2x slower here.
// Single source of truth: "_active" in memory-calibration.json (Python reads the same key).
import fs from "fs";
const CAL_FILE = new URL("../../memory-calibration.json", import.meta.url);
export const EMBED_MODEL = process.env.OPENCODE_EMBED_MODEL
  || (() => { try { return JSON.parse(fs.readFileSync(CAL_FILE, "utf-8"))._active; } catch { return ""; } })()
  || "embeddinggemma";
const URL_BASE = process.env.OLLAMA_HOST ? `http://${process.env.OLLAMA_HOST.replace(/^https?:\/\//, "")}` : "http://127.0.0.1:11434";
// short: the model (~620 MB for embeddinggemma) leaves RAM 20 min after OpenCode stops using it, e.g. while gaming
const KEEP_ALIVE = "20m";
// (query, document) prefixes each model was trained with; keep in sync with PREFIXES in lib/agy_recall.py
const PREFIXES = {
  "nomic-embed-text": ["search_query: ", "search_document: "],
  embeddinggemma: ["task: search result | query: ", "title: none | text: "],
  "embeddinggemma:300m-qat-q8_0": ["task: search result | query: ", "title: none | text: "],
};
const [QUERY_PREFIX, DOC_PREFIX] = PREFIXES[EMBED_MODEL] || ["", ""];
const PREFIX = { query: QUERY_PREFIX, doc: DOC_PREFIX };
let queriesInFlight = 0; // bulk document embedding yields to interactive queries

const cache = new Map(); // query text -> Float32Array, LRU by reinsertion
const inflight = new Map(); // query text -> Promise, so skills + recall share one request
const CACHE_MAX = 512;
let downUntil = 0;
let lastOk = 0;
// After KEEP_ALIVE idle the model is unloaded and the next request reloads it from disk (measured
// 1.6 s cold here, 56 ms warm): give that one query room instead of falling back to keywords.
const WARM_MS = 1500, COLD_MS = 3500, COLD_AFTER = 19 * 60_000;

export function normalize(v) {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

export function dot(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export const toBlob = (v) => Buffer.from(v.buffer, v.byteOffset, v.byteLength);
export const fromBlob = (b) => {
  if (!b) return null;
  const u8 = b instanceof Uint8Array ? b : new Uint8Array(b);
  return new Float32Array(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
};

async function call(inputs, timeoutMs) {
  if (Date.now() < downUntil) return null;
  try {
    const res = await fetch(`${URL_BASE}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input: inputs, keep_alive: KEEP_ALIVE, truncate: true }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`ollama ${res.status}`);
    const j = await res.json();
    lastOk = Date.now();
    return (j.embeddings || []).map((e) => normalize(Float32Array.from(e)));
  } catch (e) {
    // a slow answer is not an outage: Ollama keeps loading the model for the next request.
    // Only a refused connection or an error reply backs off for a minute.
    if (e?.name !== "TimeoutError" && e?.name !== "AbortError") downUntil = Date.now() + 60_000;
    return null;
  }
}

/** Embed one query; cached. Returns Float32Array or null. */
export async function embedQuery(text, timeoutMs = Date.now() - lastOk > COLD_AFTER ? COLD_MS : WARM_MS) {
  const key = text.slice(0, 2000);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  if (inflight.has(key)) return inflight.get(key);
  queriesInFlight++;
  const p = call([PREFIX.query + key], timeoutMs).then((r) => {
    queriesInFlight--;
    inflight.delete(key);
    if (!r || !r[0]) return null;
    cache.set(key, r[0]);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    return r[0];
  });
  inflight.set(key, p);
  return p;
}

/** Embed documents in batches. Returns array (same length) of Float32Array|null, or null if unavailable. */
export async function embedDocs(texts, timeoutMs = 30_000, batch = 8) {
  const out = [];
  for (let i = 0; i < texts.length; i += batch) {
    // Ollama serves one request at a time: never make a user's query wait behind a background batch
    for (let w = 0; queriesInFlight > 0 && w < 200; w++) await new Promise((r) => setTimeout(r, 25));
    const r = await call(texts.slice(i, i + batch).map((t) => PREFIX.doc + t.slice(0, 6000)), timeoutMs);
    if (!r) return null;
    out.push(...r);
  }
  return out;
}

async function reachable(timeoutMs = 600) {
  try {
    return (await fetch(`${URL_BASE}/api/version`, { signal: AbortSignal.timeout(timeoutMs) })).ok;
  } catch {
    return false;
  }
}

/** Ollama does not start at boot; OpenCode starts it on demand. A polkit rule
 * (/etc/polkit-1/rules.d/50-ollama-ondemand.rules) lets the user start just
 * ollama.service without a password. Never throws; recall stays keyword-only until it is up. */
export async function ensureServer(waitMs = 20_000) {
  if (await reachable()) return true;
  if (process.env.OPENCODE_NO_OLLAMA_START === "1") return false;
  try {
    const { spawn } = await import("child_process");
    spawn("systemctl", ["start", "--no-block", "ollama.service"], { stdio: "ignore", detached: true }).unref();
  } catch {
    return false;
  }
  for (const end = Date.now() + waitMs; Date.now() < end;) {
    await new Promise((r) => setTimeout(r, 500));
    if (await reachable(400)) {
      downUntil = 0;
      return true;
    }
  }
  return false;
}

/** Start Ollama if needed, then load the model so the first real query is warm (~50 ms instead of 1.2–1.6 s). */
export function warm() {
  ensureServer().then((up) => up && call([PREFIX.query + "warm"], 15_000)).catch(() => {});
}

export const _testing = { cache, inflight, reset: () => { cache.clear(); inflight.clear(); downUntil = 0; } };
