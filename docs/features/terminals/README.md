# Terminals

Real shells running as nodes on the canvas, kept alive across app restarts by tmux or the
standalone Windows session host.

- [Session continuity](./session-continuity.md) — how a terminal survives a node remount and app
  restart, and how cold restore works after a machine reboot.
- [Windows shell profiles](./windows-shell-profiles.md) — detected PowerShell, Command Prompt,
  Git Bash, WSL, custom profiles, and user-named startup profiles; defaults, switching, and the
  machine-local trust boundary.
- [In-place agent restart and Eco quit](./agent-restart-in-place.md) — how a restart or Eco quits
  an agent CLI in its pane, how long a slow quit is watched, and what the failure notice offers.

See also [Canvas → Node kinds](../canvas/README.md) for how a terminal node fits alongside
agent, sticky, editor and diff nodes, and [Agents](../agents/README.md) for the agent-specific
behaviour layered on top of a terminal node.
