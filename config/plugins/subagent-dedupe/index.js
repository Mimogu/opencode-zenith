// Subagent dedupe: a subagent call that repeats an earlier identical one, with nothing changed in
// between, is replaced by a note pointing at the answer that is already coming.
//
// Why: OpenCode runs subagents in the background ("working in the background … you will receive a
// <subagent> message"). Weak models do not wait: 2026-11-18 one wallpaper image went to the vision
// subagent 16 times and a 3-slide deck check 13 times (taskbench "slides", 55 steps, 446 s), each copy
// finishing and answering. A hint on the result did not stop it, so this is mechanical, like the
// approval gate: on `execute.before` the repeated call becomes an `execute` call that prints why.
// A repeat after a file edit or a shell command is allowed: "fix the slides, then check again" is real.
// Off: OPENCODE_NO_SUBAGENT_DEDUPE=1.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LOG = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "context-engine.log");
function log(msg) { try { fs.appendFileSync(LOG, `[${new Date().toISOString()}] subagent-dedupe ${msg}\n`); } catch {} }

const CHANGES = /^(write|edit|patch|multiedit|shell|bash)$/; // tools after which a re-check is legitimate
const sessions = new Map(); // sessionID -> { changes: n, seen: Map(key -> { changes, at }), byCall: Map(call id -> key) }

import crypto from "node:crypto";
// the whole request: agent, full prompt and any other field (files, images, attachments). 2026-11-18 review: the
// first 600 prompt characters only, so two vision checks of different images with one long preamble collided
const canon = (x) => x === null || typeof x !== "object" ? JSON.stringify(x) : Array.isArray(x) ? `[${x.map(canon).join(",")}]`
  : `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${canon(x[k])}`).join(",")}}`;
const keyOf = (input) => {
  const { description, prompt, ...rest } = input || {};
  return crypto.createHash("sha1").update(`${String(prompt || "").replace(/\s+/g, " ").trim()}\n${canon(rest)}`).digest("hex");
};
// a repeat after this long is allowed: a background subagent that crashed or timed out can be asked again
const RETRY_AFTER_MS = Number(process.env.OPENCODE_SUBAGENT_RETRY_MS ?? 10 * 60_000);

/** Returns null (let it run) or the note to print instead. */
export function decide(e) {
  if (process.env.OPENCODE_NO_SUBAGENT_DEDUPE === "1" || !e?.sessionID) return null;
  let s = sessions.get(e.sessionID);
  if (!s) {
    s = { changes: 0, seen: new Map(), byCall: new Map() };
    sessions.set(e.sessionID, s);
    if (sessions.size > 300) sessions.delete(sessions.keys().next().value);
  }
  const tool = String(e.tool || "").toLowerCase();
  if (CHANGES.test(tool)) { s.changes += 1; return null; }
  if (tool !== "subagent" && tool !== "task") return null;
  const key = keyOf(e.input);
  const prev = s.seen.get(key);
  if (prev && prev.changes === s.changes && Date.now() - prev.at < RETRY_AFTER_MS) {
    return `[harness subagent dedupe (harness, not the user)] Not started again: you already sent this exact request to the ${e.input?.agent || "subagent"} subagent and nothing has changed since. Subagents run in the background; its answer arrives (or already arrived) as a <subagent> message in this conversation — read that and use it. Continue with other work or end your step; do not send this request again unless you have changed the files it looks at.`;
  }
  s.seen.set(key, { changes: s.changes, at: Date.now() });
  if (e.id) s.byCall.set(e.id, key);
  return null;
}

/** A subagent call that failed outright (an error result) may be sent again at once. */
export function settle(e) {
  const s = sessions.get(e?.sessionID);
  const key = s && e?.id && s.byCall.get(e.id);
  if (!key) return;
  s.byCall.delete(e.id);
  const out = JSON.stringify(e.output ?? e.result ?? "");
  if (e.error || /"type":"error"|\bstate="(failed|error)"|^"?Error\b/.test(out)) s.seen.delete(key);
}

export default {
  id: "subagent-dedupe",
  async setup(ctx) {
    if (process.env.OPENCODE_NO_SUBAGENT_DEDUPE === "1") return;
    await ctx?.tool?.hook?.("execute.before", (e) => {
      try {
        const note = decide(e);
        if (note) {
          log(`${e.sessionID} held a repeated ${e.input?.agent || "subagent"} request: ${String(e.input?.description || "").slice(0, 80)}`);
          e.tool = "execute";
          e.input = { code: `console.log(${JSON.stringify(note)});` };
        }
      } catch (err) { log(`error: ${err.message}`); }
      return e;
    });
    await ctx?.tool?.hook?.("execute.after", (e) => { try { settle(e); } catch (err) { log(`error: ${err.message}`); } return e; });
  },
};
