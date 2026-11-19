import { test, expect } from "bun:test";
import { LinkCheck, _internal } from "../plugins/context-engine/linkcheck.mjs";

const DEAD = "https://www.amazon.eg/-/en/Cruxial-CB8GS3200-8-GB-DDR4-Laptop-Ram/dp/B08BVWX2CH/";
const OK = "https://www.amazon.eg/-/en/Hikvision-DDR4-2666MHz-SODIMM-260Pin/dp/B0B716ZT1R/";
const BLOCKED = "https://www.jumia.com.eg/crucial-ram-8gb-ddr4-3200-mhz-cl22-laptop-memory-cb8gs3200-95758724.html";

const tool = (name, value, input = {}) => ({ role: "tool", content: [{ type: "tool-result", name, id: name + value.length, input, result: { type: "text", value } }] });
const fakeFetch = async (url) => {
  if (url === DEAD) return new Response("<html><title>Page Not Found</title></html>", { status: 404 });
  if (url === BLOCKED) return new Response("<html><title>Just a moment...</title></html>", { status: 403 });
  return new Response("<html><title>Hikvision DDR4 2666MHz 8GB</title>In Stock</html>", { status: 200 });
};

test("a 404 seen earlier in the session is pinned to its URL", () => {
  const lc = new LinkCheck({ fetchImpl: fakeFetch });
  lc.learn([tool("bash", `==================== ${DEAD}\nFETCH FAIL HTTP Error 404: Not Found\n==================== ${OK}\nHITS: in stock`)]);
  expect(lc.get(DEAD)?.status).toBe("dead");
  expect(lc.get(OK)).toBeNull();
});

test("webfetch error text uses the tool input URL", () => {
  const lc = new LinkCheck({ fetchImpl: fakeFetch });
  lc.learn([tool("webfetch", "Error: StatusCode: non 2xx status code (503 GET)", { url: OK })]);
  expect(lc.get(OK)?.status).toBe("blocked");
});

test("links in a subagent report are opened and the bad ones flagged in place", async () => {
  const lc = new LinkCheck({ fetchImpl: fakeFetch });
  const report = `| Amazon.eg | Crucial | 3,574.80 | In Stock | ${DEAD} |\n| Amazon.eg | Hikvision | 2,410 | In Stock | ${OK} |\n| Jumia | Crucial | 3,780 | ${BLOCKED} |`;
  const messages = [{ role: "user", content: [{ type: "text", text: "find ram" }] }, tool("subagent", report)];
  await lc.probe(messages);
  expect(lc.get(DEAD).status).toBe("dead");
  expect(lc.get(OK).status).toBe("ok");
  expect(lc.get(BLOCKED).status).toBe("blocked");
  const { messages: out, notes } = lc.annotate(messages);
  expect(notes).toBe(1);
  const text = out[1].content[0].result.value;
  expect(text).toContain(`${DEAD} -> DOES NOT EXIST (HTTP 404`);
  expect(text).toContain(`${BLOCKED} -> could not be opened`);
  expect(text).not.toContain(`${OK} ->`);
  // originals untouched, and a second pass gives byte-identical text (prompt cache stays warm)
  expect(messages[1].content[0].result.value).toBe(report);
  expect(lc.annotate(messages).messages[1].content[0].result.value).toBe(text);
});

test("search pages, docs and comparison sites are not opened", () => {
  const { worthChecking } = _internal;
  expect(worthChecking("https://www.amazon.eg/-/en/ram-ddr4/s?k=ram+ddr4")).toBe(false);
  expect(worthChecking("https://www.egprices.com/en/product/x")).toBe(false);
  expect(worthChecking("https://github.com/a/b")).toBe(false);
  expect(worthChecking(OK)).toBe(true);
});

test("trailing markdown punctuation is not part of the URL", () => {
  expect(_internal.urlsIn(`see (${OK}).`)).toEqual([OK]);
  expect(_internal.urlsIn(`**${OK}**`)).toEqual([OK]);
});

// what OpenCode passes to plugins for a failed tool call (captured 2026-11-04)
const errorResult = (url, msg) => ({ role: "tool", content: [{ type: "tool-result", id: "e1", name: "webfetch", result: { type: "error", value: { error: { type: "unknown", message: msg ?? `StatusCode: non 2xx status code (503 GET ${url})` }, content: [] } }, providerExecuted: false }] });

test("a failed webfetch is re-opened once: 503 for the agent but 404 for real -> dead, note on the error", async () => {
  let calls = 0;
  const lc = new LinkCheck({ fetchImpl: async (u) => (calls++, fakeFetch(u)) });
  const msgs = [errorResult(DEAD)];
  lc.learn(msgs);
  expect(lc.get(DEAD).status).toBe("blocked");
  await lc.probe(msgs);
  expect(lc.get(DEAD).status).toBe("dead");
  lc.learn(msgs); await lc.probe(msgs); // next step: no second fetch
  expect(calls).toBe(1);
  const { messages: out, notes } = lc.annotate(msgs);
  expect(notes).toBe(1);
  expect(out[0].content[0].result.value.error.message).toContain("DOES NOT EXIST (HTTP 404");
  expect(msgs[0].content[0].result.value.error.message).not.toContain("harness");
});

test("a fetch that failed for the agent but opens for us stays 'not verified'", async () => {
  const lc = new LinkCheck({ fetchImpl: fakeFetch });
  const msgs = [errorResult(OK)];
  lc.learn(msgs); await lc.probe(msgs);
  expect(lc.get(OK).status).toBe("blocked");
  expect(lc.annotate(msgs).messages[0].content[0].result.value.error.message).toContain("could not be opened");
});

test("timeouts count as failures", () => {
  const lc = new LinkCheck({ fetchImpl: fakeFetch });
  lc.learn([{ role: "tool", content: [{ type: "tool-result", name: "webfetch", input: { url: OK }, result: { type: "error", value: { error: { message: "Request timed out" }, content: [] } } }] }]);
  expect(lc.get(OK)?.code).toBe("timeout");
});
