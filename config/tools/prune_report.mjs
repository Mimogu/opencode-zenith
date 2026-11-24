#!/usr/bin/env bun
// Replays stored OpenCode sessions through plugins/context-engine/prune.mjs and reports how much
// conversation history is re-sent across all steps, with and without pruning.
//   bun tools/prune_report.mjs [days=21]
// Counts history characters only (the fixed system prompt and tool definitions are the same on both
// sides). Messages are rebuilt in the request shape the plugin sees (user/assistant/tool/system).
import { Database } from "bun:sqlite";
import os from "os";
import path from "path";
const { prune } = await import(process.env.PRUNE_MODULE || "../plugins/context-engine/prune.mjs");

const days = Number(process.argv[2] || 21);
const db = new Database(path.join(os.homedir(), ".local/share/opencode/opencode.db"), { readonly: true });
const since = Date.now() - days * 86400_000;
const sessions = db.query(`SELECT id FROM session_v2 WHERE parent_id IS NULL AND title != '' AND time_updated > ?
  AND directory NOT LIKE '/var/tmp/%' AND directory NOT LIKE '/tmp%'`).all(since);

const textOf = (d) => (Array.isArray(d.content) ? d.content.filter((p) => p?.type === "text").map((p) => p.text).join("\n") : String(d.text ?? d.content ?? ""));
function rebuild(rows) {
  const out = []; // [{ msg, step: bool }]
  for (const { type, data } of rows) {
    const d = JSON.parse(data);
    if (type === "user") out.push({ msg: { id: d.id || String(out.length), role: "user", content: [{ type: "text", text: textOf(d) }] } });
    else if (type === "system") out.push({ msg: { role: "system", content: [{ type: "text", text: String(d.text ?? "") }] } });
    else if (type === "compaction") { out.length = 0; out.push({ msg: { role: "user", content: [{ type: "text", text: String(d.text ?? d.summary ?? textOf(d)) }] } }); }
    else if (type === "assistant") {
      const content = [], results = [];
      for (const p of d.content || []) {
        if (p.type === "reasoning" || p.type === "text") content.push({ type: p.type, text: p.text || "" });
        else if (p.type === "tool") {
          const st = p.state || {};
          content.push({ type: "tool-call", id: p.id, name: p.name, input: st.input || {} });
          const value = (st.content || []).filter((x) => x?.type === "text").map((x) => x.text).join("\n");
          results.push({ role: "tool", content: [{ type: "tool-result", id: p.id, name: p.name, result: { type: "text", value } }] });
        }
      }
      out.push({ msg: { role: "assistant", content }, step: true }, ...results.map((msg) => ({ msg })));
    }
  }
  return out;
}
const size = (msgs) => msgs.reduce((n, m) => n + JSON.stringify(m.content).length, 0);

let before = 0, after = 0, steps = 0, n = 0;
const perSession = [];
for (const { id } of sessions) {
  const rows = db.query("SELECT type, data FROM session_message WHERE session_id = ? ORDER BY time_created").all(id);
  const all = rebuild(rows);
  let b = 0, a = 0;
  for (let k = 0; k < all.length; k++) {
    if (!all[k].step) continue;
    const req = all.slice(0, k).map((x) => x.msg); // what was sent to produce step k
    if (!req.length) continue;
    b += size(req);
    a += size(prune(req).messages);
    steps++;
  }
  if (!b) continue;
  n++; before += b; after += a;
  perSession.push([b, a]);
}
const pct = (x) => `${(x * 100).toFixed(0)}%`;
console.log(`${n} sessions, ${steps} model steps, last ${days} days`);
console.log(`history re-sent: ${(before / 4e6).toFixed(1)}M tokens -> ${(after / 4e6).toFixed(1)}M tokens (−${pct(1 - after / before)}) [~4 chars/token]`);
perSession.sort((x, y) => y[0] - x[0]);
const top = perSession.slice(0, 10).reduce((s, [b, a]) => [s[0] + b, s[1] + a], [0, 0]);
console.log(`10 largest sessions: −${pct(1 - top[1] / top[0])}; median session −${pct(perSession.map(([b, a]) => 1 - a / b).sort((x, y) => x - y)[perSession.length >> 1])}`);
