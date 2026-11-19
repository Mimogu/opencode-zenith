#!/usr/bin/env bash
# Desktop control for Wayland sessions (Hyprland, labwc and other wlroots compositors): screenshots
# with grim, text location with tesseract, keys/text with wtype, clicks with ydotool. The pointer is
# moved by Hyprland itself when it runs: `ydotool mousemove --absolute` is scaled by pointer
# acceleration there (2026-11-17: asked 400,300, landed 801,601). Coordinates are full-resolution
# screen pixels.
#
#   desk.sh size                      screen size "W H"
#   desk.sh shot [out.png] [scale]    screenshot (default scale 0.5, with cursor); prints path
#   desk.sh region X Y W H [out.png]  full-resolution crop of one area; prints path
#   desk.sh find "text" [n]           locate on-screen text; prints "x y conf word" (click centers)
#   desk.sh text                      OCR of the whole screen as plain text
#   desk.sh move X Y                  move pointer
#   desk.sh click X Y [left|right|middle|double]
#   desk.sh scroll up|down [n]
#   desk.sh type "text"               type literal text into the focused window
#   desk.sh key combo                 e.g. Return, ctrl+l, ctrl+shift+t, alt+F4, super
set -euo pipefail

OUT_DIR="${DESK_OUT:-/var/tmp/pip-scratch/opencode/desk}"
mkdir -p "$OUT_DIR"
export YDOTOOL_SOCKET="${YDOTOOL_SOCKET:-/run/user/$(id -u)/.ydotool_socket}"

need() { command -v "$1" >/dev/null || { echo "desk.sh: missing $1" >&2; exit 3; }; }

# Hyprland: find the running instance even when this shell did not inherit the session's environment
hypr() {
  command -v hyprctl >/dev/null || return 1
  if [ -z "${HYPRLAND_INSTANCE_SIGNATURE:-}" ]; then
    local d; d=$(ls -td "${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"/hypr/*/ 2>/dev/null | head -1)
    [ -n "$d" ] && export HYPRLAND_INSTANCE_SIGNATURE=$(basename "$d")
  fi
  [ -n "${HYPRLAND_INSTANCE_SIGNATURE:-}" ] && hyprctl version >/dev/null 2>&1
}

move_to() {
  local x=$1 y=$2
  if hypr; then
    # 0.57+ Lua config dispatcher, then the classic one; check where the cursor really is
    hyprctl dispatch "hl.dsp.cursor.move({ x = $x, y = $y })" >/dev/null 2>&1 || true
    [ "$(hyprctl cursorpos 2>/dev/null)" = "$x, $y" ] && return 0
    hyprctl dispatch movecursor "$x" "$y" >/dev/null 2>&1 || true
    [ "$(hyprctl cursorpos 2>/dev/null)" = "$x, $y" ] && return 0
    echo "desk.sh: Hyprland did not move the pointer to $x,$y (now $(hyprctl cursorpos))" >&2; return 4
  fi
  need ydotool
  ydotool mousemove --absolute -x "$x" -y "$y" >/dev/null
}

screen_size() {
  need grim
  local tmp; tmp=$(mktemp --suffix=.png)
  grim -t png "$tmp"
  python3 - "$tmp" <<'PY'
import struct, sys
with open(sys.argv[1], "rb") as f:
    f.read(16); w, h = struct.unpack(">II", f.read(8))
print(w, h)
PY
  rm -f "$tmp"
}

cmd="${1:-}"; shift || true
case "$cmd" in
  size) screen_size ;;
  shot)
    need grim
    out="${1:-$OUT_DIR/shot-$(date +%H%M%S).png}"; scale="${2:-0.5}"
    grim -c -t png -s "$scale" "$out"
    echo "$out (scale $scale: multiply image coordinates by $(python3 -c "print(round(1/$scale, 3))") for clicks)"
    ;;
  region)
    need grim
    [ $# -ge 4 ] || { echo "usage: region X Y W H [out]" >&2; exit 2; }
    out="${5:-$OUT_DIR/region-$(date +%H%M%S).png}"
    grim -t png -g "$1,$2 ${3}x${4}" "$out"; echo "$out"
    ;;
  text)
    need grim; need tesseract
    tmp=$(mktemp --suffix=.png); grim -t png "$tmp"
    tesseract "$tmp" - --psm 3 2>/dev/null; rm -f "$tmp"
    ;;
  find)
    need grim; need tesseract
    [ $# -ge 1 ] || { echo "usage: find \"text\" [n]" >&2; exit 2; }
    tmp=$(mktemp --suffix=.png); grim -t png "$tmp"
    tesseract "$tmp" - --psm 11 tsv 2>/dev/null | python3 -c '
import sys, csv
want = sys.argv[1].lower().split(); n = int(sys.argv[2])
rows = [r for r in csv.DictReader(sys.stdin, delimiter="\t") if r.get("text", "").strip()]
words = [(r["text"], int(r["left"]), int(r["top"]), int(r["width"]), int(r["height"]), float(r["conf"]))
         for r in rows if r["conf"] not in ("", "-1")]
hits = []
for i in range(len(words)):
    seq = words[i:i + len(want)]
    if len(seq) < len(want):
        break
    if all(w.lower() in s[0].lower() for w, s in zip(want, seq)):
        x0 = min(s[1] for s in seq); y0 = min(s[2] for s in seq)
        x1 = max(s[1] + s[3] for s in seq); y1 = max(s[2] + s[4] for s in seq)
        conf = min(s[5] for s in seq)
        hits.append(((x0 + x1) // 2, (y0 + y1) // 2, conf, " ".join(s[0] for s in seq)))
hits.sort(key=lambda h: -h[2])
for x, y, c, t in hits[:n]:
    print(x, y, int(c), t)
if not hits:
    sys.exit(1)
' "$1" "${2:-5}"
    status=$?; rm -f "$tmp"; exit $status
    ;;
  move)
    [ $# -ge 2 ] || { echo "usage: move X Y" >&2; exit 2; }
    move_to "$1" "$2"
    ;;
  click)
    need ydotool; [ $# -ge 2 ] || { echo "usage: click X Y [button]" >&2; exit 2; }
    move_to "$1" "$2"; sleep 0.1
    case "${3:-left}" in
      left)   ydotool click 0xC0 >/dev/null ;;
      right)  ydotool click 0xC1 >/dev/null ;;
      middle) ydotool click 0xC2 >/dev/null ;;
      double) ydotool click --repeat 2 --next-delay 80 0xC0 >/dev/null ;;
      *) echo "unknown button $3" >&2; exit 2 ;;
    esac
    ;;
  scroll)
    need ydotool
    dir="${1:-down}"; n="${2:-3}"
    step=$([ "$dir" = up ] && echo 1 || echo -1)
    for _ in $(seq "$n"); do ydotool mousemove --wheel -x 0 -y "$step" >/dev/null; done
    ;;
  type)
    need wtype; [ $# -ge 1 ] || { echo "usage: type \"text\"" >&2; exit 2; }
    wtype -- "$1"
    ;;
  key)
    need wtype; [ $# -ge 1 ] || { echo "usage: key combo" >&2; exit 2; }
    IFS=+ read -r -a parts <<< "$1"
    args=(); last="${parts[-1]}"
    for m in "${parts[@]:0:${#parts[@]}-1}"; do
      case "${m,,}" in
        ctrl|control) args+=(-M ctrl) ;; shift) args+=(-M shift) ;;
        alt) args+=(-M alt) ;; super|win|logo) args+=(-M logo) ;;
        *) echo "unknown modifier $m" >&2; exit 2 ;;
      esac
    done
    [ "${last,,}" = super ] && last=Super_L
    args+=(-k "$last")
    for m in "${parts[@]:0:${#parts[@]}-1}"; do
      case "${m,,}" in
        ctrl|control) args+=(-m ctrl) ;; shift) args+=(-m shift) ;;
        alt) args+=(-m alt) ;; super|win|logo) args+=(-m logo) ;;
      esac
    done
    wtype "${args[@]}"
    ;;
  *) sed -n '2,20p' "$0"; exit 2 ;;
esac
