---
name: voxel-craft-cad
description: Master procedural voxel generation, 3D architectural modeling, parametric math curves, Three.js viewports, and Minecraft-grade spatial engineering. Use whenever the user asks for 3D voxel builds, Minecraft structures, architectural CAD, procedural geometry, Three.js viewports, or structural blueprints.
---

# Voxel Craft CAD & Spatial Engineering

This skill teaches agents how to design and synthesize production-grade 3D voxel structures with mathematical precision, structural realism, and procedural fidelity.

## Core Voxel Architectural Principles

### 1. Parametric Curves over Rigid Prisms
Never model organic structures (trees, terrain, curved roofs, branches) with rigid bounding boxes or flat layers. Always use parametric formulas:
- **Arching Boughs with Gravitational Droop (Sine Wave):**
  ```javascript
  // Arch up then gracefully droop at the tip:
  const archY = Math.round(startY + Math.sin(t * Math.PI * 0.85) * maxHeight - t * droopFactor);
  ```
- **Ellipsoidal Dome Shells with Normalized Distance:**
  ```javascript
  const normDist = Math.hypot(horizontalDist / radius, verticalDist / heightRadius);
  if (normDist >= minShell && normDist <= maxShell) { ... }
  ```
- **Logarithmic Spiral Staircases:**
  ```javascript
  const stairAngle = (stepIndex / stepsPerRev) * Math.PI * 2;
  const x = Math.round(Math.cos(stairAngle) * radius);
  const z = Math.round(Math.sin(stairAngle) * radius);
  ```

### 2. Hollow Geometric Shafts & Buttress Roots
- **7×7 Octagonal Hollow Shaft (16 Perimeter Coordinates):**
  North: `[-1,-3], [0,-3], [1,-3]`, South: `[-1,3], [0,3], [1,3]`
  West: `[-3,-1], [-3,0], [-3,1]`, East: `[3,-1], [3,0], [3,1]`
  Diagonals: `[-2,-2], [2,-2], [-2,2], [2,2]`
  Center interior `5×5` is hollow for stairs, ladders, or elevators.
- **Parabolic Root Buttress Flares:**
  Taper buttress reaches smoothly as height climbs (e.g., ground `Y=1..2` reaches 5 blocks, `Y=3..5` reaches 4, `Y=6..9` reaches 3).

### 3. Procedural Texture Atlases (16×16 Pixel Art)
Always generate procedural pixel textures with **1px dark edge outlines (`rgba(0,0,0,0.85)`)** for the signature Heybuilds/Minecraft aesthetic:
- **Log Rings:** Concentric lighter and darker wood rings on top/bottom faces.
- **Bark:** Vertical grain variations on side faces.
- **Planks:** Horizontal plank divisions with nail rivets.
- **Stained Glass & Foliage:** Cutout transparency (`alphaTest: 0.35`) and emissive core glow (`emissiveIntensity: 0.8-1.2`).

## Voxel CAD & Architectural Blueprint Guidelines (restored from AGENTS.md)

When designing 3D/2D voxel structures, Minecraft build guides, or spatial CAD web applications:
1. **Dual Projection Mandatory**: Always implement both a Three.js WebGL 3D orbital viewport and an interactive 2D top-down orthogonal slice grid with coordinates. Single-view perspective causes depth ambiguity.
2. **Parametric Organic Geometry**: Never use flat discs or monolithic boxes for trees or natural forms. Use mathematical curves (sine-wave droop for arching boughs, multi-lobed ellipsoidal shells, and parabolic root flares).
3. **Builder Utility Suite**: Always include ghosting of previous steps, interior cutaway, ruler/measurement tool, material stack calculators (64-item base), and in-game export (.mcfunction).
4. **Video Timeline Grounding**: When given a video reference, synchronize construction phases to exact video timestamps (e.g., 00:03, 00:09, 00:20, 00:31).
