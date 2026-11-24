---
name: video-gen
description: >
  Generate short video clips via tiered video models in OmniRoute (Google Veo,
  ByteDance SeaDance). Use during development for UI motion concepts, demo
  assets, animations, and video placeholders. Triggers on "generate a video",
  "create a video clip", "render an animation", "video mockup". Returns a local
  .mp4 file path.
---

# Video Gen

Generate video clips using the free and high-speed video backends exposed through OmniRoute.

```bash
# defaults to ./video.mp4, walks tiers
~/.config/opencode/skills/video-gen/generate.sh "ocean waves crashing against cliffs at sunset"

# explicit output
~/.config/opencode/skills/video-gen/generate.sh "timelapse of glowing stars over a mountain" -o /tmp/timelapse.mp4

# skip to a specific tier
~/.config/opencode/skills/video-gen/generate.sh "geometric crystal spinning in space" --tier 2
```

## Tier order

| Tier | Model | Provider | Features |
| :--- | :--- | :--- | :--- |
| 1 | `veo-free/veo` | Google Veo | Photorealistic high-definition video rendering |
| 2 | `veo-free/seedance` | SeaDance | Dynamic motion and animation rendering |
| 3 | LTX-Video (`generate-video`) | Hugging Face ZeroGPU | Free fallback when the gateway tiers need a login or are out of quota; skipped if `generate-video` is not installed |

## Protocol

1. Read this skill for invocation syntax.
2. Generate using `~/.config/opencode/skills/video-gen/generate.sh "<prompt>" -o <output.mp4>`.
3. Verify: `file <output.mp4>` must report `video/mp4` or ISO Media.
4. If every tier fails, report the per-tier errors to the user. Do not print `free-models.env` or other key files while debugging: check a key with `[ -n "$NAME" ]`.
4. Report the resulting file path and details to the user.
