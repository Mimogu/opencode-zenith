---
name: godot-effekseer
description: "Effekseer for Godot 4 (EffekseerForGodot4 GDExtension): install, importing .efkefc effects, EffekseerEmitter3D/2D API, dynamic inputs & triggers, scaling, autofree, sound script, performance limits. Use for Godot VFX made in the Effekseer tool (skill/ultimate effects, hits, spells)."
---

# Effekseer for Godot 4

Plays particle effects authored in the free **Effekseer** editor (`.efkefc`) inside Godot. MIT. GDExtension.

- Local release: `~/godot-addons/effekseer/` (v1.80.7 — needs **Godot 4.6+** since 1.80.2; supports GPU particles). Copy its `addons/effekseer` into the project.
- Upstream docs: `references/how-to-use.md`, `references/api-reference.md` (full class API), `faq.md`, `history.md`.
- Effekseer authoring tool (to make/edit effects): https://effekseer.github.io/ — sample effects ship with the tool and in the repo's `Demo/`.

## Install
```bash
mkdir -p <project>/addons && cp -r ~/godot-addons/effekseer/addons/effekseer <project>/addons/
```
Enable "Effekseer for Godot" in Project Settings → Plugins (`[editor_plugins]` in project.godot). The plugin registers the `EffekseerSystem` singleton and project settings under `effekseer/*` (instance max count, square max count, draw max count, sound script).

## Assets
Copy the `.efkefc` **plus all its textures, models, materials, sounds with the same relative paths** under `res://`. The importer creates an `EffekseerEffect` resource; if sub-resources show unlinked, reimport. Adjust size with the **import `scale`** option (preferred over node scale, which some effects ignore).

## API (3D; 2D is the same plus `orientation: Vector3`)
`EffekseerEmitter3D` (extends VisualInstance3D → respects layer masks):
- props: `effect: EffekseerEffect`, `autoplay`, `autofree` (queue_free when finished), `paused`, `speed` (0–10), `color` (multiplied), `target_position`
- methods: `play()`, `stop()`, `stop_root()` (let spawned particles finish), `is_playing()`, `set_dynamic_input(index 0-3, value)`, `send_trigger(index 0-3)`
- signal: `finished`

```gdscript
const SLASH := preload("res://vfx/slash.efkefc")

func spawn_vfx(at: Transform3D, effect: EffekseerEffect = SLASH) -> void:
	var e := EffekseerEmitter3D.new()
	e.effect = effect
	e.autofree = true
	add_child(e)               # add to tree before play()
	e.global_transform = at
	e.play()
```
2D: `EffekseerEmitter2D` — positions are pixels, so set a large node scale (e.g. 50–100) and fix facing with `orientation`.

## Tips
- Pool emitters for frequently spawned hits instead of new nodes each time; `stop()` + `play()` restarts.
- Use dynamic inputs / triggers (configured in the Effekseer editor) to drive charge levels, loops ending, etc. from gameplay.
- Effekseer renders in its own pass: it does **not** cast shadows or get lit by Godot lights; tone-mapping/glow from WorldEnvironment still applies, so tune HDR intensity accordingly.
- For cinematics (ultimates), drive `play()` from an `AnimationPlayer` method track and use `speed` for slow-mo instead of `Engine.time_scale` if you want VFX unaffected.
- Raise `effekseer/instance_max_count` / `square_max_count` if effects get cut off when many play at once.

## Verify
Check the console for "Effekseer" load errors; `ClassDB.class_exists("EffekseerEmitter3D")` confirms the extension is loaded. Select the `.efkefc` in the editor to preview it in the inspector.

## OpenCode notes
- Before using any class, method or property, look it up: `grep -rn "<name>" references/` in this skill folder or the full docs in `~/godot-addons/docs/godot-docs-4.x/classes/`. Do not guess APIs; Godot 3 names (KinematicBody, yield, export var) are wrong in Godot 4.
- If `~/godot-addons/docs/godot-docs-4.x/` is missing, the same docs are online at https://docs.godotengine.org/en/stable/.
- Check that the project still loads, without a screen: `godot --headless --path <project> --import 2>&1 | grep -iE "error|failed"` (nothing printed = fine), then run the scene for a few seconds: `godot --headless --path <project> --quit-after 300 2>&1 | grep -iE "error|warning"`.
- Add-on: `~/godot-addons/effekseer/` (EffekseerForGodot4 1.80.7, Godot 4.6+). Missing? Download the release zip from https://github.com/effekseer/EffekseerForGodot4/releases and unzip it there.
- After copying `addons/effekseer`, enable the plugin in `project.godot`: under `[editor_plugins]` add `res://addons/effekseer/plugin.cfg` to `enabled=PackedStringArray(...)`.
- Always `mkdir -p <project>/addons` before copying: on a fresh project `cp -r <addon> <project>/addons/` creates `addons/` *as* the add-on folder (2026-11-25 this installed Voxel Tools twice and Godot loaded it twice). A fresh project has no addons/ folder.
