---
name: godot4-dev
description: Godot 4 and GDScript 2.0 engineering guidelines. Autoloads vs singletons, themes/UI property overrides, integer division warnings, node signal/property shadowing, callback rules, and headless testing. Use whenever developing, debugging, or reviewing Godot 4 game engine projects.
---

# Godot 4 & GDScript 2.0 Engineering Guidelines

When developing or debugging Godot 4 / GDScript projects:
1. **Autoloads vs Engine Singletons**:
   - Autoloads (configured in `project.godot`) are NOT engine singletons. Never use `Engine.has_singleton("Name")` or `Engine.get_singleton("Name")` for autoloads — that always returns false/null.
   - Autoloads are registered as global script identifiers and root nodes under `/root/Name`. Access them directly by name (e.g., `GameData`, `ProfileManager`, `SoundManager`).
2. **Themes & UI Property Overrides**:
   - `ThemeDB.set_project_theme()` does NOT exist in Godot 4. Use `get_tree().root.theme = theme` or assign on controls.
   - Do NOT assign dictionaries directly to `theme_override_constants` (e.g. `theme_override_constants = {"separation": 10}` will crash). Use `add_theme_constant_override("separation", 10)`.
   - Use `add_theme_color_override("fill_color", color)`, `add_theme_font_size_override("font_size", size)`.
3. **Number Types & Arithmetic Warnings**:
   - In GDScript, dividing two integers (`a / b`) truncates to an integer and produces an `INTEGER_DIVISION` warning. Use float division: `float(a) / float(b)` or `a / 10.0`.
4. **Base Node Signal & Property Shadowing**:
   - Never name a local variable or parameter `ready`, `process`, `tree`, `owner`, `name`, etc. They shadow built-in Node signals/properties and generate compile warnings or runtime bugs.
5. **No Duplicate Function Declarations**:
   - Never define duplicate lifecycle or callback functions (such as two `_draw()` methods) in the same script.
6. **Headless Testing**:
   - When running standalone script checks via `godot-mono -s test.gd`, Autoloads are not loaded automatically. Test scripts should instantiate classes directly or run full scenes via `godot-mono --headless path/to/project scene.tscn`.

## Reference material & related skills
- Full Godot docs (rst text, 4.x) offline: `~/godot-addons/docs/godot-docs-4.x/`, class reference in `classes/class_<name>.rst`: grep there before guessing an API (online: https://docs.godotengine.org/en/stable/).
- Add-on skills: `godot-jolt-physics` (3D physics), `godot-navigation-recast` (pathfinding), `godot-terrain3d` (large terrains), `godot-voxel-tools` (voxel/Minecraft-like terrain), `godot-effekseer` (VFX). Downloaded add-on releases live in `~/godot-addons/`.
- Check a project without a screen: `godot --headless --path <project> --import`, then `godot --headless --path <project> --quit-after 300` and read errors.
