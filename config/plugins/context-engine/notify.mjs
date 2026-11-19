// Review status as a desktop notification, so the user knows whether the reply on screen is final.
// A reply is followed by quick checks (instant) and, for "done"/"fixed" replies and longer reports,
// an AI review that takes 10-120 s and may send the agent back for a corrected reply. Without a
// signal the user cannot tell whether another reply is coming (asked 2026-11-06). One notification
// per session, replaced in place (dunst stack tag): "Checking the reply..." -> "checked, final" or
// "correcting"; a reply that needs no review gets "final: no check needed", an error "check failed".
// Only for top-level sessions; never for subagents or the harness's own test runs.
//   OPENCODE_NO_REVIEW_NOTIFY=1  off
import { Database } from "bun:sqlite";
import { execFile } from "child_process";
import os from "os";
import path from "path";

const DB = process.env.OPENCODE_DB_PATH || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local/share"), "opencode/opencode.db");
// taskbench and the real-task runner put their sessions here
const QUIET_DIR = /\/pip-scratch\/opencode\/(taskbench|rt)(\/|$)/;

const TEXT = {
  checking: ["Checking the reply…", "An AI review is running. If it finds a problem, a corrected reply follows.", 120_000, "low"],
  ok: ["Reply checked: final", "The review found nothing to fix.", 8_000, "low"],
  fixing: ["Correcting the reply", "A check found a problem. OpenCode is working on a corrected reply; trust the newer one.", 15_000, "normal"],
  final: ["Checks finished", "OpenCode is sending its final answer, with anything it could not verify marked.", 10_000, "normal"],
  // every finished reply ends with one of these, so silence never has to be read as "final"
  none: ["Reply final: no check needed", "Quick checks passed; this reply does not need an AI review.", 6_000, "low"],
  unavailable: ["Not reviewed", "No AI reviewer answered, so this reply was only quick-checked. Read it with care.", 15_000, "normal"],
  error: ["Check failed", "The automatic check hit an error, so this reply is unchecked. Read it with care.", 15_000, "normal"],
};

function sessionInfo(sessionID) {
  try {
    const db = new Database(DB, { readonly: true });
    const s = db.query("SELECT parent_id, directory, title FROM session_v2 WHERE id = ?").get(sessionID);
    db.close();
    return s;
  } catch { return null; }
}

export function notifyReview(sessionID, kind, { log = () => {}, round } = {}) {
  if (process.env.OPENCODE_NO_REVIEW_NOTIFY === "1" || !TEXT[kind]) return;
  const s = sessionInfo(sessionID);
  if (!s || s.parent_id || QUIET_DIR.test(String(s.directory || ""))) return;
  const [title, body, ms, urgency] = TEXT[kind];
  const name = String(s.title || "").slice(0, 60);
  execFile("notify-send", ["-a", "OpenCode", "-u", urgency, "-t", String(ms), "-h", `string:x-dunst-stack-tag:opencode-${sessionID}`,
    `OpenCode: ${title}${round ? ` (round ${round})` : ""}`, name ? `${name}\n${body}` : body], (e) => { if (e) log(`notify: ${e.message}`); });
}

export const _internal = { QUIET_DIR, TEXT };
