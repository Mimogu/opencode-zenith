// Approval gate: nothing is published or sent from a browser until the user approved it in chat.
//
// Why: posting on LinkedIn, bidding on Nafezly, sending a message or a form cannot be undone, and the
// reply review (verify-claims) only runs after the turn, when the post is already public. Rules in a
// prompt are not enough for free models (2026-11-17: a session opened Discord and joined a voice
// channel when it was only asked to open the browser). So this is mechanical, like undo-guard: on
// `execute.before` a call that would publish is replaced by one that only prints why it was held
// (OpenCode runs the input the hook returns; its own opencode.tool.input.repair rewrites s.input the
// same way). The agent shows the user what will be published and asks; once the user approves, the
// same action goes through once. Standing approval for one site: `oc-approve <domain> <duration>`.
//
// The whole script is scanned, not one call shape (2026-11-18 review: `tools["x"]["browser_click"]`,
// a saved tools object, Playwright `getByRole(...).click()` and `keyboard.press('Enter')` slipped past
// a regex for `tools["x"].fn({...})`). A script is held when it commits something (a click, Enter, a
// form submit, a dialog accept, a POST, synthetic input events) and
//   - names a publishing control in a string (Post, Send, Submit, Apply, Bid, Connect, نشر, إرسال …), or
//     clicks an element the newest page snapshot labels as one (`- button "Post" [ref=e4]`), or
//   - runs on a publishing site (LinkedIn, freelance sites, social, mail …) — there only clicks on
//     elements the newest snapshot shows as something harmless go through.
// Shell commands that drive the browser or the screen are held on publishing sites. When the session
// history cannot be read the page counts as a publishing site (fail closed).
// Off: OPENCODE_NO_APPROVAL_GATE=1.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOG = path.join(DIR, "context-engine.log");
const APPROVALS = path.join(DIR, "state", "approvals.json");
const DB = process.env.OPENCODE_DB_PATH || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local/share"), "opencode/opencode.db");
export const TAG = "[harness approval gate";
const HELD_MARK = `${TAG} (harness, not the user)] Held`;

function log(msg) { try { fs.appendFileSync(LOG, `[${new Date().toISOString()}] approval-gate ${msg}\n`); } catch {} }

// controls that publish, send or commit something outside the machine
export const PUBLISH = /\b(post|re-?post|publish|submit|send|share|apply|bid|place (?:a |the )?bid|make (?:an? )?offer|connect|invite|follow|comment|reply|confirm|pay|purchase|buy|checkout|donate|schedule|endorse|hire)\b|نشر|انشر|إرسال|ارسال|أرسل|ارسل|تقديم|قدم|أضف عرض|اضف عرض|إضافة عرض|تأكيد|ادفع|دفع|شراء|تعليق/i;
// harmless words that contain or sit next to the ones above
const NOT_PUBLISH = /\b(post(?:s|ing)? (?:feed|list|tab|filter)|search|start a post|create (?:a )?post|write (?:a )?post|new post|open|edit|draft|preview|cancel|close|dismiss|next|back|continue|more|show|view|see|filter|sort|sign ?in|log ?in)\b/i;
const STRONG = /\b(submit|send|publish|bid|pay)\b|نشر|إرسال|تقديم/i;
export const OUTWARD_SITES = /(^|\.)(linkedin\.com|nafezly\.com|kafil\.io|mostaql\.com|khamsat\.com|upwork\.com|fiverr\.com|freelancer\.com|facebook\.com|instagram\.com|x\.com|twitter\.com|threads\.net|reddit\.com|discord\.com|t\.me|web\.telegram\.org|whatsapp\.com|web\.whatsapp\.com|mail\.google\.com|outlook\.(live|office)\.com|tiktok\.com|bsky\.app|mastodon\.social)$/i;
// not listed (2026-11-18: 9 harmless clicks held while playing YouTube videos): youtube.com, github.com,
// gitlab.com — mostly browsing; their publishing buttons (Comment, Submit new issue) are still caught by label
const extraSites = () => (process.env.OPENCODE_GATE_SITES || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
export const UNKNOWN = "(unknown page)";

export function hostOf(url) { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } }
export function isOutward(host) {
  return host === UNKNOWN || (!!host && (OUTWARD_SITES.test(host) || extraSites().some((s) => host === s || host.endsWith(`.${s}`))));
}
export const publishes = (text) => { const t = String(text || ""); return PUBLISH.test(t) && !(NOT_PUBLISH.test(t) && !STRONG.test(t)); };
const SUBMIT_SELECTOR = /^#?[\w-]*\b(submit|publish|send|make-offer|offer-btn|bid|post-btn|post-button|share-btn|apply)\b[\w-]*$|type=["']?submit/i;

// What a script does, in call syntax only, so a tool search for "click button" is not an action;
// page scripts passed as strings still contain call syntax (`page.getByRole(...).click()`).
// any server's naming (Playwright browser_click, Firefox click_by_uid, chrome-devtools click, camofox_click …)
const TOOL_LITERAL = /["'`](\w*(?:click|press_key|dialog)\w*)["'`]\s*\]/; // tools["x"]["browser_click"]
const DOES = {
  // no \b before mouse_click: in browser_mouse_click_xy the "_" before it is a word character
  // Firefox (my-firefox) clicks are click_by_uid({ uid }), its dialogs accept_dialog()
  click: /\.(click|dblclick|tap|check)\s*\(|\b\w*click\w*\s*\(|dispatchMouseEvent/i,
  xyClick: /mouse_click_xy\s*\(|click_at\s*\(|mouse\.click\s*\(|dispatchMouseEvent/i,
  key: /\w*press_key\s*\(|\.press\s*\(|\bkeyboard\.(press|down|type|insertText)\s*\(/i,
  submit: /\.submit\s*\(|requestSubmit|\bsubmit\s*:\s*true/i,
  post: /method\s*:\s*["'`]post["'`]|\.open\s*\(\s*["'`]post["'`]|sendBeacon/i,
  dialog: /\w*(handle|accept)_dialog\s*\(|\.accept\s*\(/i,
  events: /new\s+(Mouse|Pointer|Keyboard|Submit)Event/i,
};
function commits(code) {
  const c = String(code);
  const acts = [];
  if (DOES.click.test(c) || /click/.test(c.match(TOOL_LITERAL)?.[0] || "")) acts.push("click");
  if (((DOES.key.test(c) || /press_key/.test(c.match(TOOL_LITERAL)?.[0] || "")) && /\b(enter|return)\b/i.test(c)) || /\bpressEnter\s*:\s*true/.test(c)) acts.push("enter");
  for (const k of ["submit", "post", "events"]) if (DOES[k].test(c)) acts.push(k);
  if (DOES.dialog.test(c) || /(handle|accept)_dialog/.test(c.match(TOOL_LITERAL)?.[0] || "")) acts.push("dialog");
  return acts;
}
const literals = (code) => [...String(code).matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((m) => m[2]);
// one level deeper too: a page script is a string whose own strings name the control ('#make-offer')
const strings = (code) => { const top = literals(code); return [...top, ...top.flatMap((t) => literals(t.replace(/\\(["'`])/g, "$1")))]; };
const REF = /^(?:e\d+|\d+_\d+|s\d+e\d+)$/;

/** Why `code` (a Code Mode script) would publish on `host`, given element ref -> label from the
 *  newest page snapshot. Returns [{what, why}] (empty: let it run). */
export function risky(code, host = "", labels = new Map()) {
  const src = String(code || "");
  const acts = commits(src);
  if (!acts.length) return [];
  const lits = strings(src);
  const refs = lits.filter((s) => REF.test(s));
  const named = lits.filter((s) => !REF.test(s) && (publishes(s) || SUBMIT_SELECTOR.test(s.trim())));
  const labelled = refs.filter((r) => publishes(labels.get(r)));
  const out = [];
  if (named.length) out.push({ what: `${acts.join("+")} on "${named[0].slice(0, 60)}"`, why: "names a publishing control" });
  if (labelled.length) out.push({ what: `${acts.join("+")} on ${labels.get(labelled[0])} [${labelled[0]}]`, why: "the page snapshot shows a publishing control" });
  if (out.length) return out;
  if (isOutward(host)) {
    // on a publishing site only a click on elements the newest snapshot shows as harmless goes through
    const onlyClick = acts.every((a) => a === "click") && !DOES.xyClick.test(src);
    const unknown = refs.filter((r) => !labels.has(r));
    if (!onlyClick || !refs.length || unknown.length) {
      out.push({ what: acts.join("+"), why: host === UNKNOWN ? "the page could not be determined" : `on ${host} (${!onlyClick ? acts.filter((a) => a !== "click").join(", ") || "coordinate click" : unknown.length ? `element ${unknown[0]} is not in the newest snapshot` : "no element ref to check"})` });
    }
  }
  return out;
}

/** Shell commands that drive the browser or the screen to click while on a publishing site. */
export function riskyShell(command, host = "") {
  const c = String(command || "");
  const drives = /(9222|devtools|cdp|playwright|puppeteer|selenium)/i.test(c) && /(click|submit|dispatchMouseEvent|Input\.dispatch|press)/i.test(c);
  const screen = /\b(ydotool|xdotool|wtype|desk\.sh)\b[^\n]*\b(click|key|type)\b/i.test(c);
  return (drives || screen) && (isOutward(host) || publishes(c)) ? [{ what: c.slice(0, 100), why: "shell command that clicks or types in the browser" }] : [];
}

// ---------------------------------------------------------------- session state
const APPROVE_WORDS = "yes|yep|yeah|y|ok(ay)?|sure|go( ahead)?|do it|approved?|confirm(ed)?|post it|send it|submit( it)?|publish( it)?|bid|looks good|lgtm|perfect|نعم|ايوه|أيوه|اه|آه|تمام|موافق|ماشي|انشر|انشره|ابعت|ارسل|أرسل|قدم";
// \b does not work next to Arabic letters in JavaScript: end each word with an explicit boundary
const END = "(?=$|[\\s.,!؟?،])";
const APPROVE = new RegExp(`^\\s*(${APPROVE_WORDS})${END}`, "i");
const REFUSE = new RegExp(`(^|[\\s,.])(no|not yet|don'?t|do not|wait|stop|hold|cancel|change|edit|fix|instead|but|first|before|after|later|بس|لا|مش|استنى|انتظر|عدل|غير)${END}`, "i");
// a "no"/"don't" that only says nothing needs changing still approves ("yes, no changes", "yes don't change anything")
const NOTHING_TO_CHANGE = /\b(no (changes?|edits?)( needed)?|don'?t (change|edit) (anything|it|a thing)|nothing to (change|fix|edit)|no need to (change|edit))\b|من غير تعديل|بدون تعديل/gi;

/** Fold session rows (oldest first) into what the gate needs. Incremental: pass the previous state. */
export function fold(state, messages) {
  const st = state || { host: "", labels: new Map(), held: 0, askedAfterHold: false, approval: null, n: 0, users: 0 };
  for (const m of messages) {
    st.n += 1;
    if (m.type === "user" && typeof m.text === "string") {
      st.users += 1;
      const t = m.text.replace(/​.*$/, "").trim();
      // an approval answers a question the agent asked after a hold; anything else resets it
      // "yes, wait" / "yes but change the price first" is not an approval (2026-11-18 review: it was)
      const ok = st.held && st.askedAfterHold && t.length <= 160 && APPROVE.test(t) && !REFUSE.test(t.replace(NOTHING_TO_CHANGE, " "));
      st.approval = ok ? { id: m.id || m.time?.created || `${st.n}`, text: t } : null;
      if (ok) { st.held = 0; st.askedAfterHold = false; }
      continue;
    }
    if (m.type !== "assistant") continue;
    for (const p of Array.isArray(m.content) ? m.content : []) {
      if (p?.type === "text" && st.held && String(p.text || "").trim().length > 0) st.askedAfterHold = true;
      if (p?.type !== "tool") continue;
      const code = String(p.state?.input?.code || p.state?.input?.command || "");
      const out = (p.state?.content || []).map((c) => c?.text || "").join("\n").replace(/\\"/g, '"').replace(/\\n/g, "\n");
      if (out.includes(HELD_MARK)) { st.held = st.n; st.askedAfterHold = false; }
      // the page the browser is on: the newest "Page URL:" line or navigate call (not tab lists)
      for (const u of `${code}\n${out}`.matchAll(/(?:Page URL:\s*|browser_navigate\s*\(\s*\{\s*url\s*:\s*["'`]|navigate_page\s*\(\s*\{[^}]*?url\s*:\s*["'`]|\.goto\s*\(\s*["'`])(https?:\/\/[^\s"'`\\)]+)/g)) st.host = hostOf(u[1]) || st.host;
      // element labels from the newest snapshot only: refs are reused when the page changes
      const snap = new Map();
      for (const x of out.matchAll(/-\s+(\w+)\s+"([^"]*)"[^\n]*?\[ref=([\w]+)\]/g)) snap.set(x[3], `${x[1]} "${x[2]}"`);
      // chrome-devtools and Firefox: `uid=e4 button "Guide"`, `uid=e7 span text="EG"`, `uid=e14 div` (no name)
      for (const x of out.matchAll(/uid=([\w-]+)\s+(\w+)(?:\s+"([^"]*)")?([^\n]*)/g)) {
        const text = (x[4].match(/\btext="([^"]*)"/) || [])[1] || "";
        snap.set(x[1], `${x[2]} "${x[3] ?? text}"`);
      }
      if (snap.size) st.labels = snap;
    }
  }
  return st;
}

const cache = new Map(); // sessionID -> { seq, state }
function sessionState(sessionID) {
  let c = cache.get(sessionID);
  try {
    const { Database } = require("bun:sqlite");
    const db = new Database(DB, { readonly: true });
    try {
      const rows = db.query("SELECT seq, type, data FROM session_message WHERE session_id = ? AND seq > ? ORDER BY seq")
        .all(sessionID, c?.seq ?? -1);
      const msgs = rows.map((r) => { try { return { seq: r.seq, type: r.type, ...JSON.parse(r.data) }; } catch { return { seq: r.seq, type: r.type }; } });
      // rows are updated in place while a step runs (a held message or snapshot arrives later): only final
      // rows go into the cache; the rest are folded into a copy for this call and read again next time
      let k = 0;
      while (k < msgs.length && (msgs[k].type !== "assistant" || msgs[k].time?.completed)) k++;
      c = { seq: k ? msgs[k - 1].seq : c?.seq ?? -1, state: fold(c?.state, msgs.slice(0, k)) };
      cache.set(sessionID, c);
      if (cache.size > 200) cache.delete(cache.keys().next().value);
      if (k === msgs.length) return c.state;
      const copy = { ...c.state, labels: new Map(c.state.labels), approval: c.state.approval && { ...c.state.approval } };
      return fold(copy, msgs.slice(k));
    } finally { db.close(); }
  } catch (err) {
    log(`${sessionID} history unreadable (${err.message}): treating the page as a publishing site`);
    return null;
  }
}

export function standing(host, now = Date.now()) {
  try {
    const a = JSON.parse(fs.readFileSync(APPROVALS, "utf-8"));
    return Object.entries(a).some(([d, until]) => until > now && (host === d || host.endsWith(`.${d}`)));
  } catch { return false; }
}

// One approval = one publishing action: 2026-11-17 live test, one "yes" let the Post click through three
// times (on LinkedIn: three identical posts). "yes, all" / "كلهم" approves a batch (several bids).
const BATCH = /\b(all|every|each|both|them)\b|كل|كلهم|الكل|جميع/i;
const used = new Map(); // approval key -> actions let through
const pending = new Map(); // tool call id -> approval key
const refunds = new Map(); // approval key -> failed tries given back
const MAX_REFUNDS = 3;
export function consume(key, text) {
  const n = used.get(key) || 0;
  if (n >= 1 && !BATCH.test(text)) return false;
  used.set(key, n + 1);
  if (used.size > 500) used.delete(used.keys().next().value);
  return true;
}

// A let-through action that failed published nothing, so the approval is given back for a corrected
// retry (2026-11-17: "Ref e4 not found in the current page snapshot" after a reload). Only the
// browser tool's own failure counts: an "Error"/"not found" in page text or console output after a
// click that worked must not refund it (that would allow a second post).
const CLICK_RAN = /### Ran Playwright code[\s\S]{0,400}?\.(click|dblclick|tap|press|check)\s*\(/;
export const FAILED = /^\s*### Error\b|\bError: Ref \S+ not found\b|\bElement (is )?not (found|visible|attached)\b|\bTimeout \d+ms exceeded\b/m;
export function settle(e) {
  const key = pending.get(e?.id);
  if (!key) return false;
  pending.delete(e.id);
  const text = e.status === "error" ? String(e.error?.message || e.error || "error")
    : (e.result?.content || []).map((c) => c?.text || "").join("\n") + String(e.result?.output || "");
  if (e.status === "error" || (FAILED.test(text) && !CLICK_RAN.test(text))) {
    // at most MAX_REFUNDS per approval (2026-11-18 live test: 14 failed tries on one "yes"); a "timeout"
    // that in fact clicked must not turn into an unbounded series of retries
    const r = (refunds.get(key) || 0) + 1;
    refunds.set(key, r);
    if (r > MAX_REFUNDS) { log(`${e.sessionID} the approved action failed again; ${MAX_REFUNDS} retries used, approval spent`); return false; }
    used.set(key, Math.max(0, (used.get(key) || 1) - 1));
    log(`${e.sessionID} the approved action failed, approval kept for a retry: ${text.slice(0, 120).replace(/\s+/g, " ")}`);
    return true;
  }
  return false;
}

export function heldMessage(found, host) {
  return `${HELD_MARK}, nothing was clicked: ${found.map((f) => `${f.what} (${f.why})`).join("; ")}${host && host !== UNKNOWN ? `, page: ${host}` : ""}.
Publishing, posting, sending or bidding needs the user's approval in chat first. Now: take a screenshot of the filled form, look at it with the see command, and show the user exactly what will be published (the full text, the price or recipient, the page), then ask "Shall I post it?" and end your turn. When they approve, repeat this same action. Do not try another way (keyboard, page script, coordinates, shell): those are held too. Do not tell the user it was published.`;
}

/** Decide for one tool call. Returns null (let it run) or {found, host, repeat?}. `state` = fold() of
 *  the session (tests pass it; the hook reads it from OpenCode's DB). */
export function decide(e, { state } = {}) {
  if (process.env.OPENCODE_NO_APPROVAL_GATE === "1") return null;
  const tool = String(e?.tool || "").toLowerCase();
  const input = e?.input || {};
  const shell = /^(shell|bash)$/.test(tool);
  const code = tool === "execute" ? String(input.code || "") : shell ? String(input.command || "") : "";
  if (!code) return null;
  if (shell ? !/ydotool|xdotool|wtype|desk\.sh|9222|devtools|cdp|playwright|puppeteer|selenium/i.test(code) : !commits(code).length) return null;
  const st = state === undefined ? sessionState(e.sessionID) : state;
  // a navigate earlier in this very script moves the page; any other url text does not
  const nav = [...code.matchAll(/(?:browser_navigate\s*\(\s*\{\s*url\s*:|navigate_page\s*\(\s*\{[^}]*?url\s*:|\.goto\s*\()\s*["'`](https?:\/\/[^"'`]+)/g)].at(-1);
  const host = nav ? hostOf(nav[1]) : st ? st.host || "" : UNKNOWN;
  const found = shell ? riskyShell(code, host) : risky(code, host, st?.labels || new Map());
  if (!found.length) return null;
  if (host !== UNKNOWN && standing(host)) { log(`${e.sessionID} allowed by standing approval for ${host}: ${found[0].what}`); return null; }
  if (st?.approval) {
    const key = `${e.sessionID}:${st.approval.id}`;
    if (consume(key, st.approval.text)) {
      if (e.id) pending.set(e.id, key);
      log(`${e.sessionID} allowed, user approved: ${found[0].what}`);
      return null;
    }
    log(`${e.sessionID} HELD repeat: the approval was already used once (${found[0].what})`);
    return { found, host, repeat: true };
  }
  return { found, host };
}

// The replacement never runs anything from the held call: the message goes into a quoted heredoc
// (2026-11-18 review: inside "…" bash still ran a held command's $(...) and the backticks around `see`).
export function replacement(tool, msg) {
  if (String(tool).toLowerCase() === "execute") return { code: `console.log(${JSON.stringify(msg)});` };
  return { command: `cat <<'OC_APPROVAL_GATE_EOF'\n${msg.replace(/^OC_APPROVAL_GATE_EOF$/gm, "")}\nOC_APPROVAL_GATE_EOF` };
}

const told = new Set();
export default {
  id: "approval-gate",
  async setup(ctx) {
    if (process.env.OPENCODE_NO_APPROVAL_GATE === "1") return;
    await ctx?.tool?.hook?.("execute.before", (e) => {
      try {
        const d = decide(e);
        if (!d) return e;
        const msg = d.repeat
          ? `${HELD_MARK}: the user's approval was for one action and it was already used in this turn: ${d.found[0].what}. Doing it again could publish twice. Check the page (snapshot or screenshot) to see whether the first one went through, report that to the user, and ask before any further publishing action.`
          : heldMessage(d.found, d.host);
        log(`${e.sessionID} HELD ${d.found.map((f) => `${f.what} (${f.why})`).join(" | ")}`);
        e.input = { ...e.input, ...replacement(e.tool, msg) };
        if (!told.has(e.sessionID)) {
          told.add(e.sessionID);
          try { execFile("notify-send", ["-a", "OpenCode", "Approval needed", `OpenCode wants to publish or send something${d.host && d.host !== UNKNOWN ? ` on ${d.host}` : ""}. Check the chat and reply yes to go ahead.`], () => {}); } catch {}
        }
      } catch (err) { log(`error: ${err.message}`); }
      return e;
    });
    await ctx?.tool?.hook?.("execute.after", (e) => { try { settle(e); } catch (err) { log(`error: ${err.message}`); } return e; });
  },
};
