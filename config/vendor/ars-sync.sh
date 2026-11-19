#!/usr/bin/env bash
# Update the vendored academic-research-skills and re-apply the local deep-research merge.
#
#   ars-sync.sh            # pull latest, re-merge, report
#   ars-sync.sh --status   # report installed version without touching anything
#
# Layout:
#   vendor/academic-research-skills   git clone (source of truth for 4 of 5 skills)
#   skills/<name>                     symlink -> vendor/<name>   (auto-updates on pull)
#   skills/deep-research              real directory               (vendor + local exa merge)
#
# Because deep-research is a real directory rather than a symlink, a bare `git pull`
# would leave it stale and would not re-apply the merge. This script does both.

set -euo pipefail

VENDOR="$HOME/.config/opencode/vendor/academic-research-skills"
SKILLS="$HOME/.config/opencode/skills"
MERGE="$HOME/.config/opencode/vendor/merge_deep_research.py"
SYMLINKED=(academic-paper academic-paper-reviewer academic-pipeline sr-screener)

status() {
  local ver
  ver=$(python3 -c "import json;print(json.load(open('$VENDOR/.claude-plugin/plugin.json'))['version'])" 2>/dev/null || echo "?")
  printf 'upstream version : %s\n' "$ver"
  printf 'upstream commit  : %s\n' "$(git -C "$VENDOR" rev-parse --short HEAD 2>/dev/null || echo '?')"
  printf 'last commit date : %s\n' "$(git -C "$VENDOR" log -1 --format=%cs 2>/dev/null || echo '?')"
  printf 'skills present   :'
  for s in "${SYMLINKED[@]}" deep-research; do
    [ -f "$SKILLS/$s/SKILL.md" ] && printf ' %s' "$s" || printf ' %s(MISSING)' "$s"
  done
  printf '\n'
  if grep -q 'Route selection' "$SKILLS/deep-research/SKILL.md" 2>/dev/null; then
    printf 'exa merge        : applied\n'
  else
    printf 'exa merge        : NOT APPLIED — run ars-sync.sh\n'
  fi
}

if [[ "${1:-}" == "--status" ]]; then status; exit 0; fi

echo "==> pulling upstream"
git -C "$VENDOR" pull --ff-only

echo "==> re-applying deep-research merge"
python3 "$MERGE"

echo "==> verifying symlinks"
for s in "${SYMLINKED[@]}"; do
  if [ -f "$SKILLS/$s/SKILL.md" ]; then
    printf '  ok    %s -> %s\n' "$s" "$(readlink "$SKILLS/$s")"
  else
    printf '  BROKEN %s\n' "$s"; ln -sfn "$VENDOR/$s" "$SKILLS/$s"
  fi
done

echo
status
echo
echo "Restart opencode (or start a new session) for it to pick up skill changes."