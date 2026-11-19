// bun test tests/undo_guard.test.mjs: what an agent deletes or overwrites in the user's config is kept first.
import { test, expect } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { rmTargets, isProtected, backup, prune } from "../plugins/undo-guard/index.js";

const HOME = os.homedir();
// real, existing protected paths to aim at (nothing is deleted: only the parser and the copy run)
const dir = fs.mkdtempSync(path.join(HOME, ".config", "undo-guard-test-"));
const a = path.join(dir, "hypridle.conf"), sub = path.join(dir, "illogical-impulse");
fs.writeFileSync(a, "listener { timeout = 600 }\n");
fs.mkdirSync(sub); fs.writeFileSync(path.join(sub, "config.json"), "{}\n");
const rel = (p) => p.replace(HOME, "~");
process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));

test("the 2026-11-11 command: rm behind echo, several per line", () => {
  const cmd = `echo "=== Removing old configs ==="; rm -f ${a}; rm -rf ${sub}; echo "EXIT: $?"; ls ${dir} 2>&1`;
  expect(rmTargets(cmd).sort()).toEqual([a, sub].sort());
});

test("~, $HOME, cd, sudo, sh -c, globs and quotes are followed", () => {
  expect(rmTargets(`rm -rf ${rel(sub)}`)).toEqual([sub]);
  expect(rmTargets(`rm -rf "$HOME/${path.relative(HOME, sub)}"`)).toEqual([sub]);
  expect(rmTargets(`cd ${dir} && rm -f hypridle.conf`)).toEqual([a]);
  expect(rmTargets(`echo 'pw' | sudo -S rm -rf ${sub}`)).toEqual([sub]);
  expect(rmTargets(`echo 'pw' | sudo -S sh -c "rm -rf ${sub}; rm -f ${a}"`).sort()).toEqual([a, sub].sort());
  expect(rmTargets(`rm -rf ${dir}/*`).sort()).toEqual([a, sub].sort());
  expect(rmTargets("rm -f hypridle.conf", dir)).toEqual([a]);
});

test("scratch, caches, unknown variables and missing paths are left alone", () => {
  expect(rmTargets("rm -rf /var/tmp/pip-scratch/* /tmp/x")).toEqual([]);
  expect(rmTargets(`rm -rf ${HOME}/.cache/thumbnails`)).toEqual([]);
  expect(rmTargets('rm -rf "$D/film.mp4"')).toEqual([]);
  expect(rmTargets(`rm -f ${dir}/does-not-exist`)).toEqual([]);
  expect(rmTargets(`grep -r rm ${a}; echo rm ${a}`)).toEqual([]);
  expect(isProtected(path.join(HOME, ".config"))).toBe(false);
  expect(isProtected(path.join(HOME, ".zshrc"))).toBe(true);
  expect(isProtected(path.join(HOME, ".config/x/node_modules/y"))).toBe(false);
});

test("backup keeps the tree under its absolute path, skips what is too big, and prune ages it out", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "undo-"));
  const r = backup([a, sub, path.join(sub, "config.json")], { sessionID: "ses_abc12345xyz", why: "rm -rf x", root });
  expect(r.saved.sort()).toEqual([a, sub].sort());
  expect(fs.readFileSync(path.join(r.dir, a), "utf-8")).toContain("timeout = 600");
  expect(fs.existsSync(path.join(r.dir, sub, "config.json"))).toBe(true);
  expect(fs.readFileSync(path.join(root, "INDEX.log"), "utf-8")).toContain("ses_abc12345xyz");
  expect(backup([sub], { root, maxItem: 1 }).skipped.length).toBe(1);
  expect(prune(root, { now: Date.now() + 15 * 86_400_000 })).toBeGreaterThan(0);
  expect(fs.readdirSync(root).filter((n) => /^\d{8}-/.test(n))).toEqual([]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("shell overwrites are kept too: >, tee, sed -i, perl -i, truncate, cp/mv/install/ln onto a file", () => {
  expect(rmTargets(`cat > ${a} <<'EOF'\nlistener {}\nEOF`)).toEqual([a]);
  expect(rmTargets(`echo x >${a}`)).toEqual([a]);
  expect(rmTargets(`echo x > ${rel(a)}`)).toEqual([a]);
  expect(rmTargets(`printf 'x' | sudo tee ${a} >/dev/null`)).toEqual([a]);
  expect(rmTargets(`sed -i 's/600/300/' ${a}`)).toEqual([a]);
  expect(rmTargets(`sed -i -e 's/a/b/' -e 's/c/d/' ${a}`)).toEqual([a]);
  expect(rmTargets(`perl -pi -e 's/a/b/' ${a}`)).toEqual([a]);
  expect(rmTargets(`truncate -s 0 ${a}`)).toEqual([a]);
  expect(rmTargets(`cp /etc/hostname ${a}`)).toEqual([a]);
  expect(rmTargets(`mv /var/tmp/new.conf ${rel(a)}`)).toEqual([a]);
  expect(rmTargets(`cp -r /var/tmp/x/hypridle.conf /var/tmp/x/nope ${dir}`)).toEqual([a]); // into a folder: the file it replaces
  expect(rmTargets(`ln -sf /var/tmp/x ${a}`)).toEqual([a]);
});

test("appends, error logs, /dev/null, quotes and copies out of config are not overwrites", () => {
  expect(rmTargets(`echo x >> ${a}`)).toEqual([]);
  expect(rmTargets(`cmd 2> ${a}`)).toEqual([]);
  expect(rmTargets(`echo x | tee -a ${a}`)).toEqual([]);
  expect(rmTargets(`sed 's/a/b/' ${a} > /var/tmp/out`)).toEqual([]);
  expect(rmTargets(`echo "a > ${a}"`)).toEqual([]);
  expect(rmTargets(`cp ${a} /var/tmp/backup.conf`)).toEqual([]);
  expect(rmTargets(`ls > /dev/null 2>&1`)).toEqual([]);
});

test("review 2026-11-18: wrappers (env, nohup, timeout, setsid, xargs, nice -n) and >| are seen", async () => {
  const { shellPaths } = await import("../plugins/undo-guard/index.js");
  const H = os.homedir();
  const cases = [
    ["env rm -rf ~/.config/hypr", "deleted", `${H}/.config/hypr`],
    ["env -u FOO BAR=1 rm -f ~/.config/x.conf", "deleted", `${H}/.config/x.conf`],
    ["nohup rm -f ~/.config/x.conf &", "deleted", `${H}/.config/x.conf`],
    ["timeout 5 rm ~/.config/a.conf", "deleted", `${H}/.config/a.conf`],
    ["setsid -f rm ~/.config/b.conf", "deleted", `${H}/.config/b.conf`],
    ["nice -n 10 rm ~/.config/c.conf", "deleted", `${H}/.config/c.conf`],
    ["sudo -u root env rm /etc/foo.conf", "deleted", "/etc/foo.conf"],
    ["echo x >| ~/.config/y.conf", "written", `${H}/.config/y.conf`],
  ];
  for (const [cmd, kind, want] of cases) expect(shellPaths(cmd)[kind]).toContain(want);
  expect(shellPaths("ls | grep conf").deleted).toEqual([]);
});
