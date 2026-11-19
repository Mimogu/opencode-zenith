import { test, expect } from "bun:test";
import { capMedia, mediaInfo, tighten, levelOf, MEDIA_LIMIT } from "../plugins/context-engine/media.mjs";
import { classify, mayCompact } from "../plugins/auto-failover/index.js";

const KB = 1024;
const b64 = (n) => "A".repeat(n);
const user = (text) => ({ role: "user", content: [{ type: "text", text }] });
const media = (n, filename = "shot.png") => ({ type: "media", media: { source: { type: "base64", data: b64(n), mediaType: "image/png" } }, filename });
// one read step: assistant tool-call + tool message whose result carries the image
const readStep = (k, n, shape = "media") => [
  { role: "assistant", content: [{ type: "tool-call", id: `c${k}`, name: "read", input: { path: `/tmp/page-${k}.jpg` } }] },
  { role: "tool", content: [{ type: "tool-result", id: `c${k}`, name: "read", result: { type: "content", value: [
    { type: "text", text: "Image read successfully" },
    shape === "media" ? media(n, `/tmp/page-${k}.jpg`) : { type: "file", uri: `data:image/jpeg;base64,${b64(n)}`, mime: "image/jpeg", name: `/tmp/page-${k}.jpg` },
  ] } }] },
];
const convo = (count, size, shape) => [user("make the report"), ...Array.from({ length: count }, (_, k) => readStep(k, size, shape)).flat()];
const inlined = (messages) => JSON.stringify(messages).length;
const kept = (messages) => messages.filter((m) => m.role === "tool").map((m) => mediaInfo(m.content[0].result.value[1]) !== null);

test("recognises media parts and data URIs, not ordinary parts", () => {
  expect(mediaInfo(media(2000)).size).toBe(2000);
  expect(mediaInfo({ type: "file", uri: `data:image/jpeg;base64,${b64(2000)}`, mime: "image/jpeg" }).size).toBeGreaterThan(2000);
  expect(mediaInfo({ type: "text", text: b64(5000) })).toBeNull();
  expect(mediaInfo({ type: "file", url: "https://example.com/a.png" })).toBeNull();
  expect(mediaInfo({ type: "tool-call", input: { content: b64(5000) } })).toBeNull();
});

test("a few images are left alone and the array is returned as is", () => {
  const m = convo(5, 200 * KB);
  const r = capMedia(m);
  expect(r.messages).toBe(m);
  expect(r.stats).toMatchObject({ images: 5, dropped: 0 });
});

test("the session of 2026-11-10 (64 page images, 9.2 MB) stays far under the provider limit", () => {
  for (const shape of ["media", "file"]) {
    const m = convo(64, 144 * KB, shape);
    const before = JSON.stringify(m);
    const r = capMedia(m);
    expect(JSON.stringify(m)).toBe(before); // input untouched
    expect(inlined(r.messages)).toBeLessThan(4.2 * KB * KB);
    const k = kept(r.messages);
    expect(k.at(-1)).toBe(true); // the newest image is always there
    expect(k.lastIndexOf(false)).toBeLessThan(k.indexOf(true)); // only the oldest go
    const cut = r.messages.find((x) => x.role === "tool").content[0].result.value;
    expect(cut[0].text).toBe("Image read successfully");
    expect(cut[1].text).toContain("/tmp/page-0.jpg");
    expect(cut[1].text).toContain("read the file again");
  }
});

test("the cut only moves when the budget is passed again (prompt cache prefix stays identical)", () => {
  const prefixes = [];
  let moves = 0, last = -1;
  for (let n = 1; n <= 80; n++) {
    const k = kept(capMedia(convo(n, 144 * KB)).messages);
    const firstKept = k.indexOf(true);
    if (firstKept !== last) { moves++; last = firstKept; }
    prefixes.push(firstKept);
  }
  expect(moves).toBeLessThan(8); // 80 steps, the cut moved a handful of times, not 80
  expect(prefixes.at(-1)).toBeGreaterThan(40);
});

test("more than 24 small images are thinned by count", () => {
  const k = kept(capMedia(convo(30, 10 * KB)).messages);
  expect(k.filter(Boolean).length).toBeLessThanOrEqual(24);
  expect(k.filter(Boolean).length).toBeGreaterThanOrEqual(12);
});

test("an image too big to send at all is replaced with advice, others stay", () => {
  const m = [user("look"), ...readStep(0, 6 * KB * KB), ...readStep(1, 100 * KB)];
  const r = capMedia(m);
  expect(kept(r.messages)).toEqual([false, true]);
  expect(r.messages[2].content[0].result.value[1].text).toContain("too large to send");
});

test("images the user attached are capped the same way", () => {
  const m = [{ role: "user", content: [{ type: "text", text: "compare" }, ...Array.from({ length: 30 }, (_, k) => media(300 * KB, `a${k}.png`))] }];
  const r = capMedia(m);
  const parts = r.messages[0].content;
  expect(parts.length).toBe(31);
  expect(parts.filter((p) => p.type === "media").length).toBeLessThan(15);
  expect(parts.at(-1).type).toBe("media");
});

test("compaction, title and summary requests carry no images", () => {
  const r = capMedia(convo(3, 100 * KB), { all: true });
  expect(kept(r.messages)).toEqual([false, false, false]);
  expect(inlined(r.messages)).toBeLessThan(2000);
});

test("tighten halves the budget per session until nothing is kept, then reports there is nothing left", () => {
  const m = convo(20, 150 * KB); // 3 MB: under the normal budget
  expect(capMedia(m, { sessionID: "s1" }).stats.dropped).toBe(0);
  expect(tighten("s1")).toBe(1);
  const one = capMedia(m, { sessionID: "s1" });
  expect(one.stats.dropped).toBeGreaterThan(0);
  expect(inlined(one.messages)).toBeLessThan(2.1 * KB * KB);
  expect(capMedia(m, { sessionID: "other" }).stats.dropped).toBe(0);
  expect(tighten("s1")).toBe(2);
  expect(tighten("s1")).toBe(3);
  expect(tighten("s1")).toBe(4);
  expect(capMedia(m, { sessionID: "s1" }).stats.dropped).toBe(20);
  expect(tighten("s1")).toBe(0);
  expect(levelOf("s1")).toBe(4);
});

test("failover: a media-size rejection is not a context overflow", () => {
  const msg = "Upstream request failed: [airlock_error] inlined media exceeds the 33554432 byte total limit";
  expect(MEDIA_LIMIT.test(msg)).toBe(true);
  expect(classify(400, "provider.invalid-request", msg)).toEqual({ media: true, overflow: false });
  expect(classify(400, "", "This model's maximum context length is 131072 tokens")).toEqual({ media: false, overflow: true });
  expect(classify(400, "", "prompt is too long: 250000 tokens > 200000 maximum")).toEqual({ media: false, overflow: true });
  expect(classify(429, "", "Rate limit exceeded")).toEqual({ media: false, overflow: false });
});

test("failover: at most two compactions per session in ten minutes", () => {
  const t = 1_000_000;
  expect(mayCompact("c1", t)).toBe(true);
  expect(mayCompact("c1", t + 7_000)).toBe(true);
  expect(mayCompact("c1", t + 14_000)).toBe(false);
  expect(mayCompact("c1", t + 5 * 60_000)).toBe(false);
  expect(mayCompact("c2", t + 14_000)).toBe(true);
  expect(mayCompact("c1", t + 11 * 60_000)).toBe(true);
});
