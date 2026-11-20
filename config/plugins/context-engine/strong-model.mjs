// The strongest measured model that can run a session: reviewer ranking (tools/reviewer_eval.mjs, real
// sessions with known verdicts) filtered to models declared in opencode.json. Used to escalate a
// failing turn (verify-claims) and to start risky own-machine changes on a strong model (context engine).
import fs from "fs";
import os from "os";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function declaredModels(provider = "omniroute") {
  try {
    let p = path.join(DIR, "opencode.json");
    if (!fs.existsSync(p)) p = path.join(DIR, "opencode.json.template");
    const cfg = JSON.parse(fs.readFileSync(p, "utf-8"));
    return new Set(Object.keys(cfg.providers?.[provider]?.models || {}).map((m) => `${provider}/${m}`));
  } catch { return new Set(); }
}

// Standby strong tier: models reached directly at a provider with its own quota ("nvidia:<model>" in
// the reviewer ranking), used only while every primary strong route (Antigravity Claude, omni-code) is
// cooling. Antigravity ran out on 10 of 26 days (failover.log, 2026-10-23..11-17) and strong sessions
// then fell to the weak ladder; NVIDIA NIM's free tier is 10,000 requests/day. 2026-11-17 reviewer
// scores: nemotron-3-ultra 0.71, nemotron-3.5-super-vl 0.71 (Claude Opus 0.82, Sonnet 0.67).
const STANDBY_MIN = 0.7;
export function standbyModels() {
  const declared = declaredModels("nvidia");
  try {
    return (JSON.parse(fs.readFileSync(path.join(DIR, "state/reviewer-ranking.json"), "utf-8")).ranking || [])
      .filter((r) => r.score >= STANDBY_MIN && /^nvidia:/.test(r.model))
      .sort((a, b) => b.score - a.score)
      .map((r) => `nvidia/${r.model.slice("nvidia:".length)}`)
      .filter((m) => declared.has(m));
  } catch { return []; }
}

// Median seconds per step per model in real sessions of the last 3 days (OpenCode's own store,
// read-only), cached 10 min. 2026-11-06: the strong pick omni-code took 26 s/step while
// antigravity/agy claude-sonnet-4-6 (the same model family) took 4-19 s.
const DB = process.env.OPENCODE_DB_PATH || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local/share"), "opencode/opencode.db");
let speedCache = { at: 0, map: new Map() };
export function stepSpeeds() {
  if (Date.now() - speedCache.at < 600_000) return speedCache.map;
  const map = new Map();
  try {
    const { Database } = require("bun:sqlite");
    const db = new Database(DB, { readonly: true });
    const rows = db.query(`SELECT json_extract(data,'$.model.providerID')||'/'||json_extract(data,'$.model.id') AS m,
      json_extract(data,'$.time.completed') - json_extract(data,'$.time.created') AS ms
      FROM session_message WHERE type = 'assistant' AND time_created >= ? AND json_extract(data,'$.time.completed') IS NOT NULL`).all(Date.now() - 3 * 86_400_000);
    db.close();
    const per = new Map();
    for (const r of rows) if (r.m && r.ms >= 0) (per.get(r.m) || per.set(r.m, []).get(r.m)).push(r.ms / 1000);
    for (const [m, v] of per) if (v.length >= 6) { v.sort((a, b) => a - b); map.set(m, v[Math.floor(v.length / 2)]); }
  } catch {}
  speedCache = { at: Date.now(), map };
  return map;
}

// strong enough to work on the user's machine: models the reviewer ranking measured >= 0.8, plus
// Claude Sonnet/Opus-class routes and the omni-code combo; among them the fastest recent one wins
const STRONG_NAME = /\bclaude-(sonnet|opus)|^omniroute\/omni-code$/;

/** "provider/model" of the best usable model that is not `current`, or null. */
export function strongModel(current = "", { avoidCooling = false, cool = cooling() } = {}) {
  const declared = declaredModels();
  let ranked = [];
  try {
    ranked = (JSON.parse(fs.readFileSync(path.join(DIR, "state/reviewer-ranking.json"), "utf-8")).ranking || [])
      .filter((r) => r.score >= 0.8).map((r) => `omniroute/${r.model}`);
  } catch {}
  const pool = [...new Set([...ranked, ...[...declared].filter((m) => STRONG_NAME.test(m)), "omniroute/omni-code"])]
    .filter((m) => declared.has(m) && m !== current);
  const speed = stepSpeeds();
  // unmeasured: assume slow-ish so measured fast ones win; thinking routes are slower still
  const sec = (m) => speed.get(m) ?? (/thinking/.test(m) ? 40 : 25);
  // a route that just failed (429/5xx, auto-failover's ledger) goes last: 2026-11-06 three sessions
  // started on agy/claude-sonnet-4-6 at once, it answered 429, and they fell to weak models
  const best = pool.map((m, i) => ({ m, i, s: sec(m), c: cool.has(m) ? 1 : 0 }))
    .sort((a, b) => a.c - b.c || a.s - b.s || a.i - b.i)[0];
  // every primary strong route cooling (their shared free allowance is spent): the standby tier, fastest
  // measured first, before giving up (switching to a cooling route only lands the session on whatever
  // weak model failover finds: 2026-11-06 agnes-3.0-flash at 35-95 s/step)
  if (!best || best.c) {
    const standby = standbyModels().filter((m) => m !== current && !cool.has(m))
      .map((m, i) => ({ m, i, s: speed.get(m) ?? 25 })).sort((a, b) => a.s - b.s || a.i - b.i)[0];
    if (standby) return standby.m;
  }
  if (avoidCooling && best?.c) return null;
  return best?.m || null;
}

/** Models auto-failover / the sentinel put in backoff (`.cooldown_state.json`), still cooling now. */
export function cooling() {
  try {
    const st = JSON.parse(fs.readFileSync(path.join(DIR, ".cooldown_state.json"), "utf-8"));
    const now = Date.now() / 1000;
    return new Set(Object.entries(st).filter(([, v]) => v && Number(v.cooldown_until || 0) > now).map(([m]) => m));
  } catch { return new Set(); }
}

/** True when `model` is one of the measured strong models (so no switch is needed). */
export function isStrong(model) {
  if (!model) return false;
  if (STRONG_NAME.test(model)) return true;
  if (standbyModels().includes(model)) return true;
  try {
    return (JSON.parse(fs.readFileSync(path.join(DIR, "state/reviewer-ranking.json"), "utf-8")).ranking || [])
      .some((r) => r.score >= 0.8 && `omniroute/${r.model}` === model);
  } catch { return false; }
}

// A run that chose its model on purpose keeps it: taskbench with TASKBENCH_MODEL writes `.pinned-model`
// into the task folder. 2026-11-18 a pinned nemotron-3-ultra comparison silently ran 8 of 14 tasks on
// Claude Sonnet (strong start for own-machine/browser playbooks, review escalation), so the numbers
// compared the wrong model.
const pinCache = new Map();
export function isPinned(sessionID) {
  if (!sessionID) return false;
  if (pinCache.has(sessionID)) return pinCache.get(sessionID);
  let pinned = false;
  try {
    const { Database } = require("bun:sqlite");
    const db = new Database(DB, { readonly: true });
    const s = db.query("SELECT directory FROM session_v2 WHERE id = ?").get(sessionID);
    db.close();
    pinned = !!s?.directory && fs.existsSync(path.join(s.directory, ".pinned-model"));
  } catch {}
  if (pinCache.size > 500) pinCache.clear();
  pinCache.set(sessionID, pinned);
  return pinned;
}

export const toModel = (s) => ({ providerID: s.slice(0, s.indexOf("/")), id: s.slice(s.indexOf("/") + 1) });
export const modelString = (m) => (!m ? "" : typeof m === "string" ? m : `${m.providerID}/${m.id ?? m.modelID ?? m.model}`);
