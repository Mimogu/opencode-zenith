// Installed desktop apps, read live from desktop entries (XDG data dirs, ~/.local, Flatpak exports).
// A change request that names one of them ("fix Discord and Vesktop so…") is about the user's own
// machine even when it has none of the failure words the playbook routes look for. Re-read every
// 5 minutes, so installing or removing an app needs no config change.
import fs from "fs";
import os from "os";
import path from "path";

const TTL_MS = 5 * 60_000;
// names that are also everyday words: they would turn ordinary requests into machine tasks
const COMMON = new Set("files help settings editor text notes calculator calendar clock camera music videos photos image viewer document documents console terminal system monitor software update updates disks maps weather contacts tasks web browser mail email chat store about window windows app apps python java node ruby rust perl lua julia kotlin swift dart deno bun shell bash zsh fish code extensions tour fonts characters screenshot remote desktop network power color sound display keyboard mouse".split(" "));

let cache = { at: 0, names: [] };

function dirs() {
  const data = [process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local/share"),
    ...(process.env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":"),
    path.join(os.homedir(), ".local/share/flatpak/exports/share"), "/var/lib/flatpak/exports/share"];
  return [...new Set(data.map((d) => path.join(d, "applications")))].filter((d) => fs.existsSync(d));
}

export function installedApps() {
  if (Date.now() - cache.at < TTL_MS) return cache.names;
  const names = new Set();
  for (const d of dirs()) {
    let files = [];
    try { files = fs.readdirSync(d).filter((f) => f.endsWith(".desktop")); } catch { continue; }
    for (const f of files) {
      let src = "";
      try { src = fs.readFileSync(path.join(d, f), "utf-8"); } catch { continue; }
      const entry = src.split(/^\[/m).find((s) => s.startsWith("Desktop Entry]")) || "";
      if (/^NoDisplay\s*=\s*true/mi.test(entry) || /^Hidden\s*=\s*true/mi.test(entry)) continue;
      if (!/^Type\s*=\s*Application/mi.test(entry)) continue;
      // programming tools (python, node, code editors) are named in coding requests all the time
      if (/^Categories\s*=.*\bDevelopment\b/mi.test(entry)) continue;
      const name = entry.match(/^Name\s*=\s*(.+)$/m)?.[1]?.trim().toLowerCase();
      if (!name) continue;
      const words = name.replace(/[()]/g, " ").split(/[\s\-_:]+/).filter(Boolean);
      // the full name, and its first word when it is distinctive ("vesktop", "discord", "steam")
      if (name.length >= 4 && !COMMON.has(name)) names.add(name);
      if (words[0] && words[0].length >= 4 && !COMMON.has(words[0])) names.add(words[0]);
    }
  }
  cache = { at: Date.now(), names: [...names].sort((a, b) => b.length - a.length) };
  return cache.names;
}

/** Installed apps named in the text (whole words, case-insensitive). */
export function appsIn(text, names = installedApps()) {
  const t = ` ${String(text).toLowerCase()} `;
  return names.filter((n) => new RegExp(`(?<![\\w-])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(t)).slice(0, 5);
}
