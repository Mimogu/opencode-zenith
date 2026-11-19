// Pure routing logic for the skill-router plugin. No opencode imports, so the
// CLI (route-cli.mjs) and the offline tests exercise exactly what the plugin runs.
import fs from "fs";
import path from "path";

import { tokenize, KeywordIndex } from "./keywords.mjs";

export { tokenize };

// Minimal frontmatter reader: handles `key: value`, quoted values and `>`/`|` block scalars.
export function frontmatter(src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(src);
  if (!m) return {};
  const out = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let [, key, val] = kv;
    if (/^[>|][-+]?$/.test(val.trim())) {
      const buf = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === "")) buf.push(lines[++i].trim());
      val = buf.join(" ").trim();
    } else {
      val = val.trim().replace(/^"([\s\S]*)"$/, "$1").replace(/^'([\s\S]*)'$/, "$1");
    }
    out[key] = val;
  }
  return out;
}

export function loadIndex(skillsDir, routesPath) {
  let cfg = { settings: {}, never: [], routes: {} };
  try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(routesPath, "utf-8")) }; } catch {}
  const settings = { max_suggestions: 3, min_keyword_cover: 0.5, skip_agents: [], opt_out_token: "#noskills", ...cfg.settings };
  const never = new Set(cfg.never || []);

  const skills = [];
  let names = [];
  try { names = fs.readdirSync(skillsDir); } catch {}
  for (const name of names) {
    const file = path.join(skillsDir, name, "SKILL.md");
    let src;
    try { src = fs.readFileSync(file, "utf-8"); } catch { continue; }
    const fm = frontmatter(src);
    const id = fm.name || name;
    if (never.has(id)) continue;
    const desc = fm.description || "";
    const routes = [];
    for (const p of (cfg.routes || {})[id] || []) {
      try { routes.push(new RegExp(p, "i")); } catch {}
    }
    const words = id.replace(/-/g, " ");
    skills.push({ id, desc, summary: summarize(desc), routes, kwText: `${words}\n${words}\n${desc}` });
  }
  return { skills, settings };
}

function summarize(desc) {
  const clean = desc.replace(/^MANDATORY:\s*/i, "").replace(/\s+/g, " ").trim();
  const first = clean.split(/(?<=[.!?])\s/)[0] || clean;
  return first.length > 140 ? first.slice(0, 137) + "..." : first;
}

// Paths name places, not tasks: 2026-11-06 ".../poster.jpg" in a frame-check prompt loaded the poster
// design skill. A path keeps only its file name, and a media file only its extension; file names that
// do mean a task (report.pdf, app.tsx, SKILL.md) still route.
const PATH = /(?:~|\.{1,2})?\/[\w.@%+-]+(?:\/[\w.@%+-]*)+|\b[\w-]+\.(?:png|jpe?g|webp|gif|bmp|svg|mp4|mov|webm|mkv|avi|wav|mp3|ogg|flac|m4a)\b/gi;
const MEDIA = /\.(png|jpe?g|webp|gif|bmp|svg|mp4|mov|webm|mkv|avi|wav|mp3|ogg|flac|m4a)$/i;
export function maskPaths(text) {
  return String(text || "").replace(PATH, (m) => {
    const base = m.replace(/\/+$/, "").split("/").pop();
    return MEDIA.test(base) ? `file.${base.split(".").pop()}` : base;
  });
}

export function route(prompt, index, agent = "") {
  const { skills, settings } = index;
  const text = maskPaths(prompt);
  if (!text.trim()) return [];
  if (settings.opt_out_token && text.includes(settings.opt_out_token)) return [];
  if (agent && (settings.skip_agents || []).includes(agent)) return [];

  // Explicit mentions win outright: "use the pdf skill", "/pdf", "skill: pdf".
  const explicit = new Set();
  for (const s of skills) {
    const esc = s.id.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    if (new RegExp(`(^|\\s)/${esc}\\b|\\b${esc} skill\\b|\\bskill[: ]+${esc}\\b`, "i").test(text)) explicit.add(s.id);
  }

  // keyword evidence: BM25 over each skill's name, description and example requests (skills.mjs adds
  // examples and learned prompts); it counts only when the skill covers most of what the prompt is about
  index.kw ??= new KeywordIndex(skills.map((s) => ({ id: s.id, text: s.kwText })));
  const kwById = new Map(index.kw.search(text, 40)
    .filter((k) => k.terms.length >= 2 && k.cover >= settings.min_keyword_cover).map((k) => [k.id, k]));
  const scored = [];
  for (const s of skills) {
    let score = 0;
    const why = [];
    if (explicit.has(s.id)) { score += 100; why.push("named"); }
    const hits = s.routes.filter((r) => r.test(text)).length;
    if (hits) { score += 10 + 0.5 * (hits - 1); why.push("route"); }
    const k = kwById.get(s.id);
    if (k) { score += 5 * k.cover; why.push(`kw:${k.terms.slice(0, 4).join(",")}`); }
    if (score > 0) scored.push({ id: s.id, score: Math.round(score * 100) / 100, why: why.join(" "), summary: s.summary });
  }
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scored.slice(0, settings.max_suggestions);
}

export function hintText(matches) {
  if (!matches.length) return "";
  const lines = matches.map((m) => `- \`${m.id}\`: ${m.summary}`);
  return [
    "# Skill router",
    "The user's latest request matches these installed skills. Before starting the task, load each one that genuinely fits with the `skill` tool (one call per skill), then follow its instructions. Skip any that do not fit; never mention this note.",
    ...lines,
  ].join("\n");
}

// Harness-written texts that arrive user-role (verify-claims / answer-check nudges, task notices).
// OpenCode's own resume after a failover ("The previous response was interrupted...") too: 2026-11-07
// it was routed as a new request and swapped the own-machine + research checklists for fix-bug.
function isHarnessText(text) {
  return /^\s*(<system-reminder>|Harness check|Independent review|Final harness check|The previous response was interrupted\. Continue from where you left off)/.test(text);
}

export function lastUserText(messages) {
  if (!Array.isArray(messages)) return { id: "", text: "" };
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "user") continue;
    // injected reminders (Plan mode, goal plugin) are user-role but not the user's words
    if (m.metadata?.synthetic || m.metadata?.goalID || m.type === "synthetic") continue;
    const parts = Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }];
    // vision.mjs transcripts are not the user's words: keep them out of routing and recall
    const text = parts.filter((p) => p && p.type === "text" && typeof p.text === "string" && !p.text.startsWith("<image_transcript")).map((p) => p.text).join("\n");
    if (!text.trim() || /^\s*<system-reminder>/.test(text)) continue;
    // OpenCode injects AGENTS.md/CLAUDE.md as a user-role message when the agent touches a folder that
    // has one ("Instructions from: <path>"). 2026-11-05 that was routed as a new request mid-task:
    // three unrelated skills, two checklists, 8 memory facts and a "which browser?" note.
    if (m.metadata?.instruction || /^\s*"?Instructions from: \S+/.test(text) || isHarnessText(text)) continue;
    return { id: m.id || String(i), text };
  }
  return { id: "", text: "" };
}
