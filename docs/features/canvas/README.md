# Canvas

The pan/zoom surface nodeterm is built around, and everything that lives on it.

- [Node kinds](./node-kinds.md) — terminal, agent, sticky, group, editor, and diff nodes, and
  what each one is for.
- [Unified Node Catalog](./node-catalog.md) — the typed registry, guided picker, creation event
  idempotence, availability reasons, and collision-free placement shared by every creation path.
- [Alarm Clock nodes](../../alarm-clock.md) — one-shot and recurring reminders with timezone,
  daylight-saving, snooze, dismiss, and missed-occurrence handling.
- [Canvas & node lifecycle](./canvas-and-lifecycle.md) — how nodes mount, unmount, park, and
  release memory as you pan around a large canvas; context menus, undo/redo, and selection.
- [Terminal sharpness under pan and zoom](./terminal-sharpness.md) — why terminal text goes soft on
  a fractional-dpr display, the two independent causes, and what the app does about each.
- [Timer nodes](./timer-nodes.md) — countdowns, stopwatches, work/rest sequences, laps, repeats,
  occurrences, and non-blocking alarms.

See also [Terminals](../terminals/README.md) for how a terminal node's own session survives
independently of the canvas, and [Projects](../projects/README.md) for how a whole canvas is
saved, switched, and reopened.
