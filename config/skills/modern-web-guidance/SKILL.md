---
name: modern-web-guidance
description: "MANDATORY: Autonomously activate for all HTML, CSS, frontend UI, styling, and clientside JavaScript tasks. Enforces modern CSS (:has(), container queries, subgrid, View Transitions, native dialog/popover) and prevents generic, outdated UI anti-patterns. Trigger automatically on any frontend or UI task; never wait for user to request."
---

# Modern Web & Anti-Slop UI Architecture

Ensures all frontend code uses modern browser primitives, accessible semantic HTML, and fluid, responsive design instead of outdated 2018-era patterns or generic Tailwind bloat.

## Modern Layout & Styling Primitives

1. **Native Popover & Dialog**:
   - Use native `<dialog>` with `.showModal()` for modal dialogs.
   - Use native `popover="auto"` and `popovertarget` for tooltips and dropdowns without external JS libraries.
2. **Modern CSS Selectors**:
   - Parent & relational styling: `:has(.error)`, `:has(:checked)`.
   - Modern pseudo-classes: `:is()`, `:where()`, `:user-valid`, `:user-invalid`.
3. **Fluid & Container Layouts**:
   - Container queries: `@container (min-width: 400px)` for component-level responsiveness.
   - Subgrid: `grid-template-columns: subgrid;` to align nested cards with parent tracks.
   - Clamp sizing: `font-size: clamp(1rem, 2.5vw, 1.75rem);`.
4. **Motion & Transitions**:
   - View Transitions API (`document.startViewTransition`) for seamless page and component state shifts.
   - `@media (prefers-reduced-motion: reduce)` must be respected for all animations.

## Anti-Slop UI Principles

- **Avoid Generic Purple Gradients & Card Clutter**: Design purposeful, content-first visual hierarchy.
- **Accessible Contrast**: All text must meet WCAG AA standards (4.5:1 for normal text, 3:1 for large text).
- **Interactive States**: Every interactive element requires clear `:focus-visible`, `:hover`, and `:active` styling.
