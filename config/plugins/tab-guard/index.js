// Tab guard: the agent works in tabs it opened itself in the user's own browsers (my-browser = Brave over
// CDP, my-firefox = the user's Firefox). A Code Mode script that would navigate, reload, go back in or
// close a tab the agent did not open is replaced by one that prints why, the same way approval-gate holds
// a publish (OpenCode runs the input the hook returns).
// Why: 2026-11-18 a navigate example ran in the user's current Brave tab and replaced their Mostaql and
// DuckDuckGo tabs (restored by hand). The tool sheets already say "work in a new tab"; weak models skip it.
// Interactions (click, type, snapshot, evaluate) stay allowed: the user may ask for work on an open page.
// The user's latest message naming the current/this tab ("in this tab", "same tab", "هذا التبويب") lifts it.
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const DB = process.env.OPENCODE_DB_PATH || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local/share"), "opencode/opencode.db");
const LOG = path.join(os.homedir(), ".config/opencode/context-engine.log");
export const TAG = "[harness tab guard";
function log(msg) { try { fs.appendFileSync(LOG, `[${new Date().toISOString()}] tab-guard ${msg}\n`); } catch {} }

const CALL = /tools\s*(?:\[\s*["'`](my-browser|my-firefox)["'`]\s*\]|\.(my_browser|my_firefox))\s*\.\s*(\w+)\s*\(/g;
// the user asking for work in their current tab lifts the guard for that turn; a negation near it does not
// ("don't touch my tab", "keep this tab as is"); "my tab"/"open tab" alone are too ambiguous to count
export const THIS_TAB = /\b(in|on|use|using|with)\s+(this|the current|my current|the same|this same)\s+(browser\s+)?tab\b|في (التبويب|التاب) (ده|هذا|الحالي)|(نفس|هذا) (التبويب|التاب)/i;
const NOT_THIS_TAB = /\b(don'?t|do not|never|not|without|leave|keep|avoid)\b[^.!?\n]{0,40}\b(tab|tabs)\b|متلمسش|لا تلمس|سيب/i;
export const asksThisTab = (text) => THIS_TAB.test(String(text || "")) && !NOT_THIS_TAB.test(String(text || ""));
/** The argument text of a call starting at `i` (just after "("): a balanced {...} literal, or "" */
function argsAt(code, i) {
  while (i < code.length && /\s/.test(code[i])) i++;
  if (code[i] !== "{") return "";
  let depth = 0, q = "";
  for (let j = i; j < code.length; j++) {
    const ch = code[j];
    if (q) { if (ch === "\\") j++; else if (ch === q) q = ""; continue; }
    if (ch === '"' || ch === "'" || ch === "`") q = ch;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return code.slice(i, j + 1);
  }
  return code.slice(i);
}
// a literal index, null when none is given (= the current tab), "?" when it is an expression we cannot read
const num = (args, key) => {
  const a = String(args || "");
  const m = a.match(new RegExp(`\\b${key}\\s*:\\s*(\\d+)\\s*[,}]`));
  if (m) return Number(m[1]);
  return new RegExp(`\\b${key}\\s*:`).test(a) ? "?" : null;
};

/** One own-browser call in a script: what it does to tabs. */
export function classify(server, name, args = "") {
  const a = String(args);
  if (server === "my-browser") {
    if (name === "browser_tabs") {
      const action = (a.match(/action\s*:\s*["'`](\w+)/) || [])[1] || "list";
      if (action === "new") return { kind: "new" };
      if (action === "select") return { kind: "select", index: num(a, "index") };
      if (action === "close") return { kind: "close", index: num(a, "index") };
      return { kind: "read" };
    }
    if (/^browser_(navigate|navigate_back|navigate_forward|reload)$/.test(name)) return { kind: "nav", what: name };
    if (name === "browser_close") return { kind: "close", index: null };
    return { kind: "read" };
  }
  if (name === "new_page") return { kind: "new" };
  if (name === "select_page") return { kind: "select", index: num(a, "pageIdx") };
  if (name === "close_page") return { kind: "close", index: num(a, "pageIdx") };
  if (/^(navigate_page|navigate_history|reload_page|reload)$/.test(name)) return { kind: "nav", what: name };
  // with --connect-existing this only disconnects ("Disconnected from Firefox. The browser is still running.")
  return { kind: "read" };
}

export function callsIn(code) {
  const out = [];
  const src = String(code || "");
  for (const m of src.matchAll(CALL)) {
    const server = m[1] || (m[2] === "my_browser" ? "my-browser" : "my-firefox");
    out.push({ server, name: m[3], ...classify(server, m[3], argsAt(src, m.index + m[0].length)) });
  }
  return out;
}

const fresh = () => ({ ownIdx: { "my-browser": new Set(), "my-firefox": new Set() }, onOwn: { "my-browser": false, "my-firefox": false }, thisTab: false });

// after any close the browser may show one of the user's tabs: the agent selects its own again (or opens one)
function closeTab(st, s, index) {
  if (index !== null && index !== "?") st.ownIdx[s] = new Set([...st.ownIdx[s]].filter((i) => i !== index).map((i) => (i > index ? i - 1 : i)));
  st.onOwn[s] = false;
}

/** Apply one call to the state. Returns a reason string when it would touch a user's tab. */
export function step(st, c) {
  const s = c.server;
  if (c.kind === "new") { st.onOwn[s] = true; return ""; }
  if (c.kind === "select") { st.onOwn[s] = c.index === null || c.index === "?" ? false : st.ownIdx[s].has(c.index); return ""; }
  if (st.thisTab) return "";
  if (c.kind === "nav" && !st.onOwn[s]) return `${c.what} would change the page in one of the user's own tabs`;
  if (c.kind === "close") {
    if (c.index === "?") return "closing a tab by a computed index could close one of the user's own tabs (use the literal index of your own tab)";
    const mine = c.index === null ? st.onOwn[s] : st.ownIdx[s].has(c.index);
    if (!mine) return `closing ${c.index === null ? "the current tab" : `tab ${c.index}`} would close one of the user's own tabs`;
    closeTab(st, s, c.index);
  }
  return "";
}

/** Fold session rows (oldest first) into which tabs the agent opened. Incremental. */
export function fold(state, messages) {
  const st = state || fresh();
  for (const m of messages) {
    if (m.type === "user" && typeof m.text === "string") { st.thisTab = asksThisTab(m.text); continue; }
    if (m.type !== "assistant") continue;
    for (const p of Array.isArray(m.content) ? m.content : []) {
      if (p?.type !== "tool") continue;
      const code = String(p.state?.input?.code || "");
      const calls = callsIn(code);
      if (!calls.length) continue;
      const out = (p.state?.content || []).map((c) => c?.text || "").join("\n").replace(/\\"/g, '"').replace(/\\n/g, "\n");
      if (/^\s*(\[harness tab guard|\[harness approval gate)/.test(out)) continue; // held: nothing ran
      for (const c of calls) {
        if (c.kind === "new") {
          // the index the new tab got: Firefox "new page [2] →", Playwright "- 3: (current) [..]"
          const idx = c.server === "my-firefox" ? (out.match(/new page \[(\d+)\]/) || [])[1] : [...out.matchAll(/-\s*(\d+):\s*\(current\)/g)].at(-1)?.[1];
          if (idx !== undefined) st.ownIdx[c.server].add(Number(idx));
          st.onOwn[c.server] = true;
        } else if (c.kind === "close") closeTab(st, c.server, c.index);
        else step(st, c);
      }
    }
  }
  return st;
}

const clone = (st) => ({ ownIdx: { "my-browser": new Set(st.ownIdx["my-browser"]), "my-firefox": new Set(st.ownIdx["my-firefox"]) }, onOwn: { ...st.onOwn }, thisTab: st.thisTab });

/** null = let it run, else the reason. `state` = fold() of the session (tests pass it). */
export function decide(e, { state } = {}) {
  if (process.env.OPENCODE_NO_TAB_GUARD === "1") return null;
  if (String(e?.tool || "").toLowerCase() !== "execute") return null;
  const calls = callsIn(e?.input?.code);
  if (!calls.some((c) => c.kind === "nav" || c.kind === "close")) return null;
  const st = clone(state === undefined ? sessionState(e.sessionID) || fresh() : state || fresh());
  for (const c of calls) { const why = step(st, c); if (why) return { why, server: c.server }; }
  return null;
}

export function heldMessage(d) {
  const open = d.server === "my-firefox" ? `tools["my-firefox"].new_page({ url: "<url>" })` : `tools["my-browser"].browser_tabs({ action: "new" })`;
  return `${TAG} (harness, not the user)] Nothing ran: ${d.why}. ${d.server} is the user's own browser with their tabs and logins. Open your own tab first with ${open}, work only there, and close only that tab when done. If the user really wants this done in their current tab, ask them.`;
}

// Rows are updated in place while a step runs (a tool's output arrives later): only rows that are final
// (user/synthetic, or an assistant row with time.completed) go into the cached state; the rest are folded
// into a copy for this call and read again next time.
const cache = new Map();
const isFinal = (m) => m.type !== "assistant" || !!m.time?.completed;
function sessionState(sessionID) {
  let c = cache.get(sessionID);
  try {
    const { Database } = require("bun:sqlite");
    const db = new Database(DB, { readonly: true });
    try {
      const rows = db.query("SELECT seq, type, data FROM session_message WHERE session_id = ? AND seq > ? ORDER BY seq").all(sessionID, c?.seq ?? -1);
      const msgs = rows.map((r) => { try { return { seq: r.seq, type: r.type, ...JSON.parse(r.data) }; } catch { return { seq: r.seq, type: r.type }; } });
      let k = 0;
      while (k < msgs.length && isFinal(msgs[k])) k++;
      c = { seq: k ? msgs[k - 1].seq : c?.seq ?? -1, state: fold(c?.state, msgs.slice(0, k)) };
      cache.set(sessionID, c);
      if (cache.size > 200) cache.delete(cache.keys().next().value);
      return k < msgs.length ? fold(clone(c.state), msgs.slice(k)) : c.state;
    } finally { db.close(); }
  } catch (err) { log(`${sessionID} history unreadable (${err.message})`); return null; }
}

export default {
  id: "tab-guard",
  async setup(ctx) {
    if (process.env.OPENCODE_NO_TAB_GUARD === "1") return;
    await ctx?.tool?.hook?.("execute.before", (e) => {
      try {
        const d = decide(e);
        if (!d) return e;
        log(`${e.sessionID} HELD ${d.why}`);
        e.input = { ...e.input, code: `console.log(${JSON.stringify(heldMessage(d))});` };
      } catch (err) { log(`error: ${err.message}`); }
      return e;
    });
  },
};
