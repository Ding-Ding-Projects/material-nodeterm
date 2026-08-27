# Interactive Multiverse door construction

The Multiverse navigator creates a child canvas first, then opens the guided door constructor. A
door is not a blank request field: the constructor requires a frame, hinges, panel, handle, and
activation core. Each part has a bounded set of real material choices, a visible description, and
an explicit selected state.

## Guided interaction

Choose **New child canvas** in the canvas hierarchy, select a valid parent, name the child, and
choose **Create and open**. The constructor then shows the exact parent and child canvas ids. Pick
one material for each physical part. Every part picker has its own local plain-text search and its
own adjacent anchored regex builder. Keyboard focus enters the picker search, options are real
buttons in a listbox, Escape clears an active search before closing, and focus returns to the
picker trigger when the anchored surface closes.

The activation core stays unavailable until all four physical parts are configured. Its disabled
state names the missing parts. **Arm activation core** is a separate step, followed by **Activate
door**. Activation emits a validated construction to the canvas owner, which creates a reciprocal
entry and return door pair and records the portal in project state.

## Schema 3 portability

`src/shared/door-construction.ts` defines the schema 3 payload. It carries bounded safe intent only:
door identity, canvas relationship, labels, material choices, geometry, enabled state, and the
door-only activation mode. Unknown fields, control characters, unsupported materials, unbounded
geometry, self-targeting routes, and self-pairs are refused before persistence.

`ProjectPortalState.entryConstruction` and `ProjectPortalState.returnConstruction` retain the two
validated sides in the shared project projection. Schema 3 export derives paired `doors` records
from these fields, and import validates their identity against the surrounding door record. Older
door-only records remain readable.

Credentials, local paths, provider sessions, process state, runtime handles, host identifiers,
downloads, and deployment actions never enter the construction or the portable project. Import and
export are data operations only. A destination computer receives the blueprint and must configure
any local binding through an explicit later action.

## Failure and recovery

The child-canvas creation result is checked before the constructor opens. A stale parent, missing
child, duplicate portal, mismatched construction identity, or unavailable route leaves the project
unchanged and reports the exact recovery action. Cancelling the constructor leaves the child canvas
preserved as an unbound canvas for explicit later repair rather than deleting user content.

## Verification boundary

This issue's ultra-speed implementation lane intentionally did not run tests, type checks, lint,
builds, packaging, installer execution, runtime interaction, security review, accessibility review,
or UI captures. Those checks remain unverified. The implementation paths are
`src/shared/door-construction.ts`, `src/renderer/components/DoorConstructionDialog.tsx`,
`src/renderer/components/MultiverseNavigator.tsx`, `src/renderer/state/projects.ts`,
`src/renderer/canvas/Canvas.tsx`, and `src/core/portable-canvas-projection.ts`.

## Suggested articles

- [Multiverse child canvases](./multiverse-canvases.md)
- [Door-only universe navigation](./door-only-universe-navigation.md)
- [Portal lifecycle](./portal-lifecycle.md)
- [Portable schema 3](../projects/portable-schema3.md)
