// bun test tests/browsers_finder.test.mjs: browser choice (browsers.mjs) and skills.sh auto-install
// (skill-finder.mjs), with a fake browser list and a mocked network.
import { test, expect, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { Browsers } from "../plugins/context-engine/browsers.mjs";
import { SkillFinder } from "../plugins/context-engine/skill-finder.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bf-test-"));
const LIST = [
  { id: "firefox", name: "Firefox", engine: "gecko", mcp: "my-firefox", automatable: true, aliases: ["firefox"] },
  { id: "chrome", name: "Google Chrome", engine: "chromium", mcp: "my-browser", automatable: true, aliases: ["chrome"] },
  { id: "opera", name: "Opera GX", engine: "chromium", mcp: "my-browser", automatable: true, aliases: ["gx", "opera", "opera gx"] },
];
const fakeCtl = path.join(tmp, "browser-ctl");
fs.writeFileSync(fakeCtl, `#!/bin/sh\ncat <<'EOF'\n${JSON.stringify(LIST)}\nEOF\n`, { mode: 0o755 });

test("named browser wins; own-browser without a name asks; plain web tasks add nothing", async () => {
  const b = new Browsers({ bin: fakeCtl });
  expect((await b.decide("open youtube in firefox"))?.why).toBe("named:firefox");
  expect((await b.decide("log in to github with Opera GX"))?.why).toBe("named:opera");
  const ask = await b.decide("use my browser to check my inbox");
  expect(ask?.why).toBe("ask");
  expect(ask.text).toContain("Firefox (id `firefox`");
  expect(ask.text).toContain("built-in headless browser");
  expect(await b.decide("search the web for the latest bun release")).toBeNull();
  expect(await b.decide("debug the extension with chrome devtools")).toBeNull();
  expect(await b.decide("why is my code slow")).toBeNull();
});

test("the list is re-read, so a newly installed browser is recognised", async () => {
  const b = new Browsers({ bin: fakeCtl });
  expect(await b.decide("open it in vivaldi")).toBeNull();
  fs.writeFileSync(fakeCtl, `#!/bin/sh\ncat <<'EOF'\n${JSON.stringify([...LIST, { id: "vivaldi", name: "Vivaldi", engine: "chromium", mcp: "my-browser", automatable: true, aliases: ["vivaldi"] }])}\nEOF\n`, { mode: 0o755 });
  b.at = 0; // TTL expired
  expect((await b.decide("open it in vivaldi"))?.why).toBe("named:vivaldi");
});

// ------------------------------------------------------------------ skill finder
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const routes = path.join(tmp, "routes.json");
fs.writeFileSync(routes, JSON.stringify({ auto_install: { min_similarity: -1 } })); // no Ollama in tests
process.env.OMNIROUTE_API_KEY = "test";

function mockNet({ needs = true, query = "stripe webhooks", results = [], pick = "1", searchStatus = 200 }) {
  const calls = { search: [], chat: 0 };
  globalThis.fetch = async (url, opts) => {
    url = String(url);
    if (url.includes("/api/search")) {
      calls.search.push(new URL(url).searchParams.get("q"));
      return new Response(JSON.stringify({ skills: calls.search.length === 1 && results.length > 1 ? [] : results }), { status: searchStatus });
    }
    if (url.includes("skills.sh/")) return new Response('<meta name="description" content="Stripe webhook handling for Next.js"/>');
    if (url.includes("/chat/completions")) {
      calls.chat++;
      const body = JSON.parse(opts.body);
      const content = body.max_tokens > 10 ? JSON.stringify({ needs_skill: needs, query }) : pick;
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
    }
    if (url.includes("/api/embed")) return new Response("{}", { status: 500 });
    return realFetch(url, opts);
  };
  return calls;
}
const mkFinder = () => new SkillFinder({ dir: tmp, routesPath: routes, statePath: path.join(tmp, `state-${Math.random()}.json`) });
const STRIPE = { id: "hookdeck/webhook-skills/stripe-webhooks", source: "hookdeck/webhook-skills", skillId: "stripe-webhooks", name: "stripe-webhooks", installs: 598 };

test("a request that needs no skill stops after the plan call and is cached", async () => {
  const calls = mockNet({ needs: false });
  const f = mkFinder();
  expect(await f.find("explain what a mutex is in simple words please", new Set(), { dryRun: true })).toBeNull();
  expect(calls.search.length).toBe(0);
  expect(await f.find("explain what a mutex is in simple words please", new Set(), { dryRun: true })).toBeNull();
  expect(calls.chat).toBe(1); // negative cache: no second plan call
});

test("empty search drops the last word; installed, non-GitHub and unpopular skills are filtered", async () => {
  const results = [STRIPE, { ...STRIPE, id: "x/y/stripe", skillId: "stripe", installs: 5 }, { ...STRIPE, id: "open.feishu.cn/s", source: "open.feishu.cn", skillId: "s", installs: 99999 }];
  const calls = mockNet({ query: "stripe webhooks nextjs", results });
  const r = await mkFinder().find("set up stripe webhooks in my next.js app router project", new Set(), { dryRun: true });
  expect(calls.search).toEqual(["stripe webhooks nextjs", "stripe webhooks"]);
  expect(r?.id).toBe("stripe-webhooks");
  mockNet({ results: [STRIPE] });
  expect(await mkFinder().find("set up stripe webhooks in my next.js app router project", new Set(["stripe-webhooks"]), { dryRun: true })).toBeNull();
});

test("judge 0 = nothing installed; short or chatty prompts never search; 429 pauses the finder", async () => {
  mockNet({ results: [STRIPE], pick: "0" });
  expect(await mkFinder().find("build a SwiftUI settings screen with toggles", new Set(), { dryRun: true })).toBeNull();
  const calls = mockNet({ results: [STRIPE] });
  const f = mkFinder();
  expect(await f.find("thanks!", new Set(), { dryRun: true })).toBeNull();
  expect(await f.find("hi there how are you", new Set(), { dryRun: true })).toBeNull();
  expect(calls.chat).toBe(0);
  mockNet({ results: [STRIPE], searchStatus: 429 });
  expect(await f.find("set up stripe webhooks in my next.js project please", new Set(), { dryRun: true })).toBeNull();
  const c2 = mockNet({ results: [STRIPE] });
  expect(await f.find("configure stripe billing portal for my saas app", new Set(), { dryRun: true })).toBeNull();
  expect(c2.chat).toBe(0); // backing off
});
