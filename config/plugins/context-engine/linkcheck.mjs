// Link check: free models report URLs they never opened, or opened and got an error page, as
// "verified" (2026-11-04: a browser subagent typed an Amazon product ID, got 404, and still wrote
// "In stock (add to cart), read on-page"; the parent repeated it as its top pick). Rules in prompts
// did not stop it, so the harness checks mechanically and writes the verdict into the tool result
// that carries the URL, right where the model reads it:
//   1. failures already in the session (webfetch errors, "404 Not Found", challenge pages) are
//      matched to their URL;
//   2. URLs in a subagent's report (the `subagent` tool result) are opened once (GET, browser UA,
//      8 s) and classified dead / ok / blocked.
// Verdicts are cached per URL for 30 min, so every later step sends byte-identical text.

const TTL_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 8000;
const MAX_ACTIVE = 12; // URLs opened per subagent report
const UA = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0";
const URL_RE = /https?:\/\/[^\s"'<>()\[\]{}|\\^`]+/g;
// what a failed fetch looks like in tool output, with the status it implies
const FAIL_RE = /(?:non 2xx status code \((\d{3})|HTTP Error (\d{3})|\b(\d{3}) (?:Not Found|Forbidden|Service Unavailable|Too Many Requests|Gone)\b|(Page Not Found)|(Just a moment\.\.\.)|(Robot Check|Enter the characters you see below)|(Request timed out|Transport error))/gi;
const DEAD_TITLE = /<title>[^<]*(page not found|404|not found|no longer available|does not exist)[^<]*<\/title>/i;
const CHALLENGE = /<title>[^<]*(just a moment|attention required|robot check|access denied|captcha)[^<]*<\/title>/i;
// only shop/product-like links are worth opening; docs and search pages are not claims
const SKIP_HOST = /(^|\.)(google|bing|duckduckgo|youtube|youtu|github|githubusercontent|wikipedia|egprices|qarenly|pcprice|kanbkam|opencode|anthropic|exa)\.[a-z.]+$/i;
const SKIP_PATH = /\/(search|s)\?|[?&](q|k|query)=/i;
const NOTE_TAG = "[harness link check";

const clean = (u) => u.replace(/[.,;:!?*_)\]}>]+$/, "");

export class LinkCheck {
  constructor({ log = () => {}, fetchImpl = globalThis.fetch } = {}) {
    this.log = log;
    this.fetch = fetchImpl;
    this.cache = new Map(); // url -> { at, status: "dead"|"ok"|"blocked", code, why }
  }

  get(url) {
    const v = this.cache.get(url);
    if (v && Date.now() - v.at < TTL_MS) return v;
    return null;
  }

  set(url, v) {
    // a page seen working wins over an older failure, a hard failure over "blocked"
    const old = this.get(url);
    if (old && old.status === "dead" && v.status === "blocked") return;
    this.cache.set(url, { ...v, at: Date.now() });
    if (this.cache.size > 2000) this.cache.delete(this.cache.keys().next().value);
  }

  /** Record failures visible in tool results (any agent: subagent failures count for the parent too). */
  learn(messages) {
    for (const p of toolResults(messages)) {
      const text = p.text;
      const inputUrls = urlsIn(JSON.stringify(p.part.input ?? ""));
      FAIL_RE.lastIndex = 0;
      let m;
      while ((m = FAIL_RE.exec(text))) {
        const code = m[1] || m[2] || m[3] || (m[4] ? "404" : m[5] || m[6] ? "challenge" : m[7] ? "timeout" : "");
        const url = nearestUrl(text, m.index) || (inputUrls.length === 1 ? inputUrls[0] : null);
        if (!url || this.get(url)) continue; // already known (and maybe probed): keep that verdict
        const dead = code === "404" || code === "410";
        this.set(url, { status: dead ? "dead" : "blocked", code, why: "failed earlier in this session" });
      }
    }
  }

  /** Open product links reported by subagents that nobody has checked yet. */
  async probe(messages) {
    const todo = [];
    // a fetch the agent saw fail: open it once ourselves (Amazon answers 503 to webfetch but 404 to us)
    for (const [u, v] of this.cache) {
      if (todo.length >= MAX_ACTIVE) break;
      if (v.status === "blocked" && !v.probed && Date.now() - v.at < TTL_MS && worthChecking(u)) todo.push(u);
    }
    for (const p of toolResults(messages)) {
      if (p.part.name !== "subagent" && p.part.name !== "task") continue; // OpenCode v2 calls it `subagent`
      for (const u of urlsIn(p.text)) {
        if (todo.length >= MAX_ACTIVE) break;
        if (!this.get(u) && worthChecking(u) && !todo.includes(u)) todo.push(u);
      }
    }
    if (!todo.length) return 0;
    await Promise.all(todo.map((u) => this.open(u)));
    this.log(`linkcheck: opened ${todo.length}: ${todo.map((u) => `${this.get(u)?.status}:${u.slice(0, 60)}`).join(" ")}`);
    return todo.length;
  }

  async open(url) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const r = await this.fetch(url, { redirect: "follow", signal: ctl.signal, headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" } });
      const body = (await r.text()).slice(0, 200000);
      let v;
      if (r.status === 404 || r.status === 410 || DEAD_TITLE.test(body)) v = { status: "dead", code: String(r.status === 200 ? 404 : r.status), why: "page not found" };
      else if (r.status >= 400 || CHALLENGE.test(body)) v = { status: "blocked", code: String(r.status), why: "the site blocked the check" };
      else v = { status: "ok", code: String(r.status), why: "opens" };
      if (v.status === "ok" && this.get(url)?.status === "blocked") v = { ...this.get(url), probed: true }; // it opens for us, but the agent never read it
      this.cache.set(url, { ...v, probed: true, at: Date.now() });
    } catch (e) {
      const old = this.get(url);
      this.cache.set(url, { ...(old || { status: "blocked", code: "timeout", why: "no answer within 8 s" }), probed: true, at: Date.now() });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Copy of `messages` with the verdicts appended to each tool result that mentions a bad URL
   *  (messages are cloned before editing: the originals may be shared with OpenCode's store). */
  annotate(messages) {
    if (!Array.isArray(messages)) return { messages, notes: 0 };
    let notes = 0;
    const out = messages.map((m) => {
      if (!Array.isArray(m?.content) || !m.content.some((p) => p?.type === "tool-result")) return m;
      let copy = null;
      m.content.forEach((part, j) => {
        if (part?.type !== "tool-result") return;
        const rt = resultText(part);
        if (!rt || rt.text.includes(NOTE_TAG)) return;
        const bad = [];
        for (const u of urlsIn(rt.text)) {
          const v = this.get(u);
          if (v && v.status !== "ok") bad.push({ u, v });
        }
        if (!bad.length) return;
        copy ??= structuredClone(m);
        const lines = bad.map(({ u, v }) => v.status === "dead"
          ? `- ${u} -> DOES NOT EXIST (HTTP ${v.code}, ${v.why}). Do not give this link or anything "read" from it.`
          : `- ${u} -> could not be opened (${v.code}, ${v.why}). Not verified: say so if you mention it.`);
        resultText(copy.content[j]).set(`${rt.text}\n\n${NOTE_TAG} (harness, not the user): ${bad.length} link(s) above are not verified pages]\n${lines.join("\n")}`);
        notes += 1;
      });
      return copy ?? m;
    });
    return { messages: notes ? out : messages, notes };
  }
}

export function toolResults(messages) {
  const out = [];
  if (!Array.isArray(messages)) return out;
  for (const m of messages) {
    if (!Array.isArray(m?.content)) continue;
    for (const part of m.content) {
      if (part?.type !== "tool-result") continue;
      const rt = resultText(part);
      if (rt) out.push({ part, text: rt.text, set: rt.set });
    }
  }
  return out;
}

export function resultText(part) {
  const r = part?.result;
  if (!r) return null;
  // a failed tool call: {type: "error", value: {error: {type, message}, content: []}}
  if (r.type === "error" && r.value?.error && typeof r.value.error.message === "string") {
    const e = r.value.error;
    return { text: e.message, set: (t) => { e.message = t; } };
  }
  if ((r.type === "text" || r.type === "error-text") && typeof r.value === "string") return { text: r.value, set: (t) => { r.value = t; } };
  if (r.type === "content" && Array.isArray(r.value)) {
    const texts = r.value.filter((x) => x?.type === "text" && typeof x.text === "string");
    if (!texts.length) return null;
    return { text: texts.map((x) => x.text).join("\n"), set: (t) => { r.value = [{ type: "text", text: t }, ...r.value.filter((x) => x?.type !== "text")]; } };
  }
  return null;
}

export function urlsIn(text) {
  return [...new Set((String(text).match(URL_RE) || []).map(clean))];
}

/** The URL closest before `idx` (within 400 chars), else the first after it (within 80). */
function nearestUrl(text, idx) {
  const before = text.slice(Math.max(0, idx - 400), idx).match(URL_RE);
  if (before?.length) return clean(before[before.length - 1]);
  const re = new RegExp(URL_RE.source, "g");
  re.lastIndex = idx;
  const after = re.exec(text); // the URL must start within 80 chars, but is taken whole
  return after && after.index - idx <= 80 ? clean(after[0]) : null;
}

// placeholders and local addresses are never claims about the real web
const PLACEHOLDER_HOST = /(^|\.)(example\.(com|org|net)|localhost|local|test|invalid|internal)$|^(127\.|0\.0\.0\.0|10\.|192\.168\.|\[?::1)/i;

export function worthChecking(u) {
  try {
    const url = new URL(u);
    if (SKIP_HOST.test(url.hostname) || PLACEHOLDER_HOST.test(url.hostname) || SKIP_PATH.test(url.pathname + url.search)) return false;
    return url.pathname.length > 1;
  } catch {
    return false;
  }
}

// exported for tests
export const _internal = { urlsIn, nearestUrl, worthChecking, toolResults };
