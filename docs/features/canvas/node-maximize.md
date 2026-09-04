# Node maximize and restore

Canvas nodes that have a resizable body can temporarily fill the visible canvas without moving
the camera. The header control appears on terminal, editor, and diff nodes. It is unavailable for
groups, collapsed nodes, or a canvas that has not measured a usable viewport.

The first activation records the node's exact root-space position and measured size, then resizes
the node to the visible viewport with a 24 px margin. Grouped nodes are converted to their parent's
coordinate space and their ancestor frames are re-fitted in the same transform. Terminal nodes
therefore receive a real resize and can reflow their session content.

The second activation restores the recorded rectangle, including after reload. The snapshot is
stored in `premaxRect` as workspace presentation state. It is cleared only after a successful
restore, and the ordinary workspace dirty and undo paths remain responsible for persistence.
The node's group membership, viewport camera, selection, collapse state, and focus remain intact.

Keyboard users can use `Ctrl+Shift+Enter`, matching the iTerm2 maximize-pane gesture. The command
targets the node containing keyboard focus, or the single selected node when focus is elsewhere;
ambiguous multi-selection and unsupported node kinds are left untouched. The header button exposes
the same action with an accessible name and pressed state, and its tooltip describes whether the
next action will maximize or restore.

This is a presentation transform, not a security boundary. It never changes the node identity,
session identity, project file location, or group membership. The camera stays fixed so the user
can return to the same canvas context, and a failed measurement leaves the prior geometry alone.

Suggested articles: [Canvas & node lifecycle](./canvas-and-lifecycle.md), [Node kinds](./node-kinds.md),
and [Local version history](../../local-history.md).
