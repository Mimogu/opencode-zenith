---
description: Run the live model capability lab and recalibrate the ladders (daily round, smoke, full, budget, or single model)
agent: build
---

Arguments: `$ARGUMENTS`

- empty → `python3 ~/.config/opencode/model_lab.py` (the budgeted daily round; aborts cleanly on the free-tier cap)
- `smoke` → `python3 ~/.config/opencode/model_lab.py --smoke`
- `budget N` → `python3 ~/.config/opencode/model_lab.py --budget N`
- `list` → `python3 ~/.config/opencode/model_lab.py --list`
- `full` → `python3 ~/.config/opencode/model_lab.py --full` — **warn the user first**: this spends the entire shared daily free-tier allowance and will usually abort partway.
- a model id → `python3 ~/.config/opencode/model_lab.py --model <id>`

Run the chosen command with a generous timeout, then report the ladder heads from `~/.config/opencode/ladders.json` and whether `state/lab_results.json` recorded `quota_hit`. Do not hand-edit the ladder; let the lab write it.
