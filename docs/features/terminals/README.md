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
- [Switched-away terminal park](./park-window.md) — how long terminals of another project stay
  attached, the count cap, and which parks are released first.
- [Terminal keyboard and rendering fixes](./terminal-keyboard-and-rendering.md) — project jump from
  a focused terminal, Windows Ctrl+V paste, input-method Caps Lock and DOM row spacing.
- [Stale working directory banner](./stale-working-directory.md) — a reattached shell whose
  folder was deleted or replaced, and the explicit Restart in folder recovery.
- [Dev-server ports](./dev-server-ports.md) — the ports a terminal's session listens on, opening
  them in a browser node, and same-port forwarding for SSH projects.

See also [Canvas → Node kinds](../canvas/README.md) for how a terminal node fits alongside
agent, sticky, editor and diff nodes, and [Agents](../agents/README.md) for the agent-specific
behaviour layered on top of a terminal node.
