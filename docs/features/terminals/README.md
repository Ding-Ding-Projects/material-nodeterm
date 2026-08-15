# Terminals

Real shells running as nodes on the canvas, kept alive by tmux across everything short of a
power cut.

- [Session continuity (tmux)](./session-continuity.md) — how a terminal survives a node
  remount, an app restart, and a full machine reboot; what happens when tmux isn't available.

See also [Canvas → Node kinds](../canvas/README.md) for how a terminal node fits alongside
agent, sticky, editor and diff nodes, and [Agents](../agents/README.md) for the agent-specific
behaviour layered on top of a terminal node.
