// bun test tests/failover.test.mjs: account-wide limits rest every model of that account at once
import { test, expect } from "bun:test";
import { accountLimit } from "../plugins/auto-failover/index.js";

const MODELS = ["openrouter/recursive/flint-v1.0:free", "omniroute/openrouter/nvidia/nemotron-3.5-super-vl:free", "opencode/glm-5.3-flash-free",
  "omniroute/agy/claude-sonnet-4-6", "omniroute/antigravity/claude-opus-4-6-thinking", "omniroute/antigravity/gemini-3.5-flash-lite",
  "omniroute/omni-code", "omniroute/omni-review", "omniroute/agnes/agnes-3.0-flash", "omniroute/omni-quick"];

test("OpenRouter daily free limit: every :free route until after 00:00 UTC (2026-11-06 stickman session)", () => {
  const a = accountLimit("Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day", MODELS, new Date("2026-11-06T20:00:00Z"));
  expect(a.models.sort()).toEqual(["omniroute/openrouter/nvidia/nemotron-3.5-super-vl:free", "openrouter/recursive/flint-v1.0:free"]);
  expect(a.seconds).toBe(4 * 3600 + 60);
});

test("Antigravity Claude quota out: only the Claude antigravity/agy routes rest, for the stated reset (2026-11-07)", () => {
  const a = accountLimit("[antigravity/claude-sonnet-4-6] All antigravity accounts have exhausted their quota (cached quota state, no upstream attempt; earliest reset reset after 8m 5s) (reset after 8m 5s)", MODELS);
  expect(a.seconds).toBe(8 * 60 + 5 + 15);
  expect(a.models.sort()).toEqual(["omniroute/agy/claude-sonnet-4-6", "omniroute/antigravity/claude-opus-4-6-thinking"]);
  // Gemini kept answering and the combos route around exhausted members
  expect(a.models).not.toContain("omniroute/antigravity/gemini-3.5-flash-lite");
  expect(a.models).not.toContain("omniroute/omni-code");
  expect(a.models).not.toContain("omniroute/omni-review");
});

test("Antigravity quota message without a model: every antigravity/agy route, still not the combos", () => {
  const a = accountLimit("All antigravity accounts have exhausted their quota (reset after 2m)", MODELS);
  expect(a.models.sort()).toEqual(["omniroute/agy/claude-sonnet-4-6", "omniroute/antigravity/claude-opus-4-6-thinking", "omniroute/antigravity/gemini-3.5-flash-lite"]);
});

test("an ordinary 429 is one model's problem", () => {
  expect(accountLimit("HTTP 429 Too Many Requests", MODELS)).toBeNull();
  expect(accountLimit("Rate limit exceeded", MODELS)).toBeNull();
});

test("the failover waits for a close reset instead of stopping, and never waits on a capped free model", async () => {
  const src = (await import("fs")).readFileSync(new URL("../plugins/auto-failover/index.js", import.meta.url), "utf-8");
  expect(src).toMatch(/soon\.s <= WAIT_FOR_RESET_S/);
  expect(src).toMatch(/isFreeCap && m\.startsWith\("opencode\/"\)/);
  expect(src).not.toMatch(/return candidates\[0\] \|\| currentModel/);
});

test("big inputs leave flint-40b-free for the next usable model of the same provider (2026-11-24 stall)", async () => {
  const { bigInputModel, BIG_INPUT_CHARS } = await import("../plugins/auto-failover/index.js");
  const chain = ["opencode/flint-40b-free", "opencode/iceman-free", "nvidia/nvidia/nemotron-3-ultra", "opencode/beam-free", "opencode/hy4-flash-free"];
  const meta = { "opencode/iceman-free": { context: 262144 }, "nvidia/nvidia/nemotron-3-ultra": { context: 1048576 },
    "opencode/beam-free": { context: 1048576 }, "opencode/hy4-flash-free": { context: 1048576 } };
  const big = BIG_INPUT_CHARS + 1;
  expect(bigInputModel("opencode/flint-40b-free", big, chain, new Set(), meta)).toBe("opencode/beam-free"); // iceman: 262k, too small
  expect(bigInputModel("opencode/flint-40b-free", big, chain, new Set(["opencode/beam-free"]), meta)).toBe("opencode/hy4-flash-free");
  expect(bigInputModel("opencode/flint-40b-free", 500, chain, new Set(), meta)).toBeNull();
  expect(bigInputModel("opencode/beam-free", big * 2, chain, new Set(), meta)).toBeNull();
  expect(bigInputModel("opencode/flint-40b-free", big, ["opencode/flint-40b-free", "opencode/iceman-free"], new Set(), meta)).toBeNull();
});

test("stall guard: empty-delta streams are ended, real output passes through untouched", async () => {
  const { watchStream, PROGRESS } = await import("../plugins/auto-failover/index.js");
  const enc = new TextEncoder();
  const keepalive = 'data: {"choices":[{"delta":{"reasoning_content":""}}]}\n\n';
  const real = 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n';
  expect(PROGRESS.test(keepalive)).toBe(false);
  expect(PROGRESS.test(real)).toBe(true);
  expect(PROGRESS.test('data: {"choices":[{"delta":{"tool_calls":[{"id":"c1"}]}}]}')).toBe(true);
  expect(PROGRESS.test("data: [DONE]")).toBe(true);
  // a stream that only ever sends empty deltas
  const endless = (chunk) => new ReadableStream({ async pull(c) { await new Promise((r) => setTimeout(r, 10)); c.enqueue(enc.encode(chunk)); } });
  let stalled = false;
  const s = watchStream(endless(keepalive), { stallMs: 120, tickMs: 20, onStall: () => { stalled = true; } });
  let err = null;
  try { const rd = s.getReader(); for (;;) { const { done } = await rd.read(); if (done) break; } } catch (e) { err = e; }
  expect(stalled).toBe(true);
  expect(String(err?.message)).toContain("stream idle timeout");
  // real output keeps it alive and every byte arrives unchanged
  const parts = [real, real, "data: [DONE]\n\n"];
  const fin = new ReadableStream({ async pull(c) { await new Promise((r) => setTimeout(r, 60)); const p = parts.shift(); p ? c.enqueue(enc.encode(p)) : c.close(); } });
  const out = await new Response(watchStream(fin, { stallMs: 100, tickMs: 20 })).text();
  expect(out).toBe(real + real + "data: [DONE]\n\n");
});
