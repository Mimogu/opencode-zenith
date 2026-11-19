// bun test tests/vision.test.mjs: image transcripts (plugins/context-engine/vision.mjs) with a fake `see`.
import { test, expect } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { Vision } from "../plugins/context-engine/vision.mjs";
import { lastUserText } from "../plugins/context-engine/router.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vision-test-"));
const counter = path.join(tmp, "calls");
const fake = path.join(tmp, "see");
fs.writeFileSync(fake, `#!/bin/sh\necho x >> "${counter}"\n[ -f "${tmp}/fail" ] && { echo boom >&2; exit 1; }\necho "TRANSCRIPT of $(basename "$1")"\n`, { mode: 0o755 });

const img = (data, filename = "shot.png") => ({ type: "media", media: { source: { type: "base64", data, mediaType: "image/png" } }, filename });
const calls = () => (fs.existsSync(counter) ? fs.readFileSync(counter, "utf-8").trim().split("\n").length : 0);
const mk = () => new Vision({ seeBin: fake, cachePath: path.join(tmp, "cache.json"), scratch: path.join(tmp, "scratch") });

test("adds a transcript after each user image, keeps the image, caches by content", async () => {
  const v = mk();
  const msgs = [{ role: "user", content: [{ type: "text", text: "what is this" }, img("aGVsbG8=")] }, { role: "assistant", content: [img("aGVsbG8=")] }];
  const out = await v.annotate(msgs);
  expect(out[0].content.length).toBe(3);
  expect(out[0].content[1].type).toBe("media");
  expect(out[0].content[2].text).toStartWith('<image_transcript file="shot.png">');
  expect(out[0].content[2].text).toContain("TRANSCRIPT of");
  expect(out[1]).toBe(msgs[1]); // assistant images untouched
  const again = await mk().annotate(msgs); // new instance: disk cache, no second call
  expect(calls()).toBe(1);
  expect(again[0].content[2].text).toBe(out[0].content[2].text);
});

test("transcripts never count as the user's words for routing", async () => {
  const out = await mk().annotate([{ role: "user", id: "m1", content: [{ type: "text", text: "fix this" }, img("aGVsbG8=")] }]);
  expect(lastUserText(out).text).toBe("fix this");
});

test("image-only message is annotated; #noimgread opts out; no images = same array", async () => {
  const v = mk();
  const only = await v.annotate([{ role: "user", content: [img("b25seQ==")] }]);
  expect(only[0].content[1].text).toContain("<image_transcript");
  const opted = [{ role: "user", content: [{ type: "text", text: "#noimgread look" }, img("b3B0")] }];
  expect(await v.annotate(opted)).toBe(opted);
  const none = [{ role: "user", content: [{ type: "text", text: "hi" }] }];
  expect(await v.annotate(none)).toBe(none);
});

test("a failing see leaves the message unchanged and is retried later", async () => {
  fs.writeFileSync(path.join(tmp, "fail"), "");
  const v = mk();
  const msgs = [{ role: "user", content: [img("ZmFpbA==")] }];
  const before = calls();
  expect((await v.annotate(msgs))[0].content.length).toBe(1);
  fs.rmSync(path.join(tmp, "fail"));
  expect((await v.annotate(msgs))[0].content.length).toBe(2);
  expect(calls()).toBe(before + 2);
});
