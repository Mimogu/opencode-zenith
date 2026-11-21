// bun test tests/tab_guard.test.mjs: the agent never navigates or closes the user's own tabs.
import { test, expect } from "bun:test";
import { decide, fold, callsIn, heldMessage } from "../plugins/tab-guard/index.js";

const run = (code) => ({ tool: "execute", sessionID: "s1", input: { code } });
const tool = (code, out) => ({ type: "tool", state: { input: { code }, content: [{ type: "text", text: out }] } });
const asst = (...parts) => ({ type: "assistant", content: parts });
const user = (text) => ({ type: "user", text });

test("navigate in the user's current Brave tab is held", () => {
  const d = decide(run(`return await tools["my-browser"].browser_navigate({ url: "https://example.com" });`), { state: null });
  expect(d.why).toMatch(/user's own tabs/);
  expect(heldMessage(d)).toMatch(/browser_tabs\(\{ action: "new" \}\)/);
});

test("new tab then navigate in the same script runs", () => {
  expect(decide(run(`await tools["my-browser"].browser_tabs({ action: "new" });\nawait tools["my-browser"].browser_navigate({ url: "https://example.com" });`), { state: null })).toBeNull();
});

test("Firefox: navigate_page after the agent's own new_page runs; selecting the user's tab then navigating is held", () => {
  const st = fold(null, [user("find a video"), asst(tool(`return await tools["my-firefox"].new_page({ url: "https://youtube.com" });`, "new page [2] → https://youtube.com"))]);
  expect(decide(run(`await tools["my-firefox"].navigate_page({ url: "https://youtube.com/x" })`), { state: st })).toBeNull();
  const d = decide(run(`await tools["my-firefox"].select_page({ pageIdx: 0 });\nawait tools["my-firefox"].navigate_page({ url: "https://x.com" })`), { state: st });
  expect(d?.why).toMatch(/navigate_page/);
  expect(decide(run(`await tools["my-firefox"].select_page({ pageIdx: 2 });\nawait tools["my-firefox"].navigate_page({ url: "https://x.com" })`), { state: st })).toBeNull();
});

test("closing: own tab by index ok, user's tab held, browser_close of the user's current tab held", () => {
  const st = fold(null, [asst(tool(`await tools["my-browser"].browser_tabs({ action: "new" })`, "### Open tabs\n- 0: [Mostaql](https://mostaql.com)\n- 1: [DDG](https://duckduckgo.com)\n- 2: (current) [about:blank](about:blank)"))]);
  expect(decide(run(`await tools["my-browser"].browser_tabs({ action: "close", index: 2 })`), { state: st })).toBeNull();
  expect(decide(run(`await tools["my-browser"].browser_tabs({ action: "close", index: 0 })`), { state: st })?.why).toMatch(/tab 0/);
  expect(decide(run(`await tools["my-browser"].browser_tabs({ action: "select", index: 1 });\nawait tools["my-browser"].browser_close({})`), { state: st })?.why).toMatch(/current tab/);
});

test("reading and interacting with the current page is not held", () => {
  expect(decide(run(`return await tools["my-browser"].browser_snapshot({});`), { state: null })).toBeNull();
  expect(decide(run(`await tools["my-browser"].browser_click({ target: "e4" })`), { state: null })).toBeNull();
});

test("the user asking for this tab lifts the guard; a negation does not", () => {
  for (const no of ["look up X but don't touch my tab", "keep my open tab as is and search youtube", "never close this tab"]) {
    const s0 = fold(null, [user(no)]);
    expect(decide(run(`await tools["my-browser"].browser_navigate({ url: "https://example.com" })`), { state: s0 })).not.toBeNull();
  }
  const st = fold(null, [user("go to the next page in this tab please")]);
  expect(decide(run(`await tools["my-browser"].browser_navigate({ url: "https://example.com/2" })`), { state: st })).toBeNull();
});

test("other browsers (headless playwright) are not guarded", () => {
  expect(decide(run(`await tools.playwright.browser_navigate({ url: "https://example.com" })`), { state: null })).toBeNull();
  expect(callsIn(`tools.my_browser.browser_navigate({url:"x"})`)[0].server).toBe("my-browser");
});

test("a held call in history does not count as the agent's tab", () => {
  const st = fold(null, [asst(tool(`await tools["my-browser"].browser_tabs({ action: "new" })`, "[harness tab guard (harness, not the user)] Nothing ran"))]);
  expect(decide(run(`await tools["my-browser"].browser_navigate({ url: "https://example.com" })`), { state: st })).not.toBeNull();
});

test("close_firefox_session only disconnects (connect-existing) and is not held", () => {
  expect(decide(run(`return await tools["my-firefox"].close_firefox_session({});`), { state: null })).toBeNull();
});

test("arguments containing parentheses are still read", () => {
  const st = fold(null, [asst(tool(`await tools["my-browser"].browser_tabs({ action: "new" })`, "- 0: [Mostaql](https://mostaql.com)\n- 1: (current) [x](about:blank)"))]);
  expect(decide(run(`await tools.my_browser.browser_tabs({ action: "close", index: Number(0) })`), { state: st })?.why).toMatch(/close/);
  expect(decide(run(`await tools["my-browser"].browser_tabs({ action: "close", index: Math.max(0, n) })`), { state: null })?.why).toMatch(/close/);
});

test("after closing its own tab by index the agent is no longer on its own tab", () => {
  const st = fold(null, [asst(tool(`await tools["my-browser"].browser_tabs({ action: "new" })`, "- 0: [Mostaql](https://mostaql.com)\n- 1: (current) [x](about:blank)"))]);
  expect(decide(run(`await tools["my-browser"].browser_tabs({ action: "close", index: 1 });\nawait tools["my-browser"].browser_navigate({ url: "https://x.com" })`), { state: st })?.why).toMatch(/browser_navigate/);
  const st2 = fold(st, [asst(tool(`await tools["my-browser"].browser_tabs({ action: "close", index: 1 })`, "- 0: (current) [Mostaql](https://mostaql.com)"))]);
  expect(decide(run(`await tools["my-browser"].browser_navigate({ url: "https://x.com" })`), { state: st2 })).not.toBeNull();
});

test("browse MCP: browse.navigate without tab opens a new tab and closing its returned tab ID runs", () => {
  expect(decide(run(`await tools.browse.navigate({ url: "https://news.ycombinator.com" })`), { state: null })).toBeNull();
  const st = fold(null, [asst(tool(`await tools.browse.tabs({ action: "new", url: "https://news.ycombinator.com" })`, '{"tab":1545729747,"url":"https://news.ycombinator.com/","title":"Hacker News"}'))]);
  expect(decide(run(`await tools.browse.tabs({ action: "close", tab: 1545729747 })`), { state: st })).toBeNull();
});

test("user saying 'close the tab' lifts tab guard close", () => {
  const st = fold(null, [user("close the tab")]);
  expect(decide(run(`await tools.browse.tabs({ action: "close", tab: 999 })`), { state: st })).toBeNull();
});
