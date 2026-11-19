// bun test tests/nudge_gate.test.mjs: two end-of-turn checkers never both send the agent back on one idle.
import { test, expect } from "bun:test";
import { begin, tryClaim } from "../plugins/context-engine/nudge-gate.mjs";

test("second checker on the same idle is refused; next idle is free again", async () => {
  const a = begin(), b = begin();
  expect(tryClaim("s1", "verify-claims", a).ok).toBe(true);
  const second = tryClaim("s1", "answer-check", b);
  expect(second.ok).toBe(false);
  expect(second.by).toBe("verify-claims");
  await new Promise((r) => setTimeout(r, 5));
  expect(tryClaim("s1", "answer-check", begin()).ok).toBe(true); // a later idle
  expect(tryClaim("s2", "answer-check", begin()).ok).toBe(true); // other session unaffected
});

test("the same checker may send again on a later idle", async () => {
  const t = begin();
  expect(tryClaim("s3", "verify-claims", t).ok).toBe(true);
  await new Promise((r) => setTimeout(r, 5));
  expect(tryClaim("s3", "verify-claims", begin()).ok).toBe(true);
});
