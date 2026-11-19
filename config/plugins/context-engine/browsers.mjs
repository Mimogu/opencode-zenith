// browsers: which browser a request should use, decided per user message.
//
//   the user names an installed browser ("in Firefox", "with chrome")   -> use that browser
//   the user wants their own / a real browser driven, names none         -> ask which (question tool)
//   any other web task                                                   -> nothing added: the built-in
//                                                                           headless MCP servers stay default
// The installed list comes from `bin/browser-ctl list --json` (desktop entries, re-read live), cached
// for a minute, so installing or removing a browser is picked up without touching this file.
//   OPENCODE_NO_BROWSER_INTENT=1  off
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const TTL_MS = 60_000;
const OWN_BROWSER = [
  /\b(my|own|real|actual|personal|the user'?s|desktop|visible|regular|normal|everyday|default) (web ?)?browsers?\b/i,
  /\b(automate|control|drive|operate|take over|use|run)\b(\W+\w+){0,4}\W+(the |a )?browser\b(?!\W+(search|tool|mcp|devtools))/i,
  /\bbrowser automation\b/i,
  /\bin a (real|visible|headed|non-headless) browser\b/i,
  /\b(where|so) i can (see|watch)\b(\W+\w+){0,5}\W+browser\b/i,
];

// Exact tool sheets per browser server, generated from each server's own tools/list by bin/browser-tools
// (state/browser-tools.json): every server names its tools differently, and 2026-11-18 a model used
// Brave's Playwright names on Firefox, one failed step per guess. Re-read when the file changes.
const SHEETS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "state", "browser-tools.json");
let sheetCache = { mtime: 0, data: {} };
export function browserSheet(server) {
  try {
    const m = fs.statSync(SHEETS).mtimeMs;
    if (m !== sheetCache.mtime) sheetCache = { mtime: m, data: JSON.parse(fs.readFileSync(SHEETS, "utf-8")) };
  } catch { return ""; }
  return sheetCache.data[server]?.sheet || "";
}
export const browserServers = () => { browserSheet(""); return Object.keys(sheetCache.data); };
export const browserToolNames = (server) => { browserSheet(""); return sheetCache.data[server]?.tools || null; };

export class Browsers {
  constructor({ bin, log }) {
    this.bin = bin;
    this.log = log || (() => {});
    this.list = null;
    this.at = 0;
    this.loading = null;
    if (process.env.OPENCODE_NO_BROWSER_INTENT !== "1") this.load(); // warm: names are known before the first prompt
  }

  load() {
    if (this.list && Date.now() - this.at < TTL_MS) return Promise.resolve(this.list);
    if (this.loading) return this.loading;
    this.loading = new Promise((resolve) => {
      execFile(this.bin, ["list", "--json", "--no-state"], { timeout: 30_000 }, (err, out) => {
        this.loading = null;
        try {
          if (err) throw err;
          this.list = JSON.parse(out);
          this.at = Date.now();
        } catch (e) {
          this.log(`browsers: ${e.message}`);
        }
        resolve(this.list || []);
      });
    });
    return this.loading;
  }

  named(text, list) {
    const t = ` ${text.toLowerCase().replace(/\s+/g, " ")} `;
    return list.filter((b) => (b.aliases || []).some((a) => {
      const esc = a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // "chrome devtools" / "firefox extension" development talk is not a browser choice
      return new RegExp(`(?<![\\w-])${esc}(?![\\w-])(?!\\s+(devtools|extension|web store|api|mcp|driver))`, "i").test(t);
    }));
  }

  async decide(text) {
    if (process.env.OPENCODE_NO_BROWSER_INTENT === "1" || !text) return null;
    const own = OWN_BROWSER.some((r) => r.test(text));
    const list = await this.load();
    if (!list.length) return null;
    const hits = this.named(text, list);
    const fmt = (b) => `${b.name} (id \`${b.id}\`, ${b.automatable ? `MCP \`${b.mcp}\`` : "desktop-control only"})`;
    if (hits.length) {
      const b = hits[0];
      return {
        why: `named:${b.id}`,
        text: b.automatable
          ? `If this needs a browser, use the user's ${b.name}, not the headless servers: run \`browser-ctl start ${b.id}\` (exit 3 = it is open without its automation port: ask the user before \`browser-ctl restart ${b.id}\`; exit 4 = another browser holds the port: ask before stopping it), then use the \`${b.mcp}\` MCP tools in a new tab. Follow the browser-automation skill.${browserSheet(b.mcp) ? `\n${browserSheet(b.mcp)}` : ""}`
          : `The user named ${b.name}, which cannot be automated over a protocol (${b.engine}). If the task needs it, drive it with the desktop-control skill (real cursor, \`see\` for the screen).`,
      };
    }
    if (own) {
      const auto = list.filter((b) => b.automatable);
      return {
        why: "ask",
        text: `The user wants a real browser driven but did not say which. Before opening any browser, ask with the question tool which one to use. Options (installed now): ${auto.map(fmt).join("; ")}; plus "built-in headless browser (no window, logged out)". Then run \`browser-ctl start <id>\` and use its MCP server.`,
      };
    }
    return null; // ordinary web task: the built-in headless servers (browser-automation skill) are the default
  }
}
