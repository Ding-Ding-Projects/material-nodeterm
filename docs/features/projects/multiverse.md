# Multiverse child canvases

Multiverse child canvases are scoped content inside one project. They are not projects and never
appear as project tabs. The project root has the stable canvas identity `root`; each child stores a
stable `id`, `rootCanvasId`, `parentCanvasId`, `depth`, viewport, and its own node content.

## Hierarchy and scope

Children can be nested from the root through depth 8. Creation is refused when the requested parent
would produce depth 9, when the parent is missing, when an id is reused, or when a cycle would be
formed. Commands carry the active canvas scope. A node add, remove, or move must address that exact
canvas, and nodes cannot move between child canvases. Opening a child changes content scope only;
it does not create or switch a project tab.

The catalog seam is `src/core/multiverse.ts`. It exposes the node kinds currently allowed in a
Multiverse canvas and makes future universe-specific entries explicit. Door construction, numeric
or passphrase access, and the recovery game are intentionally not registered here; those belong to
the later Wave D issues.

## Persistence and portable saves

`Project.multiverse` is persisted in `.nodeterm/project.json` through `ProjectFileV1`. Every child
retains its own viewport and nodes. Node execution fields, credentials, host identifiers, process
state, and other machine-local values are stripped before writing and reattached only from the
local index on load.

Schema 3 portable projection includes child canvases and child nodes with explicit root and parent
identity. Import validates ids, parent references, cycles, exact depth, node membership, bounded
geometry, and content shape before adopting the hierarchy. Invalid child state is rejected as one
unit and never partially applied. Import makes no network request, deployment, provider mutation,
process launch, or download.

## Lang gui surface

The canvas command palette includes **Open Multiverse canvases**, and the canvas app bar exposes the
same action. The anchored panel provides a searchable child-canvas list with its own full regex
builder, a guided child name field, a parent picker with depth information, active-scope status,
and a catalog summary. Child content can be inspected and notes can be added through the catalog
seam. Empty and rejected states remain visible and explain the depth or scope boundary.

The panel uses the app's Lang gui tokens, keyboard-reachable controls, visible focus, a painted
bounded overlay, and a narrow-layout reflow. No child canvas is represented as a project tab.

## Suggested articles

- [Portable canvas projection](./portable-canvas-projection.md)
- [Portable project schema 3](./portable-schema3.md)
- [Projects and tabs](./projects-and-tabs.md)
- [Canvas lifecycle](../canvas/canvas-lifecycle.md)
