import { test, expect } from "bun:test";
import { addProgressNotes, isNarration, SILENT_EVERY, CANCEL_REQUEST, CANCEL_REPLY_NOTE } from "../plugins/context-engine/progress.mjs";

const user = (text, id) => ({ role: "user", id, content: [{ type: "text", text }] });
let n = 0;
// one assistant step: optional text, then `calls` tool calls, each with its result
const step = (text, calls = 1) => {
  const ids = Array.from({ length: calls }, () => `c${++n}`);
  return [
    { role: "assistant", content: [...(text ? [{ type: "text", text }] : []), ...ids.map((id) => ({ type: "tool-call", id, name: "shell", input: { command: "true" } }))] },
    { role: "tool", content: ids.map((id) => ({ type: "tool-result", id, name: "shell", result: { type: "text", value: "ok" } })) },
  ];
};
const notesIn = (messages) => messages.flatMap((m) => (m.role === "tool" ? m.content : []))
  .map((p) => p.result.value).filter((v) => v.includes("[harness progress note"));

test("narration detection looks at the first sentence only", () => {
  expect(isNarration("Let me check the config.")).toBe(true);
  expect(isNarration("Now let me read the env file.")).toBe(true);
  expect(isNarration("Okay, I'll install it now.")).toBe(true);
  expect(isNarration("Sudo works. Now let me install Hyprland.")).toBe(false);
  expect(isNarration("Found it: the bar waits on a 3 s timer. Let me fix that.")).toBe(false);
  expect(isNarration("Hyprland installed; next the shell config.")).toBe(false);
});

test(`a note after ${SILENT_EVERY} silent steps, and again after ${SILENT_EVERY * 2}`, () => {
  const msgs = [user("fix my bar", "u1"), ...step("Checking the bar config first."), ...Array.from({ length: 10 }, () => step("")).flat()];
  const r = addProgressNotes(msgs, "u1");
  expect(r.notes).toBe(2);
  expect(notesIn(r.messages)[0]).toContain(`last ${SILENT_EVERY} steps`);
  expect(notesIn(r.messages)[1]).toContain(`last ${SILENT_EVERY * 2} steps`);
  expect(notesIn(msgs).length).toBe(0); // input untouched
});

test("an update resets the silence count", () => {
  const msgs = [user("go", "u1"), ...step("Plan: check, fix, test."), ...step("", 3), ...step("The timer is the cause; fixing it."), ...step("", 3)];
  expect(addProgressNotes(msgs, "u1").notes).toBe(0);
});

test("two announcement-only updates in a row get one note; the opening plan does not count", () => {
  const msgs = [user("go", "u1"), ...step("I'll start by looking at the config."), ...step("Let me read the env file."), ...step("Now let me check the logs.")];
  const r = addProgressNotes(msgs, "u1");
  expect(r.notes).toBe(1);
  expect(notesIn(r.messages)[0]).toContain("only announced the next step");
  const good = [user("go", "u1"), ...step("I'll start by looking at the config."), ...step("The env file sets the wrong path. Let me fix it."), ...step("Fixed; now testing.")];
  expect(addProgressNotes(good, "u1").notes).toBe(0);
});

test("earlier turns are left alone and notes are stable from step to step", () => {
  const old = [user("old task", "u0"), ...Array.from({ length: 12 }, () => step("")).flat(), { role: "assistant", content: [{ type: "text", text: "Done." }] }];
  const now = [user("new task", "u1"), ...Array.from({ length: 6 }, () => step("")).flat()];
  const r1 = addProgressNotes([...old, ...now], "u1");
  expect(r1.notes).toBe(1);
  // the next step adds one more call: the note already given stays byte-identical
  const r2 = addProgressNotes([...old, ...now, ...step("")], "u1");
  expect(JSON.stringify(r2.messages.slice(0, -2))).toBe(JSON.stringify(r1.messages));
});

test("parallel calls in one step count as one step", () => {
  const msgs = [user("go", "u1"), ...step("Checking five logs at once."), ...step("", 5), ...step("", 4)];
  expect(addProgressNotes(msgs, "u1").notes).toBe(0);
});

test("a result that already carries a note is not noted twice", () => {
  const msgs = [user("go", "u1"), ...Array.from({ length: 5 }, () => step("")).flat()];
  const once = addProgressNotes(msgs, "u1").messages;
  expect(addProgressNotes(once, "u1").notes).toBe(0);
});

test("cancellation requests get short confirmation note", () => {
  expect(CANCEL_REQUEST.test("ok stop")).toBe(true);
  expect(CANCEL_REQUEST.test("cancel")).toBe(true);
  expect(CANCEL_REQUEST.test("never mind")).toBe(true);
  expect(CANCEL_REQUEST.test("leave it")).toBe(true);
  expect(CANCEL_REQUEST.test("stop the process")).toBe(true);
  expect(CANCEL_REQUEST.test("fix the bug")).toBe(false);
  expect(CANCEL_REPLY_NOTE).toContain("Reply with 1 short sentence confirming the stop");
});
