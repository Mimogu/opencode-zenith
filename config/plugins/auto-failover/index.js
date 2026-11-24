import fs from "fs";
import path from "path";
import os from "os";
import { execFile, execFileSync } from "child_process";

import { fileURLToPath } from "url";
import { strongModel, isStrong } from "../context-engine/strong-model.mjs";
import { tighten, MEDIA_LIMIT } from "../context-engine/media.mjs";

// config dir = two levels above this file (plugins/auto-failover/index.js)
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LADDERS_FILE = path.join(DIR, "ladders.json");
const CONFIG_FILE = path.join(DIR, "opencode.json");
const COOLDOWN_FILE = path.join(DIR, ".cooldown_state.json");
const COOLDOWN_SCRIPT = path.join(DIR, "cooldown.py");
// "python3" is a Microsoft Store stub on Windows
const PYTHON = process.platform === "win32" ? "python" : "python3";

const DEFAULT_CONTEXT = 200000;
const WAIT_FOR_RESET_S = 900; // wait this long for a resting model instead of stopping the request

const AGENT_CATEGORY = {
  build: "build",
  coder: "build",
  architect: "plan",
  planner: "plan",
  "refactor-cleaner": "build",
  "build-error-resolver": "build",
  "tdd-guide": "build",
  "e2e-runner": "build",
  "harness-optimizer": "build",
  browser: "build",
  explorer: "explore",
  explore: "explore",
  "docs-lookup": "explore",
  "doc-updater": "explore",
  verifier: "review",
  review: "review",
  "code-reviewer": "review",
  "security-reviewer": "review",
  "database-reviewer": "review",
  "thermo-review": "review",
  "thermo-quality-review": "review",
  "comment-sicko": "review",
  quick: "quick",
  text: "quick",
};

function log(msg) {
  const line = `[${new Date().toISOString()}] [Auto-Failover] ${msg}\n`;
  try {
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 2 * 1024 * 1024) {
      const tail = fs.readFileSync(LOG, "utf-8").split("\n").slice(-2000).join("\n");
      fs.writeFileSync(LOG, tail);
    }
    fs.appendFileSync(LOG, line);
  } catch {}
}
const LOG = path.join(DIR, "failover.log");

// ---------------------------------------------------------------- ladder

let ladderCache = { mtime: 0, data: null };

function ladders() {
  try {
    const st = fs.statSync(LADDERS_FILE);
    if (ladderCache.data && ladderCache.mtime === st.mtimeMs) return ladderCache.data;
    const data = JSON.parse(fs.readFileSync(LADDERS_FILE, "utf-8"));
    ladderCache = { mtime: st.mtimeMs, data };
    return data;
  } catch {
    return { categories: {} };
  }
}

function chainFor(category) {
  const data = ladders();
  const chain = (data.categories || {})[category] || [];
  return Array.isArray(chain) ? chain.filter(Boolean) : [];
}

function cooldownState() {
  try {
    return JSON.parse(fs.readFileSync(COOLDOWN_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function parseModel(m) {
  if (!m) return "";
  if (typeof m === "string") return m;
  const prov = m.providerID || m.provider || "";
  const id = m.id || m.model || "";
  return prov && id ? `${prov}/${id}` : id || "";
}

function toModelObj(str) {
  const i = str.indexOf("/");
  if (i < 0) return { providerID: "opencode", id: str };
  return { providerID: str.slice(0, i), id: str.slice(i + 1) };
}

function categoryFor(agent, currentModel) {
  if (agent && AGENT_CATEGORY[agent]) return AGENT_CATEGORY[agent];
  for (const cat of ["build", "plan", "explore", "review", "quick"]) {
    if (chainFor(cat).includes(currentModel)) return cat;
  }
  return "build";
}

function nextModel(currentModel, agent, isFreeCap = false) {
  const category = categoryFor(agent, currentModel);
  const chain = chainFor(category).length ? chainFor(category) : chainFor("build");
  const idx = chain.indexOf(currentModel);
  const candidates = idx >= 0 ? chain.slice(idx + 1) : chain;
  const state = cooldownState();
  const now = Date.now() / 1000;

  for (const candidate of candidates) {
    if (candidate === currentModel) continue;
    // When free-tier account quota is reached, skip all other opencode free-tier models
    if (isFreeCap && candidate.startsWith("opencode/") && /-free$/.test(candidate)) continue;
    const info = state[candidate];
    if (!info || !info.cooldown_until || now >= info.cooldown_until) return candidate;
  }

  // If under an account-wide free cap, jump to the first available non-free model in the chain
  if (isFreeCap) {
    for (const candidate of chain) {
      if (candidate.startsWith("opencode/") && /-free$/.test(candidate)) continue;
      const info = state[candidate];
      if (!info || !info.cooldown_until || now >= info.cooldown_until) return candidate;
    }
  }

  // every forward candidate is cooling down: take the best one anyway rather
  // than switching to a model that is not in the ladder at all.
  if (isFreeCap) {
    const nonFree = chain.find((m) => (!m.startsWith("opencode/") || !/-free$/.test(m)) && !m.startsWith("ollama/"));
    if (nonFree) return nonFree;
  }
  return null; // every candidate is cooling: the caller waits for the soonest reset or gives up
}

/** The model in `chain` whose cooldown ends first, and in how many seconds. */
function soonestReset(chain, skip = () => false) {
  const st = cooldownState();
  const now = Date.now() / 1000;
  return chain.filter((m) => !skip(m)).map((m) => ({ m, s: Math.max(0, Number(st[m]?.cooldown_until || 0) - now) }))
    .sort((a, b) => a.s - b.s)[0] || null;
}

// A compaction that fails (or does not shrink the request) brings the same error straight back:
// 2026-11-10 one session was "compacted" every ~7 s for 30 minutes. At most COMPACT_MAX per session
// per COMPACT_WINDOW_MS; after that the error is handled as a plain failure.
const COMPACT_MAX = 2, COMPACT_WINDOW_MS = 10 * 60_000;
const compactions = new Map(); // sessionID -> [timestamps]
export function mayCompact(sessionID, now = Date.now()) {
  const recent = (compactions.get(sessionID) || []).filter((t) => now - t < COMPACT_WINDOW_MS);
  if (recent.length >= COMPACT_MAX) { compactions.set(sessionID, recent); return false; }
  recent.push(now);
  compactions.set(sessionID, recent);
  if (compactions.size > 300) compactions.delete(compactions.keys().next().value);
  return true;
}

/** What a 4xx error is about. Media-size rejections say "exceeds ... limit" too, but compaction does
 *  not help them: the images are what is too big, not the text. */
export function classify(status, errType, errMsg) {
  const msg = String(errMsg || "");
  const media = MEDIA_LIMIT.test(msg);
  const overflow = !media && (
    (status === 400 && /context|token|overflow|too long|maximum context|exceed.*limit/i.test(msg)) ||
    /context.*length.*exceeded|maximum context length|prompt is too long/i.test(msg) ||
    errType === "context-overflow");
  return { media, overflow };
}

export const MISSING_KEY = /authorization.{0,20}(missing|required)|no api key|api key.{0,20}(missing|not (set|provided|found))/i;
const missingKeyTold = new Set();
function missingKeyNotice(provider, errMsg) {
  if (missingKeyTold.has(provider)) return;
  missingKeyTold.add(provider);
  log(`no API key for ${provider} in this process ("${String(errMsg).slice(0, 80)}"): start OpenCode through ~/.local/bin/opencode, which loads free-models.env`);
  try {
    execFile("notify-send", ["-u", "critical", "-a", "OpenCode", `No API key for ${provider}`,
      "Its models cannot be used in this session, so a weaker model is answering. Restart OpenCode from its normal launcher (it loads ~/.config/opencode/free-models.env)."], () => {});
  } catch {}
}

function recordFailure(model, err) {
  try {
    execFile(PYTHON, [COOLDOWN_SCRIPT, "fail", model, String(err || "Request failed").slice(0, 120)],
      () => {});
  } catch {}
}

// ---------------------------------------------------------------- account-wide limits
// Some 429s are not about one model: the whole provider account is out. 2026-11-06 the failover tried
// ~10 models of three exhausted providers within 3 s, then the session stopped:
//   OpenRouter  "Rate limit exceeded: free-models-per-day"            -> every :free model until 00:00 UTC
//   Antigravity "All antigravity accounts have exhausted their quota (... reset after 8m 5s)"
//               -> every antigravity/agy route and the combos built on them, until the reset
const BATCH_COOL_PY = `
import sys, json
sys.path.insert(0, sys.argv[1])
import oclib
for m in json.loads(sys.argv[2]):
    oclib.ledger_record(m, False, sys.argv[3], int(sys.argv[4]))
`;
function allKnownModels() {
  const cats = ladders().categories || {};
  let declared = [];
  try { declared = Object.keys(JSON.parse(fs.readFileSync(path.join(DIR, "opencode.json"), "utf-8")).providers?.omniroute?.models || {}).map((m) => `omniroute/${m}`); } catch {}
  return [...new Set([...Object.values(cats).flat().filter(Boolean), ...declared])];
}
function resetSeconds(msg) {
  const m = String(msg).match(/reset(?:s)? (?:after|in) (?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?/i);
  if (!m || !(m[1] || m[2] || m[3])) return null;
  return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
}
export function accountLimit(errMsg, models = allKnownModels(), now = new Date()) {
  const msg = String(errMsg || "");
  if (/free-models-per-day|free model requests per day/i.test(msg)) {
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) / 1000;
    return { what: "OpenRouter free models (daily limit)", seconds: Math.max(60, Math.ceil(midnight - now.getTime() / 1000) + 60),
      models: models.filter((m) => /^(omniroute\/)?openrouter\/.+:free$/.test(m)) };
  }
  if (/all antigravity accounts have exhausted|antigravity.{0,40}exhausted (their|its) quota/i.test(msg)) {
    // the quota is per model family: 2026-11-07 Claude was out while antigravity Gemini (and so the
    // omni-code / omni-review combos, which OmniRoute routes around exhausted members) kept answering;
    // resting all 7 routes plus the combos dropped strong-start sessions to the weak ladder head
    const fam = (msg.match(/\[(?:antigravity|agy)\/([a-z]+)/i)?.[1] || "").toLowerCase();
    return { what: `Antigravity ${fam ? `${fam} models` : "(Claude/Gemini pool)"}`, seconds: (resetSeconds(msg) ?? 600) + 15,
      models: models.filter((m) => {
        const r = m.match(/^omniroute\/(?:antigravity|agy)\/([a-z]+)/i);
        return r && (!fam || r[1].toLowerCase() === fam);
      }) };
  }
  return null;
}
function coolAll(models, why, seconds) {
  if (!models.length) return;
  try { execFileSync(PYTHON, ["-c", BATCH_COOL_PY, DIR, JSON.stringify(models), String(why).slice(0, 120), String(Math.ceil(seconds))], { timeout: 15000 }); }
  catch (e) { log(`account cooldown write failed: ${e.message}`); }
}

// Writes go through oclib.update_config so they share opencode.json.lock with
// the sentinel and the lab instead of racing them.
const UPDATE_DEFAULT_PY = `
import sys
sys.path.insert(0, sys.argv[1])
import oclib
new, prev = sys.argv[2], sys.argv[3]
changed = []
def mutate(cfg):
    # a run pinned with -m (router, lab, scripts) must not rewrite the default
    if cfg.get("model") == prev and prev != new:
        cfg["model"] = new
        changed.append(1)
oclib.update_config(mutate)
print("updated" if changed else "unchanged")
`;

function updateConfigDefaultModel(newModel, previousModel) {
  execFile(PYTHON, ["-c", UPDATE_DEFAULT_PY, DIR, newModel, previousModel],
    { timeout: 10000 }, (err, stdout) => {
      if (err) log(`Failed to update opencode.json: ${err.message}`);
      else if (String(stdout).trim() === "updated") log(`Updated opencode.json default model to: ${newModel}`);
    });
}


// Big inputs. 2026-11-24: flint-40b-free (ladder head) opened a reasoning stream on a 120 KB message
// and then sent only empty chunks for 15 min: chunkTimeout counts gaps between chunks, so it never
// fired, no error reached the retry hook and nothing failed over. beam-free (same provider, 1M context)
// answered the same prompt correctly in 52 s. Such a request starts on the next usable model of the
// same provider instead (model.resolve can only swap within one provider).
export const BIG_INPUT_CHARS = 60_000;
export const BIG_INPUT_AVOID = new Set(["opencode/flint-40b-free"]);
// The replacement must also be a long-context model: iceman-free (262k) took the same prompt without
// stalling but answered 8/9/9/12 for 19/23/22/25 ERROR lines; beam-free (1M) was exact.
export const BIG_INPUT_CONTEXT = 1_000_000;
export function bigInputModel(current, userChars, chain, cooling = new Set(), meta = {}) {
  if (!BIG_INPUT_AVOID.has(current) || userChars < BIG_INPUT_CHARS) return null;
  const provider = current.split("/")[0];
  return chain.find((m) => m !== current && !BIG_INPUT_AVOID.has(m) && m.startsWith(`${provider}/`) && !cooling.has(m)
    && Number(meta[m]?.context || 0) >= BIG_INPUT_CONTEXT) || null;
}

export default {
  id: "auto-failover",
  setup(api) {
    if (!api.session || !api.session.hook) {
      log("api.session.hook unavailable in this build — failover disabled");
      return;
    }

    api.session.hook("experimental.model.resolve", async (ev) => {
      if (process.env.OPENCODE_NO_FAILOVER === "1" || ev.kind === "title" || !ev.model) return;
      try {
        const cur = `${ev.model.providerID}/${ev.model.id}`;
        if (!BIG_INPUT_AVOID.has(cur)) return;
        const messages = await api.session.context({ sessionID: ev.sessionID });
        const user = (messages || []).findLast((m) => m?.type === "user");
        const chars = String(user?.text || "").length;
        const now = Date.now() / 1000;
        const st = cooldownState();
        const resting = new Set(Object.keys(st).filter((m) => Number(st[m]?.cooldown_until || 0) > now));
        const next = bigInputModel(cur, chars, chainFor(categoryFor(ev.agent, cur)), resting, ladders().meta || {});
        if (!next) return;
        ev.model = toModelObj(next);
        log(`${ev.sessionID} big input (${chars} chars): ${cur} -> ${next} for this request`);
      } catch (e) { log(`big-input check failed: ${e.message}`); }
    });

    api.session.hook("retry", async (event) => {
      if (process.env.OPENCODE_NO_FAILOVER === "1") return;
      try {
        const currentModel = parseModel(event.model);
        const attempt = event.attempt || 1;
        const errType = event.error?.type || "";
        const status = event.error?.status || 0;
        const errMsg = event.error?.message || "";

        // The free-tier allowance is account-wide: if every model in the chain is
        // free, we cannot fail over. If gateway/non-free fallbacks exist, jump to them.
        // The harness tags this condition as provider.free-limit; the text and
        // the 429 are fallbacks for builds that only surface the status.
        const isPrimaryFree = currentModel.startsWith("opencode/") && /-free$/.test(currentModel);
        const isFreeCap = errType === "provider.free-limit" ||
                          /free usage limit|free tier|free messages/i.test(errMsg) ||
                          // bare 429 only when the build surfaces nothing else: the real cap is tagged and worded
                          // (failover.log: "type=provider.free-limit msg=Free usage limit reached"); any other 429
                          // is one model's rate limit (2026-11-18 review: it skipped every free model, cooled none)
                          (status === 429 && isPrimaryFree && !String(errMsg || "").trim());
        if (isFreeCap) {
          const category = categoryFor(event.agent, currentModel);
          const chain = chainFor(category).length ? chainFor(category) : chainFor("build");
          const hasFallback = chain.some((m) => !m.startsWith("opencode/") || !/-free$/.test(m));
          if (!hasFallback) {
            log(`free-tier cap reached; every model in ${category} is free and no gateway fallback — not retrying`);
            if (event.decision) event.decision.retry = false;
            return;
          }
        }

        // 401 "Header of type `authorization` was missing": this process has no key for the provider (2026-11-11:
        // OpenCode started from a shell that had not loaded free-models.env; every NVIDIA model failed, the
        // session fell to a model scoring 70 instead of 88 and nobody was told). The model is fine, so it is
        // not put in cooldown; the user is told once per provider, and this session moves on.
        const isMissingKey = status === 401 && MISSING_KEY.test(errMsg);
        if (isMissingKey) missingKeyNotice(String(event.model?.providerID || event.providerID || "provider"), errMsg);
        const isQuota = status === 429 || /rate limit|quota|too many/i.test(errMsg);
        const isBlocked = status === 403 || /abusive traffic|not available.*network|forbidden/i.test(errMsg);
        const isComboIssue = /combo.*timeout|upstream.*stream.*failed|maximum.*retry.*limit|production no readiness/i.test(errMsg);
        const isInternal = status >= 500 || /internal|failed with http/i.test(errMsg) || isComboIssue;
        // "SSE read timed out": the provider stopped streaming mid-answer and chunkTimeout (opencode.json
        // providers.*.settings) aborted it (2026-11-18: one NVIDIA step stalled 332 s before that was set).
        // A stall is transient: retry the same model once; only a repeat moves the session down the ladder
        // (review: failing over on the first stall cooled the best model and switched the whole session).
        const isStall = /sse read timed out|stream idle timeout/i.test(errMsg);
        const isConnRefused = /connectionrefused|unable to connect|econnrefused/i.test(errMsg) || errType === "provider.transport";
        const isThoughtSignature = /thought_signature|thought-signatures|missing.*thought/i.test(errMsg);
        // 413 "Request too large ... tokens per minute (TPM): Limit 8000" (Groq free tier, 2026-11-06): this
        // model cannot take a request of this size at all, so another model must (not a compaction)
        const isTooLargeForModel = status === 413 || /request too large for model|tokens per minute \(TPM\): limit/i.test(errMsg);
        const { media: isMediaLimit, overflow: isContextOverflow } = classify(status, errType, errMsg);

        // The images in the request are too big for the provider. Compaction and other models do not
        // help (the compaction request carries the same images): halve the image budget of this
        // session (context-engine/media.mjs replaces the oldest images by notes) and retry.
        if (isStall && attempt < 2) {
          log(`${event.sessionID} ${currentModel} stalled mid-stream ("${errMsg.slice(0, 60)}"): retrying the same model once`);
          if (event.decision) { event.decision.retry = true; event.decision.delay = 1000; }
          return;
        }

        if (isMediaLimit) {
          const level = tighten(event.sessionID);
          log(`${event.sessionID} media limit ("${errMsg.slice(0, 90)}"): ${level ? `image budget halved (level ${level}), retrying` : "no images left to cut, stopping this request"}`);
          if (event.decision) { event.decision.retry = !!level; event.decision.delay = 0; }
          return;
        }

        if ((isThoughtSignature || isContextOverflow) && !mayCompact(event.sessionID)) {
          log(`${event.sessionID} ${isThoughtSignature ? "thought signature" : "context overflow"} again after ${COMPACT_MAX} compactions in ${COMPACT_WINDOW_MS / 60000} min: not compacting again`);
        } else if (isThoughtSignature || isContextOverflow) {
          log(`compacting ${event.sessionID} (${isThoughtSignature ? "thought signature" : "context overflow"})`);
          try {
            await api.session.compact({ sessionID: event.sessionID });
            if (event.decision) {
              event.decision.retry = true;
              event.decision.delay = 0;
            }
            return;
          } catch (e) {
            log(`compaction failed: ${e.message} — continuing with failover`);
          }
        }

        // A 4xx that is not about quota, auth-blocking or context is a bad
        // request: another model will reject it too, so let the CLI surface it.
        const isClientError = status >= 400 && status < 500 &&
          !isQuota && !isBlocked && !isContextOverflow && !isTooLargeForModel && !isMissingKey && status !== 408;
        // a missing key fails every model of that provider in this process: rest them all for 10 min so the
        // next pick is another provider (2026-11-18 review: the 401 matched no trigger, so nothing moved on)
        if (isMissingKey && attempt >= 1) {
          const prov = String(event.model?.providerID || currentModel.split("/")[0] || "");
          if (prov) coolAll(allKnownModels().filter((m) => m.startsWith(`${prov}/`)), errMsg, 600);
        }
        const shouldFailover = isFreeCap || (isMissingKey && attempt >= 1) || (attempt >= 2 && !isClientError) ||
          (attempt >= 1 && (isQuota || isBlocked || isInternal || isStall || isContextOverflow || isTooLargeForModel ||
                            isConnRefused || isThoughtSignature));
        if (!shouldFailover) return;

        // the free-tier cap is account-wide, not a property of this model
        const acct = accountLimit(errMsg);
        if (acct) {
          coolAll(acct.models, errMsg, acct.seconds);
          log(`${acct.what} is out for every model (${acct.models.length} routes) for ${Math.round(acct.seconds / 60)} min; skipping them all`);
        } else if (!isFreeCap && !isMissingKey) recordFailure(currentModel, errMsg); // a missing key is not the model's fault
        // a strong model (own-machine / research / escalation turns) falls back to the next strong
        // route, not to whatever weak model follows it in the ladder (2026-11-06: Sonnet 429 ->
        // nemotron-super-vl at 60-94 s/step, then agnes-3.0-flash)
        let next = isStrong(currentModel) ? strongModel(currentModel) : null;
        if (next && cooldownState()[next]?.cooldown_until > Date.now() / 1000) next = null;
        if (next) log(`strong model ${currentModel} failed: next strong route ${next}`);
        if (!next && isStrong(currentModel)) {
          // no strong route left: the best usable model of the category (its head is fast), not the
          // weak models that sit below the strong route in the ladder
          const st = cooldownState();
          const chain = chainFor(categoryFor(event.agent, currentModel));
          next = chain.find((m) => m !== currentModel && !isStrong(m) && !(st[m]?.cooldown_until > Date.now() / 1000)
            && !(isFreeCap && m.startsWith("opencode/") && /-free$/.test(m))) || null;
          if (next) log(`no strong route left after ${currentModel}: ladder head ${next}`);
        }
        next ||= nextModel(currentModel, event.agent, isFreeCap);
        if (!next) {
          // everything is resting: wait for the first reset if it is close, instead of stopping the
          // session (the user had to press continue twice); otherwise stop with a clear reason
          const chain = chainFor(categoryFor(event.agent, currentModel));
          // the OpenCode free cap is daily and not in the ledger: never "wait" for one of those models
          const soon = soonestReset(chain, (m) => m === currentModel || (isFreeCap && m.startsWith("opencode/") && /-free$/.test(m)));
          if (soon && soon.s <= WAIT_FOR_RESET_S) {
            log(`every model is resting; waiting ${Math.round(soon.s)} s for ${soon.m}`);
            await api.session.switchModel({ sessionID: event.sessionID, model: toModelObj(soon.m) });
            if (event.decision) { event.decision.retry = true; event.decision.delay = Math.ceil(soon.s * 1000) + 3000; }
            return;
          }
          log(`every model in ${categoryFor(event.agent, currentModel)} is resting (first back in ${soon ? Math.round(soon.s / 60) : "?"} min); stopping this request`);
          if (event.decision) event.decision.retry = false;
          return;
        }

        const meta = (ladders().meta || {})[next] || {};
        const limit = meta.context || DEFAULT_CONTEXT;
        const safeThreshold = Math.floor(limit * 0.6);
        try {
          const session = await api.session.get?.(event.sessionID);
          const used = session?.tokens_input || session?.tokensInput || 0;
          if (used > safeThreshold) {
            log(`session ${event.sessionID} at ${used} tokens (safe ${safeThreshold} for ${limit} window) — compacting before switch`);
            await api.session.compact({ sessionID: event.sessionID }).catch((e) =>
              log(`pre-switch compaction warning: ${e.message}`));
          }
        } catch {}

        log(`failing over ${currentModel} -> ${next} (attempt ${attempt}, status ${status})`);
        await api.session.switchModel({ sessionID: event.sessionID, model: toModelObj(next) });

        const isPrimary = !event.agent || ["build", "primary", "architect", "planner"].includes(event.agent);
        if (isPrimary) updateConfigDefaultModel(next, currentModel);

        if (event.decision) {
          event.decision.retry = true;
          event.decision.delay = 0;
        }
      } catch (err) {
        log(`retry hook error: ${err.message}`);
        if (event.decision && event.attempt >= 2) event.decision.retry = false;
      }
    });
  },
};
