---
name: godot-jolt-physics
description: "Jolt Physics in Godot 4.4+ (built-in 3D physics engine): enabling it, project settings, differences from Godot Physics, joints, margins, ghost collisions, CharacterBody3D/RigidBody3D tuning, migration from the godot-jolt extension. Use for any Godot 3D physics, collision, raycast, ragdoll or physics-bug work."
---

# Jolt Physics in Godot 4

Jolt is **built into Godot since 4.4** and is the **default 3D engine for new projects since 4.6**. Do not install the old `godot-jolt` GDExtension (maintenance mode) unless the project specifically needs its extra joint nodes (`JoltHingeJoint3D` etc.), which the built-in module does not have.

Full upstream docs are in `references/` (read `using_jolt_physics.rst` first; also `physics_introduction`, `ray-casting`, `ragdoll_system`, `troubleshooting_physics_issues`, `large_world_coordinates`, `rigid_body`, `soft_body`, `collision_shapes_3d`). The complete Godot docs (text) are at `~/godot-addons/docs/godot-docs-4.x/`; class refs in `classes/class_*.rst`.

## Preflight
1. Check `project.godot` → `[physics] 3d/physics_engine`. Values: `"DEFAULT"`, `"GodotPhysics3D"`, `"Jolt Physics"`. Projects created before 4.6 may still be on Godot Physics.
2. Switching engines changes behaviour (margins, joints, contacts). After switching, re-test character movement, slopes, stairs and ragdolls.

```ini
[physics]
3d/physics_engine="Jolt Physics"
```

## Key differences vs Godot Physics (bite you in practice)
- **Shape margins shrink then round** the shape (no growth). Controlled by `physics/jolt_physics_3d/collisions/collision_margin_fraction` (× smallest AABB axis; `Shape3D.margin` becomes an upper bound). Odd normals on shape queries → lower it, but not to 0 normally.
- **Single-body joints:** Jolt treats the lone body as `node_b` (world = `node_a`). Toggle `physics/jolt_physics_3d/joints/world_node` for legacy behaviour.
- **Unsupported joint props** (warning if non-default): Pin `bias/damping/impulse_clamp`; Hinge `bias/softness/relaxation`; Slider `angular_*`, `*_limit/softness|restitution|damping`; ConeTwist `bias/relaxation/softness`; 6DOF `*_limit_*/softness|restitution|damping|erp`.
- **Penetration recovery** (Baumgarte) affects position only: no overshoot, slower to resolve. `simulation/baumgarte_stabilization_factor` (0..1).
- **Ghost collisions** on ConcavePolygon/HeightMap edges: `collisions/active_edge_threshold`, `simulation|queries|motion_queries/use_enhanced_internal_edge_removal`.
- `intersect_ray()` / `RayCast3D` `face_index` is always `-1` unless `queries/enable_ray_cast_face_index` (+~25% ConcavePolygon memory).
- Frozen-kinematic `RigidBody3D` reports **no** contacts vs static/kinematic unless `simulation/generate_all_kinematic_contacts` (costly with trimesh/heightmap).
- `get_contact_impulse()` is an estimate; only exact for isolated pairs.
- Areas DO emit overlap signals for `SoftBody3D` (Godot Physics doesn't).
- `WorldBoundaryShape3D` is finite and much smaller: `limits/world_boundary_shape_size`. Prefer a big box / HeightMapShape3D for ground.
- Temporary stack memory: `limits/temporary_memory_buffer_size` (raise if you see allocation errors with many bodies).
- Thread safety / running physics on a separate thread: see `references/using_jolt_physics.rst` "Thread safety".

## Migrating from the godot-jolt extension
Settings moved `physics/jolt_3d/*` → `physics/jolt_physics_3d/*` and many were renamed (e.g. `sleep/enabled` → `simulation/allow_sleep`, `solver/position_iterations` → `simulation/position_steps`, percentages → fractions). Full table in the reference. Remove `addons/godot-jolt` and swap `Jolt*Joint3D` nodes for stock joints.

## Practical patterns
- **Character controllers:** prefer `CharacterBody3D` + `move_and_slide()`; set `floor_max_angle`, `floor_snap_length` (0.2–0.5 for slopes/stairs), `safe_margin` small (0.001–0.01). Use `CapsuleShape3D` (no edges → fewer ghost hits).
- **Terrain:** `HeightMapShape3D` is cheapest for heightfields (Terrain3D generates these). Avoid huge ConcavePolygonShape3D for ground.
- **Fast projectiles:** `RigidBody3D.continuous_cd = true`, or ray/shape-cast per frame instead of bodies.
- **Ragdolls:** `PhysicalBoneSimulator3D` + `PhysicalBone3D` (4.3+); joint softness props are ignored under Jolt — tune with angular limits instead.
- **Queries:** `PhysicsDirectSpaceState3D.intersect_ray/intersect_shape/cast_motion` with `PhysicsRayQueryParameters3D.create(from, to, mask, exclude)`. Only query in `_physics_process`.
- **Performance:** keep bodies sleeping (`can_sleep`), use collision layers/masks aggressively, prefer primitive/convex shapes, set physics ticks (`physics/common/physics_ticks_per_second`) deliberately and enable physics interpolation for smooth rendering at low tick rates.

## Verify
Run the scene headless or with a bot (`godot --headless --path . res://scene.tscn --quit-after N`) and check the output for Jolt warnings about unsupported joint properties. Visual check: Debug → Visible Collision Shapes.

## OpenCode notes
- Before using any class, method or property, look it up: `grep -rn "<name>" references/` in this skill folder or the full docs in `~/godot-addons/docs/godot-docs-4.x/classes/`. Do not guess APIs; Godot 3 names (KinematicBody, yield, export var) are wrong in Godot 4.
- If `~/godot-addons/docs/godot-docs-4.x/` is missing, the same docs are online at https://docs.godotengine.org/en/stable/.
- Check that the project still loads, without a screen: `godot --headless --path <project> --import 2>&1 | grep -iE "error|failed"` (nothing printed = fine), then run the scene for a few seconds: `godot --headless --path <project> --quit-after 300 2>&1 | grep -iE "error|warning"`.
- Built into Godot 4.4+ (this machine: Godot 4.7.2): nothing to download. Switching engines is one line in `project.godot`; re-test movement after switching.
