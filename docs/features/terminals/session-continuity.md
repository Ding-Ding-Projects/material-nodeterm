# Session continuity (tmux)

**Category:** [Terminals](./README.md)

Every terminal node runs its shell inside a persistent [tmux](https://github.com/tmux/tmux)
session rather than a bare PTY. Because the tmux *server* keeps running independently of
nodeterm, a terminal's process — and everything it started — survives closing a node,
switching projects, quitting the app, and (with a little help) rebooting the machine.

## Behaviour

Each terminal node is backed by a session named `nt-<nodeId>` on a dedicated tmux socket, so
nodeterm's sessions never collide with any tmux you run yourself. The socket carries a
generated config (mouse on, 50k lines of history, clipboard integration) rather than your own
`~/.tmux.conf`, so nodeterm's terminals behave consistently regardless of your personal tmux
setup.

**tmux owns the mouse.** Scrolling, drag-to-select, and the alternate screen (the thing that
keeps a full-screen tool like `vim` or `htop` from scrolling its own UI away) are all handled
natively by tmux, exactly as they would be in a terminal you attached to by hand. A copy made
by dragging goes to your system clipboard via the terminal protocol's OSC 52 escape sequence —
which is what makes copy work identically over a local shell and over SSH, with no
`pbcopy`/`xclip` dependency.

Lifecycle, by trigger:

| Event | What happens to the session |
| --- | --- |
| Switch away from a project | The node's terminal view detaches from the session; the process keeps running. |
| Close the app / quit | Every open terminal detaches; sessions keep running under the tmux server. |
| Reopen the node / relaunch the app | A fresh terminal client re-attaches to the same session; tmux redraws it. |
| Pan the node off-screen for a while | The terminal view is torn down to free memory (the tmux session is untouched) and rebuilds when you scroll back. |
| Click the node's **×** | The tmux session itself is killed — this is the only action that actually ends the process. |
| **Machine reboot** | The tmux *server* does not survive this — see below. |

### Surviving a reboot

A reboot kills every tmux server on the machine, so there is genuinely nothing to re-attach
to. nodeterm bridges this gap instead of pretending it didn't happen:

- A capped snapshot of each session's recent output is kept on disk and replayed into a fresh
  terminal on the first open after a reboot, with a visible "session restored" separator so
  it's clear this is historical output, not a live redraw.
- For a resumable agent CLI, the node re-launches the agent with its own resume flag (for
  example `claude --resume <session-id>`) using the session id it had recorded, rather than
  leaving you to type it back in.

## Configuration

- **Settings → tmux** — turn tmux support on/off, and set the scrollback size kept by the
  in-app terminal buffer for the *non*-tmux-backed cases (a cold-start replay, or a plain
  shell when tmux isn't available at all).
- The macOS desktop build ships its own tmux binary as a fallback so terminal continuity works
  with nothing pre-installed; a tmux already on your system is always preferred over the
  bundled one.

## Failure modes

- **tmux is unavailable** (not installed, and — outside the macOS desktop build — no bundled
  fallback either): nodeterm falls back to a plain, non-persistent shell. Everything still
  works for the current session; it simply doesn't survive an app restart or a reboot. This is
  a real, reported degrade, not a silent one — recognizable because your terminal loses its
  history and running processes the next time you open the app.
- **A tmux session was killed outside the app** (you ran `tmux kill-session` yourself, or the
  server ran out of memory): the next open is treated as a fresh/cold start — same recovery
  path as a reboot.

## Security considerations

- tmux sessions run under your own user account with your own environment; nodeterm does not
  elevate privileges or run anything as a different user.
- Copying via OSC 52 is a write-only channel from the terminal to your OS clipboard — nodeterm
  never reads your clipboard through it, and a remote host cannot use the same mechanism to
  read it either.
- Session names are derived from an internal node id, not from anything a remote party
  controls, so a malicious program running inside a session cannot cause it to attach to (or
  interfere with) a different node's session by choosing its own name.

## Verification

- Open a terminal, run a long-lived process (`sleep 600` is enough), close and reopen the app,
  and confirm the process is still counted as running (its PTY reattaches instead of starting
  a fresh shell).
- With a project open, pan the canvas far enough that the node leaves the viewport, wait for
  the configured release window, then pan back — the terminal should redraw from the same
  live session rather than restarting.
- Reboot the machine, reopen the app, and confirm the "session restored" separator appears
  with the tail of your prior output, and that a resumable agent node relaunches with its
  prior conversation id.

## Suggested articles

- [Canvas & node lifecycle](../canvas/canvas-and-lifecycle.md) — the memory-management side of
  the same lifecycle (parking, WebGL budgets, offscreen release).
- [Node kinds](../canvas/node-kinds.md) — how a terminal node differs from an agent node built
  on top of it.
- [Agents](../agents/agent-support.md) — the resumable-CLI behaviour this article references.
- [SSH projects](../remote/ssh-projects.md) — session continuity when the terminal itself is
  on a remote host.
