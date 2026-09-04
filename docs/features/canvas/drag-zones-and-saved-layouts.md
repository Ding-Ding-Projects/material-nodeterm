# Drag zones and saved layouts

**Category:** [Canvas](./README.md)

The canvas supports deliberate placement of one node into a visible zone. Hold `Ctrl` or `Meta`
while dragging, or move the pointer close to a canvas edge, to reveal the zone overlay. The
overlay exposes halves by default, thirds while holding `Shift`, and a 2x2 quarter grid while
holding `Alt`. Release over a highlighted zone and the
node is resized and placed into that zone's current screen-relative rectangle. The result is
ordinary node geometry, not a live constraint, so panning later does not move the node again.

## Keyboard and guided controls

With one non-group, expanded node selected, `Ctrl+Alt+Left/Right/Up/Down` applies the matching
half. The same actions are available from the node context menu under **Snap to zone**, including
thirds and quarters. The shortcut is ignored while an input, terminal, or editor owns focus. A
`Ctrl+Alt+L` shortcut opens **Saved layouts**, the anchored catalogue used to save, preview, apply,
and remove arrangements.

The catalogue has a plain-text search by default and an adjacent anchored regex builder. Every
entry has a real preview path: it reports how many current nodes will move or resize, names saved
nodes that are absent, and reports cross-container collisions before applying. Applying the
arrangement calls the same canvas mutation path as a manual edit, so ordinary local undo/redo,
autosave, and peer sync remain available.

## Saved layout records

A layout has schema version `1`, a stable id, a user-provided name, a creation timestamp, and a
bounded list of node records containing only:

| Field | Meaning |
| --- | --- |
| `id` | The node identity used to match a future canvas. |
| `position` | The node's parent-relative x/y geometry. |
| `size` | The node's width and height. |
| `parentId` | The group frame relationship, when present. |
| `collapsed` | The node's collapsed presentation state, when present. |

Malformed rows, duplicate ids, non-finite coordinates, and geometry outside the documented
bounds are ignored on load. Missing nodes are kept in the saved record and reported during
preview, so deleting a node never silently destroys a useful arrangement. Collisions are reported
as a reviewable warning and the saved geometry is applied exactly, preserving user intent rather
than inventing a rearrangement.

Named layouts are stored in `.nodeterm/project.json` with the project's shared, portable content.
They never include credentials, provider sessions, machine paths, process state, terminal profiles,
caches, or runtime-only nodes. Opening an imported project therefore performs no network request,
deployment, provider mutation, process launch, or download. The current canvas remains unchanged
until the user deliberately chooses **Apply**.

## Accessibility and Material Design

The overlay is non-modal, paints its own Material Design 3 surface, stays within the viewport, and
does not intercept pointer events intended for the canvas. Zone labels are exposed to assistive
technology, the active zone has a visible border and a text label, and the hint is not communicated
by colour alone. The saved-layout catalogue is keyboard reachable, uses a labelled listbox, returns
focus to its opener when closed, and keeps the list scrollable at narrow widths and larger display
scales. Reduced motion keeps the geometry and state indication but removes transitions.

## Failure and recovery

- A canvas with no usable dimensions or a zone below the one-pixel geometry floor refuses the drop
  and leaves the node where it was.
- A missing node in a saved layout is reported and skipped; no new node, process, or credential is
  created.
- A collision is reported before applying. Undo returns the complete prior node snapshot.
- Deleting a saved layout uses the app's two-key destructive confirmation. It removes only the
  named arrangement, never the current canvas or its nodes.
- If project persistence fails, the normal canvas save notification remains the source of truth;
  the UI does not claim that a layout was stored until the project save path accepts it.

## Verification record

The implementation lives in `src/renderer/lib/nodeZones.ts`,
`src/renderer/lib/savedLayouts.ts`, `src/renderer/components/canvas/SavedLayoutsPanel.tsx`,
`src/renderer/canvas/Canvas.tsx`, `src/shared/types.ts`, `src/core/workspace-files.ts`, and
`src/core/portable-canvas-projection.ts`. This ultra-speed lane intentionally did not run tests,
type checks, lint, security or accessibility checks, builds, packaging, installer execution,
runtime interaction, or screenshots. Those checks remain pending against the exact candidate commit.

## Suggested articles

- [Canvas and node lifecycle](./canvas-and-lifecycle.md) — the canvas state and undo model.
- [Projects and tabs](../projects/projects-and-tabs.md) — shared project persistence and local
  camera state.
- [Portable canvas projection](../projects/portable-canvas-projection.md) — schema 3 import/export boundaries.
