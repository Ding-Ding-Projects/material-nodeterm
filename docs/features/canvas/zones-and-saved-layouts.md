# Canvas zones and saved layouts

The canvas supports deliberate placement of one expanded node into a viewport-relative zone.
The available targets are left, right, top, and bottom halves, left, center, and right thirds,
and the four quarters. The node is resized and moved once, so the resulting geometry remains an
ordinary canvas position after panning or reopening the project.

## Dragging to an edge

Drag an eligible node toward an edge or corner of the visible canvas. The target region appears as
an anchored preview and names the zone. Releasing over the preview applies the same geometry used by
the context-menu action. Dragging in the middle of the canvas remains an ordinary move. Group frames,
collapsed nodes, and multi-node selections do not enter the zone flow because there is no single
unambiguous target rectangle.

## Menu placement

Right-click one expanded node and choose **Snap to zone**. The submenu exposes every supported half,
third, and quarter. The keyboard half commands remain available on platforms where their existing
canvas shortcut is registered. Zones are not live constraints and never create or modify a group.

## Saved layouts

The canvas menu and command palette provide **Save current canvas layout**. A saved layout contains a
user-chosen name, the canvas viewport, and bounded node snapshots keyed by node id. Each snapshot
contains position, size, grouping, and collapsed state only. Sessions, credentials, process state,
machine paths, and other runtime data are not copied into the layout record.

Selecting a saved layout restores matching nodes and the saved viewport without creating or deleting
nodes. If a saved node is absent, the restore still applies the matching entries and reports the
number of missing nodes. Saved layouts can be removed from the same menu. At most 32 layouts are kept
per project; the oldest entry is discarded when a new layout exceeds that bound.

## Persistence and recovery

Layouts are stored in the git-shared project projection alongside the canvas. The reader validates
names, identifiers, timestamps, viewports, node geometry, duplicate ids, and collection bounds. An
invalid layout entry is ignored rather than making the whole project unreadable. Runtime-only node
fields are never part of the saved layout schema.

The implementation is source-complete for this ultra-speed lane. Tests, type checks, lint, reviews,
security checks, accessibility checks, builds, packaging, installer execution, runtime interaction,
and UI captures were intentionally not run. Those checks remain unverified and must be performed by
the later integration lane.

## Suggested articles

- [Canvas and node lifecycle](./canvas-and-lifecycle.md)
- [Multiverse child canvases](./multiverse-canvases.md)
- [Projects and tabs](../projects/projects-and-tabs.md)
