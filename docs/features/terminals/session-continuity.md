# Session continuity

**Category:** [Terminals](./README.md)

Terminal and agent nodes use a persistent backend rather than tying the live shell directly to
the desktop window. On Linux that backend is normally
[tmux](https://github.com/tmux/tmux); on Windows the resolver prefers `tmux`, then the
tmux-compatible `psmux`, and falls back to nodeterm's standalone session host when neither is
available. In all cases the process can survive closing a node, switching projects, and quitting
or crashing the app.

## Behaviour

Each terminal node is backed by a session named `nt-<nodeId>`. On the tmux path, sessions use a
dedicated socket so they never collide with a tmux you run yourself. That socket carries a
generated config (mouse on, 50k lines of history, clipboard integration) rather than your own
`~/.tmux.conf`. On the Windows session-host path, one detached Node process owns the real ConPTY
and a headless xterm buffer for each named session.

**tmux owns the mouse on tmux-backed sessions.** Scrolling, drag-to-select, and the alternate
screen are handled natively by tmux, exactly as they would be in a terminal attached by hand. A
copy made by dragging goes to the system clipboard through OSC 52, including over SSH. The Windows
session host instead serializes the live headless-xterm screen, cursor, alternate-buffer state,
and private terminal modes when a client reattaches.

Lifecycle, by trigger:

| Event | What happens to the session |
| --- | --- |
| Switch away from a project | The node's terminal view detaches or parks; the persistent session and process keep running. |
| Close or crash the app | Desktop clients detach; tmux or the standalone Windows session host keeps the session running. A normal Windows title-bar close enters the same bounded application shutdown path as Quit, so auxiliary windows and application-owned child processes do not keep the old instance alive. |
| Reopen the node / relaunch the app | A client reattaches to the same named session. tmux redraws itself; the session host supplies a reconstructed screen. |
| Pan the node off-screen for a while | The terminal view may be torn down to free memory; the persistent backend is untouched and rebuilds the view on return. |
| Click the node's **×** | The persistent session itself is killed, ending its live process. |
| Choose **Restart with profile…** on Windows | After destructive confirmation, the old session is killed and the node is recreated with the selected machine-local profile. |
| **Machine reboot** | Neither backend can keep an OS process alive; the cold-restore path below applies. |

### Surviving a reboot

A reboot kills every tmux server and every Windows session-host process, so there is genuinely
nothing to reattach to. nodeterm bridges this gap instead of pretending it did not happen:

- A capped snapshot of each session's recent output is kept on disk and replayed into a fresh
  terminal on the first open after a reboot, with a visible "session restored" separator so
  it's clear this is historical output, not a live redraw.
- For a resumable agent CLI, the node re-launches the agent with its own resume flag (for
  example `claude --resume <session-id>`) using the session id it had recorded, rather than
  leaving you to type it back in.

## Configuration

- **Settings → tmux** — turn persistent backend support on/off, and set the scrollback bound used
  by tmux history, the Windows host's headless terminal, and cold-start replay.
- A system `tmux` found on `PATH` (or at a fixed POSIX location) is always preferred over the
  session host. On Windows, `psmux` is checked after `tmux`, with `PATHEXT` expansion for native
  executables and package-manager shims. If neither is present, the session host remains the
  explicit fallback.
- **Settings → Shell** on Windows selects the default detected profile. Profile choices are
  machine-local and snapshotted per node; see [Windows shell profiles](./windows-shell-profiles.md).

## Failure modes

- **The selected persistent backend is disabled or unavailable:** nodeterm reports the
  non-persistent state instead of claiming continuity. On Windows, a provisional or rejected
  session-host attach fails closed and surfaces its real reason; it is not replaced by a plain
  shell or indexed as a persistent session.
- **No Windows multiplexer is available:** the banner identifies `psmux` as the supported
  compatible implementation and offers `winget install --exact --id marlocarlo.psmux --source
  winget --accept-source-agreements --accept-package-agreements --silent` when `winget` is
  discoverable. The command is opened in a titled **Install psmux** terminal node, which is
  selected and framed for immediate inspection. The banner retains **Show installer terminal**
  while installation is being checked. If the terminal cannot be placed, the banner reports that
  placement failure immediately and leaves a retry action rather than pretending an install is
  running. Without Windows Package Manager, the banner remains an honest warning without
  inventing an installer command, and the session host continues to provide persistence.
- **A selected Windows profile is unavailable:** the node reports that exact profile and lets the
  user choose another. Explicit PowerShell, Git Bash, custom, and WSL profiles never silently fall
  back; only the `auto` profile follows its documented precedence.
- **A tmux session was killed outside the app** (you ran `tmux kill-session` yourself, or the
  server ran out of memory): the next open is treated as a fresh/cold start — same recovery
  path as a reboot.
- **The Windows session-host process was killed:** its sessions are gone and the next open takes
  the same cold-start path. A dropped desktop client connection alone is not session death; it
  reconnects and reattaches.

## Security considerations

- Persistent sessions run under your own user account; nodeterm does not elevate privileges or
  run them as another user. The Windows host authenticates local clients with a random token kept
  in a mode-restricted file, never in argv.
- Copying via OSC 52 is a write-only channel from the terminal to your OS clipboard — nodeterm
  never reads your clipboard through it, and a remote host cannot use the same mechanism to
  read it either.
- Session names are derived from an internal node id, not from anything a remote party
  controls, so a malicious program running inside a session cannot cause it to attach to (or
  interfere with) a different node's session by choosing its own name.
- Windows executable paths and arguments are resolved inside the trusted desktop core. Shared
  project files and peers cannot supply them or replace a machine-local profile selection.

## Verification

- Open a terminal, run a long-lived process (`sleep 600` on POSIX or an equivalent long-running
  command on Windows), close and reopen the app, and confirm the same process and reconstructed
  screen survive.
- With a project open, pan the canvas far enough that the node leaves the viewport, wait for
  the configured release window, then pan back — the terminal should redraw from the same
  live session rather than restarting.
- Reboot the machine, reopen the app, and confirm the "session restored" separator appears
  with the tail of your prior output, and that a resumable agent node relaunches with its
  prior conversation id.

Resolver, spawn, protocol, reconnect, and fail-closed attach behaviour are covered by automated
tests. Packaged Windows interaction and capture evidence remains pending until it is recorded
through the required headless verification route; this article does not claim that run is done.

## Suggested articles

- [Canvas & node lifecycle](../canvas/canvas-and-lifecycle.md) — the memory-management side of
  the same lifecycle (parking, WebGL budgets, offscreen release).
- [Node kinds](../canvas/node-kinds.md) — how a terminal node differs from an agent node built
  on top of it.
- [Agents](../agents/agent-support.md) — the resumable-CLI behaviour this article references.
- [SSH projects](../remote/ssh-projects.md) — session continuity when the terminal itself is
  on a remote host.
- [Windows shell profiles](./windows-shell-profiles.md) — selecting and switching the local shell
  that the Windows persistence backend owns.
