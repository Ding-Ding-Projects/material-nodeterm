# Canvas

The pan/zoom surface nodeterm is built around, and everything that lives on it.

- [Node kinds](./node-kinds.md) — terminal, agent, sticky, group, editor, and diff nodes, and
  what each one is for.
- [Canvas & node lifecycle](./canvas-and-lifecycle.md) — how nodes mount, unmount, park, and
  release memory as you pan around a large canvas; context menus, undo/redo, and selection.
- [Terminal sharpness under pan and zoom](./terminal-sharpness.md) — why terminal text goes soft on
  a fractional-dpr display, the two independent causes, and what the app does about each.
- [Node maximize and restore](./node-maximize.md) — fill the visible canvas while preserving the
  camera and return to the exact prior node geometry.

See also [Terminals](../terminals/README.md) for how a terminal node's own session survives
independently of the canvas, and [Projects](../projects/README.md) for how a whole canvas is
saved, switched, and reopened.
