---
name: godot-terrain3d
description: "Terrain3D (TokisanGames) GDExtension for large editable terrains in Godot 4: install, data directory/regions, sculpting & texture painting, heightmap import/export, instancer foliage, collision/height queries, navigation baking, shaders, performance. Use whenever a Godot project uses or should use Terrain3D / heightmap open-world terrain."
---

# Terrain3D for Godot 4

C++ GDExtension terrain with clipmap LOD, up to 1024 regions, sculpting, 32 texture layers, MultiMesh instancer. MIT. Works with **all renderers** (Forward+, Mobile, Compatibility). GDScript/C# bindings.

- Local release: `~/godot-addons/terrain3d/` (v1.1.0-stable, contains `addons/terrain_3d` + `demo/`). Check release notes for supported Godot versions; v1.1.0 targets Godot 4.5+ (user runs 4.7.2 mono).
- Full upstream docs + class API in `references/` (`references/api/class_terrain3d*.rst`). Start with `introduction.md`, `programming_languages.md`, `tips.md`, `troubleshooting.md`.

## Install into a project
```bash
mkdir -p <project>/addons && cp -r ~/godot-addons/terrain3d/addons/terrain_3d <project>/addons/
# optional demo: cp -r ~/godot-addons/terrain3d/demo <project>/
```
Then enable the plugin: `project.godot` → `[editor_plugins] enabled=PackedStringArray("res://addons/terrain_3d/plugin.cfg")`. First open must be in the editor (or `godot --headless --editor --quit --path <project>`) so the extension imports. To upgrade: delete `addons/terrain_3d` first, then copy the new one (never copy over). Follow the upgrade-path table in `installation.md` for data conversion.

## Core model
- `Terrain3D` node → `data_directory` (one `terrain3d_*.res` file per region; share the directory between scenes using the same map), `material: Terrain3DMaterial`, `assets: Terrain3DAssets` (textures + meshes; save both as `.tres`).
- `terrain.data: Terrain3DData` holds regions; `region_size` (64–2048, default 256), `vertex_spacing` scales horizontally.
- Outside regions = no data / no collision (only visual WorldNoise background).

## Scripting essentials
```gdscript
var terrain: Terrain3D = $Terrain3D           # node prints as [Wrapped:..], test with `is Terrain3D`
var h: float = terrain.data.get_height(pos)   # NAN for holes / outside regions
var n: Vector3 = terrain.data.get_normal(pos)
var hit: Dictionary = terrain.get_raycast_result(from, Vector3(0, -500, 0))
var p: Vector3 = terrain.get_intersection(cam_pos, dir)   # raymarch or GPU mode, see API caveats
terrain.data.add_region_blankp(pos)            # create regions at runtime
terrain.data.set_height(pos, 12.0); terrain.data.update_maps()   # batch edits, then update once
```
Procedural/runtime generation example: `demo/src/CodeGenerated.gd` (CodeGeneratedDemo.tscn). Bulk data edits: read `tips.md` → "Editing Data".

## Collision (`terrain.collision.mode`)
`Dynamic/Game` (default, node-less, around camera) · `Dynamic/Editor` · `Full/Game` · `Full/Editor` · `Disabled`. Use Editor modes only when tools need collision in-editor. Prefer `get_height()` over raycasts when X/Z is known. Use Jolt (see `godot-jolt-physics`).

## Textures
Pack albedo+height and normal+roughness per `texture_prep.md` (channel packing is required; use the built-in Pack Textures tool). Use mipmapped, VRAM-compressed textures, all same size/format per array.

## Foliage / instancer
Asset Dock → Meshes → paint. Limitations: no per-instance collision, no scene scripts, MultiMesh per cell. Use LODs + shadow impostor settings (`instancer.md`). Static colliders for trees must be added separately.

## Navigation (Recast via Godot NavigationServer)
Paint the **Navigable** tool first (all terrain un-navigable by default) → Terrain3D menu → *Set up Navigation* → *Bake NavMesh* (the stock NavigationRegion3D bake button does NOT include Terrain3D). Runtime baking example in `CodeGeneratedDemo.tscn`. Large worlds: several NavigationRegion3D with `filter_baking_aabb` + group source mode. See `navigation.md` and the `godot-navigation-recast` skill.

## Performance (see `performance.md`)
Fewer/larger regions, compressed+mipmapped textures, lower `mesh_size`/`mesh_lods`, disable unused material features (`Terrain3DMaterial` shader toggles), `Dynamic` collision with small radius, culling margins. On weak iGPUs (Intel HD 620) use the Mobile renderer and minimal shader options.

## Verify
Run with the console Godot so GDExtension errors show. `ClassDB.class_exists("Terrain3D")` confirms the extension loaded. Common failures: missing `.gdextension` libs for the platform, plugin not enabled, data dir unsaved → check `troubleshooting.md`.

## OpenCode notes
- Before using any class, method or property, look it up: `grep -rn "<name>" references/` in this skill folder or the full docs in `~/godot-addons/docs/godot-docs-4.x/classes/`. Do not guess APIs; Godot 3 names (KinematicBody, yield, export var) are wrong in Godot 4.
- If `~/godot-addons/docs/godot-docs-4.x/` is missing, the same docs are online at https://docs.godotengine.org/en/stable/.
- Check that the project still loads, without a screen: `godot --headless --path <project> --import 2>&1 | grep -iE "error|failed"` (nothing printed = fine), then run the scene for a few seconds: `godot --headless --path <project> --quit-after 300 2>&1 | grep -iE "error|warning"`.
- Add-on: `~/godot-addons/terrain3d/` (Terrain3D v1.1.0). Missing? Download from https://github.com/TokisanGames/Terrain3D/releases.
- After copying `addons/terrain_3d`, enable the plugin in `project.godot` (`[editor_plugins]` → `res://addons/terrain_3d/plugin.cfg`). Sculpting and painting are done by the user in the editor; from code you can create regions, import heightmaps and query heights.
- Always `mkdir -p <project>/addons` before copying: on a fresh project `cp -r <addon> <project>/addons/` creates `addons/` *as* the add-on folder (2026-11-25 this installed Voxel Tools twice and Godot loaded it twice). A fresh project has no addons/ folder.
