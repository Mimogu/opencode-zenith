---
description: Generate an image via the free backend chain (best tier first, automatic fallback)
agent: build
---

# /img: Generate Image

Generate a raster image using the tiered free backend chain: $ARGUMENTS

## Protocol

1. **Load the skill**: read `~/.config/opencode/skills/image-gen/SKILL.md` for tier
   order, measured limits, and per-backend gotchas.
2. **Generate** from the repo root:

   ```bash
   ~/.config/opencode/skills/image-gen/generate.sh "<prompt>" -o <output-path>
   ```

   The script walks OVH → Cloudflare → AI Horde → Pollinations and stops at the
   first tier that returns a valid image. Do not hand-roll the curl calls.
3. **Verify**: `file <output-path>` must report an image mime type. The script
   already enforces this internally; confirm before reporting success.
4. **Report**: give the absolute path, the tier that served it, and the pixel
   dimensions. Never report success without the `file` check passing.

## Rules

- Never promise a tier will work. Read the limits table first.
- If all four tiers fail, say so plainly and report the exit code. Do not retry
  the same tier in a loop — tiers 1 and 2 are both rate-limited by design.
- Prefer a descriptive output path (`docs/hero-banner.png`) over `img.jpg`.
- For text rendered *inside* the image, do not use these backends — none of
  them render legible text reliably. Use HTML/CSS and screenshot it instead.