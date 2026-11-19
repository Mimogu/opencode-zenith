// Request-time cap on inlined images. Only the request view changes; the stored session is untouched.
//
// Every image an agent reads (page renders, screenshots) stays in the conversation as base64 and is
// re-sent on every later step. 2026-11-10: a report task read 64 page images (9.2 MB of base64); the
// provider answered 400 "inlined media exceeds the 33554432 byte total limit" on every step AND on
// every compaction (the compaction request carried the same images), so the session could neither
// continue nor compact.
//
//  - normal requests: the newest images are kept. Once they pass HIGH (bytes or count) the oldest
//    are replaced by a one-line note until LOW is reached. The cut is replayed from the start of
//    the conversation, so it only moves when HIGH is passed again and the request prefix stays
//    byte-identical in between (prompt caches keep hitting).
//  - compaction / title / summary requests: every image is replaced (a summary needs none).
//  - a provider that still rejects the request for its media size halves the budget for that
//    session (`tighten`, called by auto-failover) and the step is retried.

const MB = 1024 * 1024;
const HIGH_BYTES = Number(process.env.OPENCODE_MEDIA_HIGH || 4 * MB); // base64 chars, all images together
const LOW_BYTES = Number(process.env.OPENCODE_MEDIA_LOW || 2 * MB);
const HIGH_COUNT = Number(process.env.OPENCODE_MEDIA_HIGH_COUNT || 24);
const LOW_COUNT = Number(process.env.OPENCODE_MEDIA_LOW_COUNT || 12);
const MAX_LEVEL = 4; // budget / 2^level; at MAX_LEVEL nothing is kept

// on globalThis: auto-failover and context-engine must see the same map even if the runtime loads
// this file once per plugin
const levels = (globalThis.__opencodeMediaLevels ??= new Map()); // sessionID -> level

/** The provider rejected this session's request for its media size: halve the budget. Returns the
 *  new level, or 0 when there is nothing left to cut. */
export function tighten(sessionID) {
  const cur = levels.get(sessionID) || 0;
  if (cur >= MAX_LEVEL) return 0;
  levels.set(sessionID, cur + 1);
  if (levels.size > 300) levels.delete(levels.keys().next().value);
  return cur + 1;
}
export const levelOf = (sessionID) => levels.get(sessionID) || 0;

export const MEDIA_LIMIT = /inlined media|media exceeds|image exceeds|images? (is|are) too large|too many images|image.{0,40}(size|dimension).{0,30}(limit|exceed)/i;

const DATA_URI = /^data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,/i;

/** Size in base64 chars and a display name when `p` carries inlined media, else null. */
export function mediaInfo(p) {
  if (!p || typeof p !== "object") return null;
  const src = p.media?.source ?? p.source;
  if ((p.type === "media" || p.type === "image" || p.type === "file") && src && typeof src.data === "string" && src.type !== "url") {
    return { size: src.data.length, name: p.filename || p.name || "", mime: src.mediaType || src.media_type || p.mediaType || "" };
  }
  for (const k of ["uri", "url", "data", "image"]) {
    const v = p[k];
    if (typeof v !== "string" || v.length < 512) continue;
    if (DATA_URI.test(v) || ((p.type === "media" || p.type === "image" || p.type === "file" || p.type === "image-data" || p.type === "file-data") && k !== "url" && k !== "uri")) {
      return { size: v.length, name: p.filename || p.name || "", mime: p.mediaType || p.mime || p.mimeType || "" };
    }
  }
  return null;
}

function note(info, why) {
  const what = /^(image\/|$)/.test(info.mime) ? "image" : "file";
  const name = info.name ? ` ${info.name}` : "";
  return { type: "text", text: `[The ${what}${name} (${Math.max(1, Math.round(info.size * 0.75 / 1024))} KB) shown here earlier is ${why}]` };
}
const AGED = "no longer attached, to keep the request within the provider's size limit. What you concluded from it still stands; read the file again only if you need another look.";
const TOO_BIG = "too large to send. Look at it with `see <file> \"question\"`, or make a smaller copy (for example `magick in.png -resize 1600x1600 -quality 80 out.jpg`) and read that.";
const SUMMARY = "left out of this summary request.";

/** Every inlined media part, in conversation order: {mi, path, info}. `path` leads from the message's
 *  content array to the part (tool results nest it under result.value). */
function locate(messages) {
  const found = [];
  messages.forEach((m, mi) => {
    if (!Array.isArray(m?.content)) return;
    m.content.forEach((p, pi) => {
      const info = mediaInfo(p);
      if (info) { found.push({ mi, path: [pi], info }); return; }
      for (const key of ["result", "output"]) {
        const v = p?.[key]?.value;
        if (!Array.isArray(v)) continue;
        v.forEach((x, xi) => {
          const inner = mediaInfo(x);
          if (inner) found.push({ mi, path: [pi, key, xi], info: { ...inner, name: inner.name || p.input?.path || "" } });
        });
      }
    });
  });
  return found;
}

/** Indexes (into `found`) to drop: replay the conversation, cutting to LOW whenever HIGH is passed. */
function evictions(found, level) {
  const div = 2 ** level;
  const highB = HIGH_BYTES / div, lowB = LOW_BYTES / div;
  const highC = Math.max(1, Math.floor(HIGH_COUNT / div)), lowC = Math.max(0, Math.floor(LOW_COUNT / div));
  const dropped = new Map(); // index -> reason
  if (level >= MAX_LEVEL) { found.forEach((_, i) => dropped.set(i, AGED)); return dropped; }
  const live = [];
  let bytes = 0;
  found.forEach((f, i) => {
    if (f.info.size > highB) { dropped.set(i, TOO_BIG); return; }
    live.push(i);
    bytes += f.info.size;
    if (bytes <= highB && live.length <= highC) return;
    // the newest image always stays: it is what the agent is looking at now
    while (live.length > 1 && (bytes > lowB || live.length > lowC)) {
      const old = live.shift();
      bytes -= found[old].info.size;
      dropped.set(old, AGED);
    }
  });
  return dropped;
}

/** Returns {messages, stats}; `messages` is the input array itself when nothing was cut. */
export function capMedia(messages, { sessionID = "", all = false } = {}) {
  const stats = { images: 0, bytes: 0, dropped: 0, saved: 0, level: levelOf(sessionID) };
  if (!Array.isArray(messages)) return { messages, stats };
  const found = locate(messages);
  stats.images = found.length;
  stats.bytes = found.reduce((n, f) => n + f.info.size, 0);
  if (!found.length) return { messages, stats };
  const dropped = all ? new Map(found.map((_, i) => [i, SUMMARY])) : evictions(found, stats.level);
  if (!dropped.size) return { messages, stats };
  const out = messages.slice();
  for (const [i, why] of dropped) {
    const { mi, path, info } = found[i];
    if (out[mi] === messages[mi]) out[mi] = structuredClone(messages[mi]);
    const content = out[mi].content;
    if (path.length === 1) content[path[0]] = note(info, why);
    else content[path[0]][path[1]].value[path[2]] = note(info, why);
    stats.dropped++;
    stats.saved += info.size;
  }
  return { messages: out, stats };
}
