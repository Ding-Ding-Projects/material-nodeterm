# AWS wizard generator

The AWS wizard generator is a schema-driven canvas node for composing and reviewing an AWS request
shape locally. It maps the model to typed controls instead of asking somebody to guess a command:
searchable enum pickers, switches, bounded integer and number fields, native date and time fields,
local file pickers, repeatable lists, maps, and nested objects are all rendered from one schema.

## Behaviour

The starter schema is an offline `ec2.DescribeInstances` request shape and demonstrates every model
kind supported by the renderer. A future AWS model catalogue can replace the schema without changing
the editor. The node never calls an AWS service, starts a process, reads credentials, or turns user
input into a shell command. It is a reviewable request plan for a separately authorized execution
surface.

Every field carries a label, description, and schema-specific validation. Number controls enforce
finite values, integer values, minimums, maximums, and steps. Date, time, and date-time values use
native controls. Enum choices have their own local search and anchored regex builder. Lists and maps
have bounded add and remove actions, while nested objects recurse through the same editor.

The typed view and advanced view are synchronized. JSON and YAML are separate tabs over the same
value object. Editing either advanced view and choosing Apply parses the bounded text, requires an
object root, and publishes it back through the same schema validation used by typed controls. The
advanced view never becomes an arbitrary command or request textbox.

## Persistence and portability

The schema and safe request values are stored in `awsWizardSpec` as project content. File picker
paths are held in the renderer's machine-local `awsWizardFiles` overlay and are deliberately not
part of `CanvasNodeState` or `.nodeterm/project.json`. The advanced representation shows a local
file marker rather than a machine path. Reopening a project therefore leaves the request intent
portable while asking the user to choose a local attachment again when needed.

Importing advanced JSON or YAML has no network or provider side effect. It only updates the node's
in-memory request plan after parsing. No service execution control is exposed by this lane.

## Failure modes and recovery

Malformed or oversized JSON/YAML reports an inline error and leaves the previous typed values in
place. A non-object root is refused. Unknown object keys, unsafe map keys, wrong enum values,
invalid dates or times, out-of-range numbers, excessive nesting, and oversized collections are
reported at their field path by the shared validator. Clearing a selected file returns the field to
its empty local state. A list or map at its limit disables its add control and states the exact
bound.

Invalid values never trigger a provider request because this node has no execution path. The user
can correct the field, clear the advanced draft, or return to typed controls without losing the last
accepted value.

## Material, accessibility, and search

The node uses the app's Material Design 3 primitives, token colours, light and dark surfaces,
visible focus, keyboard-operable buttons, fieldset and legend structure, labelled controls, and a
responsive two-column-to-one-column layout. The main field search is plain text by default and has
an adjacent anchored full regex builder. Every enum picker has its own search and anchored builder.
No control is decorative, and no disabled add action is silent about its bound.

The renderer displays a clear review-only notice. Informational validation state is inline and does
not block the canvas. File selection uses the existing native local file picker and keeps the path
out of portable project content.

## Implementation map

| Concern | Implementation |
| --- | --- |
| Schema, defaults, bounds, safe keys | `src/shared/aws-wizard.ts` |
| Typed and JSON/YAML synchronized editor | `src/renderer/nodes/AwsWizardNode.tsx` |
| Canvas registration and creation command | `src/renderer/canvas/Canvas.tsx` |
| Portable intent | `CanvasNodeState.awsWizardSpec` in `src/shared/types.ts` and `src/renderer/state/workspace.ts` |
| Machine-local file overlay | `NodeData.awsWizardFiles` in `src/renderer/state/workspace.ts` |
| Material surface styling | `src/renderer/styles.md3.css` |

## Verification boundary

This implementation lane intentionally did not run automated checks, type checks, lint, builds, packaging,
runtime interaction, service execution, or screenshots. Those checks belong to the owning integration
pass. The code is written so the focused verification can exercise each schema kind, bounds and
error path, advanced JSON/YAML round trips, portable serialization without file paths, keyboard
labels, and the real canvas command.

## Suggested articles

- [Portable canvas projection](./projects/portable-canvas-projection.md)
- [Portable project schema 3](./projects/portable-schema3.md)
- [File converter](./file-converter.md)
- [Appearance](./appearance/README.md)
