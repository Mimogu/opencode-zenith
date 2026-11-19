import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
// Tool hints: a failed tool call gets one line telling the model what works instead, written
// into the error itself (the one place a weak model is guaranteed to read). Measured failure:
// 2026-11-04 a browser subagent hit "Web search rate limited (HTTP 429)" 16 times in one run and
// kept retrying the same provider, and fetched Amazon/Jumia with webfetch (503/403) instead of a
// browser. Hints depend only on the tool result text, so every step sends identical bytes.

import { resultText } from "./linkcheck.mjs";
import { shellWrites, validatorFor } from "./validators.mjs";
import { browserSheet, browserServers, browserToolNames } from "./browsers.mjs";

const TAG = "[harness hint";
const KNOWN_MCP = ["playwright", "chrome-devtools", "browser-profile", "parallel", "api-anything"];
let MCP_SERVERS = null;
function mcpServers() {
  if (!MCP_SERVERS) {
    try {
      const configured = Object.keys(JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "opencode.json"), "utf-8")).mcp || {});
      MCP_SERVERS = [...new Set([...configured, ...KNOWN_MCP])];
    }
    catch { MCP_SERVERS = [...KNOWN_MCP]; }
  }
  return MCP_SERVERS;
}
// hosts that answer plain fetches with 403/503/challenges but work in a real browser
const BOT_WALL = /\b(amazon\.[a-z.]+|jumia\.[a-z.]+|noon\.com|aliexpress\.com|ebay\.[a-z.]+|walmart\.com|bestbuy\.com|linkedin\.com|instagram\.com|facebook\.com|x\.com|twitter\.com|reddit\.com|cloudflare)\b/i;

const RULES = [
  {
    // 2026-11-06 a fast model called memory_add directly, got this, and told the user "noted"
    when: (name, text) => /No tool named "[^"]+" is currently available/i.test(text),
    hint: "MCP tools are not called directly here: run them inside `execute`, e.g. `await tools.memory.memory_add({ domain, title, content, origin, evidence })`. If unsure of the server or the fields, first `await search({ query: \"<tool name>\" })` in `execute`. Then call it again; until it succeeds, do not tell the user it was done.",
  },
  {
    // a real 429 from a search call (not search results that merely mention rate limits)
    when: (name, text) => /\bHTTP 429\b|rate[- ]limited \(|Too Many Requests|"(?:status|code)":\s*429\b/i.test(text)
      && (/search/i.test(name) || (name === "execute" && text.length < 3000 && /search|exa|parallel/i.test(text))),
    hint: "This search provider is rate-limited for a while; retrying it will fail again. Search with Parallel instead (a separate provider): in `execute`, `await tools.parallel.web_search({ objective: \"<what you need>\", search_queries: [\"<query 1>\", \"<query 2>\"] })`. Or fetch a page you already know.",
  },
  {
    when: (name, text) => /webfetch|fetch/i.test(name) && BOT_WALL.test(text) && /\b(403|429|503)\b|Just a moment|Robot Check|captcha|timed out|Transport error/i.test(text),
    hint: "This site blocks plain fetches; the page may well exist. Open it in a real browser: the `camofox` MCP (stealth) or the `browser` subagent, then read the title, price and stock from the loaded page. Until then it is not verified.",
  },
  {
    when: (name, text) => /webfetch|fetch/i.test(name) && /\b(500|502|503|504)\b|timed out|Transport error|ECONNRESET|ETIMEDOUT/i.test(text),
    hint: "Retry once. If it fails again, open it with the `playwright` MCP, or say the page could not be opened; do not report its contents.",
  },
  {
    // 2026-11-06 the read-only verifier had python3 refused 5 times in rephrased forms, then spent
    // 8 minutes hand-computing float arithmetic it could not run
    when: (name, text) => /^(shell|bash)$/.test(name) && /permission\.rejected|Permission denied: shell\b/i.test(text),
    hint: "This command is not allowed for this agent, and rephrasing it (cd …&&, another interpreter, a pipe) is refused too. If you are a read-only subagent: do not work the result out by hand at length; read the code, and put the exact command under \"Needs running\" in your report for the caller to run. Otherwise it needs the user's approval: ask, or report it.",
  },
  {
    // OpenCode connects MCP servers on first use (4-10 s): until then a call answers "Unknown tool
    // '<server>.<tool>'". 2026-11-18 a headless run read that as "playwright does not exist", started
    // Firefox by hand, tried other tools and needed 37 steps; 17 such results in a week.
    when: (name, text) => /^execute$/.test(name) && mcpServers().includes((text.match(/Unknown tool '([\w-]+)\.[\w-]+'/) || [])[1]),
    // a tool that does exist on that server: it is still connecting; one that does not: a wrong name
    // (2026-11-18 review: a misspelled tool on a running server was told to "repeat the same call")
    hint: (name, text) => {
      const [, server, tool] = text.match(/Unknown tool '([\w-]+)\.([\w-]+)'/);
      const known = browserToolNames(server);
      if (known && !known.includes(tool)) return `\`${tool}\` is not a ${server} tool.\n${browserSheet(server)}\nUse an exact name from this list.`;
      return `The ${server} server is still starting: OpenCode connects each MCP server on its first use, which takes a few seconds. Repeat the same call to tools["${server}"].${tool} (do not switch to another browser or tool, do not start a browser by hand). If it still says Unknown tool after two tries, run \`await search({ query: "${server} ${tool}" })\` in execute and use the exact name it returns.`;
    },
  },
  {
    // 2026-11-18: camofox answered 500 on every tab (its Camoufox browser had been removed from
    // ~/.cache) and the agent spent 10 minutes and a 663 MB download repairing it mid-task
    when: (name, text) => /^execute$/.test(name) && /camofox error: 5\d\d|camofox.{0,40}Internal server error/i.test(text),
    hint: "camofox itself is failing (server error), not your call. Finish the task with another browser server (`playwright`, or `browser-profile` for logged-in pages) and tell the user camofox is broken. Its log says why: `journalctl --user -u camofox-browser -n 20`. Do not reinstall or download anything for it unless the user asks: a missing ~/.cache/camoufox is restored with `cd ~/.local/opt/camofox-browser && npm run fetch-bin` (663 MB).",
  },
  {
    // OpenCode runs subagents in the background: 2026-11-18 one image was sent to the vision subagent 16
    // times, each call answering "working in the background"
    when: (name, text) => /^(subagent|task)$/.test(name) && /working in the background/i.test(text),
    hint: "It is already running; calling it again starts another copy and returns this same note. Do not call it again for the same task: continue with other work, or end your step; its answer arrives as a <subagent> message. To look at one image file now, run `see <file> \"question\"` in the shell instead: it answers in the same call.",
  },
  {
    when: (name, text) => /^(shell|bash)$/.test(name) && /command not found|No such file or directory.*\/bin\//i.test(text),
    hint: "Find the real command before trying again: `command -v <name>`, `pacman -Qo <path>`, `pacman -F <name>` or `<tool> --help`. Do not guess a different command name.",
  },
];

// A browser call failed: attach the exact sheet of the server(s) the script called (bin/browser-tools,
// generated from each server's tools/list). 2026-11-18 Firefox sessions guessed Playwright names on
// my-firefox and statements for evaluate_script, one failed step per guess, for minutes.
const CALL_ERROR = /### Error|\bError:|is not a function|Invalid arguments|Missing key|Unknown identifier|Invalid function format|cannot receive keyboard focus|not found in the current page snapshot|No tool named/i;
function browserHint(name, input, text) {
  if (!/^execute$/.test(name) || !CALL_ERROR.test(text)) return "";
  const code = String(input?.code || "");
  const used = [...new Set([...code.matchAll(/tools\s*\[\s*["'`]([\w-]+)["'`]\s*\]|tools\.([\w]+)/g)].map((m) => m[1] || m[2]))];
  const known = browserServers();
  const servers = used.filter((s) => known.includes(s));
  if (!servers.length) return "";
  return `${servers.map((s) => browserSheet(s)).join("\n")}\nFix the call with an exact name and fields from this list; do not retry the same call unchanged.`;
}

/** A config file of the user's machine was just written: name the command that makes the program
 *  itself check it (validators.mjs). Depends only on the call's input, so every step sends the same bytes. */
function configHint(name, input) {
  if (!input) return "";
  const files = /^(write|edit|patch|multiedit)$/.test(name) ? [input.path ?? input.filePath ?? input.file_path]
    : /^(shell|bash)$/.test(name) ? shellWrites(input.command, input.workdir) : [];
  for (const f of files) {
    const v = f && validatorFor(f, input.workdir);
    if (v && !(/^(shell|bash)$/.test(name) && v.ran.test(String(input.command)))) {
      return `This is a config file the program reads at startup. Check it now, before anything else: \`${v.cmd}\`, and fix what it reports. ${v.note ? v.note + " " : ""}Options, functions and keys you did not see in the installed docs or example config are guesses: confirm each or leave it out. Until the check passes, do not tell the user it works.`;
    }
  }
  return "";
}

/** Copy of `messages` with a hint appended to each failed tool result a rule matches, and to each
 *  write of a machine config file that has a checker. */
export function addHints(messages) {
  if (!Array.isArray(messages)) return { messages, hints: 0 };
  let hints = 0;
  const inputs = new Map(); // tool-call id -> input
  for (const m of messages) {
    if (!Array.isArray(m?.content)) continue;
    for (const p of m.content) if (p?.type === "tool-call" && p.id) inputs.set(p.id, p.input);
  }
  const out = messages.map((m) => {
    if (!Array.isArray(m?.content) || !m.content.some((p) => p?.type === "tool-result")) return m;
    let copy = null;
    m.content.forEach((part, j) => {
      if (part?.type !== "tool-result") return;
      const failed = part.result?.type === "error" || part.result?.type === "error-text";
      const rt = resultText(part);
      if (!rt || rt.text.includes(TAG)) return;
      const name = String(part.name || "");
      let hint = "";
      // shell and execute (MCP calls in Code Mode) report failures inside a normal result
      if (failed || /^(shell|bash|execute|subagent|task)$/.test(name)) { const rule = RULES.find((r) => r.when(name, rt.text)); hint = typeof rule?.hint === "function" ? rule.hint(name, rt.text) : rule?.hint || ""; }
      if (!hint) hint = browserHint(name, inputs.get(part.id), rt.text);
      if (!hint && !failed) hint = configHint(name, inputs.get(part.id));
      if (!hint) return;
      copy ??= structuredClone(m);
      resultText(copy.content[j]).set(`${rt.text}\n\n${TAG} (harness, not the user)] ${hint}`);
      hints += 1;
    });
    return copy ?? m;
  });
  return { messages: hints ? out : messages, hints };
}

export const _internal = { RULES, BOT_WALL };
