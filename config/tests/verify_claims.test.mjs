// bun test tests/verify_claims.test.mjs: replies may not report changes that did not happen.
import { test, expect, describe } from "bun:test";
import { findClaims, check, evidence, nudgeText } from "../plugins/verify-claims/index.js";
import * as VC from "../plugins/verify-claims/index.js";

const T0 = 1_800_000_000_000;
const user = (text = "fix my screen sharing", created = T0) => ({ type: "user", id: `u${created}`, text, time: { created } });
const shell = (command, exit = 0) => ({ type: "tool", name: "shell", state: { status: "completed", input: { command }, metadata: { exit } } });
const edit = (p) => ({ type: "tool", name: "edit", state: { status: "completed", input: { path: p, oldString: "a", newString: "b" } } });
const reply = (text, tools = [], agent = "build") => ({ type: "assistant", agent, content: [...tools, { type: "text", text }] });
const statOld = () => ({ mtimeMs: T0 - 86_400_000 });
const statNew = () => ({ mtimeMs: T0 + 5000 });

const HALLUCINATED = `Fixed: window sharing is now enabled.

## What I changed
1. **Updated the wlr portal config** to use a dmenu chooser.
   - Edited \`~/.config/xdg-desktop-portal-wlr/config\`
2. **Restarted the portal services**.`;

test("the 2026-11-05 reply (14 read-only commands, then 'Fixed') is caught with evidence", () => {
  const r = check([user(), reply(HALLUCINATED, [shell("cat ~/.config/xdg-desktop-portal-wlr/config"), shell("strings /usr/bin/labwc | grep -i toplevel 2>/dev/null")])], { stat: statOld });
  expect(r).not.toBeNull();
  expect(r.problems[0]).toContain("No tool call in this turn changed anything");
  expect(r.problems.join(" ")).toContain("was not modified during this turn");
  expect(nudgeText(r, 1)).toContain("Do the work now");
});

test("a real edit of the claimed file passes", () => {
  const r = check([user(), reply(HALLUCINATED, [edit("~/.config/xdg-desktop-portal-wlr/config"), shell("systemctl --user restart xdg-desktop-portal-wlr")])], { stat: statNew });
  expect(r).toBeNull();
});

test("an edit that did not land (file mtime unchanged) is still flagged", () => {
  const r = check([user(), reply(HALLUCINATED, [shell("sed -i s/none/dmenu/ ~/.config/xdg-desktop-portal-wlr/config", 1), shell("systemctl --user restart xdg-desktop-portal-wlr")])], { stat: statOld });
  expect(r?.problems.join(" ")).toContain("~/.config/xdg-desktop-portal-wlr/config");
});

test("answers, suggestions and honest 'nothing changed' replies are not claims", () => {
  for (const t of ["The answer is 42.", "You should restart the portal after editing the file.", "I did not change anything. To fix it, edit the config.", "No changes were made.", "If you want, I can update the config."]) {
    expect(findClaims(t)).toEqual([]);
    expect(check([user("why?"), reply(t, [shell("cat x")])], { stat: statOld })).toBeNull();
  }
});

test("recap questions are judged against the whole session; plan/read-only agents are skipped", () => {
  const earlier = [user("fix it", T0), reply("ok", [edit("~/.config/x.conf")])];
  const recap = [...earlier, user("what did you change?", T0 + 60_000), reply("I edited `~/.config/x.conf`.")];
  expect(check(recap, { stat: () => ({ mtimeMs: T0 + 10_000 }) })).toBeNull();
  expect(check([user(), reply(HALLUCINATED, [], "plan")], { stat: statOld })).toBeNull();
});

test("shell evidence: redirects to /dev/null and greps are read-only; sed -i, tee, systemctl restart mutate", () => {
  const ev = evidence([shell("grep foo bar 2>/dev/null"), shell("ls > /dev/null"), shell("cat a | head"), shell("sed -i 's/a/b/' f"), shell("echo x | tee f"), shell("systemctl --user restart foo"), shell("echo x > /tmp/f")]);
  expect(ev.readOnly).toBe(3);
  expect(ev.mutations.length).toBe(4);
});

test("outcome review: only fix requests that end in 'Done/Fixed' are reviewed; the transcript carries tool outputs", async () => {
  const { needsReview, transcript } = await import("../plugins/verify-claims/index.js");
  const sh = (command, out) => ({ type: "tool", name: "shell", state: { status: "completed", input: { command }, content: [{ type: "text", text: out }], metadata: { exit: 0 } } });
  const fixTurn = [user("please fix screen sharing, it only lets me share full screen"), reply("Done. Your machine is now configured.", [sh("systemctl --user restart x", "")])];
  expect(needsReview(fixTurn)).toBe(true);
  expect(needsReview([user("what is a mutex?"), reply("Done. A mutex is a lock.")])).toBe(false);
  expect(needsReview([user("fix the bug"), reply("I could not reproduce it; here is what I found.")])).toBe(false);
  expect(transcript(fixTurn)).toContain("TOOL shell [completed, exit 0]: systemctl --user restart x");
});

test("bulleted '- **Fixed:**' summaries count as done-claims (run 3 of 2026-11-05)", async () => {
  const { needsReview } = await import("../plugins/verify-claims/index.js");
  expect(needsReview([user("fix screen sharing please"), reply("## Summary\n\n- **Fixed:** you can now share a single window.\n- **Root cause:** ...")])).toBe(true);
});

test("substantial reports after tool use are reviewed for accuracy; 'revise' asks to correct only the reply", async () => {
  const { needsReview, reviewNudge } = await import("../plugins/verify-claims/index.js");
  const long = "Here is what I found on your machine. ".repeat(15);
  expect(needsReview([user("how much swap do I have?"), reply(long, [shell("swapon --show")])])).toBe(true);
  expect(needsReview([user("how much swap do I have?"), reply("You have 8 GB of zram.", [shell("swapon --show")])])).toBe(false);
  expect(needsReview([user("explain mutexes"), reply(long)])).toBe(false);
  const n = reviewNudge({ verdict: "revise", reason: "guess stated as fact", unsupported: ["it broke (quoting issue)"] }, 1);
  expect(n).toContain('"it broke (quoting issue)"');
  expect(n).toContain("no other work is needed");
});

test("reviewer replies: fenced, cut-off and single-quoted JSON still give a verdict; junk gives none", async () => {
  const { parseVerdict } = await import("../plugins/verify-claims/index.js");
  expect(parseVerdict("```json\n{\"verdict\":\"revise\",\"unsupported\":[\"a\"]}\n```").unsupported).toEqual(["a"]);
  expect(parseVerdict('{"claims":[{"claim":"x"}],"verdict":"continue","reason":"not done","next_step":"read the conf').verdict).toBe("continue");
  expect(parseVerdict("{'verdict': 'done'}").verdict).toBe("done");
  expect(parseVerdict("Looks fine to me.")).toBeNull();
});

test("escalation target: the best measured model that is configured and not the current one", async () => {
  const { strongModel, honestReportNudge } = await import("../plugins/verify-claims/index.js");
  const s = strongModel("opencode/nemotron-3.5-lightning-free");
  expect(s).toMatch(/^omniroute\//);
  expect(strongModel(s)).not.toBe(s);
  expect(honestReportNudge()).toContain("Do not write Fixed, Done or Complete");
  expect(honestReportNudge("fix screen sharing in vesktop")).toContain("what you changed");
  expect(honestReportNudge("i want to buy a 1TB SSD for my laptop in egypt. what's the cheapest?")).toContain("final answer to their question");
});

test("ensemble: the stricter of two reviewers wins and their next steps merge", async () => {
  const src = (await import("fs")).readFileSync(new URL("../plugins/verify-claims/index.js", import.meta.url), "utf-8");
  expect(src).toContain("export async function reviewEnsemble");
  expect(src).toMatch(/const v = await reviewEnsemble\(/);
});

test("after compaction the summary starts the turn, so the final reply is still judged against the request", async () => {
  const { withCompaction, needsReview } = await import("../plugins/verify-claims/index.js");
  const msgs = [{ type: "compaction", id: "c1", time: { created: T0 }, summary: "## Objective\n- Fix the screenshare picker: no hardcoded app names" },
    reply("Fixed: the picker now shows clean names and icons.", [edit("~/.config/xdg-desktop-portal-wlr/share-picker.sh")])];
  const out = withCompaction(msgs);
  expect(out[0].type).toBe("user");
  expect(out[0].text).toContain("no hardcoded app names");
  expect(needsReview(out)).toBe(true);
  const later = [...msgs, user("thanks", T0 + 1000)];
  expect(withCompaction(later)).toBe(later); // a real user message after it wins
});

test("a video or picture made this turn but never looked at is sent back; see / vision count as looking", async () => {
  const { unseenMedia, unseenNudge } = await import("../plugins/verify-claims/index.js");
  const fresh = () => ({ mtimeMs: T0 + 5000 });
  const done = (tools) => [user("make a 20 second film about caches"), reply("Done: the film is at `/home/u/Videos/x/film.mp4`.", tools)];
  expect(unseenMedia(done([shell("sh build.sh")]), { stat: fresh })).toEqual(["/home/u/Videos/x/film.mp4"]);
  expect(unseenMedia(done([shell("for t in 2 9 16; do ffmpeg -ss $t -i film.mp4 -frames:v 1 f$t.jpg; done; see f2.jpg q; see f9.jpg q; see f16.jpg q")]), { stat: fresh })).toBeNull();
  const vision = { type: "tool", name: "subagent", state: { status: "completed", input: { agent: "vision", prompt: "look at f.jpg" } } };
  expect(unseenMedia(done([vision]), { stat: fresh })).toEqual(["/home/u/Videos/x/film.mp4"]); // one look is not the film
  const frames = { type: "tool", name: "subagent", state: { status: "completed", input: { agent: "vision", prompt: "look at /t/f1.jpg /t/f8.jpg and /t/f15.jpg" } } };
  expect(unseenMedia(done([frames]), { stat: fresh })).toBeNull();
  const poster = { type: "tool", name: "subagent", state: { status: "completed", input: { agent: "vision", prompt: "Look at /home/u/Videos/x/poster.jpg" } } };
  expect(unseenMedia(done([poster, poster, poster]), { stat: fresh })).toEqual(["/home/u/Videos/x/film.mp4"]);
  expect(unseenMedia(done([shell("sh build.sh")]), { stat: statOld })).toBeNull(); // an old file merely mentioned
  expect(unseenNudge(["/a.mp4"], 1)).toContain("Counting pixels");
});

test("a rate-limited reviewer sits out and the ensemble asks the next one", async () => {
  const { reviewerPool, reviewEnsemble, isCooling } = await import("../plugins/verify-claims/index.js");
  process.env.VERIFY_REVIEWER = "busy,ok1,ok2";
  process.env.OMNIROUTE_API_KEY = "test";
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (_u, o) => {
    const { model } = JSON.parse(o.body);
    asked.push(model);
    if (model === "busy") return new Response("{}", { status: 429 });
    return new Response(JSON.stringify({ choices: [{ message: { content: `{"verdict":"done","reason":"${model}"}` } }] }));
  };
  try {
    const v = await reviewEnsemble([user("fix it"), reply("Fixed.", [shell("true")])]);
    expect(v.model.split(",").sort()).toEqual(["ok1:done", "ok2:done"]);
    expect(isCooling("busy")).toBe(true);
    expect(reviewerPool()).toEqual(["busy", "ok1", "ok2"]); // env override is taken as given
  } finally { globalThis.fetch = real; delete process.env.VERIFY_REVIEWER; }
});

test("figures the reply quotes from deep in a long page reach the reviewer (2026-11-06 Bun release notes)", async () => {
  const { transcript } = await import("../plugins/verify-claims/index.js");
  const page = "intro\n".repeat(400) + "That's 286x faster than Prettier.\n" + "filler\n".repeat(400);
  const fetchTool = { type: "tool", name: "webfetch", state: { status: "completed", input: { url: "https://x" }, content: [{ type: "text", text: page }] } };
  const t = transcript([user("what changed in bun?"), reply("bun fmt is 286x faster than Prettier.", [fetchTool])]);
  expect(t).toContain("That's 286x faster than Prettier.");
  const { reviewNudge } = await import("../plugins/verify-claims/index.js");
  expect(reviewNudge({ verdict: "revise", unsupported: ["x"] }, 1)).toContain("without mentioning this review");
});

test("review status notifications: harness test sessions and subagents stay quiet; ok is not sent while another checker corrects", async () => {
  const { _internal } = await import("../plugins/context-engine/notify.mjs");
  expect(_internal.QUIET_DIR.test("/var/tmp/pip-scratch/opencode/taskbench/2026/cart-fix")).toBe(true);
  expect(_internal.QUIET_DIR.test("/home/user/projects/shop")).toBe(false);
  for (const k of ["checking", "ok", "fixing", "final", "none", "unavailable", "error"]) expect(_internal.TEXT[k][0].length).toBeGreaterThan(5);
  const { begin, tryClaim, claimedSince } = await import("../plugins/context-engine/nudge-gate.mjs");
  const t = begin();
  expect(claimedSince("s-notify", t)).toBeNull();
  tryClaim("s-notify", "answer-check", t);
  expect(claimedSince("s-notify", t)).toBe("answer-check");
  const src = (await import("fs")).readFileSync(new URL("../plugins/verify-claims/index.js", import.meta.url), "utf-8");
  expect(src).toMatch(/await waitDone\(sessionID, "answer-check", startedAt\);\s*if \(!claimedSince\(sessionID, startedAt\)\) notify\(sessionID, kind\)/);
  expect(src).toContain('notify(ev.sessionID, "error")');
  const { markDone, waitDone } = await import("../plugins/context-engine/nudge-gate.mjs");
  const t2 = Date.now();
  setTimeout(() => markDone("s-wait", "answer-check"), 300);
  expect(await waitDone("s-wait", "answer-check", t2, 3000)).toBe(true);
  expect(await waitDone("s-never", "answer-check", Date.now(), 500)).toBe(false);
});

test("a read-only answer's 'What I did not do' section and offers are not claims of changes (2026-11-06 disk)", () => {
  const reply = "## What I did not do\n\nI did not delete anything.\n\nIf you'd like, I can:\n- Look deeper into the biggest folders (`.local`, `/var/tmp`) to find files you might remove, or\n- Investigate the ~63 GB unaccounted gap, or\n\n## What I did / did not do\n\n- **Did:** read-only disk usage inspection (`df`, `lsblk`, `du`).\n- **Did not:** delete anything.";
  expect(findClaims(reply)).toEqual([]);
  expect(findClaims("## What I changed\n- `~/.config/x.conf`: chooser set to dmenu").length).toBe(1);
  expect(findClaims("## What I did\n- Edited the portal config").length).toBe(1);
});

test("the reviewer sees the core memory facts the agent was given (2026-11-06 laptop has no M.2 slot)", async () => {
  const { coreFacts } = await import("../plugins/verify-claims/index.js");
  expect(Array.isArray(coreFacts())).toBe(true);
  const src = (await import("fs")).readFileSync(new URL("../plugins/verify-claims/index.js", import.meta.url), "utf-8");
  expect(src).toContain("Verified facts the harness gave the agent from durable memory");
});

test("a delivered report is audited against the user's folder; untraced figures and invented metadata send it back (2026-11-10)", async () => {
  const fs = await import("fs"), os = await import("os"), path = await import("path");
  const { deliveredFiles, sourcePaths, auditDocs, docProblems, docNudge, auditNote } = await import("../plugins/verify-claims/index.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-doc-"));
  const data = path.join(dir, "data", "work");
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, "kpi.csv"), "Year,Cost per ton,Food\n2020,1.0573,-0.0015\n2024,0.9864,0.3382\n");
  const doc = path.join(dir, "report.md");
  fs.writeFileSync(doc, "Revision history\nFood inflation was 33.82% in 2024. Cost per ton fell from 1.0525 to 0.9803, and 129.9% of volume.\n");
  const msgs = [user(`create a 100% accurate data analysis report from ${data}`), reply(`Done: the report is at \`${doc}\`, verified against the data.`, [shell(`pandoc -o ${doc}`)])];
  // the user's folder is the source; the home folder or "/" alone never is
  expect(sourcePaths(msgs)).toEqual([data]);
  expect(sourcePaths([user("look in ~ and / for it")])).toEqual([]);
  expect(deliveredFiles(msgs, "md", { stat: () => ({ mtimeMs: T0 + 5000 }) })).toEqual([doc]);
  const [a] = await auditDocs(msgs, [doc]);
  expect(a.untraced_figures.map((u) => u.figure).sort()).toEqual(["0.9803", "1.0525", "129.9%"]);
  expect(docProblems(a)).toBe(true);
  expect(a.metadata_not_in_sources.join(" ")).toContain("Revision history");
  const nudge = docNudge([a], 1);
  expect(nudge).toContain("untraced 1.0525");
  expect(nudge).toContain("doc-audit");
  expect(auditNote([a])).toContain("3 UNTRACED");
  // a computation printed by a tool this session traces a figure; the report's own text does not
  const computed = [...msgs.slice(0, 1), reply("ok", [{ type: "tool", name: "shell", state: { status: "completed", input: { command: "python3 calc.py" }, content: [{ type: "text", text: "cost 2020 1.0525\ncost 2024 0.9803\nshare 1.299" }], metadata: { exit: 0 } } }])];
  const [b] = await auditDocs(computed, [doc]);
  expect(b.untraced_total).toBe(0);
  fs.rmSync(dir, { recursive: true, force: true });
}, 30_000); // two python runs of bin/doc-audit

test("'already removed' with the work done in an earlier turn is not sent back (2026-11-11)", () => {
  const earlier = [user("if i don't need the lucid shell remove it", T0 - 200_000), reply("Moved the lucid shell to trash.", [shell("cd ~/.config/quickshell && trash-put shell.qml lucidbar")])];
  const now = [user("ok then just remove the lucid shell", T0), reply("Done. The lucid shell is removed. It was already moved to trash in my previous step.", [shell("ls ~/.config/quickshell")])];
  expect(check([...earlier, ...now], { stat: statOld })).toBeNull();
  // the same words with nothing ever done in the session are still caught
  expect(check(now, { stat: statOld })).not.toBeNull();
});

test("every primary strong route cooling: the NVIDIA standby tier, not the weak ladder (2026-11-17)", async () => {
  const { strongModel, standbyModels, isStrong } = await import("../plugins/context-engine/strong-model.mjs");
  const standby = standbyModels();
  if (!standby.length) return; // ranking without nvidia entries on this machine
  const primaries = new Set(JSON.parse((await import("fs")).readFileSync(new URL("../opencode.json", import.meta.url), "utf-8")).providers?.omniroute?.models
    ? Object.keys(JSON.parse((await import("fs")).readFileSync(new URL("../opencode.json", import.meta.url), "utf-8")).providers.omniroute.models).map((m) => `omniroute/${m}`) : []);
  const pick = strongModel("opencode/glm-5.3-flash-free", { avoidCooling: true, cool: primaries });
  expect(standby).toContain(pick);
  expect(isStrong(pick)).toBe(true);
  // standby cooling too: give up rather than pick a cooling route
  expect(strongModel("opencode/glm-5.3-flash-free", { avoidCooling: true, cool: new Set([...primaries, ...standby]) })).toBeNull();
  // nothing cooling: a primary route still wins over the standby
  expect(standby).not.toContain(strongModel("opencode/glm-5.3-flash-free", { cool: new Set() }));
});

test("the review pair is one gateway reviewer and one direct-provider reviewer, not two from the Claude pool (2026-11-17)", async () => {
  const { reviewEnsemble } = await import("../plugins/verify-claims/index.js");
  const saved = { fetch: globalThis.fetch, env: process.env.VERIFY_REVIEWER, nv: process.env.NVIDIA_API_KEY, om: process.env.OMNIROUTE_API_KEY };
  process.env.VERIFY_REVIEWER = "agy/claude-opus-4-6-thinking,omni-review,nvidia:nvidia/nemotron-3.5-super-vl-120b-a12b";
  process.env.NVIDIA_API_KEY ||= "test-key"; process.env.OMNIROUTE_API_KEY ||= "test-key";
  const asked = [];
  let failNvidia = false;
  globalThis.fetch = async (url, init) => {
    const model = JSON.parse(init.body).model;
    asked.push(model);
    if (failNvidia && /nemotron/.test(model)) return new Response("busy", { status: 503 });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"claims":[],"verdict":"done","reason":"ok","next_step":"","unsupported":[]}' } }] }), { status: 200 });
  };
  try {
    const turn = [{ type: "user", text: "how much ram do i have" }, { type: "assistant", text: "15 GiB" }];
    const v = await reviewEnsemble(turn);
    expect(v.verdict).toBe("done");
    expect(asked.sort()).toEqual(["agy/claude-opus-4-6-thinking", "nvidia/nemotron-3.5-super-vl-120b-a12b"].sort());
    asked.length = 0; failNvidia = true;
    await reviewEnsemble(turn); // the direct reviewer fails: its slot moves on to the next gateway reviewer
    expect(asked).toContain("omni-review");
  } finally {
    globalThis.fetch = saved.fetch;
    for (const [k, v] of [["VERIFY_REVIEWER", saved.env], ["NVIDIA_API_KEY", saved.nv], ["OMNIROUTE_API_KEY", saved.om]]) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

describe("firstOrBoth (no waiting on a straggler reviewer)", () => {
  const { firstOrBoth } = VC;
  const after = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));
  test("continue settles at once", async () => {
    const t0 = Date.now();
    const vs = await firstOrBoth([after(20, { model: "a", verdict: "continue" }), after(2000, { model: "b", verdict: "done" })], { minGraceMs: 500, maxGraceMs: 500 });
    expect(vs.map((v) => v.model)).toEqual(["a"]);
    expect(Date.now() - t0).toBeLessThan(400);
  });
  test("done waits for the other within the grace", async () => {
    const vs = await firstOrBoth([after(20, { model: "a", verdict: "done" }), after(100, { model: "b", verdict: "revise" })], { minGraceMs: 300, maxGraceMs: 300 });
    expect(vs.map((v) => v.verdict).sort()).toEqual(["done", "revise"]);
  });
  test("a straggler past the grace is dropped", async () => {
    const t0 = Date.now();
    const vs = await firstOrBoth([after(20, { model: "a", verdict: "done" }), after(3000, { model: "b", verdict: "continue" })], { minGraceMs: 200, maxGraceMs: 200 });
    expect(vs.map((v) => v.model)).toEqual(["a"]);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  test("a failed slot does not wait for the grace", async () => {
    const vs = await firstOrBoth([after(10, null), after(50, { model: "b", verdict: "done" })], { minGraceMs: 5000, maxGraceMs: 5000 });
    expect(vs.map((v) => v.model)).toEqual(["b"]);
  });
});

test("firstOrBoth tells the caller when the review is settled, so an ignored slot stops trying reviewers", async () => {
  let n = 0;
  const after = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));
  await VC.firstOrBoth([after(10, { model: "a", verdict: "continue" }), after(300, null)], { onSettle: () => { n++; }, minGraceMs: 50, maxGraceMs: 50 });
  expect(n).toBe(1);
});

test("cancellation and stop requests skip check and needsReview", async () => {
  const { check, needsReview } = await import("../plugins/verify-claims/index.js");
  const sh = (command, out = "") => ({ type: "tool", name: "shell", state: { status: "completed", input: { command }, content: [{ type: "text", text: out }], metadata: { exit: 0 } } });
  const user = (text = "ok stop it", t = T0) => ({ type: "user", id: "u", time: { created: t }, text });
  const reply = (text, tools = []) => ({ type: "assistant", content: [...tools, { type: "text", text }] });
  
  const stopTurn = [user("ok stop it"), reply("Cancelled all jobs and stopped.", [sh("cancel -a")])];
  expect(check(stopTurn)).toBeNull();
  expect(needsReview(stopTurn)).toBe(false);

  const cancelTurn = [user("cancel all print jobs please"), reply("Done: cancelled.", [sh("cancel -a")])];
  expect(check(cancelTurn)).toBeNull();
  expect(needsReview(cancelTurn)).toBe(false);
});

test("mentioning past changes verified in this session with read-only commands in current turn does not fail check", async () => {
  const { check } = await import("../plugins/verify-claims/index.js");
  const sh = (command, out = "") => ({ type: "tool", name: "shell", state: { status: "completed", input: { command }, content: [{ type: "text", text: out }], metadata: { exit: 0 } } });
  const user = (text, t = T0) => ({ type: "user", id: "u" + t, time: { created: t }, text });
  const reply = (text, tools = []) => ({ type: "assistant", content: [...tools, { type: "text", text }] });

  const t1 = [user("enable printer", T0), reply("Enabled queue.", [sh("cupsenable printer")])];
  const t2 = [
    ...t1,
    user("lights are flashing", T0 + 10_000),
    reply("Verified from this session: I enabled the queue. Current lights indicate hardware paper jam.", [sh("lpstat -p printer", "idle")]),
  ];
  expect(check(t2)).toBeNull();
});

test("#noreview user prompt strictly skips check and needsReview", async () => {
  const { check, needsReview, NO_REVIEW } = await import("../plugins/verify-claims/index.js");
  const sh = (command, out = "") => ({ type: "tool", name: "shell", state: { status: "completed", input: { command }, content: [{ type: "text", text: out }], metadata: { exit: 0 } } });
  const user = (text = "play youtube for 30s #noreview", t = T0) => ({ type: "user", id: "u", time: { created: t }, text });
  const reply = (text, tools = []) => ({ type: "assistant", content: [...tools, { type: "text", text }] });

  expect(NO_REVIEW.test("play video #noreview")).toBe(true);
  expect(NO_REVIEW.test("#noreview check this")).toBe(true);
  expect(NO_REVIEW.test("play video #NOREVIEW")).toBe(true);
  expect(NO_REVIEW.test("quick check, no review needed")).toBe(false);
  expect(NO_REVIEW.test("please do not review this turn")).toBe(false);
  expect(NO_REVIEW.test("open site, skip review")).toBe(false);
  expect(NO_REVIEW.test("fix the auth bug")).toBe(false);

  const turnTag = [user("play youtube for 30s #noreview"), reply("Done: played video.", [sh("browser-ctl start brave")])];
  expect(check(turnTag)).toBeNull();
  expect(needsReview(turnTag)).toBe(false);

  // General phrase 'no review' without #noreview tag does NOT skip check or review
  const turnPhrase = [user("open site, no review needed"), reply("Done: opened site.", [sh("cat site.txt")])];
  expect(needsReview(turnPhrase)).toBe(false); // cat is read-only, short text
});

describe("motion facts for delivered videos", () => {
  const { spawnSync } = require("child_process");
  const dir = require("fs").mkdtempSync(require("path").join(require("os").tmpdir(), "vc-motion-"));
  const mk = (name, src) => {
    const f = `${dir}/${name}.mp4`;
    spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", src, "-t", "3", "-pix_fmt", "yuv420p", f]);
    return f;
  };
  test("frameDiff is a 0-100 percentage", () => {
    expect(VC.frameDiff(Buffer.from([0, 0]), Buffer.from([255, 255]))).toBe(100);
    expect(VC.frameDiff(Buffer.from([10]), Buffer.from([10]))).toBe(0);
    expect(VC.frameDiff(Buffer.from([1]), Buffer.from([1, 2]))).toBeNull();
  });
  test("a still video is flagged, a moving one is not", () => {
    const still = mk("still", "color=c=teal:s=320x180:r=24");
    const moving = mk("moving", "testsrc2=s=320x180:r=24");
    const [s, m] = VC.mediaFacts([still, moving]);
    expect(s).toContain("PRACTICALLY A STILL PICTURE");
    expect(m).toContain("of the picture changes");
    expect(m).not.toContain("STILL PICTURE");
  });
  test("a small figure crossing a still background is motion, not a still (2026-11-24 line-art walk)", () => {
    const small = mk("small", "color=c=white:s=320x180:r=24[bg];color=c=black:s=10x24:r=24[b];[bg][b]overlay=x='20+t*90':y=140[out0]");
    const [m] = VC.mediaFacts([small]);
    expect(m).toContain("of the picture changes");
    expect(m).not.toContain("STILL PICTURE");
    expect(VC.changedShare(Buffer.from([0, 0, 0, 0]), Buffer.from([0, 0, 200, 0]))).toBe(25);
  });
});

test("a bare status word answering a question is not a change claim (2026-11-24 scheduling puzzle)", () => {
  const q = user("Seven tasks, two workers. What is the minimum makespan? Give a schedule.");
  const ans = "Fixed: the minimum makespan is **10 time units**.\n\nWorker 1: A, C, E. Worker 2: B, F, D, G.";
  expect(check([q, reply(ans)], { stat: statOld })).toBeNull();
  expect(VC.statusWordOnly("**Done.** The answer is 391.")).toBe(true);
  // still caught: a fix request, a change verb, a path, or first person
  expect(check([user("fix my screen sharing"), reply(ans)], { stat: statOld })).not.toBeNull();
  expect(check([q, reply("Fixed: edited ~/.config/app/conf to set the limit.")], { stat: statOld })).not.toBeNull();
  expect(VC.statusWordOnly("Done: restarted the portal services")).toBe(false);
  expect(check([q, reply(HALLUCINATED)], { stat: statOld })).not.toBeNull();
});
