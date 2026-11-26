---
name: godot-voxel-tools
description: "Zylann's Voxel Tools for Godot 4 (godot_voxel): module vs GDExtension edition, VoxelTerrain/VoxelLodTerrain, blocky (Minecraft-like) and smooth (Transvoxel) terrain, generators & VoxelGeneratorGraph, VoxelTool editing, streams/saving, instancing, VoxelViewer, multiplayer, performance, C# caveats. Use for any voxel / destructible / minecraft-style / infinite procedural terrain in Godot."
---

# Voxel Tools (godot_voxel) for Godot 4

Two editions with the same API:
- **GDExtension** (`addons/zylann.voxel/`, works with official Godot 4.5+): local copy `~/godot-addons/voxel/` (v1.7x). **No FastNoise2**; some technical limits (upstream issue 442). Use this by default.
- **Module** (custom Godot build + custom export templates): release `v1.7` = Godot 4.7.2 + Voxel Tools 1.7 on GitHub releases. Needed for FastNoise2 SIMD or if the extension misbehaves. Never mix: a module build + the extension = class conflicts.

**C# caveat:** extension classes have no typed C# glue → use `ClassDB.Instantiate("VoxelTerrain")`, `Get/Set/Call`. Disable `voxel/ownership_checks` for C# generators. Prefer GDScript for voxel code.

Upstream docs in `references/` (start with `overview.md`, `quick_start.md`, `scripting.md`, then `blocky_terrain.md` / `smooth_terrain.md`, `generators.md`, `streams.md`, `performance.md`, `instancing.md`, `multiplayer.md`, `navigation.md`); full class API in `references/api/*.md`.

## Install (GDExtension)
```bash
mkdir -p <project>/addons && cp -r ~/godot-addons/voxel/addons/zylann.voxel <project>/addons/
```
No plugin toggle needed (extension auto-loads via `voxel.gdextension`). Exclude `addons/zylann.voxel/editor/*` from exports to drop icons.

## Choosing nodes
| Need | Node | Mesher | Channel |
|---|---|---|---|
| Minecraft-style blocks | `VoxelTerrain` | `VoxelMesherBlocky` + `VoxelBlockyLibrary`/`VoxelBlockyTypeLibrary` | `CHANNEL_TYPE` |
| Smooth, overhangs, huge view distance, LOD | `VoxelLodTerrain` | `VoxelMesherTransvoxel` | `CHANNEL_SDF` |
| Colored cubes (MagicaVoxel) | `VoxelTerrain` / `VoxelMeshInstance` | `VoxelMesherCubes` | `CHANNEL_COLOR` |

Always add a **`VoxelViewer`** under the camera/player, or nothing loads in-game. Add a light + WorldEnvironment.

## Generators
`VoxelGeneratorFlat`, `VoxelGeneratorNoise2D` (heightmap), `VoxelGeneratorNoise` (3D SDF), `VoxelGeneratorGraph` (node graph, fast, preferred for SDF), or a script:
```gdscript
@tool
extends VoxelGeneratorScript
const CH := VoxelBuffer.CHANNEL_TYPE
func _get_used_channels_mask() -> int: return 1 << CH
func _generate_block(buf: VoxelBuffer, origin: Vector3i, lod: int) -> void:
	# runs on worker threads: no scene-tree access, no shared mutable state
	if origin.y < 0: buf.fill(1, CH)
```

## Editing
```gdscript
var vt: VoxelTool = terrain.get_voxel_tool()   # cache it
vt.channel = VoxelBuffer.CHANNEL_SDF           # match the mesher!
vt.mode = VoxelTool.MODE_REMOVE
vt.do_sphere(hit_pos, 3.0)
var hit: VoxelRaycastResult = vt.raycast(origin, dir, 20.0)
if vt.is_area_editable(aabb): ...
```
Only loaded areas (and LOD0 for VoxelLodTerrain) are editable. Bulk-edit with buffers/`paste`/`do_*` rather than per-voxel `set_voxel`.

## Persistence & streaming
Assign a `stream` (`VoxelStreamSQLite` recommended, or `VoxelStreamRegionFiles`) to save edits; call `terrain.save_modified_blocks()` before quitting. Generator fills anything not in the stream.

## Physics & navigation
Terrain makes its own colliders (`generate_collisions`), works with Jolt. Navigation has no built-in navmesh support: use `VoxelAStarGrid3D` for blocky, AStar3D waypoints, or runtime NavigationServer baking per chunk (expensive; see `navigation.md` and `godot-navigation-recast`). Character movement on blocky terrain can use `VoxelBoxMover`.

## Performance
Worker thread count `voxel/threads/*`, block size 16, view distance, `mesh_block_size`, LOD distance; GPU generation/detail normalmaps need Forward+ compute. On weak iGPUs keep view distance modest.

## OpenCode notes
- Before using any class, method or property, look it up: `grep -rn "<name>" references/` in this skill folder or the full docs in `~/godot-addons/docs/godot-docs-4.x/classes/`. Do not guess APIs; Godot 3 names (KinematicBody, yield, export var) are wrong in Godot 4.
- If `~/godot-addons/docs/godot-docs-4.x/` is missing, the same docs are online at https://docs.godotengine.org/en/stable/.
- Check that the project still loads, without a screen: `godot --headless --path <project> --import 2>&1 | grep -iE "error|failed"` (nothing printed = fine), then run the scene for a few seconds: `godot --headless --path <project> --quit-after 300 2>&1 | grep -iE "error|warning"`.
- Add-on: `~/godot-addons/voxel/` (Voxel Tools GDExtension, Godot 4.5+). Missing? Download `GodotVoxelExtension.zip` from https://github.com/Zylann/godot_voxel/releases. The GDExtension edition needs no plugin entry; it loads from `addons/zylann.voxel/`.
- Install path matters: copy the folder itself, `mkdir -p <project>/addons && cp -r ~/godot-addons/voxel/addons/zylann.voxel <project>/addons/`, so the project has `addons/zylann.voxel/voxel.gdextension`. Do not copy its contents straight into `addons/` (2026-11-25 a model did; it loads, but add-on updates and other add-ons then collide).
- Always `mkdir -p <project>/addons` before copying: on a fresh project `cp -r <addon> <project>/addons/` creates `addons/` *as* the add-on folder (2026-11-25 this installed Voxel Tools twice and Godot loaded it twice). A fresh project has no addons/ folder.
