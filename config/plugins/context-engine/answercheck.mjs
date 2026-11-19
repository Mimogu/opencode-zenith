// Answer check: when a top-level session goes idle, check the final answer for claims the
// harness can verify mechanically, and send the agent back once to fix what is wrong.
// (OpenCode's own /goal feature uses the same hook + session.synthetic to keep a session going.)
//
// Checks (no model judgement, so no false "the model thinks it is fine"):
//   1. links: every shop/product URL in the answer is opened (LinkCheck, 8 s, cached); a page
//      that does not exist is reported. 2026-11-04: a free model's top pick was an Amazon link
//      it had invented, "verified in stock".
//   2. tests: the answer says tests/build/type checks pass, but no test or build command ran
//      in this turn (shell, or a subagent that reports running them).
//   4. config: a config file of the user's machine was written (Hyprland, sway, systemd unit, fish,
//      JSON…) and the program's own checker never ran afterwards (validators.mjs).
//   5. access: the answer says the agent cannot reach the user's machine or screen, while it has a
//      shell on that very machine. Both 2026-11-11, the end4-pC dotfile session.
//   3. length: the user asked for a short answer ("keep it short", "in one sentence") and got a
//      long one. 2026-11-06: "newest bun version? keep it short" got 300+ words three runs in a row.
// At most one round per user message, never for subagents or background sessions.

import { Database } from "bun:sqlite";
import { LinkCheck, urlsIn, worthChecking } from "./linkcheck.mjs";
import { shellWrites, validatorFor } from "./validators.mjs";

const AGENTS = new Set(["build", "quick", "plan", "local"]);
const MAX_URLS = 10;
const SOURCE = "answer-check";

const TEST_CLAIM = /\b(?:all\s+)?(?:\d+\s+)?(?:unit\s+|integration\s+|e2e\s+)?tests?\s+(?:now\s+|still\s+)?(?:pass(?:es|ed|ing)?|are\s+(?:green|passing))\b|\b(?:the\s+)?build\s+(?:now\s+)?(?:succeeds|succeeded|passes|passed|is\s+green)\b|\b(?:type[- ]?checks?|lint(?:er|ing)?)\s+(?:now\s+)?(?:pass(?:es|ed)?|(?:is|are)\s+clean)\b/i;
const TEST_CMD = /\b(?:pytest|py\.test|unittest|jest|vitest|mocha|bun\s+test|node\s+--test|deno\s+test|(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:test|build|lint|typecheck|check)|cargo\s+(?:test|build|check|clippy)|go\s+(?:test|build|vet)|make\b|ctest|cmake\s+--build|ninja|tsc\b|mypy|pyright|ruff|eslint|flake8|gradle|mvn|dotnet\s+(?:test|build)|swift\s+(?:test|build)|zig\s+build|godot\S*\s+.*--headless|python3?\s+\S*test\S*|python3?\s+-m\s+(?:pytest|unittest|py_compile|compileall)|php\s*unit|rspec|bundle\s+exec)/i;

const SAYS_DEAD = /\b(404|410|dead|does(?:n['’]t| not) exist|not found|broken|no longer (?:exists|available)|removed|invalid link)\b/i;
const NEGATED = /\b(not|n['’]t|never|unable|without|unverified|could not|cannot|can['’]t|haven['’]t|didn['’]t|whether|if)\b[^.!?\n]*$/i;

function around(text, needle, n) {
  const i = text.indexOf(needle);
  return i < 0 ? "" : text.slice(Math.max(0, i - n), i + needle.length + n);
}

export class AnswerCheck {
  constructor({ dbPath, links = new LinkCheck(), log = () => {}, synthetic, agents = AGENTS } = {}) {
    this.dbPath = dbPath;
    this.links = links;
    this.log = log;
    this.synthetic = synthetic; // async ({ sessionID, text, metadata }) => void
    this.agents = agents;
    this.done = new Set(); // `${sessionID}:${userSeq}` already checked
  }

  /** Read the turn that just ended: the rows after the last user message. */
  turn(sessionID) {
    const db = new Database(this.dbPath, { readonly: true });
    try {
      const s = db.query("SELECT parent_id FROM session_v2 WHERE id = ?").get(sessionID);
      if (!s || s.parent_id) return null; // unknown, or a subagent: the parent's linkcheck covers it
      const rows = db.query("SELECT seq, type, data FROM session_message WHERE session_id = ? ORDER BY seq").all(sessionID);
      let start = -1;
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].type === "user") { start = i; break; }
      if (start < 0) return null;
      const after = rows.slice(start + 1).map((r) => ({ ...r, data: safeJson(r.data) }));
      return { userSeq: rows[start].seq, rows: after, request: String(safeJson(rows[start].data)?.text || "") };
    } finally {
      db.close();
    }
  }

  skip(why) { this.lastSkip = why; return null; }

  async onIdle(ev, startedAt = this.startedAt) {
    if (!ev?.sessionID) return this.skip("no sessionID");
    // `background` is the list of background shells still running (an empty list is falsy only
    // in Python): with work still running, the turn is not finished yet
    const bg = Array.isArray(ev.background) ? ev.background.length > 0 : !!ev.background;
    if (bg) return this.skip("background work still running");
    let t;
    try { t = this.turn(ev.sessionID); } catch (e) { this.log(`answer-check: read failed: ${e.message}`); return this.skip("read failed"); }
    if (!t) return this.skip("no turn, or a subagent");
    const key = `${ev.sessionID}:${t.userSeq}`;
    if (this.done.has(key)) return this.skip("already checked");
    // one round per user message: our own reminder already went in this turn
    if (t.rows.some((r) => r.type === "synthetic" && r.data?.metadata?.source === SOURCE)) return this.skip("already sent back once");
    const assistants = t.rows.filter((r) => r.type === "assistant" && r.data);
    const last = assistants.at(-1);
    if (!last) return this.skip("no answer yet");
    if (!this.agents.has(last.data.agent)) return this.skip(`agent ${last.data.agent}`);
    const answer = (last.data.content || []).filter((p) => p?.type === "text").map((p) => p.text || "").join("\n").trim();
    if (!answer) return this.skip("empty answer");
    this.done.add(key);
    if (this.done.size > 2000) this.done.delete(this.done.values().next().value);

    const tools = assistants.flatMap((r) => (r.data.content || []).filter((p) => p?.type === "tool"));
    const issues = [...(await this.linkIssues(answer)), ...this.testIssues(answer, tools), ...lengthIssues(t.request, answer), ...memoryIssues(t.request, answer, tools),
      ...configIssues(tools), ...accessIssues(answer, tools), ...unfinishedIssues(answer)];
    if (!issues.length) {
      this.log(`answer-check ${ev.sessionID}: ok`);
      return { issues };
    }
    const text = [
      "<system-reminder>",
      "Answer check (automatic, from the harness, not the user). Your last answer has problems the user would run into:",
      ...issues.map((i) => `- ${i}`),
      "Fix them now: check what is needed, then give the corrected answer in full (the user reads your final message). If a recommendation or claim changes, start with one line saying what you corrected. If a point above is a false alarm, say why in one line and keep the rest of the answer.",
      "</system-reminder>",
    ].join("\n");
    this.log(`answer-check ${ev.sessionID}: ${issues.length} issue(s) -> sent back: ${issues.map((i) => i.slice(0, 80)).join(" | ")}`);
    if (this.synthetic) {
      try {
        await this.synthetic({ sessionID: ev.sessionID, text, metadata: { source: SOURCE }, _startedAt: startedAt ?? 0 }); // per call: concurrent idles of other sessions must not overwrite it
      } catch (e) {
        this.log(`answer-check: synthetic failed: ${e.message}`);
      }
    }
    return { issues, text };
  }

  async linkIssues(answer) {
    // URLs in code are examples or API endpoints, not links offered to the user
    const prose = answer.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");
    const urls = urlsIn(prose).filter(worthChecking).slice(0, MAX_URLS);
    const todo = urls.filter((u) => !this.links.get(u) || this.links.get(u).status === "blocked" && !this.links.get(u).probed);
    await Promise.all(todo.map((u) => this.links.open(u)));
    return urls
      .filter((u) => this.links.get(u)?.status === "dead")
      .filter((u) => !SAYS_DEAD.test(around(prose, u, 160))) // the answer already says it is dead
      .map((u) => `${u} does not exist (HTTP ${this.links.get(u).code} when opened just now). Remove it, or find the real page and open it before giving it.`);
  }

  testIssues(answer, tools) {
    // only a positive claim counts: "I could not confirm the tests pass" is the honest answer
    const claims = [...answer.matchAll(new RegExp(TEST_CLAIM.source, "gi"))]
      .filter((m) => !NEGATED.test(answer.slice(Math.max(0, m.index - 60), m.index)))
      // someone else's tests ("234/271 of its tests passing", "the release notes say all tests pass"):
      // a report of what a source says, not a claim about this work (2026-11-06 Bun release question)
      .filter((m) => !OTHERS.test(answer.slice(Math.max(0, m.index - 40), m.index)) && !ATTRIBUTED.test(sentenceAt(answer, m.index)));
    if (!claims.length) return [];
    const ran = tools.some((p) => {
      const input = p.state?.input || {};
      if (/^(shell|bash)$/.test(p.name || "")) return TEST_CMD.test(String(input.command || ""));
      if (p.name === "execute") return TEST_CMD.test(String(input.code || ""));
      if (p.name === "subagent" || p.name === "task") {
        const out = (p.state?.content || []).map((c) => c?.text || "").join("\n");
        return TEST_CMD.test(out) || TEST_CLAIM.test(out);
      }
      return false;
    });
    if (ran) return [];
    const said = claims[0][0];
    return [`You wrote "${said}", but no test, build or type-check command ran in this turn. Run it now and report the real result, or say it was not run.`];
  }
}

const OTHERS = /\b(its|their|upstream|[A-Z][\w.-]*'s)\s+(\w+\s+)?$|\b\d+\s*(\/|of)\s*\d+\s+(of\s+)?(its|their|the)?\s*$/;
const ATTRIBUTED = /\b(reports?|reported|say|says|said|according to|release notes|changelog|announce[sd]?|claims?)\b/i;
function sentenceAt(text, i) {
  const start = Math.max(text.lastIndexOf(". ", i), text.lastIndexOf("\n", i)) + 1;
  const ends = [text.indexOf(". ", i), text.indexOf("\n", i)].filter((x) => x >= 0);
  return text.slice(start, ends.length ? Math.min(...ends) : text.length);
}

// "remember that ..." answered with "noted / saved" while no memory write succeeded (2026-11-06: the
// call failed with "No tool named memory_add", the reply said "Acknowledged — noted")
const REMEMBER_REQ = /\b(remember (that|this|my)|from now on|keep in mind|save (this|that) (to|in) (your )?memory|note that)\b/i;
const SAVED_CLAIM = /\b(saved|noted|stored|remembered|i'?ll remember|i will remember|i'?ll keep (this|that|it) in mind|added (it |this )?to (my )?memory|got it)\b/i;
export function memoryIssues(request, answer, tools) {
  if (!REMEMBER_REQ.test(request) || !SAVED_CLAIM.test(answer) || NEGATED.test(answer.split(SAVED_CLAIM)[0].slice(-60))) return [];
  const wrote = tools.some((p) => {
    const st = p.state || {};
    if (st.status !== "completed") return false;
    const out = (st.content || []).map((c) => c?.text || "").join("\n");
    if (/^memory_(add|supersede)$/.test(p.name || "")) return !/\b(error|refused|rejected)\b/i.test(out);
    return p.name === "execute" && /memory_(add|supersede)/.test(String(st.input?.code || "")) && !/\b(error|refused|rejected)\b/i.test(out.slice(0, 400));
  }) || tools.some((p) => /^(shell|bash)$/.test(p.name || "") && p.state?.status === "completed" && /\bmem\s+(add|supersede)\b/.test(String(p.state?.input?.command || "")));
  if (wrote) return [];
  return ["The user asked you to remember something and your answer says it was saved, but no memory write succeeded this turn. Save it now with `execute`: `await tools.memory.memory_add({ domain, title, content, origin: \"user-statement\", evidence: \"<their exact words>\" })`, check the result, and only then confirm."];
}

// asked for brevity -> word limit for the prose of the answer (code blocks not counted)
const BRIEF = [
  [/\b(in|with) (one|a single|1) (sentence|line|word)\b|\bone[- ]liner\b|\byes or no\b/i, 60],
  [/\b(keep it|make it|be) (short|brief|quick|concise)\b|\b(short|brief|quick|concise) (answer|reply|version|summary)\b|\bbriefly\b|\btl;?dr\b|\bin (a few|two|three|2|3) (sentences|lines|words)\b/i, 150],
];
export function lengthIssues(request, answer) {
  const limit = BRIEF.find(([re]) => re.test(request))?.[1];
  if (!limit) return [];
  const words = answer.replace(/```[\s\S]*?```/g, " ").split(/\s+/).filter((w) => /\w/.test(w)).length;
  if (words <= limit * 1.3) return [];
  return [`The user asked for a short answer, and yours is ${words} words. Keep only what answers the question (about ${limit} words or less): the direct answer, then the few points that matter most. No headings, no caveats they did not ask for.`];
}

/** Machine config files written this turn whose checker did not run after the last write to them. */
export function configIssues(tools) {
  const pending = new Map(); // file -> validator, cleared when its check runs later
  for (const p of tools) {
    const st = p.state || {};
    if (st.status && st.status !== "completed") continue;
    const input = st.input || {};
    const name = p.name || "";
    if (/^(shell|bash)$/.test(name)) {
      const cmd = String(input.command || "");
      for (const [f, v] of pending) if (v.ran.test(cmd)) pending.delete(f);
      for (const f of shellWrites(cmd, input.workdir)) { const v = validatorFor(f, input.workdir); if (v && !v.ran.test(cmd)) pending.set(v.file, v); }
    } else if (/^(write|edit|patch|multiedit)$/.test(name)) {
      const v = validatorFor(input.path ?? input.filePath ?? input.file_path, input.workdir);
      if (v) pending.set(v.file, v);
    }
  }
  return [...pending.values()].slice(0, 3).map((v) =>
    `You wrote \`${v.file}\` but never had the program check it. Run \`${v.cmd}\` now and fix every error it reports before saying it works. ${v.note} Anything in it you wrote from memory rather than from the installed docs or example config is a guess.`.replace(/\s+/g, " "));
}

// "I cannot access your machine": the shell tool runs on the machine the user is talking about
const NO_ACCESS = /\bI(?:'m| am)? (?:can(?:not|'t| not)|do(?:n't| not) have|unable to|not able to|have no)(?: \w+){0,4} (?:access|see|reach|view|look at|interact with|run (?:commands|anything) on|take (?:a )?screenshots? of)(?: \w+){0,3} (?:your|the user's) (?:\w+ ){0,3}(?:machine|system|computer|pc|laptop|device|screen|display|desktop|tty|terminal|session|emergency|files?|logs?)\b|\bI(?:'m| am) running in a (?:separate|different|remote|sandboxed) (?:session|environment|machine|sandbox)\b|\bnot (?:running )?on your (?:physical |actual |real )?(?:machine|system|computer)\b/i;
// A reply whose last sentence only announces the next step ended the turn without doing it: 2026-11-18
// a Firefox/YouTube session stopped on "The sp param isn't taking effect. Let me snapshot the filter
// chip bar to get the Shorts chip's UID for a proper click." Waiting for the user is a real stop.
const ANNOUNCE = /^(?:(?:ok(?:ay)?|alright|now|next|so|first|then)[,!.:]?\s+)*(?:let me|let's|i(?:'ll| will| am going to|'m going to| need to)|i'm now|time to|going to)\b/i;
const WAITS = /\blet me know\b|\bwait(ing)? for (you|your)\b|\b(your|the user's) (approval|answer|reply|choice|confirmation|go-ahead)\b|\bonce you\b|\bif you (want|like|'d like)\b|\bshall i\b|\bshould i\b|\?\s*$/i;
export function unfinishedIssues(answer) {
  const prose = String(answer || "").replace(/```[\s\S]*?```/g, " ").trim();
  const sentences = prose.split(/(?<=[.!?:])\s+|\n+/).map((x) => x.replace(/^[-*>#\s]+/, "").trim()).filter(Boolean);
  const last = sentences.at(-1) || "";
  if (!ANNOUNCE.test(last) || WAITS.test(last) || WAITS.test(sentences.slice(-2).join(" "))) return [];
  return [`Your reply ends by announcing a next step ("${last.slice(0, 120)}") but the turn ended without doing it, so the user is left with an unfinished task. Do that step now and carry on until the request is done; then reply with the result. If it truly needs the user, say exactly what and why instead of announcing a step.`];
}

export function accessIssues(answer, tools) {
  const prose = answer.replace(/```[\s\S]*?```/g, " ");
  const m = prose.match(NO_ACCESS);
  if (!m) return [];
  return [`You wrote "${m[0]}". That is wrong: your shell tool runs on the user's own machine, the one they are describing, as their user. Do the diagnosis yourself now: the previous boot is \`journalctl -b -1\`, programs keep their own logs, \`grim\` takes a screenshot of the running session, and the message the user quotes can be searched for (logs, the program's files) to find which program prints it. Ask the user only for what is on a screen you truly cannot reach, and then for its exact text.`];
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

export const _internal = { TEST_CLAIM, TEST_CMD };
