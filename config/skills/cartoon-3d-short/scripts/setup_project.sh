#!/usr/bin/env bash
# Create the Remotion project this skill renders in (default ~/remotion-shorts) with the bridge
# example registered. Versions are pinned: React 19 + @react-three/postprocessing 3 renders blank frames.
#   bash setup_project.sh [dir]
set -euo pipefail
SK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
P="${1:-$HOME/remotion-shorts}"
if [ -f "$P/package.json" ]; then echo "exists: $P (nothing changed)"; exit 0; fi
mkdir -p "$P/src/videos" "$P/public" "$P/scripts" "$P/out"
cp "$SK/project/package.json" "$SK/project/tsconfig.json" "$P/"
cp "$SK/project/index.ts" "$SK/project/Root.tsx" "$P/src/"
cp -r "$SK/templates/bridge" "$P/src/videos/bridge"
cp "$SK/templates/scripts/"* "$P/scripts/"
cd "$P" && npm install --no-fund --no-audit
echo "ready: $P  (test: cd $P && node scripts/bridge-stills.mjs out/test/x_ 120 0.5)"
