// Config validators: for a config file the agent wrote, the command that makes the program itself
// check it, and what counts as having checked.
//
// 2026-11-11, "set up the end4-pC dotfile": a free model wrote ~/.config/hypr/hyprland.lua from
// memory with functions that do not exist (`hl.input(...)`, `hl.decoration(...)`), tested only that
// the QML shell loads under another compositor, and reported "verified". Hyprland stopped at the
// first bad call, registered no keybinds and came up in its "Emergency mode"; the model then spent
// eight turns on systemd, fsck and disk space. `Hyprland --verify-config` names the bad line in 1 s.
//
// Used by toolhints.mjs (a note in the write/edit result: weak models act on those) and by
// answercheck.mjs (the turn ends without the check having run -> sent back once).
import os from "os";
import path from "path";
import { shellPaths } from "../undo-guard/index.js";

const HOME = os.homedir();

/** Only files that configure the user's machine: code projects have their own tests. */
export function isMachineConfig(p) {
  const f = abs(p);
  return f.startsWith(path.join(HOME, ".config") + "/") || f.startsWith("/etc/")
    || f.startsWith(path.join(HOME, ".local/share/applications") + "/")
    || (path.dirname(f) === HOME && path.basename(f).startsWith("."));
}

export function abs(p, base = HOME) {
  let f = String(p || "").trim();
  if (f === "~" || f.startsWith("~/")) f = path.join(HOME, f.slice(1));
  else if (f.startsWith("$HOME/")) f = path.join(HOME, f.slice(6));
  return path.isAbsolute(f) ? path.normalize(f) : path.resolve(base, f);
}

const q = (f) => (/^[\w@%+=:,./-]+$/.test(f) ? f : `'${f.replace(/'/g, `'\\''`)}'`);

// when: absolute path -> bool. cmd: the check to run. ran: a shell command that counts as the check.
const RULES = [
  { id: "hyprland", when: (f) => /\/hypr\/(?:.*\/)?[^/]+\.lua$|\/hypr\/(?:.*\/)?hyprland[^/]*\.conf$/.test(f),
    cmd: () => "Hyprland --verify-config", ran: /\bHyprland\b[^\n;|&]*--verify-config|\bhyprctl\s+(?:-\w+\s+)*configerrors/,
    note: "It reads the installed version's real config; for Lua, the valid functions are in /usr/share/hypr/hyprland.lua and /usr/share/hypr/stubs/." },
  { id: "sway", when: (f) => /\/sway\/config(?:\.d\/[^/]+)?$/.test(f), cmd: (f) => `sway -C -c ${q(f)}`, ran: /\bsway\s+(?:-\w+\s+)*(?:-C|--validate)/ },
  { id: "labwc", when: (f) => /\/labwc\/[^/]+\.xml$/.test(f), cmd: (f) => `xmllint --noout ${q(f)}`, ran: /\bxmllint\b|\bxml\.(?:etree|dom)\b/ },
  { id: "nginx", when: (f) => /^\/etc\/nginx\//.test(f), cmd: () => "sudo nginx -t", ran: /\bnginx\s+(?:-\w+\s+)*-[tT]\b/ },
  { id: "sshd", when: (f) => /\/ssh\/sshd_config(?:\.d\/[^/]+)?$/.test(f), cmd: () => "sudo sshd -t", ran: /\bsshd\s+(?:-\w+\s+)*-[tT]\b/ },
  { id: "fstab", when: (f) => f === "/etc/fstab", cmd: () => "findmnt --verify", ran: /\bfindmnt\s+(?:-\w+\s+)*--verify|\bmount\s+-(?:a|fav)\b/ },
  { id: "sudoers", when: (f) => /^\/etc\/sudoers(?:\.d\/|$)/.test(f), cmd: (f) => `sudo visudo -cf ${q(f)}`, ran: /\bvisudo\s+(?:-\w+\s+)*-c/ },
  { id: "systemd", when: (f) => /\/systemd\/(?:.*\/)?[^/]+\.(?:service|timer|socket|path|mount|target)$/.test(f),
    cmd: (f) => `systemd-analyze ${f.startsWith(HOME) ? "--user " : ""}verify ${q(f)}`, ran: /\bsystemd-analyze\s+(?:--user\s+)?verify\b/ },
  { id: "desktop", when: (f) => /\.desktop$/.test(f), cmd: (f) => `desktop-file-validate ${q(f)}`, ran: /\bdesktop-file-validate\b/ },
  { id: "fish", when: (f) => /\.fish$/.test(f), cmd: (f) => `fish -n ${q(f)}`, ran: /\bfish\s+(?:-\w+\s+)*(?:-n|--no-execute)\b/ },
  { id: "foot", when: (f) => /\/foot\/foot\.ini$/.test(f), cmd: (f) => `foot --check-config -c ${q(f)}`, ran: /\bfoot\s[^\n;|&]*--check-config/ },
  { id: "zsh", when: (f) => /\/\.?(?:zshrc|zshenv|zprofile)$|\.zsh$/.test(f), cmd: (f) => `zsh -n ${q(f)}`, ran: /\bzsh\s+(?:-\w+\s+)*-n\b/ },
  { id: "sh", when: (f) => /\.(?:sh|bash)$|\/\.?(?:bashrc|bash_profile|profile)$/.test(f), cmd: (f) => `bash -n ${q(f)}`, ran: /\b(?:ba)?sh\s+(?:-\w+\s+)*-n\b|\bshellcheck\b/ },
  { id: "json", when: (f) => /\.json$/.test(f), cmd: (f) => `jq empty ${q(f)}`, ran: /\bjq\b|\bjson\.tool\b|\bjson\.load|\bJSON\.parse/ },
  { id: "toml", when: (f) => /\.toml$/.test(f), cmd: (f) => `python3 -c 'import tomllib,sys; tomllib.load(open(sys.argv[1],"rb"))' ${q(f)}`, ran: /\btomllib\b|\btaplo\b/ },
];

/** { id, file, cmd, ran, note } for a machine config file that has a checker, else null. */
export function validatorFor(p, base) {
  const file = abs(p, base);
  if (!isMachineConfig(file)) return null;
  const r = RULES.find((x) => x.when(file));
  return r ? { id: r.id, file, cmd: r.cmd(file), ran: r.ran, note: r.note || "" } : null;
}

/** Files a shell command writes in place (`>`, tee, heredoc, sed -i, cp/mv onto a file …): the parser
 *  undo-guard uses to back them up, so both agree on what a command changes. */
export function shellWrites(command, cwd) {
  return shellPaths(String(command || ""), cwd || HOME).written.filter((f) => !/^\/dev\/|^\/tmp\/|^\/var\/tmp\//.test(f));
}

export const _internal = { RULES };
