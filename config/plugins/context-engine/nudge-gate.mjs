// One nudge per finished turn across plugins.
//
// verify-claims and the context engine's answer check both run on `experimental.idle` and can send
// the agent back with session.synthetic. On the same idle, two nudges would mean two extra turns and
// two half-overlapping instructions. Each checker calls begin() when its idle hook starts and
// tryClaim() right before sending: a claim fails if another checker already nudged this session
// after that start. The next idle (after the agent answered the first nudge) starts fresh, so the
// other checker still gets its turn then. State lives on globalThis because the plugins are
// separate modules in the same server process.
const G = (globalThis.__opencodeNudgeGate ??= new Map()); // sessionID -> { at, source }

export function begin() {
  return Date.now();
}

export function tryClaim(sessionID, source, startedAt) {
  const prev = G.get(sessionID);
  if (prev && prev.at >= startedAt && prev.source !== source) return { ok: false, by: prev.source };
  G.set(sessionID, { at: Date.now(), source });
  if (G.size > 1000) G.delete(G.keys().next().value);
  return { ok: true };
}

/** The checker that sent this session back after `startedAt`, if any (so "nothing to fix" is not
 *  announced while the other checker is already asking for a correction). */
export function claimedSince(sessionID, startedAt) {
  const prev = G.get(sessionID);
  return prev && prev.at >= startedAt ? prev.source : null;
}

// Each checker marks its idle run done, so verify-claims announces "final" only after the answer
// check (link probes can take ~10 s) has finished and not asked for a correction.
const DONE = (globalThis.__opencodeCheckDone ??= new Map()); // `${sessionID}:${source}` -> time

export function markDone(sessionID, source) {
  DONE.set(`${sessionID}:${source}`, Date.now());
  if (DONE.size > 2000) DONE.delete(DONE.keys().next().value);
}

/** Resolves once `source` finished a run that started at or after `startedAt` (or after timeoutMs). */
export async function waitDone(sessionID, source, startedAt, timeoutMs = 20_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if ((DONE.get(`${sessionID}:${source}`) || 0) >= startedAt) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
