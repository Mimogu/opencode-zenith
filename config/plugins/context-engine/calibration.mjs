// Per-model thresholds written by tools/recall_eval.py --write (memory-calibration.json).
// Python (lib/agy_recall.py) reads the same file, so the two sides cannot drift.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { EMBED_MODEL } from "./embed.mjs";

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "memory-calibration.json");
// used only when the active model has never been calibrated (nomic-embed-text values)
const DEFAULTS = { fact_min: 0.58, episode_min: 0.58, rel_gap: 0.08, duplicate: 0.895, related: 0.643,
  skill_hint: 0.65, skill_only_hint: 0.67, skill_inject: 0.67, skill_margin: 0.03,
  kw_relief: 0, kw_cover: 0.5, kw_only_cover: 0.6, kw_only_rel: 0.5 };

export function calibration(model = EMBED_MODEL) {
  try {
    const all = JSON.parse(fs.readFileSync(FILE, "utf-8"));
    // "_keyword" holds the model-independent keyword-only thresholds
    return { ...DEFAULTS, ...(all._keyword || {}), ...(all[model] || {}) };
  } catch {
    return { ...DEFAULTS };
  }
}
