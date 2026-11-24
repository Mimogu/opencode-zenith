// Secret guard: API keys and tokens never reach the model provider.
// Why: 2026-11-24 a free model debugging @video-gen ran `grep -v '^#' free-models.env`; the sed it piped
// through masked only *API_KEY= lines, so HF_TOKEN, FAL_KEY, CLOUDFLARE_API_TOKEN and the OpenRouter key
// went to the provider in a tool result. AGENTS.md already forbade it; weak models ignore rules, so the
// request view is cleaned mechanically: every known secret value becomes `<redacted:NAME>` in tool results,
// tool inputs and the agent's own text. Commands that use `$NAME` still work (the shell expands it).
import fs from "fs";
import { resultText } from "./linkcheck.mjs";

const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS|CREDENTIALS?)$/i;
const MIN_LEN = 12;

/** NAME -> value pairs from `KEY=value` lines (export, quotes and comments allowed). */
export function parseEnv(text) {
  const out = new Map();
  for (const line of String(text || "").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out.set(m[1], v);
  }
  return out;
}

/** [[value, NAME]] longest first. Every value in the env files counts (they hold only keys and
 *  settings); from the process environment only names that look like secrets. */
export function collectSecrets({ files = [], env = process.env } = {}) {
  const found = new Map();
  const add = (name, value) => {
    const v = String(value || "");
    if (v.length < MIN_LEN || /^(true|false|\d+)$/i.test(v) || v.startsWith("/") || v.startsWith("~") || /^https?:\/\//.test(v)) return;
    if (!found.has(v)) found.set(v, name);
  };
  for (const f of files) {
    let text = "";
    try { text = fs.readFileSync(f, "utf-8"); } catch { continue; }
    for (const [k, v] of parseEnv(text)) add(k, v);
  }
  for (const [k, v] of Object.entries(env || {})) if (SECRET_NAME.test(k)) add(k, v);
  return [...found.entries()].sort((a, b) => b[0].length - a[0].length);
}

function scrub(text, secrets) {
  let t = String(text), n = 0;
  for (const [value, name] of secrets) {
    if (!t.includes(value)) continue;
    const parts = t.split(value);
    n += parts.length - 1;
    t = parts.join(`<redacted:${name}>`);
  }
  return { text: t, n };
}

function scrubDeep(x, secrets, count) {
  if (typeof x === "string") { const r = scrub(x, secrets); count.n += r.n; return r.text; }
  if (Array.isArray(x)) return x.map((y) => scrubDeep(y, secrets, count));
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, scrubDeep(v, secrets, count)]));
  return x;
}

/** Copy of `messages` with secret values replaced in tool results, tool-call inputs and assistant
 *  text/reasoning. The user's own messages are left as written. Unchanged messages keep identity. */
export function redactSecrets(messages, secrets) {
  if (!Array.isArray(messages) || !secrets?.length) return { messages, redacted: 0 };
  let total = 0;
  const out = messages.map((m) => {
    if (!m || m.role === "user" || m.role === "system" || !Array.isArray(m.content)) return m;
    let copy = null;
    m.content.forEach((part, j) => {
      if (part?.type === "tool-result") {
        const rt = resultText(part);
        if (!rt) return;
        const r = scrub(rt.text, secrets);
        if (!r.n) return;
        copy ??= structuredClone(m);
        resultText(copy.content[j]).set(r.text);
        total += r.n;
      } else if (part?.type === "tool-call" && part.input !== undefined) {
        const count = { n: 0 };
        const input = scrubDeep(part.input, secrets, count);
        if (!count.n) return;
        copy ??= structuredClone(m);
        copy.content[j].input = input;
        total += count.n;
      } else if ((part?.type === "text" || part?.type === "reasoning") && typeof part.text === "string") {
        const r = scrub(part.text, secrets);
        if (!r.n) return;
        copy ??= structuredClone(m);
        copy.content[j].text = r.text;
        total += r.n;
      }
    });
    return copy ?? m;
  });
  return { messages: total ? out : messages, redacted: total };
}

/** Cached secret list, re-read when an env file changes (checked at most every 5 s). */
export class SecretGuard {
  constructor(files) { this.files = files; this.sig = ""; this.list = []; this.checked = 0; }
  secrets() {
    const now = Date.now();
    if (now - this.checked < 5000 && this.list.length) return this.list;
    this.checked = now;
    const sig = this.files.map((f) => { try { const s = fs.statSync(f); return `${s.mtimeMs}:${s.size}`; } catch { return "-"; } }).join("|");
    if (sig !== this.sig || !this.list.length) { this.sig = sig; this.list = collectSecrets({ files: this.files }); }
    return this.list;
  }
}
