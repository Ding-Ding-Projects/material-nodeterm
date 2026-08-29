# Door-only portal navigation

Portal navigation is the route into a special child canvas. A child canvas is not another project
tab, browser-history entry, or generic destination. It can be entered only by activating its
matching entry door, and it can be left only by activating that pair's return door.

## Behaviour

Each door stores a `doorPairId`, a direction (`entry` or `return`), and its target canvas id. The
two records must form one reciprocal pair:

- the entry door is on the parent canvas and targets the child;
- the return door is on the child and targets the parent;
- both doors have the same `doorPairId`;
- exactly one entry and one return door exist for a pair.

`src/shared/portal-navigation.ts` validates this topology before a canvas is mounted. A malformed,
missing, duplicated, or non-reciprocal pair is refused with a specific non-blocking error state.
The controller does not expose a `selectCanvas` implementation: direct tab selection, browser back,
and generic route commands return `direct-canvas-selection-refused`.

The parent camera and focused node are captured when entering. Returning restores that camera and
focus after the parent canvas mounts. Navigation is scoped to the active project and current canvas,
so a door from another canvas cannot be activated accidentally. The palette and canvas searches
therefore see only nodes in the currently mounted canvas.

## Relaunch and portability

The live navigation controller starts at `root` after every application relaunch. It does not reopen
a child canvas from browser storage, a saved tab, or an old route. The user must activate the entry
door again. Child-canvas records, node membership, door directions, pair ids, and reciprocal targets
are part of the schema 3 portable projection. Credentials, processes, host data, and local execution
state are not part of that projection.

## Material Design and accessibility

`PortalNode` is a project Material Design 3 surface with an explicit, keyboard-operable Enter or
Return action, visible focus, screen-reader names, and a bilingual label. It has no generic link or
history affordance. Its action is disabled until the active canvas installs the navigation
controller, which prevents a stale node from opening a route after a project switch.

The existing app-wide search, command palette, notification, responsive sizing, reduced-motion, and
focus rules apply. Errors are informational and non-blocking. The door's pair id is available as a
data attribute for diagnostics but is not presented as an authority or credential.

## Persistence paths

Shared project content is written to `.nodeterm/project.json` through `projectToFile` and
`fileToProject`. Child membership is `CanvasNodeState.canvasId`; door data is
`CanvasNodeState.portal`; child metadata is `Project.canvases`. The active live navigation snapshot
is held by `usePortalNavigation` and is intentionally reset to root on relaunch.

## Failure modes and recovery

| Situation | Result |
| --- | --- |
| Unknown door or wrong direction | Activation is refused and the user remains on the current canvas. |
| Pair has the wrong count or direction | The topology is invalid and neither door opens. |
| Return target is not the original parent | Exit is refused; no partial navigation occurs. |
| User selects a child through a tab, back action, or generic command | The direct-selection refusal is returned; the matching door remains the only route. |
| Application relaunches while a child is open | The root canvas opens, with no child state silently restored. |
| Parent node was deleted while away | Camera restoration still runs, but focus is skipped when the node is no longer present. |

## Verification status

This lane intentionally did not run tests, type checking, linting, builds, packaging, runtime
interaction, security checks, accessibility checks, or captures. The implementation is present in
the shared topology validator, renderer navigation store, portable projection, project persistence,
and `PortalNode`; built-artifact verification remains a later release activity.

## Suggested articles

- [Portable canvas projection](./portable-canvas-projection.md)
- [Portable project schema 3](./portable-schema3.md)
- [Projects and tabs](./projects-and-tabs.md)
- [Command palette](../command-palette.md)
