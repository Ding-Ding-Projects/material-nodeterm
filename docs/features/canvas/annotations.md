# Canvas annotations

Canvas annotations are visual-only line and arrow nodes. They help a person classify an area of the
canvas without creating a relationship between sessions. An annotation never carries a source or
target, never exposes connection handles, and never changes what an agent can read.

## Drawing and editing

Choose Draw line or Draw arrow from the canvas drawing tools, then drag across the canvas. A drag
shorter than the minimum gesture threshold is treated as a click and creates nothing. The node
keeps the diagonal that the gesture used, so resizing stretches the same stroke rather than
changing its direction.

When an annotation is selected or hovered, its compact toolbar provides:

- a local colour picker;
- an optional label, limited to 120 Unicode characters and trimmed before persistence;
- a line-thickness slider from 1 through 16 local pixels, with 3 as the default;
- a line or arrow toggle; and
- a delete action.

The label is rendered beside the stroke and is not used as a node identity. The stroke width is
stored as bounded numeric presentation intent and is applied directly to the SVG line. Invalid or
missing persisted widths return to 3 pixels. Empty labels are omitted.

## Portable project data

Annotation geometry, diagonal, label, and thickness are safe project presentation intent. Schema 3
exports carry `annotationVariant`, `annotationDir`, `annotationLabel`, and `annotationThickness`.
The importer accepts only the two known variants, the two known diagonals, non-empty trimmed labels
within the 120-character bound, and integer thickness values from 1 through 16. Credentials,
process state, host paths, and runtime bindings are not part of an annotation.

Import remains a pure reconstruction step. It does not draw a new annotation, contact a service, or
launch a process. A malformed annotation record is refused by the schema validator rather than
partially applied.

## Source of truth

The shared bounds and normalization live in `src/shared/annotation.ts`. Renderer geometry remains in
`src/renderer/lib/annotation.ts`, the node UI is in `src/renderer/nodes/AnnotationNode.tsx`, and
project and portable serializers are wired through `src/renderer/state/workspace.ts` and
`src/core/portable-canvas-projection.ts`.

## Verification state

Issue #76 uses the ultra-speed implementation boundary. Tests, type checks, lint, reviews, security
checks, accessibility checks, builds, packaging, installer execution, runtime interaction, and UI
captures were intentionally not run in this implementation lane. The integration lane must verify
the packaged application and portable round trip before calling the feature fully verified.

## Suggested articles

- [Canvas and node lifecycle](./canvas-and-lifecycle.md)
- [Node kinds](./node-kinds.md)
- [Multiverse child canvases](./multiverse-canvases.md)
