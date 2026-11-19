// context-engine: per-turn memory recall + automatic skill loading + catalog trim.
//
// One decision per user message (cached for every model step of that turn, so
// the system prefix stays stable within a turn and provider prompt caches hit).
//   OPENCODE_CONTEXT_ENGINE=0   disable entirely (the harness lab/sentinel set this)
//   OPENCODE_NO_SKILL_ROUTER=1  disable skill selection only
//   OPENCODE_NO_RECALL=1        disable memory recall only
//   OPENCODE_NO_PRUNE=1         disable request-time pruning of earlier turns
//   OPENCODE_NO_PLAYBOOKS=1     disable task checklists (playbooks.json)
//   OPENCODE_NO_LINKCHECK=1     disable the link check (linkcheck.mjs)
//   OPENCODE_NO_HINTS=1         disable hints on failed tool calls (toolhints.mjs)
//   OPENCODE_NO_GUARDS=1        disable loop-guard and untrusted-content notes (guards.mjs)
//   OPENCODE_NO_LESSONS=1       disable the learning loop (lessons.mjs): no learning, no injected lessons
//   OPENCODE_NO_PROGRESS=1      disable progress-update notes for top-level agents (progress.mjs)
//   OPENCODE_NO_ANSWER_CHECK=1  disable the end-of-turn answer check (answercheck.mjs)
//   OPENCODE_NO_VISION=1        disable image transcripts for attached images (vision.mjs)
//   OPENCODE_NO_MEDIA_CAP=1     disable the cap on inlined images (media.mjs)
//   OPENCODE_NO_STRONG_START=1  keep the ladder model for changes on the user's own machine
//   "#noskills" / "#nomem" / "#noimgread"   opt out for one prompt
import fs from "fs";
import { execFile } from "child_process";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
import { lastUserText, maskPaths } from "./router.mjs";
import { Recall, formatRecall, saveHint } from "./memory.mjs";
import { Skills, hintBlock, injectedNote, loadedSkills, compactCatalog, skillContent } from "./skills.mjs";
import { SkillFinder } from "./skill-finder.mjs";
import { warm, embedQuery, embedDocs } from "./embed.mjs";
import { prune, supersedeSystemCatalog } from "./prune.mjs";
import { capMedia } from "./media.mjs";
import { Playbooks, appendToUser } from "./playbooks.mjs";
import { LinkCheck } from "./linkcheck.mjs";
import { addHints } from "./toolhints.mjs";
import { addGuardNotes } from "./guards.mjs";
import { Lessons, CORRECTION, turnTranscript } from "./lessons.mjs";
import { addProgressNotes, REPLY_NOTE, CANCEL_REQUEST, CANCEL_REPLY_NOTE } from "./progress.mjs";
import { AnswerCheck } from "./answercheck.mjs";
import { begin as gateBegin, tryClaim, markDone } from "./nudge-gate.mjs";
import { strongModel, isStrong, isPinned, toModel, modelString } from "./strong-model.mjs";
import { appsIn } from "./apps.mjs";
import { Vision } from "./vision.mjs";
import { Browsers, browserSheet, browserServers } from "./browsers.mjs";
import { notifyReview } from "./notify.mjs";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOG = path.join(DIR, "context-engine.log");
const MEMORY_DB = path.join(os.homedir(), ".local/share/opencode/upgraded_memory/l2_memory.db");
// OpenCode's own store (sessions and messages), read-only here
const OPENCODE_DB = process.env.OPENCODE_DB_PATH || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local/share"), "opencode/opencode.db");
// vision only answers questions about images it is pointed at: skills, memory and checklists are noise
// there (2026-11-06: "poster.jpg" in its prompt loaded canvas-design into 58 frame checks)
const SKIP_AGENTS = new Set(["title", "summary", "compaction", "vision"]);
// OpenCode opens every subagent prompt with this line
// requests that only write text about the conversation: they need no images at all
const SUMMARY_AGENTS = new Set(["title", "summary", "compaction"]);
const SUBAGENT = /^\s*You are a subagent spawned by another session/;

function log(msg) {
  try {
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 1024 * 1024) {
      fs.writeFileSync(LOG, fs.readFileSync(LOG, "utf-8").split("\n").slice(-1000).join("\n"));
    }
    fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

// OPENCODE_CONTEXT_DUMP=<file>: append a size breakdown of each request (system blocks, tools,
// messages) as JSON lines, to see where the tokens go. Measurement only.
function dumpSizes(ev, file) {
  try {
    const len = (x) => (typeof x === "string" ? x.length : JSON.stringify(x ?? "").length);
    const tools = Array.isArray(ev.tools) ? ev.tools : ev.tools && typeof ev.tools === "object" ? Object.entries(ev.tools).map(([k, v]) => ({ name: k, ...v })) : [];
    fs.appendFileSync(file, JSON.stringify({
      at: new Date().toISOString(), agent: ev.agent,
      system: ev.system.map((b) => ({ chars: len(b?.text ?? b), head: String(b?.text ?? "").slice(0, 70), ...(process.env.OPENCODE_CONTEXT_DUMP_FULL ? { text: b?.text } : {}) })),
      tools: tools.map((t) => ({ name: t.name || t.id, chars: len(t) })),
      messages: (ev.messages || []).map((m) => ({ role: m.role, chars: len(m.content), ...(process.env.OPENCODE_CONTEXT_DUMP_FULL ? { m } : {}) })),
      keys: Object.keys(ev),
    }) + "\n");
  } catch {}
}

// ---- learning loop (lessons.mjs) helpers
const LEARN_QUIET_DIR = /\/pip-scratch\/opencode\/(taskbench|rt|hermesbench)(\/|$)/;
function envKey(name) {
  if (process.env[name]) return process.env[name];
  try { return ((fs.readFileSync(path.join(os.homedir(), ".config/opencode/free-models.env"), "utf-8").match(new RegExp(`^${name}=(.*)$`, "m")) || [])[1] || "").trim().replace(/^["']|["']$/g, ""); } catch { return ""; }
}
// the strongest reviewer route first (lessons steer later work, so a weak writer is worse than none),
// then NVIDIA direct with its own quota
const LEARN_MODELS = [
  { url: "http://127.0.0.1:20128/v1/chat/completions", key: "OMNIROUTE_API_KEY", model: "omni-review" },
  { url: "https://integrate.api.nvidia.com/v1/chat/completions", key: "NVIDIA_API_KEY", model: "nvidia/nemotron-3.5-super-vl-120b-a12b" },
];
async function learnChat(prompt) {
  let last = "";
  for (const m of LEARN_MODELS) {
    const key = envKey(m.key);
    if (!key) continue;
    try {
      const r = await fetch(m.url, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: m.model, max_tokens: 3000, temperature: 0, messages: [{ role: "user", content: prompt }] }), signal: AbortSignal.timeout(120_000) });
      if (!r.ok) { last = `${m.model} HTTP ${r.status}`; continue; }
      const text = String((await r.json())?.choices?.[0]?.message?.content || "");
      if (/\{[\s\S]*"rules"/.test(text)) return text;
      last = `${m.model}: no rules JSON`;
    } catch (e) { last = `${m.model}: ${e.message}`; }
  }
  throw new Error(last || "no model");
}
/** Rows of one session (oldest first) and its folder, read-only. */
function sessionRows(sessionID) {
  const { Database } = require("bun:sqlite");
  const db = new Database(OPENCODE_DB, { readonly: true });
  try {
    const s = db.query("SELECT parent_id, directory FROM session_v2 WHERE id = ?").get(sessionID) || {};
    const rows = db.query("SELECT seq, type, data FROM session_message WHERE session_id = ? ORDER BY seq").all(sessionID)
      .map((r) => { try { return { seq: r.seq, type: r.type, ...JSON.parse(r.data) }; } catch { return { seq: r.seq, type: r.type }; } });
    return { rows, parent: s.parent_id, dir: String(s.directory || "") };
  } finally { db.close(); }
}
/** The rows of the turn whose user message is `text` (the latest such): that message up to the next one.
 *  By text, not position: by the time it is read, newer turns may have started. */
function turnRows(rows, text) {
  const want = String(text || "").trim();
  const start = rows.findLastIndex((r) => r.type === "user" && String(r.text || "").trim() === want);
  if (start < 0) return [];
  const next = rows.findIndex((r, i) => i > start && r.type === "user");
  return rows.slice(start, next < 0 ? rows.length : next);
}

const COMPACTION_NOTE = [
  "# Summary requirements",
  "This summary also becomes long-term episodic memory. Keep, in short bullets: the objective; the user's stated preferences and decisions (with dates); files and commands changed; what was verified and how; root causes found; open problems and next steps. Drop chit-chat and tool noise.",
].join("\n");

function firstUserText(messages) {
  const m = messages.find((x) => x?.role === "user");
  if (!m) return "";
  if (typeof m.content === "string") return m.content;
  return Array.isArray(m.content) ? m.content.filter((p) => p?.type === "text").map((p) => p.text).join("\n") : "";
}

function toolCallsThisTurn(messages, userId) {
  if (!Array.isArray(messages)) return 0;
  let start = messages.findIndex((m, k) => m?.role === "user" && (m.id || String(k)) === userId);
  if (start < 0) start = messages.findLastIndex((m) => m?.role === "user");
  let n = 0;
  for (const m of messages.slice(start + 1)) if (m?.role === "assistant" && Array.isArray(m.content)) n += m.content.filter((p) => p?.type === "tool-call").length;
  return n;
}

// The note's text only changes at the thresholds, so the request prefix stays stable between them.
function budgetNote(calls) {
  const step = calls >= 80 ? 80 : 40;
  return `<system-reminder>\nStep budget (from the harness, not the user): this turn has used over ${step} tool calls. If you have a fix, apply it, verify it the way the user will use it, and send your final reply now. Keep digging only if you are truly blocked, and then say in the reply what you could not find out.\n</system-reminder>`;
}

/** A change request that names an installed app is a change to the user's own machine. */
// Desktop plumbing has no .desktop entry to be found by: 2026-11-11 "setup for me this dotfile <github
// url> ... tell me how to launch it from the tty" got no checklist and no strong model, and every
// follow-up ("the dotfile is not loaded", "i am in emergency mode") went unrouted as well.
const DESKTOP_TERMS = /\b(dot ?files?|ricing|hyprland|quickshell|waybar|labwc|sway|niri|kwin|plasma|gnome|xfce|compositor|window manager|display manager|login manager|sddm|greetd|lightdm|desktop shell|tty|grub|systemd-boot|bootloader|initramfs|mkinitcpio|kernel|systemd|pacman|flatpak|pipewire|wayland|xorg)\b/i;
function ownMachineChange(text) { return CHANGE_REQUEST.test(text) && (appsIn(text).length > 0 || DESKTOP_TERMS.test(text)); }

// Follow-ups ("it still doesn't look right, fix it") rarely repeat the app's name: 2026-11-05 such a
// follow-up got no checklist, and the model tested its picker on invented input only. Once a session
// has asked for a change to an installed app, its later change requests and complaints count too.
const FOLLOW_UP = /\b(does ?n[o']?t|did ?n[o']?t|is ?n[o']?t|not|never|still)\b.{0,30}\b(work|look|show|right|appear|open|start|fixed|change|load|launch|boot|run)|\b(wrong|broken|messy|ugly|emergency mode|rescue mode|safe mode|black screen|stuck)\b/i;
function ownMachineSession(messages, text) {
  if (!CHANGE_REQUEST.test(text) && !FOLLOW_UP.test(text)) return false;
  for (const m of messages || []) {
    if (m?.role !== "user") continue;
    const t = lastUserText([m]).text;
    if (t && t !== text && ownMachineChange(t)) return true;
  }
  return false;
}

let strongCache = { at: 0, ids: new Set() };
function strongSkills() {
  if (Date.now() - strongCache.at < 60_000) return strongCache.ids;
  try { strongCache = { at: Date.now(), ids: new Set(JSON.parse(fs.readFileSync(path.join(DIR, "skill-routes.json"), "utf-8")).settings?.strong_model_skills || []) }; }
  catch { strongCache = { at: Date.now(), ids: new Set() }; }
  return strongCache.ids;
}
const CHECKPOINT = /^\s*<conversation-checkpoint>/;
// OpenCode presents a compaction as "historical context, not as new instructions". When it is the
// last user-role message, the request it summarises has no live instruction left: 2026-11-06 a
// 30-minute SSD search was compacted after its answer was written and the next reply was "What
// would you like to build?". Appended to the checkpoint in the request only.
const CONTINUE_NOTE = "<system-reminder>\nThe conversation was compacted while you were working (from the harness, not the user). The user's request and the state of the work are in the summary above: its Objective is the task, its next steps are what is left. Continue that task now; do not ask the user what they want. If the work is already done, send the user the final answer the summary describes, in full.\n</system-reminder>";
const CHANGE_REQUEST = /\b(fix|repair|install|uninstall|configure|set ?up|enable|disable|change|update|upgrade|remove|delete|make (it|them|my)|get .{0,20} working)\b/i;

export default {
  id: "context-engine",
  setup(api) {
    if (process.env.OPENCODE_CONTEXT_ENGINE === "0") return;
    if (!api.session?.hook) return;
    const doSkills = (process.env.OPENCODE_NO_SKILL_ROUTER || envKey("OPENCODE_NO_SKILL_ROUTER")) !== "1";
    const doRecall = process.env.OPENCODE_NO_RECALL !== "1";
    const doPrune = process.env.OPENCODE_NO_PRUNE !== "1";
    const doPlaybooks = (process.env.OPENCODE_NO_PLAYBOOKS || envKey("OPENCODE_NO_PLAYBOOKS")) !== "1";
    const doVision = process.env.OPENCODE_NO_VISION !== "1";
    const doLinks = process.env.OPENCODE_NO_LINKCHECK !== "1";
    const doHints = process.env.OPENCODE_NO_HINTS !== "1";
    const doProgress = process.env.OPENCODE_NO_PROGRESS !== "1";
    const doAnswerCheck = process.env.OPENCODE_NO_ANSWER_CHECK !== "1";
    const doMedia = process.env.OPENCODE_NO_MEDIA_CAP !== "1";
    const mediaSeen = new Map(); // sessionID -> last logged "dropped/level", so the log has one line per change
    // Runs for every agent, compaction included: 2026-11-10 a session with 64 page images could neither
    // continue nor compact ("inlined media exceeds the 33554432 byte total limit" on both).
    function capImages(ev) {
      if (!doMedia || !Array.isArray(ev.messages)) return;
      try {
        const all = SUMMARY_AGENTS.has(ev.agent);
        const { messages, stats } = capMedia(ev.messages, { sessionID: ev.sessionID, all });
        if (!stats.dropped) return;
        ev.messages = messages;
        const mark = `${ev.agent}:${stats.dropped}/${stats.level}`;
        if (mediaSeen.get(ev.sessionID) === mark) return;
        mediaSeen.set(ev.sessionID, mark);
        if (mediaSeen.size > 300) mediaSeen.delete(mediaSeen.keys().next().value);
        log(`${ev.sessionID} media: ${stats.images} images, ${(stats.bytes / 1048576).toFixed(1)} MB inlined; ${all ? `all left out of the ${ev.agent} request` : `${stats.dropped} oldest replaced by notes (${(stats.saved / 1048576).toFixed(1)} MB${stats.level ? `, budget level ${stats.level}` : ""})`}`);
      } catch (e) { log(`media cap error: ${e.message}`); }
    }
    const links = new LinkCheck({ log });
    const vision = new Vision({
      seeBin: path.join(DIR, "bin/see"),
      cachePath: path.join(DIR, "state/vision-cache.json"),
      scratch: "/var/tmp/pip-scratch/opencode/vision",
      log,
    });
    const doLessons = process.env.OPENCODE_NO_LESSONS !== "1";
    const lessons = new Lessons({ file: path.join(DIR, "state/lessons.json"), log, chat: learnChat, embed: (texts) => embedDocs(texts, 20_000) });
    const turnScopes = new Map(); // sessionID -> { key, scopes } of its latest top-level turn
    const learnLater = (sessionID, delayMs, fn) => { const t = setTimeout(() => fn().catch((e) => log(`lessons: ${e.message}`)), delayMs); t.unref?.(); return t; };
    const finder = new SkillFinder({ dir: DIR, routesPath: path.join(DIR, "skill-routes.json"), statePath: path.join(DIR, "state/skill-finder.json"), log });
    const browsers = new Browsers({ bin: path.join(DIR, "bin/browser-ctl"), log });
    if (process.env.OPENCODE_NO_BROWSER_TOOLS_REFRESH !== "1") {
      try { execFile(path.join(DIR, "bin/browser-tools"), { timeout: 300_000 }, (err, out) => { if (out?.trim()) log(`browser-tools: ${out.trim()}`); }); } catch {}
    }
    const playbooks = new Playbooks(path.join(DIR, "playbooks.json"), path.join(DIR, "state/playbook-vectors.json"));

    const recall = new Recall(MEMORY_DB);
    const skills = new Skills({
      skillsDirs: [path.join(DIR, "skills"), path.join(os.homedir(), ".agents/skills")],
      routesPath: path.join(DIR, "skill-routes.json"),
      vectorCache: path.join(DIR, "state/skill-vectors.json"),
      examplesPath: path.join(DIR, "skill-examples.json"),
      learnedPath: path.join(DIR, "state/skill-learned.json"),
      neutralPath: path.join(DIR, "skill-neutral-prompts.json"),
    });
    warm();
    const tLoad = performance.now();
    try { skills.refresh(); } catch (e) { log(`skill index error: ${e.message}`); }
    try { recall.load(); } catch (e) { log(`memory load error: ${e.message}`); }
    try { playbooks.refresh(); } catch (e) { log(`playbooks error: ${e.message}`); }
    log(`setup: indexes loaded in ${Math.round(performance.now() - tLoad)}ms`);

    const decisions = new Map();

    const sessionDecision = new Map(); // sessionID -> decision for the latest real request (kept across compaction)
    const learnedCalls = new Set(); // skill tool-call ids already learned from

    // The agent loaded a skill the router did not inject: remember the prompt as an example.
    function learnFromSkillCalls(ev) {
      if (!Array.isArray(ev.messages)) return;
      let lastUser = "";
      for (const m of ev.messages) {
        if (m?.role === "user") { const t = lastUserText([m]).text; if (t) lastUser = t; continue; }
        if (m?.role !== "assistant" || !Array.isArray(m.content)) continue;
        for (const p of m.content) {
          if (p?.type !== "tool-call" || p.name !== "skill" || learnedCalls.has(p.id)) continue;
          learnedCalls.add(p.id);
          const id = p.input?.name || p.input?.id || p.input?.skill;
          if (id && lastUser && skills.learn(String(id), lastUser)) log(`learned: ${id} <- ${lastUser.slice(0, 80)}`);
        }
      }
      if (learnedCalls.size > 2000) learnedCalls.clear();
    }

    // Own-machine changes and strong-model skills move to the strongest measured model; the switch applies
    // from the next step. 2026-11-05 a free model killed the user's Discord/Vesktop with kill -9 and then itself.
    async function strongStart(ev, notes, why) {
      if (process.env.OPENCODE_NO_STRONG_START === "1" || notes.some((n) => n.startsWith("strong-start"))) return;
      if (isPinned(ev.sessionID)) { notes.push(`strong-start(${why}):skipped, model pinned`); return; }
      const cur = modelString(ev.model);
      if (isStrong(cur)) return;
      const strong = strongModel(cur, { avoidCooling: true });
      if (!strong) { notes.push(`strong-start(${why}):skipped, every strong route is cooling`); return; }
      try { await api.session.switchModel({ sessionID: ev.sessionID, model: toModel(strong) }); notes.push(`strong-start(${why}):${cur || "?"}->${strong}`); }
      catch (e) { log(`strong-start failed: ${e.message}`); }
    }

    async function decide(ev, text, id) {
      const t0 = performance.now();
      const blocks = [];
      const notes = [];
      const opts = { sessionID: ev.sessionID, agent: ev.agent };
      // one embedding per message, shared (via the cache) by skills and recall; timed separately
      if ((doSkills || doRecall) && !text.includes("#nomem")) await embedQuery(text).catch(() => null);
      const tEmbed = performance.now() - t0;
      const [sk, mem, pb, br] = await Promise.all([
        doSkills ? skills.select(text, { ...opts, loaded: loadedSkills(ev.messages) }).catch((e) => (log(`skills: ${e.message}`), null)) : null,
        doRecall && !text.includes("#nomem")
          ? recall.recall(text, { sessionID: ev.sessionID }).catch((e) => (log(`recall: ${e.message}`), null))
          : null,
        doPlaybooks ? playbooks.select(text, ev.agent, { force: ownMachineChange(text) || ownMachineSession(ev.messages, text) ? ["own-machine"] : [] }).catch((e) => (log(`playbooks: ${e.message}`), null)) : null,
        browsers.decide(maskPaths(text)).catch((e) => (log(`browsers: ${e.message}`), null)),
      ]);
      if (br) notes.push(`browser:${br.why}`);
      // A change on the user's own machine (fix/install/configure…) is where a weak model does damage:
      // 2026-11-05 a free model killed the user's Discord/Vesktop with kill -9 and then itself. Such
      // turns move to the strongest measured model; the switch applies from the next step, and the
      // first step of these tasks is a look around.
      if (ev.agent === "build" && pb?.ids?.includes("own-machine") && (CHANGE_REQUEST.test(text) || FOLLOW_UP.test(text))) {
        const named = appsIn(text);
        if (named.length) notes.push(`apps:${named.join(",")}`);
        await strongStart(ev, notes, "own-machine");
      }
      // The fast ladder head is fine for code but shallow where judgement matters: 2026-11-06 on
      // "1TB NVMe SSD for my laptop" it quoted search snippets and never checked that the laptop
      // has no M.2 slot (the slower model found it). Playbooks marked "strong" start strong.
      if (ev.agent === "build" && pb?.strong?.length) await strongStart(ev, notes, `pb:${pb.strong[0]}`);
      if (pb?.ids.length) notes.push(`pb:${pb.why.join(",")}`);
      if (mem) {
        const r = formatRecall(mem);
        if (r) blocks.push(r);
        notes.push(`mem:${mem.facts.map((f) => f.id).join(",") || "-"}/ep:${mem.episodes.length}${mem.semantic ? "" : "(kw)"}`);
      }
      const save = doRecall ? saveHint(text) : "";
      if (save) blocks.push(save);
      // nothing installed fits: look on skills.sh, install, and add it to this turn. In the background:
      // awaited, the lookup held up the first step 1-4 s on every such request (72 times by 2026-11-06,
      // mostly "no skill needed") and an install up to 90 s; a found skill joins from the next step.
      // Subagents never look: their task is a slice of the parent's, which already looked.
      if (sk && !sk.inject.length && !sk.hint.length && !text.includes("#noskills") && !SUBAGENT.test(text)) {
        finder.find(text, new Set(skills.meta.keys())).then((found) => {
          if (!found) return;
          try { skills.refresh(); } catch {}
          const m = skills.meta.get(found.id);
          if (!m) return;
          blocks.push(`# Skill installed\nNo installed skill covered this request, so \`${found.id}\` (from ${found.source} on skills.sh, ${found.installs} installs, security-scanned) was installed just now and is loaded below. Mention that in one line in your reply; the user can remove it with \`oc-skills remove ${found.id}\`.`,
            injectedNote([found.id]), skillContent({ id: found.id, dir: m.dir, body: m.body }));
          log(`${ev.sessionID} skill-finder: ${found.id} installed, added from the next step`);
        }).catch((e) => log(`skill-finder: ${e.message}`));
      }
      // Skills tuned for a strong model (skill-routes.json settings.strong_model_skills): 2026-11-06 a free
      // model given lemo-opuscar broke its rules (pip --break-system-packages, built inside the library)
      // and delivered a 20 s film of blank frames, reported as done.
      const strongSkill = sk?.inject.find((s) => strongSkills().has(s.id));
      if (ev.agent === "build" && strongSkill) await strongStart(ev, notes, `skill:${strongSkill.id}`);
      if (sk) {
        if (sk.inject.length) blocks.push(injectedNote(sk.inject.map((s) => s.id)), ...sk.inject.map((s) => s.content));
        const h = hintBlock(sk.hint);
        if (h) blocks.push(h);
        if (sk.inject.length || sk.hint.length) {
          notes.push(`skills:${sk.inject.map((s) => `+${s.id}(${s.why})`).concat(sk.hint.map((s) => `?${s.id}(${s.why})`)).join(" ")}`);
        }
      }
      if (doLessons && !SUBAGENT.test(text)) {
        try {
          const scopes = [...(pb?.ids || []).map((x) => `pb:${x}`), ...(sk?.inject || []).map((x) => `skill:${x.id}`)];
          const prev = turnScopes.get(ev.sessionID);
          // the user corrects the previous turn: learn from it (after this turn starts, in the background)
          if (prev && prev.key !== `${ev.sessionID}:${id}` && CORRECTION.test(text)) {
            notes.push("lessons:correction");
            lessons.outcome(prev.key, "continue"); // the user had to correct it: the lessons it used count as wrong
            learnLater(ev.sessionID, 20_000, async () => {
              const { rows, parent, dir } = sessionRows(ev.sessionID);
              if (parent || LEARN_QUIET_DIR.test(dir)) return;
              const turn = turnRows(rows, prev.text);
              if (turn.length) await lessons.learn({ key: `${prev.key}:corrected`, turn: turnTranscript(turn, { correction: text }), scopes: prev.scopes, source: ev.sessionID });
            });
          }
          const key = `${ev.sessionID}:${id}`;
          turnScopes.set(ev.sessionID, { key, scopes, text });
          if (turnScopes.size > 300) turnScopes.delete(turnScopes.keys().next().value);
          const sel = lessons.select({ scopes, text, turnKey: key });
          if (sel) { blocks.push(sel.block); notes.push(`lessons:${sel.ids.join(",")}`); }
        } catch (e) { log(`lessons: ${e.message}`); }
      }
      const total = performance.now() - t0;
      log(`${ev.agent || "-"} ${ev.sessionID} ${Math.round(total)}ms (embed ${Math.round(tEmbed)} rest ${Math.round(total - tEmbed)}) ${notes.join(" ") || "nothing"} | ${text.slice(0, 90).replace(/\s+/g, " ")}`);
      // no browser named: the headless default (playwright) is the one in use, so its exact tool list goes along
      // a browser *server* named in the request ("using camofox", "with chrome-devtools") gets its own list:
      // 2026-11-18 "using camofox, open youtube…" opened tabs in playwright three times
      const named = !br ? browserServers().find((s) => new RegExp(`(?<![\\w-])${s}(?![\\w-])`, "i").test(text)) : "";
      const headless = named ? browserSheet(named) : !br && pb?.ids?.includes("browser-task") ? browserSheet("playwright") : "";
      const brNote = br ? `<system-reminder>\nBrowser choice (from the harness, not the user; do not mention it):\n${br.text}\n</system-reminder>`
        : headless ? `<system-reminder>\nBrowser tools (from the harness, not the user; do not mention it): ${named ? `the user asked for \`${named}\`: use only its tools.` : "use the headless `playwright` server unless the page needs a login (`browser-profile`) or blocks bots (`camofox`)."}\n${headless}\n</system-reminder>` : "";
      return { blocks, reminder: [pb?.text, brNote].filter(Boolean).join("\n"), fix: !!pb?.ids?.includes("own-machine") };
    }

    api.session.hook("context", async (ev) => {
      try {
        if (!Array.isArray(ev.system) || SKIP_AGENTS.has(ev.agent)) capImages(ev);
        if (!Array.isArray(ev.system)) return;
        for (const s of ev.system) {
          if (s && typeof s.text === "string" && s.text.includes("<available_skills>")) s.text = compactCatalog(s.text);
        }
        if (SKIP_AGENTS.has(ev.agent)) {
          if (process.env.OPENCODE_CONTEXT_DUMP) dumpSizes(ev, process.env.OPENCODE_CONTEXT_DUMP);
          return;
        }
        if (doSkills) learnFromSkillCalls(ev);
        // before the text check: an image-only message still gets its transcript
        if (doVision) ev.messages = await vision.annotate(ev.messages);
        capImages(ev); // after the transcripts: an image that is cut keeps its transcript
        const { id, text } = lastUserText(ev.messages);
        if (!text) return;
        const key = `${ev.sessionID}:${id}`;
        let d = decisions.get(key);
        const first = !d;
        if (!d && CHECKPOINT.test(text)) {
          // OpenCode's compaction summary arrives user-role. 2026-11-05 it was routed as a new request:
          // chrome/teams/terminal "named" in the summary, a research checklist, unrelated skills. The task
          // is unchanged, so keep the decision made for the user's real request (none known: add nothing).
          d = sessionDecision.get(ev.sessionID) || { blocks: [] };
          decisions.set(key, d);
          log(`${ev.sessionID} compaction checkpoint: ${sessionDecision.has(ev.sessionID) ? "kept the last request's context" : "no earlier request seen"}`);
        }
        if (!d) {
          d = await decide(ev, text, id);
          decisions.set(key, d);
          if (decisions.size > 500) decisions.delete(decisions.keys().next().value);
        }
        sessionDecision.set(ev.sessionID, d);
        if (sessionDecision.size > 200) sessionDecision.delete(sessionDecision.keys().next().value);
        for (const b of d.blocks) ev.system.push({ type: "text", text: b });
        if (doPrune && Array.isArray(ev.messages)) {
          const { messages, stats } = prune(ev.messages);
          if (messages !== ev.messages && stats.saved) {
            ev.messages = messages;
            if (first || process.env.OPENCODE_CONTEXT_DUMP) log(`${ev.sessionID} pruned ~${Math.round(stats.saved / 4)} tok (reasoning ${stats.reasoning}, dedup ${stats.deduped}, aged ${stats.aged}, notices ${stats.notices})`);
          }
        }
        if (doLinks && Array.isArray(ev.messages)) {
          try {
            links.learn(ev.messages);
            await links.probe(ev.messages);
            const r = links.annotate(ev.messages);
            if (r.notes) { ev.messages = r.messages; log(`${ev.sessionID} linkcheck: flagged links in ${r.notes} tool result(s)`); }
          } catch (e) { log(`linkcheck: ${e.message}`); }
        }
        if (doHints && Array.isArray(ev.messages)) {
          try {
            const h = addHints(ev.messages);
            if (h.hints) ev.messages = h.messages;
          } catch (e) { log(`toolhints: ${e.message}`); }
        }
        if (process.env.OPENCODE_NO_GUARDS !== "1" && Array.isArray(ev.messages)) {
          try {
            const g = addGuardNotes(ev.messages);
            if (g.loops || g.injections) { ev.messages = g.messages; if (g.loops) log(`${ev.sessionID} loop-guard: ${g.loops} note(s)`); if (g.injections) log(`${ev.sessionID} injection-note: ${g.injections} tool result(s)`); }
          } catch (e) { log(`guards: ${e.message}`); }
        }
        // only agents talking to the user: a subagent's "progress" is read by another model
        if (doProgress && Array.isArray(ev.messages) && !SUBAGENT.test(firstUserText(ev.messages))) {
          try {
            const p = addProgressNotes(ev.messages, id);
            if (p.notes) { ev.messages = p.messages; log(`${ev.sessionID} progress: ${p.notes} note(s) in this turn`); }
            ev.messages = appendToUser(ev.messages, id, CANCEL_REQUEST.test(text) ? CANCEL_REPLY_NOTE : REPLY_NOTE);
          } catch (e) { log(`progress: ${e.message}`); }
        }
        if (d.reminder) ev.messages = appendToUser(ev.messages, id, d.reminder);
        if (CHECKPOINT.test(text)) ev.messages = appendToUser(ev.messages, id, CONTINUE_NOTE);
        // fixes on the user's machine drift into rabbit holes (2026-11-05: 130 calls, app source unpacked,
        // timed out with the fix already written): a short budget note at 40 and 80 calls. Only there:
        // producing something (a film, an app) legitimately takes hundreds of calls.
        const calls = d.fix ? toolCallsThisTurn(ev.messages, id) : 0;
        if (calls >= 40) ev.messages = appendToUser(ev.messages, id, budgetNote(calls));
        // "available skills have changed" notices carry the full catalog too: same one-line form
        if (Array.isArray(ev.messages) && ev.messages.some((m) => m?.role === "system" && JSON.stringify(m.content).includes("<available_skills>"))) {
          ev.messages = ev.messages.map((m) => (m?.role === "system" && Array.isArray(m.content)
            ? { ...m, content: m.content.map((p) => (p?.type === "text" && p.text.includes("<available_skills>") ? { ...p, text: compactCatalog(p.text) } : p)) }
            : m));
        }
        if (doPrune) supersedeSystemCatalog(ev.system, ev.messages);
        if (process.env.OPENCODE_CONTEXT_DUMP) dumpSizes(ev, process.env.OPENCODE_CONTEXT_DUMP); // what is actually sent
      } catch (e) {
        log(`context hook error: ${e.stack || e.message}`);
      }
    });

    // end of a top-level turn: verify what can be verified mechanically, send back once if wrong
    if (doAnswerCheck) log(`answer-check: ${typeof api.session.synthetic === "function" ? "on" : `off (no session.synthetic; session api: ${Object.keys(api.session || {}).join(",")})`}`);
    if (doAnswerCheck && typeof api.session.synthetic === "function") {
      const checker = new AnswerCheck({
        dbPath: OPENCODE_DB,
        links,
        log,
        synthetic: (input) => {
          const c = tryClaim(input.sessionID, "answer-check", input._startedAt ?? 0);
          if (!c.ok) { log(`answer-check ${input.sessionID}: ${c.by} already sent the agent back this turn; not sending a second nudge`); return; }
          const { _startedAt, ...rest } = input;
          notifyReview(input.sessionID, "fixing", { log });
          return api.session.synthetic(rest);
        },
      });
      api.session.hook("experimental.idle", async (ev) => {
        try {
          const startedAt = gateBegin();
          const r = await checker.onIdle(ev, startedAt);
          if (r === null && process.env.OPENCODE_ANSWER_CHECK_DEBUG) log(`answer-check ${ev?.sessionID}: skipped (${checker.lastSkip}) ev=${JSON.stringify(ev).slice(0, 120)}`);
        } catch (e) { log(`answer-check error: ${e.stack || e.message}`); }
        finally { if (ev?.sessionID) markDone(ev.sessionID, "answer-check"); }
      });
    }

    // end of a top-level turn: once the checks have settled (no new rows for 4 min), record how the turn
    // went for the lessons it used, and learn from it when a check had to send it back
    if (doLessons) {
      const settle = new Map(); // turn key -> timer (a later idle of the same turn restarts it; other turns keep theirs)
      api.session.hook("experimental.idle", async (ev) => {
        try {
          const sid = ev?.sessionID;
          const cur = sid && turnScopes.get(sid);
          if (!cur) return;
          clearTimeout(settle.get(cur.key));
          settle.set(cur.key, learnLater(sid, Number(process.env.OPENCODE_LESSONS_SETTLE_MS ?? 240_000), async () => {
            settle.delete(cur.key);
            const { rows, parent, dir } = sessionRows(sid);
            if (parent || LEARN_QUIET_DIR.test(dir)) return;
            const turn = turnRows(rows, cur.text);
            if (!turn.length || SUBAGENT.test(String(turn[0].text || ""))) return;
            const sentBack = turn.some((r) => r.type === "synthetic" && /verify-claims|answer-check/.test(String(r.metadata?.source || "")));
            lessons.outcome(cur.key, sentBack ? "continue" : "done");
            if (sentBack) await lessons.learn({ key: `${cur.key}:sent-back`, turn: turnTranscript(turn), scopes: cur.scopes, source: sid });
          }));
        } catch (e) { log(`lessons idle: ${e.message}`); }
      });
    }

    api.session.hook("compaction", async (ev) => {
      try {
        if (Array.isArray(ev.system)) ev.system.push({ type: "text", text: COMPACTION_NOTE });
        if (Array.isArray(ev.messages)) {
          const view = { sessionID: ev.sessionID, agent: "compaction", messages: ev.messages };
          capImages(view);
          ev.messages = view.messages;
        }
      } catch {}
    });
  },
};
export { ownMachineSession, ownMachineChange, CONTINUE_NOTE };
