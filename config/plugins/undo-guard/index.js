// Undo guard: before an agent deletes or overwrites the user's own configuration, keep a copy
// (shell: rm/shred/unlink/find -delete, `>` redirection, tee, sed -i, perl -i, truncate, cp/mv/install/ln/rsync
// onto an existing file; tools: write/edit/patch).
//
// 2026-11-11, "set up the end4-pC dotfile": asked to reinstall "from 0", a free model ran
//   echo "=== Removing old configs ==="; rm -f ~/.config/hypr/hypridle.conf; rm -f ~/.config/hypr/hyprlock.conf;
//   rm -rf ~/.config/illogical-impulse; rm -rf ~/.local/share/hyprland
// The first two belonged to the user's labwc session (idle lock and lock screen); nothing was backed
// up, and the `rm -rf *` ask rule never fired because the command starts with `echo` (rules match the
// start of the command line, and "always allow" was saved for `echo *`). They were recovered only
// because the agent had happened to `read` them an hour earlier.
//
// A permission prompt is the wrong tool for this (it is approved, or sidestepped as above), and a
// rule in the prompt is what the model ignored. So this is mechanical: on `execute.before`, paths a
// shell command is about to `rm`, and files a write/edit is about to overwrite, are copied to
//   ~/.local/share/opencode/undo/<date>-<time>-<session>/<absolute path>
// when they are under a protected folder. The command itself is never changed (a rewrite would
// change what OpenCode's permission rules see). Copies are kept 14 days, at most 2 GB.
//
// Restore: `cp -a ~/.local/share/opencode/undo/<run>/home/<user>/.config/x ~/.config/x`;
// `bin/undo-list` shows what is there. Off: OPENCODE_NO_UNDO_GUARD=1.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HOME = os.homedir();
const DATA = process.env.XDG_DATA_HOME || path.join(HOME, ".local/share");
export const UNDO_DIR = process.env.OPENCODE_UNDO_DIR || path.join(DATA, "opencode/undo");
const LOG = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..", "context-engine.log");
const MAX_ITEM = 300 * 1048576; // one deleted path larger than this is not copied (logged instead)
const MAX_FILE = 5 * 1048576;   // overwritten files
const KEEP_MS = 14 * 86_400_000;
const KEEP_BYTES = 2 * 1024 ** 3;

function log(msg) {
  try { fs.appendFileSync(LOG, `[${new Date().toISOString()}] undo-guard ${msg}\n`); } catch {}
}

// the user's own state; caches, trash, build output and this folder are not worth a copy
const PROTECTED = [".config", ".local/share", ".local/state", ".local/bin", ".ssh", ".gnupg", "Documents", "Desktop", "Pictures"].map((d) => path.join(HOME, d) + "/");
const SKIP = /\/(?:node_modules|\.cache|cache|Cache|CachedData|GPUCache|Trash|\.git\/objects|__pycache__|target|dist|build|logs?|tmp|temp|Steam|bottles|flatpak|containers|docker|pnpm|opencode\/(?:undo|snapshot|tool-output|log))(?:\/|$)/;

export function isProtected(file) {
  if (!path.isAbsolute(file) || SKIP.test(file)) return false;
  if (file.startsWith("/etc/")) return true;
  if (path.dirname(file) === HOME && path.basename(file).startsWith(".")) return !/^\.(config|local|cache|var)$/.test(path.basename(file)); // ~/.zshrc, ~/.bashrc
  // the protected folder itself is never a sensible target; only what is inside it
  return PROTECTED.some((d) => file.startsWith(d) && file.length > d.length);
}

function expandHome(tok, cwd) {
  let t = tok;
  if (t === "~" || t.startsWith("~/")) t = path.join(HOME, t.slice(1));
  t = t.replace(/^\$\{?HOME\}?(?=\/|$)/, HOME).replace(/^\$\{?XDG_CONFIG_HOME\}?(?=\/|$)/, path.join(HOME, ".config"));
  if (/[$`]/.test(t)) return null; // another variable or a substitution: unknown
  return path.isAbsolute(t) ? path.normalize(t) : cwd ? path.resolve(cwd, t) : null;
}

/** Shell words of one simple command; quotes removed, no expansion. */
function words(segment) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|((?:[^\s"'\\]|\\.)+)/g;
  let m, cur = "", last = 0;
  while ((m = re.exec(segment))) {
    if (m.index > last && /\s/.test(segment.slice(last, m.index)) && cur) { out.push(cur); cur = ""; }
    cur += m[1] !== undefined ? m[1].replace(/\\(["\\$`])/g, "$1") : m[2] !== undefined ? m[2] : m[3].replace(/\\(.)/g, "$1");
    last = re.lastIndex;
  }
  if (cur) out.push(cur);
  return out;
}

/** Simple commands of a command line: split on ; && || | & and newlines outside quotes. */
const PREFIX_CMD = /^(sudo|doas|command|exec|nice|ionice|chrt|time|env|nohup|setsid|timeout|stdbuf|xargs|unbuffer|then|do|else|\{|\()$/;
const PREFIX_ARG = {
  sudo: /^-[ugCphrT]$/, doas: /^-[uC]$/, env: /^-[uSC]$|^--(unset|chdir|split-string)$/, nice: /^-n$|^--adjustment$/,
  ionice: /^-[cnpPu]$/, chrt: /^-[p]$/, timeout: /^-[sk]$|^--(signal|kill-after)$/, stdbuf: /^-[ioe]$/,
  xargs: /^-[aEeIiLlnPsd]$|^--(arg-file|delimiter|max-args|max-procs|max-chars|replace|eof)$/,
};

function segments(text) {
  const out = [];
  let cur = "", quote = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { cur += c; if (c === "\\" && quote === '"') cur += text[++i] ?? ""; else if (c === quote) quote = ""; continue; }
    if (c === "\\") { cur += c + (text[++i] ?? ""); continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    // ">|" is a clobbering redirect, not a pipe
    if (c === ";" || c === "\n" || (c === "|" && text[i - 1] !== ">") || (c === "&" && !/[<>]/.test(text[i - 1] || "") && text[i + 1] !== ">")) {
      if (c === "&" && /\d/.test(text[i - 1] || "") && text[i - 2] === ">") { cur += c; continue; }
      out.push(cur); cur = "";
      if (text[i + 1] === c && c !== ";" && c !== "\n") i++;
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out.filter((x) => x.trim());
}

function glob(pattern) {
  if (!/[*?[]/.test(pattern)) return [pattern];
  const dir = path.dirname(pattern), base = path.basename(pattern);
  if (/[*?[]/.test(dir)) return []; // only the last component: `rm -rf ~/.config/foo/*`
  const re = new RegExp("^" + base.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
  try { return fs.readdirSync(dir).filter((n) => re.test(n) && (base.startsWith(".") || !n.startsWith("."))).map((n) => path.join(dir, n)); } catch { return []; }
}

// Truncating redirections: `>`, `1>`, `>|`, `&>` (not `>>` appends, not `2>` error logs, not `>&2`).
const TRUNCATE = /^(?:1?>\|?|&>)$/;
const OPT_WITH_ARG = { sed: /^(-e|-f|--expression|--file)$/, perl: /^(-e|-E|-I|-M)$/ };

/** Files the simple command `w` (words, redirections already removed) overwrites in place. */
function overwrites(cmd, w, here, add) {
  const args = w.slice(1);
  const plain = (list) => list.filter((a) => !a.startsWith("-"));
  if (cmd === "tee") {
    if (!args.some((a) => a === "-a" || a === "--append")) for (const a of plain(args)) add(a);
  } else if (cmd === "sed" || cmd === "perl") {
    if (!args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith("--in-place"))) return;
    const files = [];
    let script = args.some((a) => OPT_WITH_ARG[cmd].test(a)) || cmd === "perl" ? 1 : 0; // no -e: the first word is the script
    for (let i = 0; i < args.length; i++) {
      if (OPT_WITH_ARG[cmd].test(args[i])) { i++; continue; }
      if (args[i].startsWith("-")) continue;
      if (script === 0) { script = 1; continue; }
      files.push(args[i]);
    }
    for (const f of files) add(f);
  } else if (cmd === "truncate") {
    for (let i = 0; i < args.length; i++) { if (/^-(s|r)$|^--(size|reference)$/.test(args[i])) { i++; continue; } if (!args[i].startsWith("-")) add(args[i]); }
  } else if (/^(cp|mv|install|ln|rsync)$/.test(cmd)) {
    const ti = args.findIndex((a) => a === "-t" || a === "--target-directory");
    const ops = plain(args.filter((_, i) => ti < 0 || (i !== ti && i !== ti + 1)));
    const destRaw = ti >= 0 ? args[ti + 1] : ops.pop();
    if (!destRaw || !ops.length) return;
    const dest = expandHome(destRaw, here);
    if (!dest) return;
    let isDir = false; try { isDir = fs.statSync(dest).isDirectory(); } catch {}
    if (!isDir) { if (ops.length === 1 || ti >= 0) add(dest); return; }
    for (const src of ops) add(path.join(dest, path.basename(src.replace(/\/+$/, ""))));
  }
}

/** Absolute paths a shell command line deletes (`rm`, `shred`, `unlink`, `find -delete`) and writes in
 *  place (`>` redirection, `tee`, `sed -i`, `perl -i`, `truncate`, `cp`/`mv`/`install`/`ln`/`rsync` onto a
 *  file), also behind sudo, `cd x &&`, `;`, pipes and `sh -c "…"`. Unfiltered: paths may not exist yet.
 *  Shared with context-engine/validators.mjs (which config files to check after a write). */
export function shellPaths(command, cwd = HOME) {
  const deleted = new Set(), written = new Set();
  const scan = (text, dir, depth) => {
    let here = dir;
    const into = (set) => (a) => { const f = expandHome(a, here); if (f) for (const g of glob(f)) set.add(g); };
    const del = into(deleted), add = into(written);
    for (const seg of segments(String(text))) {
      const raw = words(seg);
      for (let i = 0; i < raw.length; i++) {
        if (TRUNCATE.test(raw[i]) && raw[i + 1]) add(raw[i + 1]);
        else { const m = /^(?:1?>\|?|&>)([^>&|].*)$/.exec(raw[i]); if (m && i > 0) add(m[1]); }
      }
      let w = words(seg.replace(/\s\d?>>?\|?\s*\S+|\s&>\s*\S+|\s\d?>&\d/g, " "));
      // wrappers that run the rest of the line as a command; their options (and the ones taking a value) go too.
      // 2026-11-18 review: `env rm -rf ~/.config/hypr`, `nohup rm …` were not backed up
      while (w.length && (/^\w+=/.test(w[0]) || PREFIX_CMD.test(path.basename(w[0])))) {
        const pre = path.basename(w[0]);
        w = w.slice(1);
        const takes = PREFIX_ARG[pre];
        while (w.length && /^-/.test(w[0])) w = w.slice(takes && takes.test(w[0]) && !w[0].includes("=") ? 2 : 1);
        if (pre === "env") while (w.length && /^\w+=/.test(w[0])) w = w.slice(1);
        if (pre === "timeout" && w.length && /^\d+(\.\d+)?[smhd]?$/.test(w[0])) w = w.slice(1);
        if ((pre === "nice" || pre === "ionice" || pre === "chrt") && w.length && /^-?\d+$/.test(w[0])) w = w.slice(1);
      }
      if (!w.length) continue;
      const cmd = path.basename(w[0]);
      if (cmd === "cd" && w[1]) { const d = expandHome(w[1], here); if (d) here = d; continue; }
      if (/^(ba|z|da|k)?sh$|^fish$/.test(cmd) && depth < 2) {
        const i = w.indexOf("-c");
        if (i > 0 && w[i + 1]) scan(w[i + 1], here, depth + 1);
        continue;
      }
      if (cmd === "find" && w.includes("-delete") && w[1] && !w[1].startsWith("-")) {
        del(w[1]);
        continue;
      }
      if (cmd !== "rm" && cmd !== "shred" && cmd !== "unlink") { overwrites(cmd, w, here, add); continue; }
      let opts = true;
      for (const a of w.slice(1)) {
        if (opts && a === "--") { opts = false; continue; }
        if (opts && a.startsWith("-")) continue;
        del(a);
      }
    }
  };
  scan(command, cwd, 0);
  return { deleted: [...deleted], written: [...written] };
}

/** What `shellPaths` finds that exists and is protected: the paths worth a copy before the command runs. */
export function rmTargets(command, cwd = HOME) {
  const { deleted, written } = shellPaths(command, cwd);
  return [...new Set([...deleted, ...written])].filter((f) => isProtected(f) && exists(f));
}

function exists(f) { try { fs.lstatSync(f); return true; } catch { return false; } }

function sizeOf(f, limit) {
  let total = 0;
  const walk = (p) => {
    if (total > limit) return;
    let st; try { st = fs.lstatSync(p); } catch { return; }
    if (st.isDirectory()) { let n = []; try { n = fs.readdirSync(p); } catch {} for (const x of n) walk(path.join(p, x)); }
    else total += st.size;
  };
  walk(f);
  return total;
}

const stamp = (d = new Date()) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;

/** Copy `files` under a new run folder. Returns { dir, saved[], skipped[] }. */
export function backup(files, { sessionID = "", why = "", root = UNDO_DIR, maxItem = MAX_ITEM } = {}) {
  const saved = [], skipped = [];
  // a folder and something inside it: the folder covers both
  const tops = files.filter((f) => !files.some((o) => o !== f && f.startsWith(o + "/")));
  const dir = path.join(root, `${stamp()}-${String(sessionID).replace(/^ses_/, "").slice(0, 8) || "nosession"}`);
  for (const f of tops) {
    const size = sizeOf(f, maxItem);
    if (size > maxItem) { skipped.push(`${f} (over ${Math.round(maxItem / 1048576)} MB)`); continue; }
    const dest = path.join(dir, f);
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      execFileSync("cp", ["-a", "--reflink=auto", "--", f, dest], { timeout: 60_000, stdio: "ignore" });
      saved.push(f);
    } catch (e) { skipped.push(`${f} (${String(e.message).slice(0, 80)})`); }
  }
  if (saved.length) {
    try { fs.appendFileSync(path.join(root, "INDEX.log"), `${new Date().toISOString()}\t${sessionID}\t${dir}\t${why.replace(/\s+/g, " ").slice(0, 200)}\t${saved.join(" ")}\n`); } catch {}
  }
  return { dir, saved, skipped };
}

/** Drop runs older than 14 days, then the oldest until the folder is under 2 GB. */
export function prune(root = UNDO_DIR, { keepMs = KEEP_MS, keepBytes = KEEP_BYTES, now = Date.now() } = {}) {
  let runs = [];
  try { runs = fs.readdirSync(root).filter((n) => /^\d{8}-\d{6}-/.test(n)).sort(); } catch { return 0; }
  let removed = 0;
  const sizes = runs.map((n) => ({ n, p: path.join(root, n), t: fs.statSync(path.join(root, n)).mtimeMs, s: sizeOf(path.join(root, n), Infinity) }));
  let total = sizes.reduce((a, r) => a + r.s, 0);
  for (const r of sizes) {
    if (now - r.t > keepMs || total > keepBytes) {
      try { fs.rmSync(r.p, { recursive: true, force: true }); total -= r.s; removed++; } catch {}
    }
  }
  return removed;
}

function sessionDir(sessionID) {
  if (!sessionID) return null;
  try {
    const { Database } = require("bun:sqlite");
    const db = new Database(process.env.OPENCODE_DB_PATH || path.join(DATA, "opencode/opencode.db"), { readonly: true });
    try { return db.query("SELECT directory FROM session_v2 WHERE id = ?").get(sessionID)?.directory || null; } finally { db.close(); }
  } catch { return null; }
}

const overwritten = new Set(); // `${sessionID}:${file}`: the first version per session is the one worth keeping

export function onTool(e) {
  if (process.env.OPENCODE_NO_UNDO_GUARD === "1") return null;
  const tool = String(e?.tool ?? "").toLowerCase();
  const input = e?.input;
  if (!input || typeof input !== "object") return null;
  let files = [], why = "";
  if (tool === "shell" || tool === "bash") {
    const command = String(input.command || "");
    if (!/\b(rm|shred|unlink|find|tee|sed|perl|truncate|cp|mv|install|ln|rsync)\b|>/.test(command)) return null;
    files = rmTargets(command, input.workdir || input.cwd || sessionDir(e.sessionID) || HOME);
    why = command;
  } else if (/^(write|edit|patch|multiedit)$/.test(tool)) {
    const p = input.path ?? input.filePath ?? input.file_path;
    if (!p) return null;
    const f = expandHome(String(p), input.workdir || sessionDir(e.sessionID) || HOME);
    const key = `${e.sessionID}:${f}`;
    if (!f || overwritten.has(key) || !isProtected(f)) return null;
    let st; try { st = fs.statSync(f); } catch { return null; }
    if (!st.isFile() || st.size > MAX_FILE) return null;
    overwritten.add(key);
    if (overwritten.size > 5000) overwritten.clear();
    files = [f];
    why = `${tool} ${f}`;
  }
  if (!files.length) return null;
  const r = backup(files, { sessionID: e.sessionID, why });
  if (r.saved.length) log(`${e.sessionID || "?"} kept ${r.saved.length} path(s) in ${r.dir} before: ${why.replace(/\s+/g, " ").slice(0, 160)}`);
  if (r.skipped.length) log(`${e.sessionID || "?"} NOT kept: ${r.skipped.join("; ")}`);
  return r;
}

export default {
  id: "undo-guard",
  async setup(ctx) {
    if (process.env.OPENCODE_NO_UNDO_GUARD === "1") return;
    try { const n = prune(); if (n) log(`pruned ${n} old run(s)`); } catch {}
    await ctx?.tool?.hook?.("execute.before", (e) => { try { onTool(e); } catch (err) { log(`error: ${err.message}`); } });
  },
};
