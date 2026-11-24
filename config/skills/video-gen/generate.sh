#!/usr/bin/env bash
# Tiered video generation via OmniRoute and free backends.
# Usage: ./generate.sh "prompt" [-o out.mp4] [--tier N] [--list] [--quiet]
set -uo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SKILL_DIR}/../../free-models.env"
OUT="video.mp4"
START_TIER=1
QUIET=0

log() { [ "$QUIET" -eq 1 ] || printf '%s\n' "$*" >&2; }
die() { printf 'error: %s\n' "$*" >&2; exit 2; }

TIERS=(veo seedance)
TIER_NAMES=("OmniRoute Google Veo" "OmniRoute SeaDance")
TIER_MODELS=("veo-free/veo" "veo-free/seedance")

usage() {
  cat <<'EOF'
Tiered free video generation, best backend first.

  ./generate.sh "ocean waves crashing against cliffs at sunset" [-o out.mp4] [--tier N] [--list] [--quiet]

  -o FILE     output path (default: video.mp4)
  --tier N    start at tier N (1-2), skipping better ones
  --list      show the tier order and exit
  --quiet     suppress progress logging

Tiers, best first:
  1  OmniRoute Google Veo       via local gateway, photorealistic high definition video
  2  OmniRoute SeaDance         via local gateway, stylized dynamic motion video
EOF
}

PROMPT=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o|--out) OUT="${2:?--out needs a value}"; shift 2 ;;
    --tier)   START_TIER="${2:?--tier needs a value}"; shift 2 ;;
    --list)   usage; exit 0 ;;
    --quiet)  QUIET=1; shift ;;
    -h|--help) usage; exit 0 ;;
    -*)       die "unknown flag: $1" ;;
    *)
      [ -z "$PROMPT" ] || die "unexpected extra argument: $1"
      PROMPT="$1"; shift ;;
  esac
done
[ -n "$PROMPT" ] || { usage; die "no prompt given"; }
case "$START_TIER" in
  ''|*[!0-9]*) die "--tier must be a number" ;;
esac
[ "$START_TIER" -ge 1 ] && [ "$START_TIER" -le 2 ] || die "--tier must be 1-2"

command -v jq >/dev/null 2>&1 || die "jq is required"
command -v curl >/dev/null 2>&1 || die "curl is required"
command -v ffprobe >/dev/null 2>&1 || log "warn: ffprobe not found; verify step will be skipped"

# Source environment
[ -f "$ENV_FILE" ] && { set -a; . "$ENV_FILE" 2>/dev/null; set +a; }

# ------------------------------------------------ tier 1: OmniRoute Google Veo
tier_veo() {
  local url="http://127.0.0.1:20128/v1/videos/generations"
  local token="${OMNIROUTE_API_KEY:-}"
  [ -n "$token" ] || return 1
  local body vid_url
  body=$(curl -s --max-time 180 -X POST "$url" \
    -H "Authorization: Bearer $token" \
    -H "Content-Type: application/json" \
    -d "$(jq -nc --arg p "$PROMPT" '{model:"veo-free/veo", prompt:$p}')" 2>/dev/null)
  vid_url=$(printf '%s' "$body" | jq -r '.data[0].url // .data[0].b64_json // empty' 2>/dev/null)
  [ -n "$vid_url" ] || return 1
  if [[ "$vid_url" =~ ^https?:// ]]; then
    curl -s --max-time 120 -o "$OUT" "$vid_url" 2>/dev/null || return 1
  else
    printf '%s' "$vid_url" | tr -d '[:space:]' | base64 -d > "$OUT" 2>/dev/null || return 1
  fi
  file -b --mime-type "$OUT" | grep -q '^video/' || return 1
  verify_video "$OUT" || return 1
  return 0
}

# ---------------------------------------------- tier 2: OmniRoute SeaDance
tier_seedance() {
  local url="http://127.0.0.1:20128/v1/videos/generations"
  local token="${OMNIROUTE_API_KEY:-}"
  [ -n "$token" ] || return 1
  local body vid_url
  body=$(curl -s --max-time 180 -X POST "$url" \
    -H "Authorization: Bearer $token" \
    -H "Content-Type: application/json" \
    -d "$(jq -nc --arg p "$PROMPT" '{model:"veo-free/seedance", prompt:$p}')" 2>/dev/null)
  vid_url=$(printf '%s' "$body" | jq -r '.data[0].url // .data[0].b64_json // empty' 2>/dev/null)
  [ -n "$vid_url" ] || return 1
  if [[ "$vid_url" =~ ^https?:// ]]; then
    curl -s --max-time 120 -o "$OUT" "$vid_url" 2>/dev/null || return 1
  else
    printf '%s' "$vid_url" | tr -d '[:space:]' | base64 -d > "$OUT" 2>/dev/null || return 1
  fi
  file -b --mime-type "$OUT" | grep -q '^video/' || return 1
  verify_video "$OUT" || return 1
  return 0
}

# Verify video has a stream and duration > 0
verify_video() {
  local file="$1"
  if ! command -v ffprobe >/dev/null 2>&1; then
    log "warn: ffprobe missing, skipping verify"
    return 0
  fi
  local json dur
  json=$(ffprobe -v error -print_format json -show_streams -show_format "$file" 2>/dev/null) || return 1
  echo "$json" | jq -e '.streams[] | select(.codec_type=="video")' >/dev/null 2>&1 || { log "verify: no video stream"; return 1; }
  dur=$(echo "$json" | jq -r '.format.duration // "0"' 2>/dev/null)
  awk -v d="$dur" 'BEGIN { exit !(d + 0 > 0) }' || { log "verify: duration <= 0"; return 1; }
  return 0
}

for (( i = START_TIER; i <= 2; i++ )); do
  name="${TIER_NAMES[$((i - 1))]}"
  log "tier $i: $name"
  if "tier_${TIERS[$((i - 1))]}"; then
    log "ok: $name -> $OUT"
    exit 0
  fi
  log "  failed, falling through"
done

die "all video tiers failed for: ${PROMPT:0:60}"