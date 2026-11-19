// bun test tests/subagent_dedupe.test.mjs: a repeated identical subagent request with nothing changed is held.
import { test, expect } from "bun:test";
import gate, { decide } from "../plugins/subagent-dedupe/index.js";

const sub = (sid, prompt, agent = "vision") => ({ tool: "subagent", sessionID: sid, input: { agent, prompt, description: "Inspect slides" } });

test("the 2026-11-18 slides loop: the same vision request again with nothing changed is held", () => {
  expect(decide(sub("s1", "Inspect the 3 slide images for layout defects"))).toBeNull();
  expect(decide(sub("s1", "Inspect the 3 slide images  for layout defects"))).toContain("Not started again");
  expect(decide(sub("s1", "Inspect the 3 slide images for layout defects"))).toContain("Not started again");
});

test("a re-check after an edit or a shell command runs; a different request or session runs", () => {
  expect(decide(sub("s2", "Check the deck"))).toBeNull();
  decide({ tool: "edit", sessionID: "s2", input: { path: "/x/deck.js" } });
  expect(decide(sub("s2", "Check the deck"))).toBeNull();
  expect(decide(sub("s2", "Check the deck"))).not.toBeNull();
  decide({ tool: "shell", sessionID: "s2", input: { command: "node build.js" } });
  expect(decide(sub("s2", "Check the deck"))).toBeNull();
  expect(decide(sub("s2", "Check the title slide only"))).toBeNull();
  expect(decide(sub("s3", "Check the deck"))).toBeNull();
  expect(decide(sub("s2", "Check the deck", "explorer"))).toBeNull();
});

test("the hook turns a held call into an execute note", async () => {
  let hook;
  await gate.setup({ tool: { hook: (n, fn) => { if (n === "execute.before") hook = fn; } } });
  hook(sub("s4", "Look at /tmp/a.png"));
  const out = hook(sub("s4", "Look at /tmp/a.png"));
  expect(out.tool).toBe("execute");
  expect(out.input.code).toContain("Not started again");
});

test("review 2026-11-18: same long preamble but a different image or file runs; a failed call can be retried", async () => {
  const { settle } = await import("../plugins/subagent-dedupe/index.js");
  const pre = "You are checking slides. ".repeat(40);
  expect(decide(sub("s5", `${pre} Look at slide-1.jpg`))).toBeNull();
  expect(decide(sub("s5", `${pre} Look at slide-2.jpg`))).toBeNull();
  const call = { ...sub("s5", "Summarise the report"), id: "c1" };
  expect(decide(call)).toBeNull();
  settle({ sessionID: "s5", id: "c1", error: "subagent crashed" });
  expect(decide({ ...sub("s5", "Summarise the report"), id: "c2" })).toBeNull();
  expect(decide({ ...sub("s5", "Summarise the report"), id: "c3" })).not.toBeNull();
});
