// bun test tests/approval_gate.test.mjs: nothing is published from a browser before the user approves it.
import { test, expect } from "bun:test";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import gate, { riskyShell, fold, decide, settle, replacement, heldMessage, UNKNOWN } from "../plugins/approval-gate/index.js";

const call = (server, fn, args) => `await tools["${server}"].${fn}(${args});`;
const user = (text, id) => ({ type: "user", text, ...(id ? { id } : {}) });
const say = (text) => ({ type: "assistant", content: [{ type: "text", text }] });
const tool = (code, out) => ({ type: "assistant", content: [{ type: "tool", name: "execute", state: { input: { code }, content: [{ type: "text", text: out }] } }] });
const page = (url, snapshot = "") => tool("snapshot", `### Page\n- Page URL: ${url}\n\`\`\`yaml\n${snapshot}\n\`\`\``);
const held = () => tool("click", `null\n\nLogs:\n${heldMessage([{ what: "click", why: "test" }], "x")}`);
const LI_SNAP = '  - button "Start a post" [ref=e40]\n  - link "Jobs" [ref=e12]\n  - button "Post" [ref=e512]';
const at = (url, snap = "") => fold(null, [user("open my page"), page(url, snap)]);
const ex = (code, state, id) => decide({ tool: "execute", sessionID: "t", id, input: { code } }, { state });

test("publishing clicks are held, composing and navigating are not", () => {
  const li = at("https://www.linkedin.com/feed/", LI_SNAP);
  expect(ex(call("my-browser", "browser_click", `{ target: "e512" }`), li)).not.toBeNull();
  expect(ex(call("my-browser", "browser_click", `{ element: "Start a post", target: "e40" }`), li)).toBeNull();
  expect(ex(call("my-browser", "browser_click", `{ element: "Jobs tab", target: "e12" }`), li)).toBeNull();
  const local = at("http://127.0.0.1:8090/form.html", '  - button "Post" [ref=e4]\n  - textbox "Text" [ref=e3]');
  expect(ex(call("my-browser", "browser_click", `{ element: "Next step", target: "e4" }`), local)).not.toBeNull(); // the page's label wins
  expect(ex(call("my-browser", "browser_click", `{ target: "e3" }`), local)).toBeNull();
  expect(ex(call("my-browser", "browser_click", `{ element: "Send now", target: "e99" }`), at("http://example.com/"))).not.toBeNull();
});

test("review 2026-11-18: other call shapes and Playwright page scripts are held", () => {
  const li = at("https://www.linkedin.com/feed/", LI_SNAP);
  expect(ex(call("my-browser", "browser_run_code", `{ code: "async (page) => { await page.getByRole('button', {name: 'Post'}).click(); }" }`), li)).not.toBeNull();
  expect(ex(`await tools["my-browser"]["browser_click"]({element:"Post", target:"e4"})`, li)).not.toBeNull();
  expect(ex(`const b = tools["my-browser"]; await b.browser_click({element:"Post", target:"e4"})`, li)).not.toBeNull();
  expect(ex(call("my-browser", "browser_run_code", `{ code: "async (page) => { await page.keyboard.press('Enter') }" }`), li)).not.toBeNull();
  expect(ex(call("my-browser", "browser_run_code", `{ code: "async (page) => { await page.locator('textarea').press('Control+Enter') }" }`), li)).not.toBeNull();
  expect(ex(call("my-browser", "browser_handle_dialog", `{ accept: true }`), li)).not.toBeNull();
  expect(ex(call("my-browser", "browser_evaluate", `{ function: "() => { const x = new XMLHttpRequest(); x.open('POST', '/api'); x.send(); }" }`), li)).not.toBeNull();
});

test("the 2026-11-16 Nafezly bid script is held anywhere; a read-only script and a tool search are not", () => {
  const code = call("my-browser", "browser_evaluate", `{ function: "() => { document.querySelector('#cost').value = '20'; document.querySelector('#make-offer').click(); }" }`);
  expect(ex(code, at("https://nafezly.com/project/1"))).not.toBeNull();
  expect(ex(code, at("http://127.0.0.1/"))).not.toBeNull();
  expect(ex(call("my-browser", "browser_evaluate", `{ function: "() => document.title" }`), at("https://nafezly.com/"))).toBeNull();
  expect(ex(`const r = await search({ query: "my-browser click button press key" });`, at("https://www.linkedin.com/"))).toBeNull();
});

test("on a publishing site, clicks that cannot be checked and Enter are held; elsewhere they are not", () => {
  const li = at("https://www.linkedin.com/feed/", LI_SNAP);
  expect(ex(call("my-browser", "browser_mouse_click_xy", `{ x: 400, y: 300 }`), li)).not.toBeNull();
  expect(ex(call("my-browser", "browser_mouse_click_xy", `{ x: 400, y: 300 }`), at("https://example.com/"))).toBeNull();
  expect(ex(call("my-browser", "browser_press_key", `{ key: "Enter" }`), at("https://mostaql.com/"))).not.toBeNull();
  expect(ex(call("my-browser", "browser_press_key", `{ key: "Enter" }`), at("https://example.com/"))).toBeNull();
  expect(ex(call("my-browser", "browser_click", `{ target: "e77" }`), li)).not.toBeNull(); // not in the newest snapshot
  expect(ex(call("my-browser", "browser_type", `{ target: "e5", text: "hi", submit: true }`), li)).not.toBeNull();
  expect(riskyShell("python3 cdp.py --port 9222 --click '#make-offer'", "nafezly.com")).toHaveLength(1);
  expect(riskyShell("ls ~/Downloads", "nafezly.com")).toHaveLength(0);
});

test("review: the page is the newest Page URL or a real navigate, not any url text; unreadable history fails closed", () => {
  const li = at("https://www.linkedin.com/feed/", LI_SNAP);
  expect(ex(`const x = { url: "https://example.com" }; ${call("my-browser", "browser_mouse_click_xy", "{ x: 1, y: 2 }")}`, li)).not.toBeNull();
  expect(ex(`${call("my-browser", "browser_navigate", `{ url: "https://example.com/" }`)} ${call("my-browser", "browser_mouse_click_xy", "{ x: 1, y: 2 }")}`, li)).toBeNull();
  const tabs = tool("tabs", '[{"index":0,"url":"http://127.0.0.1:8089/form.html"},{"index":1,"url":"https://nafezly.com/projects"}]');
  expect(fold(null, [page("http://127.0.0.1:8089/form.html"), tabs]).host).toBe("127.0.0.1");
  expect(ex(call("my-browser", "browser_mouse_click_xy", "{ x: 1, y: 2 }"), null)?.host).toBe(UNKNOWN);
});

test("review: labels come from the newest snapshot only", () => {
  const st = fold(null, [user("go"), page("https://example.com/a", '  - link "Jobs" [ref=e12]'), page("https://example.com/b", '  - button "Send" [ref=e12]')]);
  expect(ex(call("my-browser", "browser_click", `{ target: "e12" }`), st)).not.toBeNull();
});

test("review: approval counts only after a hold and a question; never the first message, never a no", () => {
  const code = call("my-browser", "browser_click", `{ element: "Post button", target: "e512" }`);
  const base = [user("post my update on linkedin"), page("https://www.linkedin.com/feed/", LI_SNAP)];
  expect(ex(code, fold(null, [user("post this on linkedin: hello")]))).not.toBeNull();
  expect(ex(code, fold(null, [...base, say("I'll open your browser and go to LinkedIn, OK?"), user("yes", "m1")]))).not.toBeNull(); // no hold before the yes
  expect(ex(code, fold(null, [...base, held(), say("Here is the filled post (screenshot). Shall I post it?"), user("yes", "m2")]))).toBeNull();
  expect(ex(code, fold(null, [...base, held(), say("Here is the draft. Shall I post it?"), user("تمام انشر", "m3")]))).toBeNull();
  expect(ex(code, fold(null, [...base, held(), say("Here is the draft. Shall I post it?"), user("no, change the second line first", "m4")]))).not.toBeNull();
  expect(ex(code, fold(null, [...base, held(), say("Here is the draft. Shall I post it?"), user("wait", "m5")]))).not.toBeNull();
  expect(ex(code, fold(null, [...base, held(), user("yes", "m6")]))).not.toBeNull(); // the agent never asked after the hold
});

test("one approval lets one publishing action through; a repeat is held; 'yes, all' approves a batch", () => {
  const code = call("my-browser", "browser_click", `{ element: "Post button", target: "e512" }`);
  const base = [user("post it"), page("https://www.linkedin.com/feed/", LI_SNAP), held(), say("Here is the draft. Shall I post it?")];
  const once = fold(null, [...base, user("yes", "once")]);
  expect(ex(code, once)).toBeNull();
  expect(ex(code, once)?.repeat).toBe(true);
  const batch = fold(null, [...base, user("yes, all three", "batch")]);
  for (let i = 0; i < 3; i++) expect(ex(code, batch)).toBeNull();
});

test("an approved click that failed gives the approval back; page text with 'Error' after a working click does not", () => {
  const code = call("my-browser", "browser_click", `{ element: "Post button", target: "e512" }`);
  const st = fold(null, [user("post it"), page("https://www.linkedin.com/feed/", LI_SNAP), held(), say("Shall I post it?"), user("yes", "retry")]);
  expect(ex(code, st, "c1")).toBeNull();
  expect(settle({ id: "c1", sessionID: "t", status: "completed", result: { content: [{ type: "text", text: "### Error\nError: Ref e512 not found in the current page snapshot." }] } })).toBe(true);
  expect(ex(code, st, "c2")).toBeNull();
  expect(settle({ id: "c2", sessionID: "t", status: "completed", result: { content: [{ type: "text", text: "### Ran Playwright code\n```js\nawait page.getByRole('button', { name: 'Post' }).click();\n```\n### Page\n- Console: Uncaught Error: tracking blocked\n- generic: Page not found" }] } })).toBe(false);
  expect(ex(code, st, "c3")?.repeat).toBe(true);
});

test("review: the replacement for a held shell command runs nothing from it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-"));
  const pwned = path.join(dir, "PWNED");
  const cmd = `xdotool click 1 $(touch ${pwned}) \`touch ${pwned}2\``;
  const msg = heldMessage(riskyShell(cmd, "nafezly.com"), "nafezly.com");
  const out = execFileSync("bash", ["-c", replacement("bash", msg).command], { encoding: "utf-8" });
  expect(fs.existsSync(pwned) || fs.existsSync(pwned + "2")).toBe(false);
  expect(out).toContain("Held");
  expect(out).toContain("$(touch");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the hook replaces a held call and leaves a harmless one alone", async () => {
  let before;
  await gate.setup({ tool: { hook: (name, fn) => { if (name === "execute.before") before = fn; } } });
  const out = before({ tool: "execute", sessionID: "ses_gate_hook_unknown", input: { code: call("my-browser", "browser_click", `{ element: "Post button", target: "e4" }`) } });
  expect(out.input.code.startsWith("console.log(")).toBe(true);
  expect(out.input.code).not.toContain("tools[");
  expect(before({ tool: "execute", sessionID: "ses_gate_hook_unknown", input: { code: call("my-browser", "browser_snapshot", "{}") } }).input.code).toContain("browser_snapshot");
});

test("failed tries are given back at most 3 times per approval", () => {
  const code = call("my-browser", "browser_click", `{ element: "Post button", target: "e512" }`);
  const st = fold(null, [user("post it"), page("https://www.linkedin.com/feed/", LI_SNAP), held(), say("Shall I post it?"), user("yes", "cap")]);
  const fail = (id) => settle({ id, sessionID: "t", status: "completed", result: { content: [{ type: "text", text: "### Error\nTimeoutError: Timeout 5000ms exceeded." }] } });
  for (let i = 1; i <= 3; i++) { expect(ex(code, st, `k${i}`)).toBeNull(); expect(fail(`k${i}`)).toBe(true); }
  expect(ex(code, st, "k4")).toBeNull();
  expect(fail("k4")).toBe(false);
  expect(ex(code, st, "k5")?.repeat).toBe(true);
});

test("Firefox (my-firefox): click_by_uid and accept_dialog are actions; its snapshot labels are read; YouTube browsing is not held", () => {
  const ff = (url, snap) => fold(null, [user("open firefox"), tool(`await tools["my-firefox"].navigate_page({ url: "${url}" })`, "ok"), tool("snap", `Snapshot\n${snap}`)]);
  const yt = ff("https://www.youtube.com/results?search_query=x", 'uid=e14 div\n  uid=e4 button "Guide"\n  uid=e60 a href="/watch?v=1" text="Opening 1"');
  expect(yt.host).toBe("www.youtube.com");
  expect(yt.labels.get("e14")).toBe('div ""');
  expect(ex(call("my-firefox", "click_by_uid", `{ uid: "e60" }`), yt)).toBeNull(); // playing a video
  expect(ex(call("my-firefox", "press_key", `{ key: "Enter", uid: "e14" }`), yt)).toBeNull();
  const li = ff("https://www.linkedin.com/feed/", 'uid=e9 button "Post"\n  uid=e3 div');
  expect(ex(call("my-firefox", "click_by_uid", `{ uid: "e9" }`), li)).not.toBeNull();
  expect(ex(call("my-firefox", "click_by_uid", `{ uid: "e3" }`), li)).toBeNull();
  expect(ex(call("my-firefox", "accept_dialog", `{}`), li)).not.toBeNull();
  expect(ex(`await tools["my-firefox"]["click_by_uid"]({ uid: "e9" })`, li)).not.toBeNull();
});

test("camofox and chrome-devtools naming: camofox_click, pressEnter, click({uid}) are actions", () => {
  const li = at("https://www.linkedin.com/feed/", LI_SNAP);
  expect(ex(call("camofox", "camofox_click", `{ tabId: "t1", ref: "e512" }`), li)).not.toBeNull();
  expect(ex(call("camofox", "camofox_type", `{ tabId: "t1", ref: "e5", text: "hi", pressEnter: true }`), li)).not.toBeNull();
  expect(ex(call("chrome-devtools", "click", `{ uid: "e512" }`), li)).not.toBeNull();
  expect(ex(call("camofox", "camofox_click", `{ tabId: "t1", ref: "e40" }`), li)).toBeNull(); // "Start a post" is harmless
  expect(ex(call("camofox", "camofox_snapshot", `{ tabId: "t1" }`), li)).toBeNull();
});

test("review 2026-11-18: a yes with a condition or delay is not an approval; 'yes, no changes' is", () => {
  const code = call("my-browser", "browser_click", `{ element: "Post button", target: "e512" }`);
  const base = [user("post my update on linkedin"), page("https://www.linkedin.com/feed/", LI_SNAP), held(), say("Shall I post it?")];
  for (const t of ["yes, wait", "yes but change the price to 50 first", "yes after lunch", "نعم بس عدل السعر", "تمام بس غير السطر التاني"]) expect(ex(code, fold(null, [...base, user(t, t)]))).not.toBeNull();
  for (const t of ["yes", "yes, no changes", "yes don't change anything", "تمام انشر", "ok post it"]) expect(ex(code, fold(null, [...base, user(t, t)]))).toBeNull();
});
