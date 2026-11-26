---
name: godot-navigation-recast
description: "Godot 4 navigation (Recast/Detour-based NavigationServer3D/2D): navmesh baking in editor and at runtime (async, source geometry parsing), NavigationRegion/Agent/Obstacle/Link, avoidance (RVO), navigation layers, path queries, multiple agent sizes, chunked/large-world navmeshes, Terrain3D & voxel integration, debugging. Use for AI pathfinding, enemy movement or navmesh problems."
---

# Godot 4 Navigation (Recast navmesh baking)

Godot bakes navmeshes with **Recast** internally (`NavigationMesh` cell/agent params map to Recast's) and does its own pathfinding (polygon A*) + RVO avoidance. There is no separate Recast addon to install — use the built-in NavigationServer. Full upstream docs in `references/navigation_*.rst` (read `navigation_introduction_3d`, `navigation_using_navigationmeshes`, `navigation_using_navigationagents`, `navigation_optimizing_performance`). Class refs: `~/godot-addons/docs/godot-docs-4.x/classes/class_navigation*.rst`.

## Pieces
- `NavigationRegion3D` + `NavigationMesh` resource (baked polygons). Regions on the same map merge where edges line up (`edge_connection_margin`).
- `NavigationAgent3D` (child of the moving body): pathfinding + optional avoidance.
- `NavigationObstacle3D`: avoidance-only (static vertices can also be baked as holes with `affect_navigation_mesh`).
- `NavigationLink3D`: jumps, ladders, teleports between disconnected parts.
- Navigation layers (bitmask) to restrict regions per agent type; `navigation_layers` on regions/agents.

## Baking
Key `NavigationMesh` params — must match your agents and the map:
`cell_size` / `cell_height` (= project `navigation/3d/default_cell_size|height`, mismatch → sync errors), `agent_radius`, `agent_height`, `agent_max_climb`, `agent_max_slope`, `geometry_parsed_geometry_type` (`MESH_INSTANCES` vs `STATIC_COLLIDERS` — use colliders for MultiMesh foliage/Terrain3D), `geometry_source_geometry_mode` (root children vs groups), `filter_baking_aabb`, `border_size` (for tiled chunks).

Runtime async bake (main-thread parse, threaded bake):
```gdscript
var src := NavigationMeshSourceGeometryData3D.new()
NavigationServer3D.parse_source_geometry_data(nav_mesh, src, root_node)   # main thread only
NavigationServer3D.bake_from_source_geometry_data_async(nav_mesh, src, _on_baked)
func _on_baked() -> void:
	region.navigation_mesh = nav_mesh
```
Or simply `region.bake_navigation_mesh(true)` (on_thread). For huge/streamed worlds: one region per chunk, same cell size, `border_size` > 0 with `filter_baking_aabb` per tile so edges merge; never re-bake the whole world.

## Agent loop (3D)
```gdscript
@onready var agent: NavigationAgent3D = $NavigationAgent3D
func _ready() -> void:
	agent.velocity_computed.connect(_on_velocity_computed)
	await get_tree().physics_frame   # map not synced on first frame
	agent.target_position = target
func _physics_process(_d: float) -> void:
	if agent.is_navigation_finished(): return
	var v := global_position.direction_to(agent.get_next_path_position()) * speed
	if agent.avoidance_enabled: agent.velocity = v   # result arrives in velocity_computed
	else: _on_velocity_computed(v)
func _on_velocity_computed(v: Vector3) -> void:
	velocity = v; move_and_slide()
```
Don't set `target_position` every frame; re-path on a timer or when the target moved > threshold. Direct queries without agents: `NavigationServer3D.map_get_path(map, from, to, true)` or `NavigationPathQueryParameters3D` + `query_path()` (supports path postprocessing, simplification, excluded regions).

## Multiple agent sizes
Separate navigation **maps** (`NavigationServer3D.map_create()`), each with regions baked for that radius; set `agent.set_navigation_map(map)`. See `navigation_different_actor_types.rst`.

## Integrations
- **Terrain3D:** paint Navigable areas, bake via the Terrain3D menu (stock bake ignores it). See `godot-terrain3d`.
- **Voxel Tools:** no built-in navmesh; bake per chunk at runtime or use `VoxelAStarGrid3D`. See `godot-voxel-tools`.
- **GridMap/CSG/MeshLibrary** geometry is parsed automatically.

## Debugging
Debug → Visible Navigation. Common errors: "source geometry is empty" (nothing parsed / wrong parse type / group), "Navigation map synchronization error" (cell size mismatch or overlapping regions), agents stuck (agent radius > baked `agent_radius`, `path_desired_distance` / `target_desired_distance` too small, avoidance fighting colliders). Performance tips: `navigation_optimizing_performance.rst` (fewer polygons, larger cell size, thread baking, limit avoidance neighbors).

## OpenCode notes
- Before using any class, method or property, look it up: `grep -rn "<name>" references/` in this skill folder or the full docs in `~/godot-addons/docs/godot-docs-4.x/classes/`. Do not guess APIs; Godot 3 names (KinematicBody, yield, export var) are wrong in Godot 4.
- If `~/godot-addons/docs/godot-docs-4.x/` is missing, the same docs are online at https://docs.godotengine.org/en/stable/.
- Check that the project still loads, without a screen: `godot --headless --path <project> --import 2>&1 | grep -iE "error|failed"` (nothing printed = fine), then run the scene for a few seconds: `godot --headless --path <project> --quit-after 300 2>&1 | grep -iE "error|warning"`.
- Built into Godot (NavigationServer3D/2D): nothing to download. Bake at runtime with `NavigationServer3D.bake_from_source_geometry_data_async` or `NavigationRegion3D.bake_navigation_mesh()`; in headless runs wait for the `bake_finished` signal before querying paths.

- **Start from the tested template** (Godot 4.7.2: navmesh bakes, the enemy walks to the target): copy `templates/nav_level.tscn` and `templates/enemy.gd` from this skill folder into the project and rename/adjust. Write scenes as `.tscn` text like the template; do not build them from a script.
- If you must build a scene from code: every child needs `child.owner = root` before `PackedScene.pack(root)`, or the saved scene contains only the root node (2026-11-25 a model lost 25 minutes on this).
- An un-baked `NavigationMesh` is empty and every path is empty: bake it in the editor, or call `region.bake_navigation_mesh(false)` once at start (the template's enemy does).
