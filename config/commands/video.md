---
description: Generate a video clip via OmniRoute backends (Google Veo, SeaDance)
agent: build
---

# /video: Generate Video

Generate a video clip using the tiered OmniRoute video backend chain: $ARGUMENTS

## Protocol

1. **Load the skill**: read `~/.config/opencode/skills/video-gen/SKILL.md` for tier
   order and usage.
2. **Generate** from the workspace:

   ```bash
   ~/.config/opencode/skills/video-gen/generate.sh "<prompt>" -o <output-path.mp4>
   ```

   The script walks Google Veo → SeaDance and stops at the first tier that returns a valid video.
3. **Verify**: `file <output-path.mp4>` must report a video mime type.
4. **Report**: give the absolute path, the model that served it, and the file size.
