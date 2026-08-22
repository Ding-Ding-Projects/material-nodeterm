# Canvas widget mode ("escape to widget")

Pops one terminal node's live session out of the canvas into its own always-on-top-configurable
desktop window. Electron-only. Source: `src/main/canvas-widget-window.ts` (the window lifecycle),
`src/renderer/terminal/widget-escape.ts` (the gate that decides when the action is offered),
`src/core/canvas-widget.ts` (pure bounds/state logic).

## What it is, mechanically

The widget window loads from the **same renderer bundle and same preload** as the main window
(`desktopBuildPaths().mainRenderer` / `mainPreload`), with a `?widget=<nodeId>` query string.
`renderer/main.tsx`'s bootstrap reads that query string before mounting `<App/>` and mounts a
trimmed-down `<WidgetApp/>` instead — the widget window never loads the full canvas, the workspace
store, or re-reads/re-writes `project.json`. It simply co-attaches to the **one** node's tmux (or
session-host) session that is already open on the canvas.

This is the same "one pty, N subscribers" mechanism the kanban card modal's `ModalTerminal` already
uses to give a session a second live view — here it's a second OS window instead of a second React
mount in the same window. Because it's a real second subscriber, closing the widget window **never
kills the underlying session**: this module never calls `pty:destroy`/`pty:recycle` on close, only
`ptyManager.dropClient(webContentsId)` to release that one view's subscription — mirroring what
`main/index.ts`'s main-window `closed` handler already does for the main window itself.

Position and size persist per node (`Settings.canvasWidgets[nodeId].bounds`), debounced
(`BOUNDS_SAVE_DEBOUNCE_MS`, 500ms) while the user drags/resizes so a save doesn't fire on every
intermediate frame. Always-on-top is user-configurable both at open time (carried over from the
node's last choice) and live while the widget is open.

## The escape gate: why not every terminal can pop out

`canEscapeToWidget` (`renderer/terminal/widget-escape.ts`) is the pure decision of whether a given
terminal node may be popped into a widget. It refuses in three cases:

- **`browserRuntime`** — Server Edition running in a browser tab. There is no OS window to open.
- **`remoteSession`** — an SSH project, or an SSH-project terminal (`data.ssh` /
  `data.sshRemoteTmux`).
- **`offscreenCoreIsRemote(sessionSource)`** — a relay/server tab whose session core runs on
  another machine entirely.

Both remote checks are needed and neither subsumes the other: `remoteSession` answers for SSH,
`sessionSource` answers for a relay/server tab. `data.remote` is deliberately **not** consulted —
nothing in the codebase sets that field on node data, so a gate built on it would be constant-false
and type-invisible (the offscreen-policy module records the same trap).

The reason this gate exists at all: `WidgetApp` builds its **own** `new LocalTransport()`. It has
no way to reach a remote session — only the local core. Offering the widget escape for a remote
node would hand a remote node's id to the local core, which is exactly the `requireRemote` hole
this codebase already paid for once (see the "A remote node is NEVER spawned locally" invariant in
`CLAUDE.md`'s terminal-lifecycle section) — an SSH node quietly became a local shell in the local
`$HOME`, with the remote session's scrollback snapshot replayed into it and an orphaned local
`nt-<id>` left behind. `canEscapeToWidget` is the same class of bug prevented at the UI layer,
before the widget window is ever opened.

## Suggested articles

- [Session continuity](session-continuity.md) — the tmux/session-host "one pty, N subscribers"
  model this feature co-attaches into, and why a remote node can never be spawned locally.
- [Kanban](../kanban/README.md) — the card modal's `ModalTerminal`, the other second-live-view
  mechanism this feature mirrors.
