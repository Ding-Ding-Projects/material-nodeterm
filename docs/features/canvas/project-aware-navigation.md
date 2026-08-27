# Project-aware navigation

**Category:** [Canvas](./README.md)

Project-aware navigation keeps node focus, project ownership, and return paths explicit when a
canvas contains nested nodes or links to another project. A navigation action never fabricates a
missing node or silently edits the wrong project.

## Behaviour

### Focus one node

The terminal header's focus control and the `Focus node` command promote one selected node into a
transient single-node canvas. A node nested inside a group is converted from parent-relative
coordinates to root-canvas coordinates for the focused view. Its persisted parent id and original
position remain in the source snapshot. Sibling nodes are not deleted or rewritten.

Press `F11` to enter focus for the active node. Press `F11` again, use the visible `Return to
canvas` action, or press `Escape` while canvas chrome owns the keyboard to leave focus. `Escape`
continues to belong to the terminal when its shell input owns the keyboard. The browser edition
may reserve `F11` for browser fullscreen, so the header control and command-palette action remain
available there.

The focused node remains the same live node identity. Its terminal session is not restarted merely
because its parent relationship is removed from the transient React Flow view.

### Return and persistence

Focus is navigation state, not a saved canvas mode. Before entering, the renderer records the full
node set and the parent viewport in memory. Edits made while focused are merged back into that full
set before autosave, explicit save, or canvas synchronization. A nested node is written back with
its original parent relationship and a position relative to that parent. The parent viewport is
restored on return and is the viewport persisted for the project.

If a focused node is no longer available in the live view, the saved full set is retained instead
of inventing a replacement. A project switch or reload clears only the transient focus state after
the normal save path has had an opportunity to preserve the source project.

### Project-linked targets

Navigation to a node resolves ownership from the project records held by the application:

- A node in the active project is selected and framed directly.
- A node in another open project switches to that project before framing it.
- A node in a closed project reopens that project before framing it.
- An unavailable project is not activated, because doing so could display an empty canvas while
  appearing successful.
- A missing project or node is a no-op. The application does not create a placeholder target or
  claim that navigation succeeded.

Foreign projection jump actions use the same ownership-aware route. The jump target is checked at
activation time, so a stale projection cannot redirect focus to a different node after the source
project changes.

## Configuration

No persistent setting is required. The focus command is available from the node header and command
palette, and `F11` is the desktop shortcut. The existing appearance control that hides the terminal
header's maximize affordance also hides the adjacent focus affordance, so the two related controls
remain discoverable as one user choice.

## Failure modes and recovery

- A node id that is absent from the active project is not focused.
- A stale project reference is not activated. The user can reopen or restore the owning project
  through the normal project controls, then retry navigation.
- A project switch while focused first merges the focused edit into the source project and then
  loads the destination project.
- A return action with no active focus session does nothing.
- A browser that reserves `F11` for fullscreen leaves the command-palette and header routes
  available.

## Security and ownership

The feature changes only in-memory navigation and the existing project save/synchronization path.
It performs no provider operation, process launch, credential access, or external network action.
Project ownership is resolved from the project id that contains the target node, not from a display
name, the current tab label, or a stale projection flag.

## Verification boundary

This implementation lane did not run tests, lint, type checks, builds, packaging, runtime
interaction, reviews, audits, or captures. The parent integration lane must verify the built
Windows application, including nested-node focus, return after edits, same-project retargeting,
closed-project reopening, unavailable-target refusal, and the browser `F11` boundary.

## Suggested articles

- [Canvas and node lifecycle](./canvas-and-lifecycle.md) - live node state, parking, and memory
  behavior while a canvas changes.
- [Projects and tabs](../projects/projects-and-tabs.md) - project ownership, tab switching, and
  closed-project recovery.
- [Multiverse child canvases](./multiverse-canvases.md) - explicit child-canvas navigation and
  return behavior.
