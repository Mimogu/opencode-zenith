// Request-time pruning. Only the request view changes: the hook assigns a new messages array and
// every edited message is cloned, so the stored session is untouched and nothing is lost: anything
// shortened can be re-run or re-read.
//
// Measured on this machine's sessions (tools/prune_report.mjs): in a long turn most of what is
// re-sent every step is tool output and reasoning from many steps ago, plus tool/skill catalogs that
// OpenCode re-announces whenever an MCP server (re)connects, each superseding the last.
//
//  1. superseded notices: a "Code Mode tool catalog has changed" / "available skills have changed"
//     section is dropped when a later full one of the same kind exists (OpenCode says the newer one
//     supersedes it). Instruction diffs and "new skills" additions are incremental and always kept.
//  2. earlier turns: reasoning dropped; repeated identical calls collapsed to the newest result;
//     aged-output rules below.
//  3. the turn in progress: the last KEEP_RECENT steps are untouched. Older steps get the aged-output
//     rules and shortened reasoning. The aged boundary only moves every CHUNK steps, so the request
//     prefix stays byte-identical between moves and provider prompt caches keep hitting.
//
// Aged-output rules: long shell/web/search/MCP output -> head + tail; a file read whose file was
// later edited, written or read again -> marker; other long reads -> head + tail; full contents of
// an earlier write and long edit strings -> marker (the file on disk is the truth).

const KEEP_RECENT = Number(process.env.OPENCODE_PRUNE_KEEP || 10); // env: test-only override
const CHUNK = Number(process.env.OPENCODE_PRUNE_CHUNK || 8);
const NOISY = /^(shell|bash|webfetch|websearch|grep|glob|execute|list|.+_.+)$/; // `.+_.+` = MCP tools
const NOISY_OVER = 2_500, NOISY_HEAD = 1_200, NOISY_TAIL = 800;
const READ_OVER = 6_000, READ_HEAD = 2_500, READ_TAIL = 1_000;
const WRITE_OVER = 1_500;
const REASONING_KEEP = 300;

function isRealUser(m) {
  if (m?.role !== "user") return false;
  if (m.metadata?.synthetic || m.metadata?.goalID || m.type === "synthetic") return false;
  const parts = Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }];
  return parts.some((p) => p?.type === "text" && typeof p.text === "string" && p.text.trim() && !/^\s*<system-reminder>/.test(p.text));
}

function stable(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
}

/** Text of a tool-result value, and a setter that writes a replacement back. */
function resultText(part) {
  const r = part?.result;
  if (!r) return null;
  if ((r.type === "text" || r.type === "error-text") && typeof r.value === "string") return { text: r.value, set: (t) => { r.value = t; } };
  if (r.type === "content" && Array.isArray(r.value)) {
    const texts = r.value.filter((x) => x?.type === "text" && typeof x.text === "string");
    if (!texts.length) return null;
    return { text: texts.map((x) => x.text).join("\n"), set: (t) => { r.value = [{ type: "text", text: t }, ...r.value.filter((x) => x?.type !== "text")]; } };
  }
  return null;
}

const filePath = (input) => input?.path ?? input?.filePath ?? input?.file_path ?? input?.file ?? null;
const headTail = (t, head, tail, what) =>
  `${t.slice(0, head)}\n\n[… ${t.length - head - tail} chars of this earlier ${what} trimmed to save context; re-run or re-read it if you need the middle …]\n\n${t.slice(-tail)}`;
// signed reasoning (Anthropic thinking) must be sent back byte-identical
const signed = (p) => /signature|redacted/i.test(JSON.stringify(p.providerMetadata ?? p.providerOptions ?? ""));

// ---------------------------------------------------------------- superseded notices
const SECTION = [
  [/^The Code Mode tool catalog has changed\./m, "codemode", true],
  [/^The following namespace inventories changed/m, "codemode", false],
  [/^The available skills have changed\./m, "skills", true],
  [/^New skills are available/m, "skills", false],
  [/^The following skills have changed/m, "skills", false],
  [/^The following skill IDs are no longer available/m, "skills", false],
  [/^The instructions (from |changed)/m, "keep", false],
  [/^The environment you are running in is now/m, "keep", false],
];
const SECTION_START = new RegExp(SECTION.map(([r]) => r.source.replace(/^\^/, "")).join("|"));

/** Split a notice into [{kind, full, text}] at the known section headers. */
function sections(text) {
  const starts = [];
  const re = new RegExp(`^(?:${SECTION_START.source})`, "gm");
  for (let m; (m = re.exec(text));) starts.push(m.index);
  if (!starts.length || starts[0] !== 0) starts.unshift(0);
  return starts.map((s, k) => {
    const t = text.slice(s, starts[k + 1] ?? text.length);
    const hit = SECTION.find(([r]) => r.test(t.slice(0, 200)));
    return { kind: hit ? hit[1] : "keep", full: hit ? hit[2] : false, text: t };
  });
}

function collapseNotices(messages, out, cloneAt, stats) {
  const parsed = new Map(); // index -> sections
  const lastFull = { codemode: -1, skills: -1 };
  messages.forEach((m, i) => {
    if (m?.role !== "system") return;
    const parts = Array.isArray(m.content) ? m.content : [{ type: "text", text: String(m.content ?? "") }];
    if (parts.length !== 1 || parts[0]?.type !== "text") return;
    const secs = sections(parts[0].text);
    if (!secs.some((s) => s.kind !== "keep")) return;
    parsed.set(i, secs);
    for (const s of secs) if (s.full) lastFull[s.kind] = i;
  });
  const drop = [];
  for (const [i, secs] of parsed) {
    const keep = secs.filter((s) => s.kind === "keep" || i >= lastFull[s.kind]);
    if (keep.length === secs.length) continue;
    stats.notices += secs.length - keep.length;
    stats.saved += secs.filter((s) => !keep.includes(s)).reduce((n, s) => n + s.text.length, 0);
    if (!keep.length) { drop.push(i); continue; }
    const c = cloneAt(i);
    c.content = [{ type: "text", text: keep.map((s) => s.text).join("").trim() }];
  }
  return drop;
}

// ---------------------------------------------------------------- aged outputs
function ageStep(messages, i, end, laterPaths, out, cloneAt, stats) {
  // assistant message i and its tool results up to (not including) index `end`
  const m = messages[i];
  if (m?.role === "assistant" && Array.isArray(m.content)) {
    m.content.forEach((p, j) => {
      if (p?.type !== "tool-call" || !p.input) return;
      if (p.name === "write" && typeof p.input.content === "string" && p.input.content.length > WRITE_OVER) {
        const lines = p.input.content.split("\n").length;
        cloneAt(i).content[j].input = { ...p.input, content: `[${lines} lines written earlier; the file on disk has the current text]` };
        stats.aged++; stats.saved += p.input.content.length;
      } else if (p.name === "edit") {
        const inp = { ...p.input };
        let cut = 0;
        for (const k of ["oldString", "newString", "old_string", "new_string"]) {
          if (typeof inp[k] === "string" && inp[k].length > WRITE_OVER) { cut += inp[k].length; inp[k] = `${inp[k].slice(0, 400)}\n[… earlier edit text shortened; the file on disk has the current text …]`; }
        }
        if (cut) { cloneAt(i).content[j].input = inp; stats.aged++; stats.saved += cut; }
      }
    });
  }
  for (let k = i + 1; k < end; k++) {
    const t = messages[k];
    if (t?.role !== "tool" || !Array.isArray(t.content)) continue;
    t.content.forEach((p, j) => {
      if (p?.type !== "tool-result") return;
      const rt = resultText(p);
      if (!rt) return;
      let next = null;
      if (p.name === "read") {
        const fp = laterPaths.get(p.id);
        if (fp && rt.text.length > 300) next = `[Earlier read of ${fp}: the file was edited or read again later; re-read it for the current content.]`;
        else if (rt.text.length > READ_OVER) next = headTail(rt.text, READ_HEAD, READ_TAIL, "file read");
      } else if (NOISY.test(p.name || "") && rt.text.length > NOISY_OVER) {
        next = headTail(rt.text, NOISY_HEAD, NOISY_TAIL, `${p.name} output`);
      }
      if (next === null || next.length >= rt.text.length) return;
      resultText(cloneAt(k).content[j]).set(next);
      stats.aged++;
      stats.saved += rt.text.length - next.length;
    });
  }
}

/** For each read call, the path if that file is edited, written or read again later in the conversation. */
function supersededReads(messages) {
  const touches = []; // [index, kind, path, callId]
  messages.forEach((m, i) => {
    if (m?.role !== "assistant" || !Array.isArray(m.content)) return;
    for (const p of m.content) {
      if (p?.type !== "tool-call") continue;
      const fp = filePath(p.input);
      if (fp && ["read", "edit", "write"].includes(p.name)) touches.push([i, p.name, fp, p.id]);
    }
  });
  const out = new Map();
  touches.forEach(([i, kind, fp, id], n) => {
    if (kind !== "read") return;
    if (touches.slice(n + 1).some(([j, , fp2]) => j > i && fp2 === fp)) out.set(id, fp);
  });
  return out;
}

export function prune(messages) {
  const stats = { reasoning: 0, deduped: 0, trimmed: 0, notices: 0, aged: 0, saved: 0 };
  if (!Array.isArray(messages) || messages.length < 3) return { messages, stats };
  let boundary = -1;
  for (let i = messages.length - 1; i >= 0; i--) if (isRealUser(messages[i])) { boundary = i; break; }

  const out = messages.slice();
  const cloneAt = (i) => {
    if (out[i] === messages[i]) out[i] = structuredClone(messages[i]);
    return out[i];
  };

  const drop = collapseNotices(messages, out, cloneAt, stats);

  // tool-call id -> dedupe key, over the whole conversation
  const keyOf = new Map();
  const lastIndexOfKey = new Map();
  messages.forEach((m, i) => {
    if (m?.role !== "assistant" || !Array.isArray(m.content)) return;
    for (const p of m.content) {
      if (p?.type !== "tool-call") continue;
      const key = `${p.name}\u0000${stable(p.input)}`;
      keyOf.set(p.id, key);
      lastIndexOfKey.set(key, i);
    }
  });
  const laterPaths = supersededReads(messages);

  // aged steps of the turn in progress: all but the last KEEP_RECENT, in CHUNK-sized moves
  const turnSteps = [];
  for (let i = Math.max(boundary, 0); i < messages.length; i++) if (messages[i]?.role === "assistant") turnSteps.push(i);
  const agedCount = boundary < 0 ? 0 : Math.max(0, Math.floor((turnSteps.length - KEEP_RECENT) / CHUNK) * CHUNK);
  const agedUntil = agedCount ? turnSteps[agedCount] : boundary; // first index NOT aged in the current turn

  for (let i = 0; i < Math.max(agedUntil, 0); i++) {
    const m = messages[i];
    if (!Array.isArray(m?.content)) continue;
    const earlierTurn = i < boundary;

    if (m.role === "assistant") {
      // output rules first: they address parts by index, which dropping reasoning would shift
      let end = i + 1;
      while (end < messages.length && messages[end]?.role === "tool") end++;
      ageStep(messages, i, end, laterPaths, out, cloneAt, stats);
      const reasoning = m.content.filter((p) => p?.type === "reasoning");
      if (earlierTurn && reasoning.length && reasoning.length < m.content.length) {
        const c = cloneAt(i);
        c.content = c.content.filter((p) => p?.type !== "reasoning");
        stats.reasoning += reasoning.length;
        stats.saved += reasoning.reduce((n, p) => n + (p.text?.length || 0), 0);
      } else if (!earlierTurn) {
        m.content.forEach((p, j) => {
          if (p?.type !== "reasoning" || signed(p) || (p.text?.length || 0) <= REASONING_KEEP + 100) return;
          cloneAt(i).content[j] = { ...p, text: `${p.text.slice(0, REASONING_KEEP)} …[earlier reasoning shortened]` };
          stats.reasoning++;
          stats.saved += p.text.length - REASONING_KEEP;
        });
      }
      continue;
    }

    if (m.role !== "tool" || !earlierTurn) continue;
    m.content.forEach((p, j) => {
      if (p?.type !== "tool-result") return;
      const rt = resultText(out[i] === messages[i] ? p : out[i].content[j]);
      if (!rt) return;
      const key = keyOf.get(p.id);
      if (key && (lastIndexOfKey.get(key) ?? -1) > i && rt.text.length > 200) {
        resultText(cloneAt(i).content[j]).set(`[Output omitted: the same ${p.name} call was made again later; see the newer result.]`);
        stats.deduped++;
        stats.saved += rt.text.length;
      }
    });
  }
  stats.trimmed = stats.aged;
  const final = drop.length ? out.filter((_, i) => !drop.includes(i)) : out;
  return { messages: stats.saved ? final : messages, stats };
}

/** When the conversation carries a newer full Code Mode catalog (OpenCode re-announces it after an MCP
 *  server connects), the copy in the system prompt is superseded: replace its tool list with a pointer.
 *  Returns the number of characters saved; edits `system` in place (it is the request's own copy). */
export function supersedeSystemCatalog(system, messages) {
  if (!Array.isArray(system) || !Array.isArray(messages)) return 0;
  const newer = messages.some((m) => m?.role === "system" && Array.isArray(m.content)
    && m.content.some((p) => p?.type === "text" && /^The Code Mode tool catalog has changed\./m.test(p.text || "")));
  if (!newer) return 0;
  const HEAD = "## Code Mode tools (call only inside `execute`)";
  let saved = 0;
  for (const b of system) {
    const t = b?.text;
    if (typeof t !== "string") continue;
    const i = t.indexOf(HEAD);
    if (i < 0) continue;
    const j = t.indexOf("\n\nSkills provide specialized instructions", i);
    if (j < 0) continue; // unknown layout: leave it
    const note = `${HEAD}\n\nSuperseded: the current catalog is in the latest "Code Mode tool catalog has changed" message in the conversation.`;
    if (j - i <= note.length) continue;
    b.text = t.slice(0, i) + note + t.slice(j);
    saved += j - i - note.length;
  }
  return saved;
}
