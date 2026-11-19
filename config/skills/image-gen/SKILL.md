---
name: image-gen
description: >
  Generate images via a tiered chain of free backends, best available first:
  OVH SDXL (anonymous), Cloudflare FLUX.1 schnell, AI Horde, Pollinations.
  Use during coding work when a task needs a visual asset: UI mockups,
  placeholder and test-fixture images, app-icon or logo concepts, README hero
  art, diagram illustration. Triggers on "generate an image", "mock up a page",
  "make a logo", "placeholder image", "what would this look like".
  No API key required. Returns a local file path.
---

# Image Gen

Four free backends in a fallback chain, best first. `generate.sh` walks them in
order and stops at the first that returns a valid image, so a quota exhaustion
or rate limit on one tier never blocks a request.

```bash
# defaults to ./img.jpg, walks all four tiers
./generate.sh "a red barn in a snowy field"

# explicit output, named extension is fine - format follows the backend
./generate.sh "minimalist app icon, indigo and cream" -o /tmp/icon.png

# skip to a specific tier (debugging, or forcing the unlimited one)
./generate.sh "a lighthouse at dusk" --tier 3

./generate.sh --list
```

**Use the script. Don't hand-roll the curl calls** — every tier has a
non-obvious response shape and each has cost me a debugging cycle.

## If you have no shell access to this script

You are probably a read-only subagent (`explorer`, `architect`, `code-reviewer`,
`verifier`, `security-reviewer`, `database-reviewer`, `docs-lookup`). Those agents
deny `shell *` with an allowlist that excludes this script, so you **cannot
generate the image yourself**, no matter that the skill loaded fine.

Do not silently skip the task and do not report failure. Emit the exact command
and let the parent run it, then read the resulting file:

```text
~/.config/opencode/skills/image-gen/generate.sh "<prompt>" -o <output-path>
```

If `shell` is blocked, say which tier you would have started at (default 1) and
why you could not continue. The parent owns asset generation by design: it is the
only context with both `shell` and the ability to report a verified file back.

## Tier order

| Tier | Model | Access | Limit | Resolution |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `agnes/agnes-image-2.0-flash` | **OmniRoute Gateway** | unmetered | 1024×1024 |
| 2 | `stable-diffusion-xl-base-v10` | **OVH Kepler AI (anonymous)** | 2/min → ~2,880/day | 1024×1024 |
| 3 | `@cf/black-forest-labs/flux-1-schnell` | **Cloudflare Workers AI** | 10,000 neurons/day → ~230/day | 1024×1024 |
| 4 | AI Horde (Realistic Vision default) | **AI Horde** | **no daily cap** | 512×512 |
| 5 | Pollinations `sana` | **anonymous** | ~1 per 15-45s | 768×768 |

Tier order reflects measured output speed and fidelity. Tier 1 (OmniRoute Agnes Image 2.0 Flash) leads because it renders 1024×1024 PNGs in ~5s with prompt fidelity and no watermark. Tier 2 (OVH SDXL) and Tier 3 (Cloudflare FLUX) provide immediate fallbacks.

## Measured limits — read before promising anything

**Tier 1, OmniRoute.** High quality Agnes Image 2.0 Flash via local gateway (`http://127.0.0.1:20128/v1/images/generations`). Renders 1024×1024 PNGs in ~5-8s. Direct URL retrieval.

**Tier 2, OVH.** Anonymous, no key, no signup, no card. Headers say it exactly:

```
x-ratelimit-limit-minute: 2
retry-after: 5
```

2/min → ~2,880/day. Takes 10-28s. Accepts `negative_prompt`,
`num_inference_steps`, `guidance_scale`. Returns base64 **PNG**. Undocumented
and carries no SLA — it could vanish without notice.

**Tier 2, Cloudflare.** 10,000 neurons/day, resets 00:00 UTC. Neuron formula is
`tiles × 4.8 + steps × 9.6 × tiles`. ~230 images/day at 512×512, ~57 at
1024×1024. Returns base64 **JPEG** despite the "flux" model name. The API does
**not** echo the seed back — record it yourself if you need reproducibility.

**Tier 3, AI Horde.** Volunteer network, no daily cap whatsoever, so this is
the true unlimited tier. Anonymous users are capped at ~580×580, so the script
requests 512×512. Quality is SD-1.5 era: expect geometry artifacts and occasional
false-positive NSFW blocks. Override with `HORDE_MODEL=... ./generate.sh "..."`.

**Tier 4, Pollinations.** Weakest tier. See the corrections below.

## Corrections to earlier versions of this skill

Three things in the old doc were wrong. They are fixed in the script:

- Cloudflare's FLUX endpoint **rejects `width`/`height`** with
  `AiError: Bad input: Additional or unevaluated properties`. The old doc
  claimed they were optional. Omit them.
- Pollinations is **not FLUX**. `https://image.pollinations.ai/models` returns
  exactly `["sana"]`. Passing `model=flux` silently returns a Sana image.
- Pollinations **watermarks even with `nologo=true`**. Confirmed by inspecting
  output. Treat tier 4 as last-resort only.

## Verified dead ends

- **Google Gemini image models** — 429 `free_tier_requests limit: 0` on a new key.
- **fal.ai** — account billing-locked (`TOP_UP`).
- **Together AI** — free tier withdrawn; accounts read-only until you deposit.
- **HuggingFace Inference** — only ~$0.10/month in credits.
- **Local generation** — Intel integrated graphics, 7.6GB RAM, no CUDA.
  Stable Diffusion needs a dedicated NVIDIA GPU.

## Quality expectations

These are the bottom of the leaderboard, not the middle. Current frontier
(GPT-Image-2.5, Nano Banana 2.1, Seedream 5.0 Pro) scores ~1,425 on Arena
text-to-image; FLUX.1 schnell scores ~741. Roughly a 97% head-to-head gap.

Fine for: UI mockups, visual direction, placeholder and fixture images, icon
and logo concepts, README hero art, decorative illustration.

**Not** for: pixel-exact reproduction, brand consistency across a set, legible
in-image text (no free tier here renders text correctly), or CI assets needing
reproducibility. For UI work, build the real thing in HTML/CSS — generate images
to *explore direction*, then implement in code.

An undocumented alternative worth testing if you want a quality jump: Pollinations
claims `flux` is free forever on a registered key (no per-IP limit). Unverified
here, and their recent paywall tightening makes it worth probing before trusting.