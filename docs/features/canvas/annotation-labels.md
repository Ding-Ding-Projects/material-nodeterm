# Annotation labels and line thickness

## Behaviour

The Canvas drawing menu creates colored frames, straight lines, and arrows as independent canvas
annotations. An annotation is decoration, not a relationship between nodes. Lines have no
arrowhead; arrows point at their end point. Every annotation carries a short editable label,
shown near the midpoint, so a diagram remains understandable after the canvas is reopened.

The selected annotation toolbar exposes the live color control, label field, line/arrow toggle,
line thickness in pixels, and delete action. Thickness is clamped to 1–24 px and defaults to 3 px.
The label is bounded to 120 characters and is also used as the node's accessible and searchable
display title. The root annotation element exposes an appearance-editor target, so its typography,
color, background, border, spacing, and other supported appearance properties can be edited with
the same anchored editor used by other canvas nodes.

## Persistence and portable projects

The label, variant, diagonal, color, geometry, and thickness are stored in the project node state.
Schema 3 portable projection keeps these safe presentation fields while continuing to omit process,
credential, host, and path authority. Imported thickness is rejected outside 1–24 px, and malformed
labels are rejected rather than partially applied.

## Accessibility and failure modes

The annotation is keyboard selectable through the canvas node model, has an accessible name that
includes its variant and label, and gives its label and thickness controls explicit names. A blank
label is valid and hides the visual label while retaining the variant name for assistive technology.
Invalid or missing legacy thickness values render at the safe 3 px default; they never produce a
zero-width or unbounded SVG stroke.

## Security considerations

Annotation fields are local project presentation data. They do not add node relationships, process
authority, executable paths, credentials, or network access. Portable projection validates bounds,
allowed keys, finite numbers, and text size before serialization.

## Verification

Review the drawing tools and selected annotation toolbar in the built desktop surface. Draw each
frame, line, and arrow, edit the label and thickness, resize the annotation, reload the project,
and export/import its portable projection. Confirm the appearance editor opens on the annotation,
keyboard focus reaches the label and thickness fields, and the accessible name remains meaningful
when the visual label is blank.

## Suggested articles

- [Canvas and node lifecycle](./canvas-and-lifecycle.md)
- [Appearance](../appearance/README.md)
- [Projects](../projects/README.md)
