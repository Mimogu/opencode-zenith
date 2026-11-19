#!/usr/bin/env bash
# Tiered free image generation. Best available backend first, fall through on failure.
# Usage: ./generate.sh "prompt" [-o out.jpg] [--tier N] [--list] [--quiet]
set -uo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SKILL_DIR}/../../free-models.env"
OUT="img.jpg"
START_TIER=1
QUIET=0
HORDE_MODEL="${HORDE_MODEL:-Realistic Vision}"
HORDE_TIMEOUT="${HORDE_TIMEOUT:-120}"
case "$HORDE_TIMEOUT" in
  ''|*[!0-9]*) HORDE_TIMEOUT=120 ;;
esac

log() { [ "$QUIET" -eq 1 ] || printf '%s\n' "$*" >&2; }
die() { printf 'error: %s\n' "$*" >&2; exit 2; }

TIERS=(omniroute ovh cloudflare horde pollinations)
TIER_NAMES=("OmniRoute Agnes Image 2.0" "OVH SDXL-base-v1.0" "Cloudflare FLUX.1-schnell" "AI Horde" "Pollinations Sana")
TIER_MODELS=("agnes/agnes-image-2.0-flash" "stable-diffusion-xl-base-v10" "@cf/black-forest-labs/flux-1-schnell" "$HORDE_MODEL" "sana")

usage() {
  cat <<'EOF'
Tiered free image generation, best backend first.

  ./generate.sh "a red cube on grass" [-o out.jpg] [--tier N] [--list] [--quiet]

  -o FILE     output path (default: img.jpg)
  --tier N    start at tier N (1-5), skipping better ones
  --list      show the tier order and exit
  --quiet     suppress progress logging

Tiers, best first:
  1  OmniRoute Agnes Image 2.0  via local gateway, unmetered, 1024x1024 PNG
  2  OVH SDXL-base-v1.0         anonymous, 2/min (~2880/day), 1024x1024
  3  Cloudflare FLUX            key required, 10000 neurons/day (~230/day), 1024x1024
  4  AI Horde                   uncapped, 512x512, SD-1.5 era
  5  Pollinations Sana          anonymous, watermarked, 402 rate limited, 768x768
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
[ "$START_TIER" -ge 1 ] && [ "$START_TIER" -le 5 ] || die "--tier must be 1-5"

command -v jq >/dev/null 2>&1 || die "jq is required"
command -v curl >/dev/null 2>&1 || die "curl is required"

# ---------------------------------------------------------------- tier 1: OmniRoute
# High quality Agnes Image 2.0 Flash via OmniRoute local gateway.
# Fast (~5-8s), 1024x1024 full resolution PNG.
tier_omniroute() {
  [ -f "$ENV_FILE" ] || return 1
  set -a; . "$ENV_FILE" 2>/dev/null; set +a
  local url="http://127.0.0.1:20128/v1/images/generations"
  local token="${OMNIROUTE_API_KEY:-}"
  [ -n "$token" ] || return 1
  local body img_url
  body=$(curl -s --max-time 60 -X POST "$url" \
    -H "Authorization: Bearer $token" \
    -H "Content-Type: application/json" \
    -d "$(jq -nc --arg p "$PROMPT" '{model:"agnes/agnes-image-2.0-flash", prompt:$p, size:"1024x1024"}')" 2>/dev/null)
  img_url=$(printf '%s' "$body" | jq -r '.data[0].url // empty' 2>/dev/null)
  [ -n "$img_url" ] || return 1
  curl -s --max-time 40 -o "$OUT" "$img_url" 2>/dev/null || return 1
  file -b --mime-type "$OUT" | grep -q '^image/' || return 1
  return 0
}

# ---------------------------------------------------------------- tier 2: OVH
# Anonymous. No key, no signup. 2 requests/minute, 1024x1024 SDXL base.
# Returns base64 PNG. Honours Retry-After on 429.
tier_ovh() {
  local url="https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/images/generations"
  local attempt retry_after body
  for attempt in 1 2; do
    body=$(curl -s --max-time 120 -D /tmp/.ovh_hdr -w '\n__HTTP__%{http_code}' \
      -X POST "$url" \
      -H 'Content-Type: application/json' \
      -d "$(jq -nc --arg p "$PROMPT" \
            '{model:"stable-diffusion-xl-base-v10", prompt:$p, n:1,
              size:"1024x1024", num_inference_steps:40, guidance_scale:6.5}')" 2>/dev/null)
    local code="${body##*__HTTP__}"
    body="${body%__HTTP__*}"
    case "$code" in
      200)
        local img; img=$(printf '%s' "$body" | jq -r '.data[0].b64_json // empty' 2>/dev/null)
        [ -n "$img" ] || return 1
        printf '%s' "$img" | tr -d '[:space:]' | base64 -d > "$OUT" 2>/dev/null || return 1
        file -b --mime-type "$OUT" | grep -q '^image/' || return 1
        return 0 ;;
      429)
        retry_after=$(grep -i '^retry-after:' /tmp/.ovh_hdr | tail -1 | tr -dc '0-9')
        case "$retry_after" in
          ''|*[!0-9]*) retry_after=5 ;;
        esac
        [ "$retry_after" -le 60 ] || retry_after=60
        [ "$attempt" -eq 1 ] || return 1
        log "  ovh: rate limited, sleeping ${retry_after}s"
        sleep "$retry_after" ;;
      *) return 1 ;;
    esac
  done
  return 1
}

# ---------------------------------------------------------- tier 3: Cloudflare
# Needs CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN from free-models.env.
# 10000 neurons/day. ~230 images/day at 512x512, ~57 at 1024x1024.
# NOTE: this endpoint rejects width/height. Returns base64 JPEG.
tier_cloudflare() {
  [ -f "$ENV_FILE" ] || return 1
  set -a; . "$ENV_FILE" 2>/dev/null; set +a
  [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] && [ -n "${CLOUDFLARE_API_TOKEN:-}" ] || return 1
  local body img
  body=$(curl -s --max-time 120 -X POST \
    "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$(jq -nc --arg p "$PROMPT" '{prompt:$p, steps:4}')" 2>/dev/null)
  img=$(printf '%s' "$body" | jq -r '.result.image // empty' 2>/dev/null)
  [ -n "$img" ] || return 1
  printf '%s' "$img" | tr -d '[:space:]' | base64 -d > "$OUT" 2>/dev/null || return 1
  file -b --mime-type "$OUT" | grep -q '^image/' || return 1
  return 0
}

# -------------------------------------------------------------- tier 4: AI Horde
# Uncapped queue. Async submit + poll.
# Result is a WebP URL, not base64.
tier_horde() {
  local id elapsed=0 status=""
  local key="0000000000"
  [ -n "${AI_HORDE_API_KEY:-}" ] && key="$AI_HORDE_API_KEY"
  id=$(curl -s --max-time 30 -X POST https://aihorde.net/api/v2/generate/async \
    -H "apikey: $key" -H 'Content-Type: application/json' \
    -d "$(jq -nc --arg p "$PROMPT" --arg m "$HORDE_MODEL" \
      '{prompt:$p, models:[$m], nsfw:false, censor_nsfw:true,
        params:{sampler_name:"k_euler", cfg_scale:7, height:512, width:512, steps:20, n:1}}')" \
    2>/dev/null | jq -r '.id // empty' 2>/dev/null)
  [ -n "$id" ] || return 1
  log "  horde: queued job ${id:0:8}, waiting"
  while [ "$elapsed" -lt "$HORDE_TIMEOUT" ]; do
    sleep 5
    elapsed=$((elapsed + 5))
    status=$(curl -s --max-time 15 "https://aihorde.net/api/v2/generate/check/$id" \
      -H "apikey: $key" 2>/dev/null | jq -r 'if .faulted then "fault" elif .done then "done" else "wait" end' 2>/dev/null)
    [ "$status" = "done" ] || [ "$status" = "fault" ] && break
  done
  [ "$status" = "done" ] || return 1
  local url
  url=$(curl -s --max-time 20 "https://aihorde.net/api/v2/generate/status/$id" \
    -H "apikey: $key" 2>/dev/null | jq -r '.generations[0].img // empty' 2>/dev/null)
  [ -n "$url" ] || return 1
  curl -s --max-time 40 -o "$OUT" "$url" 2>/dev/null || return 1
  file -b --mime-type "$OUT" | grep -q '^image/' || return 1
  return 0
}

# --------------------------------------------------------- tier 5: Pollinations
# Keyless. Model list is exactly ["sana"] - NOT flux. Watermarks even with
# nologo=true. Returns 402 once the per-IP window is exhausted.
tier_pollinations() {
  local code
  code=$(curl -s -o "$OUT" --max-time 60 -w '%{http_code}' --get \
    --data-urlencode "width=768" --data-urlencode "height=768" \
    --data-urlencode "nologo=true" \
    "https://image.pollinations.ai/prompt/$(printf '%s' "$PROMPT" | jq -sRr @uri)" 2>/dev/null)
  [ "$code" = "200" ] || return 1
  file -b --mime-type "$OUT" | grep -q '^image/' || return 1
  return 0
}

for (( i = START_TIER; i <= 5; i++ )); do
  name="${TIER_NAMES[$((i - 1))]}"
  log "tier $i: $name"
  if "tier_${TIERS[$((i - 1))]}"; then
    size=$(file -b "$OUT" | grep -oE '[0-9]+ ?x ?[0-9]+' | tail -1 | tr -d ' ')
    log "ok: $name -> $OUT (${size:-unknown})"
    exit 0
  fi
  log "  failed, falling through"
done

die "all five tiers failed for: ${PROMPT:0:60}"