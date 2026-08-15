# Canvas

The pan/zoom surface nodeterm is built around, and everything that lives on it.

- [Node kinds](./node-kinds.md) — terminal, agent, sticky, group, editor, and diff nodes, and
  what each one is for.
- [Canvas & node lifecycle](./canvas-and-lifecycle.md) — how nodes mount, unmount, park, and
  release memory as you pan around a large canvas; context menus, undo/redo, and selection.

See also [Terminals](../terminals/README.md) for how a terminal node's own session survives
independently of the canvas, and [Projects](../projects/README.md) for how a whole canvas is
saved, switched, and reopened.
