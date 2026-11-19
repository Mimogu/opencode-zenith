import { test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import fs from "fs";
import os from "os";
import path from "path";
import { AnswerCheck, _internal } from "../plugins/context-engine/answercheck.mjs";
import { LinkCheck } from "../plugins/context-engine/linkcheck.mjs";
import { addHints } from "../plugins/context-engine/toolhints.mjs";

const DEAD = "https://www.amazon.eg/-/en/Crucial-CT8G4SFRA32A-8GB-DDR4-3200MHz-Laptop-Memory/dp/B08BVWX2CH/";
const OK = "https://www.computecheg.com/product/crucial-basics-8gb-ddr4-3200mhz-sodimm-laptop-memory-cb8gs3200/";
const fakeFetch = async (url) => url === DEAD
  ? new Response("<title>Page Not Found</title>", { status: 404 })
  : new Response("<title>Crucial Basics 8GB</title>", { status: 200 });

let dbPath;
let seq;
function freshDb() {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "anscheck-")), "opencode.db");
  const db = new Database(dbPath);
  db.run("CREATE TABLE session_v2 (id TEXT PRIMARY KEY, parent_id TEXT)");
  db.run("CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, seq INTEGER, data TEXT)");
  db.close();
  seq = 0;
}
function session(id, parent = null) {
  const db = new Database(dbPath); db.run("INSERT INTO session_v2 VALUES (?, ?)", [id, parent]); db.close();
}
function row(sid, type, data) {
  const db = new Database(dbPath);
  db.run("INSERT INTO session_message VALUES (?, ?, ?, ?, ?)", [`m${++seq}`, sid, type, seq, JSON.stringify(data)]);
  db.close();
}
const user = (sid, text) => row(sid, "user", { text });
const answer = (sid, text, tools = [], agent = "build") => row(sid, "assistant", { agent, content: [...tools, { type: "text", text }] });
const shell = (command) => ({ type: "tool", name: "shell", state: { status: "completed", input: { command }, content: [{ type: "text", text: "ok" }] } });

function checker() {
  const sent = [];
  const c = new AnswerCheck({ dbPath, links: new LinkCheck({ fetchImpl: fakeFetch }), synthetic: async (x) => { sent.push(x); } });
  return { c, sent };
}

beforeEach(freshDb);

test("a dead link in the final answer sends the agent back once", async () => {
  session("s1"); user("s1", "find ram"); answer("s1", `Best pick: ${DEAD}\nAlso good: ${OK}`);
  const { c, sent } = checker();
  const r = await c.onIdle({ sessionID: "s1" });
  expect(r.issues.length).toBe(1);
  expect(r.issues[0]).toContain(DEAD);
  expect(sent.length).toBe(1);
  expect(sent[0].metadata.source).toBe("answer-check");
  expect(sent[0].text).toContain("does not exist (HTTP 404");
  // the same idle again, or after our reminder is stored: no second round
  expect(await c.onIdle({ sessionID: "s1" })).toBeNull();
  row("s1", "synthetic", { text: sent[0].text, metadata: { source: "answer-check" } });
  answer("s1", `Corrected: ${OK}`);
  expect(await checker().c.onIdle({ sessionID: "s1" })).toBeNull();
});

test("working links and no claims: nothing is sent", async () => {
  session("s2"); user("s2", "find ram"); answer("s2", `Buy here: ${OK}`);
  const { c, sent } = checker();
  const r = await c.onIdle({ sessionID: "s2" });
  expect(r.issues).toEqual([]);
  expect(sent.length).toBe(0);
});

test("'tests pass' without a test run is caught; with one it is not", async () => {
  session("s3"); user("s3", "fix the bug"); answer("s3", "Fixed the off-by-one. All tests pass.", [shell("sed -i 's/<=/</' src/a.py")]);
  const a = checker();
  const r = await a.c.onIdle({ sessionID: "s3" });
  expect(r.issues.length).toBe(1);
  expect(r.issues[0]).toContain("no test, build or type-check command ran");

  session("s4"); user("s4", "fix the bug"); answer("s4", "Fixed. All tests pass (12 passed).", [shell("cd proj && python3 -m pytest -q")]);
  expect((await checker().c.onIdle({ sessionID: "s4" })).issues).toEqual([]);
});

test("subagents, background runs and non-primary agents are not checked", async () => {
  session("p"); session("child", "p"); user("child", "x"); answer("child", `see ${DEAD}`);
  expect(await checker().c.onIdle({ sessionID: "child" })).toBeNull();
  session("bg"); user("bg", "x"); answer("bg", `see ${DEAD}`);
  expect(await checker().c.onIdle({ sessionID: "bg", background: [{ id: "sh_1" }] })).toBeNull();
  // what OpenCode really sends when nothing runs in the background: an empty list
  expect((await checker().c.onIdle({ sessionID: "bg", background: [] })).issues.length).toBe(1);
  session("br"); user("br", "x"); answer("br", `see ${DEAD}`, [], "browser");
  expect(await checker().c.onIdle({ sessionID: "br" })).toBeNull();
});

test("test-claim and test-command patterns", () => {
  const { TEST_CLAIM, TEST_CMD } = _internal;
  for (const s of ["All tests pass", "the build succeeds", "12 tests passed", "type checks pass", "tests are green"]) expect(TEST_CLAIM.test(s)).toBe(true);
  for (const s of ["2 tests fail", "I did not run the tests", "tests failed"]) expect(TEST_CLAIM.test(s)).toBe(false);
  // known false positive, accepted: the reminder lets the model answer "false alarm" in one line
  expect(TEST_CLAIM.test("the test passes a string to parse()")).toBe(true);
  for (const s of ["bun test tests/", "npm run test", "cargo test", "python3 -m pytest -q", "godot --headless --script t.gd", "tsc --noEmit"]) expect(TEST_CMD.test(s)).toBe(true);
  for (const s of ["ls -la", "cat README.md", "git status"]) expect(TEST_CMD.test(s)).toBe(false);
});

// ---- tool hints
const err = (name, message) => ({ role: "tool", content: [{ type: "tool-result", id: "x", name, result: { type: "error", value: { error: { message }, content: [] } } }] });

test("a rate-limited search gets the Parallel hint, once and without touching the original", () => {
  const msgs = [err("websearch", "Web search rate limited (HTTP 429)")];
  const { messages, hints } = addHints(msgs);
  expect(hints).toBe(1);
  const text = messages[0].content[0].result.value.error.message;
  expect(text).toContain("tools.parallel.web_search");
  expect(msgs[0].content[0].result.value.error.message).toBe("Web search rate limited (HTTP 429)");
  expect(addHints(messages).hints).toBe(0); // already hinted
});

test("a blocked shop page points to a real browser; a generic 503 to retry", () => {
  const amazon = addHints([err("webfetch", "StatusCode: non 2xx status code (503 GET https://www.amazon.eg/dp/B0B716ZT1R)")]);
  expect(amazon.messages[0].content[0].result.value.error.message).toContain("camofox");
  const other = addHints([err("webfetch", "StatusCode: non 2xx status code (503 GET https://example.org/x)")]);
  expect(other.messages[0].content[0].result.value.error.message).toContain("Retry once");
});

test("search results that merely mention rate limits get no hint", () => {
  const ok = { role: "tool", content: [{ type: "tool-result", name: "execute", result: { type: "text", value: "Title: How API rate limiting works\nURL: https://example.com/rate-limits\n".repeat(80) } }] };
  expect(addHints([ok]).hints).toBe(0);
  const shellOk = { role: "tool", content: [{ type: "tool-result", name: "shell", result: { type: "text", value: "zsh: command not found: decode-dimms" } }] };
  expect(addHints([shellOk]).messages[0].content[0].result.value).toContain("command -v");
});

test("no false alarms: code examples, placeholder hosts, links the answer calls dead, negated claims", async () => {
  session("fa"); user("fa", "x");
  answer("fa", [
    "Call the API like this:", "```js", `await fetch("${DEAD}")`, "```",
    "Your local server is at http://localhost:8080/api and docs use https://api.example.com/v1/users.",
    `Note: the link you sent (${DEAD}) is dead, it returns 404.`,
    "I could not confirm the tests pass because pytest is not installed.",
  ].join("\n"));
  const r = await checker().c.onIdle({ sessionID: "fa" });
  expect(r.issues).toEqual([]);
});

test("a refused shell command says rephrasing is refused too and to hand it to the caller (2026-11-06)", () => {
  const r = addHints([err("shell", "Permission denied: shell")]);
  expect(r.hints).toBe(1);
  expect(r.messages[0].content[0].result.value.error.message).toContain("Needs running");
});

test("someone else's test results are a report, not a claim about this work (2026-11-06)", () => {
  const a = Object.create(AnswerCheck.prototype);
  expect(a.testIssues("`ws` rewritten as a port of `ws` 8.22.0 (234/271 of its tests passing, up from 94)", [])).toEqual([]);
  expect(a.testIssues("Bun's own notes say all tests pass on Linux.", [])).toEqual([]);
  expect(a.testIssues("Fixed the bug; all tests pass.", []).length).toBe(1);
  expect(a.testIssues("Done. 10 tests passing.", []).length).toBe(1);
});

test("a short answer was asked for and a long one given: sent back (2026-11-06)", async () => {
  const { lengthIssues } = await import("../plugins/context-engine/answercheck.mjs");
  const long = "word ".repeat(320);
  expect(lengthIssues("what's the newest bun? keep it short", long).length).toBe(1);
  expect(lengthIssues("what's the newest bun? keep it short", "Bun 1.4.4, out 22 Oct: adds bun fmt.")).toEqual([]);
  expect(lengthIssues("In one sentence: what is a mutex?", "word ".repeat(90)).length).toBe(1);
  expect(lengthIssues("explain mutexes in depth", long)).toEqual([]);
  expect(lengthIssues("keep it short", "ok\n```js\n" + "code ".repeat(400) + "\n```")).toEqual([]);
});

test("'remember that ...' answered with 'noted' but no memory write succeeded: sent back (2026-11-06)", async () => {
  const { memoryIssues } = await import("../plugins/context-engine/answercheck.mjs");
  const req = "please remember that my favourite editor font is JetBrains Mono, size 13";
  const failed = [{ name: "memory_add", state: { status: "error", error: { message: 'No tool named "memory_add" is currently available.' } } }];
  expect(memoryIssues(req, "Acknowledged — noted that your favorite editor font is JetBrains Mono.", failed).length).toBe(1);
  const ok = [{ name: "execute", state: { status: "completed", input: { code: "await tools.memory.memory_add({...})" }, content: [{ type: "text", text: '{"id": 81, "status": "added"}' }] } }];
  expect(memoryIssues(req, "Saved — fact 81.", ok)).toEqual([]);
  expect(memoryIssues("what font do i use?", "Noted.", [])).toEqual([]);
  expect(memoryIssues(req, "I could not save it: the memory tool is unavailable.", failed)).toEqual([]);
  const r = addHints([err("memory_add", 'No tool named "memory_add" is currently available. Please use a tool from the available tool list.')]);
  expect(r.messages[0].content[0].result.value.error.message).toContain("tools.memory.memory_add");
});

// ---- config files and "I cannot access your machine" (2026-11-11, the end4-pC dotfile session)
import { configIssues, accessIssues } from "../plugins/context-engine/answercheck.mjs";
import { validatorFor, shellWrites } from "../plugins/context-engine/validators.mjs";
const HOMEDIR = os.homedir();
const write = (p) => ({ type: "tool", name: "write", state: { status: "completed", input: { path: p, content: "x" }, content: [{ type: "text", text: "Created file successfully" }] } });

test("a written Hyprland config that was never verified is sent back; verified after the write is fine", () => {
  const lua = `${HOMEDIR}/.config/hypr/hyprland.lua`;
  const issues = configIssues([write(lua), shell("timeout 8 qs -c end4-pC 2>&1 | grep Loaded")]);
  expect(issues.length).toBe(1);
  expect(issues[0]).toContain("Hyprland --verify-config");
  expect(configIssues([write(lua), shell("Hyprland --verify-config 2>&1 | tail -5")])).toEqual([]);
  // checked, then written again: the last version is unchecked
  expect(configIssues([write(lua), shell("Hyprland --verify-config"), write(lua)]).length).toBe(1);
  expect(configIssues([shell(`cat > ~/.config/hypr/hyprland.conf <<'EOF'\nmonitor=,preferred,auto,1\nEOF`)]).length).toBe(1);
});

test("validators only cover the machine's own config, each with its checker", () => {
  expect(validatorFor("/home/u/project/package.json")).toBeNull();
  expect(validatorFor(`${HOMEDIR}/projects/app/config.json`)).toBeNull();
  expect(validatorFor("~/.config/illogical-impulse/config.json").cmd).toContain("jq empty");
  expect(validatorFor("~/.config/systemd/user/x.service").cmd).toContain("systemd-analyze --user verify");
  expect(validatorFor("/etc/fstab").cmd).toBe("findmnt --verify");
  expect(validatorFor("~/.config/fish/config.fish").cmd).toContain("fish -n");
  expect(validatorFor("~/.config/hypr/hyprlock.conf")).toBeNull(); // no checker exists for it
  expect(shellWrites("echo x > /tmp/a; echo y | tee ~/.config/foot/foot.ini; ls 2>/dev/null")).toEqual([path.join(os.homedir(), ".config/foot/foot.ini")]);
});

test("a write of a machine config gets the check command in its result, once", () => {
  const call = { role: "assistant", content: [{ type: "tool-call", id: "c1", name: "write", input: { path: `${HOMEDIR}/.config/hypr/hyprland.lua`, content: "hl.input({})" } }] };
  const res = { role: "tool", content: [{ type: "tool-result", id: "c1", name: "write", result: { type: "text", value: "Created file successfully: .config/hypr/hyprland.lua" } }] };
  const { messages, hints } = addHints([call, res]);
  expect(hints).toBe(1);
  expect(messages[1].content[0].result.value).toContain("Hyprland --verify-config");
  expect(res.content[0].result.value).toBe("Created file successfully: .config/hypr/hyprland.lua");
  expect(addHints(messages).hints).toBe(0);
  const code = { role: "assistant", content: [{ type: "tool-call", id: "c2", name: "write", input: { path: "/home/u/proj/src/app.json", content: "{}" } }] };
  const codeRes = { role: "tool", content: [{ type: "tool-result", id: "c2", name: "write", result: { type: "text", value: "Created" } }] };
  expect(addHints([code, codeRes]).hints).toBe(0);
});

test("claiming to have no access to the user's machine is sent back; honest limits are not", () => {
  for (const s of [
    "I cannot directly access your physical machine's emergency mode — I'm running in a separate session, not on your system.",
    "I cannot take a screenshot of your screen or access your emergency mode TTY.",
    "I don't have access to your system, so run these commands yourself.",
  ]) expect(accessIssues(s, []).length).toBe(1);
  for (const s of [
    "I could not reach the server at 10.0.0.2.",
    "The screenshot shows the bar loaded. I can't see the dock in it.",
    "I cannot access /root without sudo.",
    "Run `journalctl -b -1` to see your previous boot.",
  ]) expect(accessIssues(s, [])).toEqual([]);
});

test("sed -i and cp onto a machine config are writes that need the program's check", () => {
  const hypr = path.join(os.homedir(), ".config/hypr/custom/general.lua");
  expect(shellWrites(`sed -i 's/a/b/' ${hypr}`)).toEqual([hypr]);
  expect(configIssues([{ name: "bash", state: { status: "completed", input: { command: `sed -i 's/gaps = 5/gaps = 8/' ${hypr}` } } }]).length).toBe(1);
  expect(configIssues([
    { name: "bash", state: { status: "completed", input: { command: `sed -i 's/a/b/' ${hypr}` } } },
    { name: "bash", state: { status: "completed", input: { command: "Hyprland --verify-config" } } },
  ])).toEqual([]);
});


test("a reply that only announces its next step is sent back; real stops are not (2026-11-18 Firefox session)", async () => {
  const { unfinishedIssues } = await import("../plugins/context-engine/answercheck.mjs");
  expect(unfinishedIssues("The sp param isn't taking effect. Let me snapshot the filter chip bar to get the Shorts chip's UID for a proper click.")).toHaveLength(1);
  expect(unfinishedIssues("Done. I'll now open the second video.")).toHaveLength(1);
  expect(unfinishedIssues("Done: May had the highest revenue (17,250).")).toHaveLength(0);
  expect(unfinishedIssues("Here is the filled post. Shall I post it?")).toHaveLength(0);
  expect(unfinishedIssues("The draft is ready. I'll wait for your approval before posting.")).toHaveLength(0);
  expect(unfinishedIssues("Everything is set up. Let me know if you want the dark theme too.")).toHaveLength(0);
  expect(unfinishedIssues("Next, I recommend checking the printer power cable.")).toHaveLength(0);
  expect(unfinishedIssues("Next, I suggest trying a different USB port.")).toHaveLength(0);
  expect(unfinishedIssues("Next, let me check the printer status.")).toHaveLength(1);
  expect(unfinishedIssues("Next, I will verify the connection.")).toHaveLength(1);
});

test("Firefox tool mistakes get the my-firefox cheat sheet; a background subagent gets 'do not call again' (2026-11-18)", () => {
  const okRes = (name, text) => ({ role: "tool", content: [{ type: "tool-result", id: "y", name, result: { type: "text", value: text } }] });
  const call = { role: "assistant", content: [{ type: "tool-call", id: "x", name: "execute", input: { code: 'await tools["my-firefox"].close_page({})' } }] };
  const ff = addHints([call, err("execute", 'Error: Invalid arguments for tool "my-firefox_close_page":\n- pageIdx: Missing key')]);
  expect(ff.hints).toBe(1);
  expect(JSON.stringify(ff.messages)).toContain("click_by_uid({ uid: str");
  const pw = addHints([{ role: "assistant", content: [{ type: "tool-call", id: "x", name: "execute", input: { code: 'await tools["camofox"].click({ ref: "e1" })' } }] }, err("execute", "TypeError: tools.camofox.click is not a function")]);
  expect(JSON.stringify(pw.messages)).toContain("camofox_click({ tabId: str");
  const sub = addHints([okRes("subagent", "The subagent is working in the background (sessionID: ses_x). You will receive a <subagent> message when it goes idle.")]);
  expect(sub.hints).toBe(1);
  expect(JSON.stringify(sub.messages)).toContain("see <file>");
  expect(addHints([okRes("execute", 'null\n\nLogs:\n{"items":[{"path":"tools[\\"my-firefox\\"].click_by_uid"}]}')]).hints).toBe(0); // a tool search is not an error
});

test("a camofox server error points to another browser, not a mid-task reinstall", () => {
  const r = addHints([err("execute", 'camofox error: 500: {"error":"Internal server error","retryable":false}')]);
  expect(JSON.stringify(r.messages)).toContain("another browser server");
});

test("a server that is still connecting ('Unknown tool playwright.x') gets 'repeat the same call'", () => {
  const r = addHints([err("execute", "Unknown tool 'playwright.browser_navigate'. Use search to find available tools.")]);
  expect(JSON.stringify(r.messages)).toContain("still starting");
  expect(JSON.stringify(r.messages)).toContain('tools[\\"playwright\\"].browser_navigate');
  const wrong = addHints([err("execute", "Unknown tool 'playwright.browser_click_element'. Use search to find available tools.")]);
  expect(JSON.stringify(wrong.messages)).toContain("is not a playwright tool");
  expect(JSON.stringify(wrong.messages)).not.toContain("still starting");
  expect(addHints([err("execute", "Unknown tool 'nosuchserver.thing'. Use search to find available tools.")]).hints).toBe(0);
});
