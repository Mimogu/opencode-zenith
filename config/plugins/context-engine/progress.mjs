// Progress notes: keep the user informed while a top-level agent works, the way Claude Code does.
// Measured 2026-11-13 on the user's real sessions: final replies already followed AGENTS.md "Replying to
// the user", but the messages in between either narrated each step ("Let me check… Now let me read…",
// session "End4-pC dotfile setup": 30 updates in 61 calls, nearly all announcements) or went silent
// (session "Wuthering Waves Steam compatibility": 7–11 tool calls with no message). Prompt text alone
// did not change that, so the note goes where a weak model is sure to read it: the tool result.
// Notes depend only on the conversation up to that tool result, so earlier steps keep identical bytes.

import { resultText } from "./linkcheck.mjs";

const TAG = "[harness progress note";
export const SILENT_EVERY = Number(process.env.OPENCODE_SILENT_EVERY || 5); // a note after 5, 10, 15… steps with no message to the user (parallel calls in one step count once)

// An update that only announces the next action. Matches its first sentence.
const NARRATION = /^\s*(?:(?:ok(?:ay)?|alright|great|good|perfect|now|next|then|first|so)[,!.:]?\s+)*(?:let me|let's|i(?:'ll| will| am going to|'m going to| need to| want to)|i'm now|time to|going to)\b/i;
const firstSentence = (t) => String(t).trim().split(/(?<=[.!?:])\s|\n/)[0] || "";
export const isNarration = (t) => NARRATION.test(firstSentence(t));

const SILENT_NOTE = (n) => `${TAG} (harness, not the user)] The user has seen no message from you for the last ${n} steps. Before your next tool call, write 1 short sentence for them: what you found, then what you are doing next (e.g. "The bar waits on a 3 s timer; fixing that next."). Do not paste tool output, recap previous turns, or re-post old summaries.`;
const NARRATION_NOTE = `${TAG} (harness, not the user)] Your last updates only announced the next step ("Let me…", "Now I'll…"). The user follows your work through these messages, so start each one with what you found or changed, then the next step in a few words (1 sentence max). Skip an update that would only say what you are about to do, and never repeat previous turn recaps.`;

/** Copy of `messages` with a progress note appended to the tool results where the user has waited too
 *  long for news, or where the last two updates were only announcements. `userId` is the id (or index)
 *  of the user message that started this turn; earlier turns are left alone. */
export function addProgressNotes(messages, userId, { every = SILENT_EVERY } = {}) {
  if (!Array.isArray(messages)) return { messages, notes: 0 };
  let start = messages.findIndex((m, k) => m?.role === "user" && (m.id || String(k)) === userId);
  if (start < 0) start = messages.findLastIndex((m) => m?.role === "user");
  if (start < 0) return { messages, notes: 0 };

  const want = new Map(); // tool-call id -> note text
  let silent = 0, updates = 0, narrated = 0;
  for (const m of messages.slice(start + 1)) {
    if (m?.role !== "assistant" || !Array.isArray(m.content)) continue;
    const text = m.content.filter((p) => p?.type === "text" && p.text?.trim()).map((p) => p.text).join(" ");
    let freshNarration = false;
    if (text) {
      silent = 0;
      updates += 1;
      // the first message of a turn may announce the plan; after that, announcements alone count
      if (updates > 1 && isNarration(text)) { narrated += 1; freshNarration = narrated >= 2; }
      else narrated = 0;
    }
    const call = m.content.find((p) => p?.type === "tool-call" && p.id); // the note goes on this step's first result
    if (!call) continue;
    if (!text) silent += 1;
    if (silent > 0 && silent % every === 0) want.set(call.id, SILENT_NOTE(silent));
    else if (freshNarration) { want.set(call.id, NARRATION_NOTE); narrated = 0; }
  }
  if (!want.size) return { messages, notes: 0 };

  let notes = 0;
  const out = messages.map((m, k) => {
    if (k <= start || !Array.isArray(m?.content) || !m.content.some((p) => p?.type === "tool-result" && want.has(p.id))) return m;
    const copy = structuredClone(m);
    copy.content.forEach((part) => {
      if (part?.type !== "tool-result" || !want.has(part.id)) return;
      const rt = resultText(part);
      if (!rt || rt.text.includes(TAG)) return;
      rt.set(`${rt.text}\n\n${want.get(part.id)}`);
      notes += 1;
    });
    return copy;
  });
  return { messages: notes ? out : messages, notes };
}

// Appended to the user's message of every top-level turn: AGENTS.md says the same, but sits ~100 lines
// up; 2026-11-13 two live runs on Claude Sonnet (omni-code) both opened "Now I have the full picture.
// Here's the breakdown:" followed by --- dividers. Same text every turn, so the request prefix is stable.
export const REPLY_NOTE = `<system-reminder>
How to write your messages to the user (from the harness, not the user; do not mention it):
- While working: every few steps, 1–2 sentences that lead with what you found, then what is next ("The bar waits on a 3 s timer; fixing that next."), never "Let me…" alone.
- Final reply: the first sentence is the answer or the outcome itself (numbers, names, "Fixed: …"), never "Here's the report/breakdown/summary" or "Now I have the full picture". Short ## headings, bullets or a table, no --- dividers, no emojis; what the user must do goes last under its own heading.
</system-reminder>`;

export const CANCEL_REQUEST = /^\s*(?:ok\s+)?(?:stop|cancel|abort|never\s*mind|leave it|quit|exit|don'?t bother|forget it)\b/i;
export const CANCEL_REPLY_NOTE = `<system-reminder>
The user cancelled or asked to stop. Reply with 1 short sentence confirming the stop. Do not produce headings, lists, or status summaries.
</system-reminder>`;

export const _internal = { NARRATION, TAG };
