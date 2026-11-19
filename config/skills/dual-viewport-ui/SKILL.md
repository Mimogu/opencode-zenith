---
name: dual-viewport-ui
description: Build synchronized dual-viewport web applications combining an interactive 3D WebGL Three.js canvas with an interactive 2D orthogonal grid/blueprint canvas, layer slicing, ghosting, and 3D measuring tape rulers. Use whenever the user asks for 3D/2D build guides, architectural viewers, or spatial CAD web applications.
---

# Dual Viewport 3D + 2D Interactive Web Architecture

When building structural guides, CAD tools, or voxel viewers, **a 3D perspective alone is insufficient** due to visual occlusion and isometric depth ambiguity. Always provide a **Synchronized Dual Viewport**.

## 1. Dual Canvas Architecture
- **Left/Main 3D Viewport:**
  - Three.js WebGL renderer with `InstancedMesh` for maximum 60FPS performance (10,000+ blocks).
  - `OrbitControls` with smooth damping (`dampingFactor: 0.06`).
  - Raycaster hover HUD showing block name and exact `(X, Y, Z)` coordinates.
  - Atmosphere shader controls (Daylight, Sunset, Night).
- **Split / Toggleable 2D Orthogonal Blueprint Canvas:**
  - Standard HTML5 2D Canvas rendering the active layer slice as a top-down pixel grid.
  - Displays grid numbers, cardinal axes (`N, S, E, W`), coordinate markers, and per-block color codes.
  - Click-to-inspect and hover crosshairs for precision block placement in survival mode.
  - "Export Layer PNG" button to download printable/shareable 2D construction sheets.

## 2. Advanced Visual Inspection Modes
- **Cumulative Build-Up (Default):** Shows all blocks from `Y=1` up to `Y=currentLayer`.
- **Single Layer Isolation (Slice):** Shows only blocks at `Y=currentLayer`.
- **Ghosting Mode (`Ghost Earlier Steps`):** Renders previous layers at 20-30% opacity or with a desaturated tone, while the active layer remains 100% vibrant.
- **Interior Cutaway:** Slices away exterior walls/canopies on a bounding plane to inspect interior rooms and stairs.
- **3D Tape Measure (Ruler Tool):** Click any two voxels in the 3D space to render a 3D line with distance readout (`ΔX, ΔY, ΔZ, Euclidean Distance`).

## 3. Video Build Timeline Synchronization
When deriving guides from construction timelapses or YouTube videos:
- Break down the build into **15–20 discrete, timestamped video phases** (e.g., `00:03 - Step 1: Central Trunk`, `00:09 - Step 4: Pod 1 Support Branch`).
- Clicking any step smoothly interpolates the 3D camera to focus directly on that phase's construction zone.
