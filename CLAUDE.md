# CLAUDE.md

This is the deep-reference for working in this repo: the invariants, why each exists, and the
measurements behind them. It is loaded automatically by Claude Code.

**Contributors: start with `CONTRIBUTING.md`** — the short version (setup, boundaries, house rules,
testing habits). This file is what you reach for when you need to know _why_ a rule is the way it
is, or you are changing a subsystem it describes. A change that other developers must know about
belongs in BOTH (see Conventions).

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Node-based terminal manager** (BUSL-1.1, converts to MIT after 4 years — see `LICENSE`): multiple real terminals live on a single
pan/zoom canvas as draggable nodes. Target users are people with ADHD / disorganized
workflows who benefit from a spatial layout over stacked tabs. Long-term vision includes
remote access and paid features — the architecture is built so those slot in without a
UI rewrite (see Transport abstraction below).

## Commands

```bash
npm install        # deps + rebuilds node-pty against Electron's ABI (postinstall hook)
npm run dev        # dev mode with renderer HMR
npm run build      # production build into out/
npm start          # preview the production build (electron-vite preview)
npm run typecheck  # tsc for both node (main/preload) and web (renderer) projects
npm run rebuild    # re-run electron-rebuild for node-pty if you hit ABI/native errors
```

**`rebuild` and `postinstall` both run `scripts/patch-node-pty.mjs` first, and that is not
optional.** node-pty 1.1.0's darwin `pty_posix_spawn` leaks a ptmx device on every SUCCESSFUL spawn
(an off-by-one in the low-fd cleanup) and master+slave on every FAILED one; on this app's spawn
churn that exhausts `kern.tty.ptmx_max` within hours, and terminals then simply stop opening. The
script rewrites `node_modules/node-pty/src/unix/pty.cc` before electron-rebuild compiles it.

`src/main/node-pty-patch.test.ts` asserts the marker is present in those sources, so a node-pty
upgrade that silently drops the patch fails loudly. **If that test is red, your `node_modules` is
unpatched, not your code** — run `npm run rebuild`. It deliberately does not measure descriptors
(that is environment-dependent); it checks the source the native module is built from. Upstream:
microsoft/node-pty#950 — if the fix lands there, delete the script, its wiring and that test.

```

```

`npm test` runs the vitest suite (unit + integration; the remote e2e suites skip when the
companion server repo isn't checked out). `npm run typecheck` is the fastest correctness gate.

### Canonical upstream source

`upstream/nodeterm` is a real Git submodule for the canonical
`https://github.com/eneskirca/nodeterm.git` source. Its gitlink is a deliberately reviewed snapshot,
not another application source tree, and `.gitmodules` records `main` so `git submodule update
--remote` follows the canonical default branch.

Do not confuse the two remote namespaces. The top-level checkout's `origin` points at this
repository and may also have a top-level remote named `upstream`; neither one updates the gitlink.
The nested repository has its own `origin`, which must resolve to the canonical URL above. Follow
the exact initialize, sync, remote-update, URL/SHA inspection, staging, and submodule-diff workflow
in `CONTRIBUTING.md`. Commit only the reviewed gitlink change (and `.gitmodules` when its metadata
changes); never commit local edits made inside the nested repository.

**Node runtime floor: `^22.22.2 || ^24.15.0 || >=26.0.0`.** Do not simplify that to a
major-only check.
`node:sqlite` arrived in 22.5 but required `--experimental-sqlite` through 22.12; 22.13 made it
unflagged. The locked dependency graph sets the stricter install/build floors above and excludes
Node 23 and 25. `core/node-runtime.ts` checks both the exact version range and the actual
`DatabaseSync` capability before Desktop or Server Edition initializes persistent services. The
installer uses the same contract through `scripts/check-node-runtime.mjs`, and the container pins
24.15.0 rather than floating on a Node major. A supported version launched with
`--no-experimental-sqlite`, or a custom build without SQLite, is still unsupported and fails closed.
The installer also requires a newly extracted runtime to report the exact requested pin before it
runs npm or writes/restarts systemd units; the capability probe alone is not evidence that archive
contents match the requested version.

`npm run build && npm run check:wired` is the built-app interaction gate. It launches with
`NT_MULTI=1` and a disposable `NT_USER_DATA`, drives real controls over CDP, and removes both that
profile and every checkout-owned Electron process it created from a `finally` block. Do not point
it at the operator's real profile, weaken cleanup failure into success, or prove app wiring with an
element the probe invented itself. Settings persistence crosses a renderer reload; the appearance
probe changes a production Switch's computed background, then restores it.

The Squirrel bootstrap imports the normal application graph lazily. That graph is therefore a
Rollup dynamic chunk, but it must remain beside `out/main/index.js`: the main window, Notch HUD,
and unpackaged icon resolve their built files from that `out/main` boundary. Electron Vite's
default `chunks/` directory changes `__dirname` and produces a blank window with no preload bridge.
Keep `main.build.rollupOptions.output.chunkFileNames` flat and keep the executable path guard in
`desktop-build-paths.ts`; `npm run build && npm run check:wired` is the final artifact proof.

## Process model (Electron, three contexts)

The codebase is split by Electron process boundary — keep code on the correct side:

- **`src/main/`** — Node/Electron main process. The **shell** around `src/core/`: owns
  Electron/window/IPC wiring, dialogs, and the `CorePlatform` implementation
  (`platform-electron.ts`). The renderer must never import these.
- **`src/core/`** — Electron-free service core (pty, workspace/settings stores, git,
  hook server + hooks cluster, context/subagent tails, transcripts,
  model-window, license, context-link, and the pure ssh leaves under `src/core/remote-ssh/`
  — control-master, remote-git). Talks to its shell ONLY via the `CorePlatform` interface
  (`src/core/platform.ts`); importing `electron` (or `../main/*`) inside `src/core` is
  forbidden and enforced by `src/core/no-electron.test.ts`. The Electron implementation is
  `src/main/platform-electron.ts`. This is the seam the Server Edition's `src/server/` shell
  plugs into.
- **`src/server/`** — Server Edition shell (Phase 2): plain `node:http` + `ws`
  serve the built renderer to a browser and speak a WS-RPC protocol
  (`src/shared/rpc.ts`) that a browser-side `window.nodeTerminal` shim
  (`src/renderer/bridge/`) consumes. Boots the same core services via
  `ServerPlatform` (`src/server/platform-server.ts`). Single-user auth
  (scrypt + httpOnly cookie + Origin check). `npm run server:dev` to try;
  docs/SERVER.md for details. `src/server` must not import electron or
  `src/main` (enforced by `src/server/no-electron.test.ts`). **Phase 3a** also
  serves fs/git/commit handlers (editor/diff/source-control now work in the
  browser) plus a web folder/file picker (in-app server-directory browser,
  replacing the native dialog) and WS backpressure; the renderer detects the
  bridge in `src/renderer/main.tsx` (desktop preload path is untouched).
  **Phase 3b** boots the loopback **hook server** (`hookServer.start()`) + installs
  the managed hook scripts, and `wireAgentStatus` (`src/server/agent-status.ts`)
  broadcasts `agent:status` / `agent:subagent-activity` / `context:update` over the
  bridge, so agent-status badges, subagent cards, and the context meter now work in the
  browser (transcript-path jailed against forged POSTs). It also serves the two transcript READ
  channels (`registerTranscriptIpc` — the ⌘M chat view + the find-bar's transcript index; see the
  ⌘M bullet under Agent support). Still deferred:
  **canvas-control** (`agent:control`) is not wired. (The SDK **chat node** — once listed here
  as deferred — was removed entirely, 2026-07; see the chat-node note in the node-kinds list.)
- **`src/preload/`** — the only bridge. `index.ts` uses `contextBridge` to expose a
  narrow API on `window.nodeTerminal` (typed in `index.d.ts`). `contextIsolation` is on,
  `nodeIntegration` off.
- **`src/renderer/`** — React UI. Talks to main _only_ through `window.nodeTerminal`.
- **`src/shared/`** — types and IPC channel names imported by all three sides. `ipc.ts`
  is the single source of truth for channel strings; never hardcode a channel elsewhere.

PTY output flows main → renderer over per-session channels (`pty:data:<sessionId>`),
input flows renderer → main over `pty:write`. node-pty is kept **external** in the bundle
(`externalizeDepsPlugin` in `electron.vite.config.ts`) because it's a native module.

## Key abstraction: TerminalTransport

This is the load-bearing design decision. The renderer depends only on the
`TerminalTransport` interface (`src/renderer/terminal/transport.ts`), never on IPC or
node-pty directly. The current implementation is `LocalTransport` (IPC → node-pty). A
future `RemoteTransport` (WebSocket to a remote agent) implements the same interface, so
remote access / paid tiers can be added without touching the canvas or terminal UI. When
adding terminal-session features, extend the interface — do not reach around it.

## State & persistence model

**React Flow is the single live source of truth** for nodes. There is intentionally no
separate store mirroring node state — earlier dual-source designs caused sync bugs.
`src/renderer/state/workspace.ts` holds only pure helpers: the color palette, the node
factories (`createTerminalNode`, `createAgentNode(agentId, …)`, `createStickyNode`, `createGroupNode`,
`createEditorNode`, `createDiffNode`), the group transforms (`groupSelectedNodes`,
`ungroupNodes`, `duplicateNode`), and the `nodeStatesToFlow` / `flowToNodeStates`
serializers. Node kinds are the `NodeKind` union in `src/shared/types.ts` — currently `terminal |
sticky | group | editor | diff | video | web | browser | subagent | loop | scheduler | dino |
annotation`, so read the union rather than this line, which has been stale before (it listed five
kinds while thirteen shipped, and a research fleet was handed that as fact). Adding a kind touches
four places and no more: the union; a component under `src/renderer/nodes/`; the `nodeTypes` map in
`Canvas.tsx` (~1521, every entry wrapped in `withNodeBoundary`); and a factory plus the
`nodeStatesToFlow` / `flowToNodeStates` serializers here. `WebNode` and `BrowserNode` are the
closest templates for a kind that renders remote state, `AnnotationNode` for one that renders only
itself. A node's `data`
carries `title, color, group, tags, collapsed, expandedHeight, shell, terminalProfileId, cwd, text,
initialCommand, filePath, diffStaged`, `agentId` (which agent CLI a terminal node runs —
persisted), and `accountId` (which managed Claude account a terminal node runs under — immutable,
resolved at creation, persisted; see **Managed Claude accounts**). `nodeStatesToFlow` defaults a
missing `kind` to `terminal` for backward compat and migrates the legacy `tags:['claude']` marker
to `data.agentId = 'claude'`. The SDK **chat node** was removed (2026-07); `nodeStatesToFlow` also
migrates a persisted `chat` node into a **sticky tombstone** in place, reading its legacy
`chatSessionId` to print a `claude --resume <id>` hint (a chat is an ordinary resumable Claude
session).

Persistence has two layers:

- **Layout + config**: schema v3. `workspace.json` (in `app.getPath('userData')`) is now an
  **index**: local folder projects are refs to `<cwd>/.nodeterm/project.json` (the source of
  truth — git-shareable, machine-portable; pretty-printed, portable `./` node cwds, monotonic
  `rev`), SSH projects are refs to the same file on the server (offline `cache` in the index,
  reconciled by rev on connect, mirrored via `SshFs` with a 5 s write throttle), cwd-less
  canvases stay inline. The renderer contract is untouched: `workspace.load()/save()` still
  speak an assembled v2-shaped `Workspace`; all fan-out lives in `core/workspace-store.ts` +
  pure `core/workspace-files.ts`. v2 files migrate on first save (backup `workspace.v2.bak`,
  one-time renderer note). Outside edits (git pull/sync) are detected by
  `core/workspace-watcher.ts` → silent reload, or a Reload/Keep-mine conflict bar when dirty.
  Unreadable refs render as greyed **unavailable** tabs (never dropped); corrupt project files
  are set aside as `project.json.corrupt-<ts>`. "Open folder…" adopts an existing
  `.nodeterm/project.json` — the probe MINTS the project id (node ids — tmux names — kept), and
  re-opening the folder is answered by the cwd lookup, not a second adoption.
  **The shared file carries content, not identity**: no project `id`, no `viewport`, no
  `defaultAccountId` — those are machine-local and ride the index entry (`IndexEntryV3`), beside
  `localApprovalId`/`localExec`. `LocalNodeExec` also owns every exec-enabling local choice:
  legacy `shell`, Windows `terminalProfileId`, and advanced SSH arguments. `projectToFile`, portable
  exports, and inbound canvas mutations strip them; a shared file or peer can never select this
  machine's executable or inject argv. Two folders holding the same committed canvas (worktree, branch
  checkout) are two independent projects, and the committed file is byte-identical on every
  machine. The file still carries a machine-INDEPENDENT legacy `id` (`legacyFileId`, derived from
  the canvas name) for one release, because a pre-change build sidelines an id-less file to
  `.corrupt-<ts>` inside the user's repo; it is ignored on read. Residual: node ids are still
  shared, so two worktrees still attach the same tmux sessions.
  **SSH mirror safety** (the ".nodeterm reset itself" bug — 12 fresh project ids and 45 orphaned
  tmux sessions in one field report): remote writes are atomic (`cat > f.tmp && mv`, `sshWriteArgs`);
  a mirror is never blind-written before the entry has read-compared the server file once
  (`WorkspaceStore.reconcileSsh` — the single decider; a checked read's `error` ≠ `absent`, and on
  error it decides NOTHING); cross-lineage conflicts (re-added folder, second machine, git checkout:
  the server file carries a different project id) are settled by content, not rev alone — an empty
  side never beats a populated one, adoption re-keys the file to the local project id (node ids =
  tmux session names are kept so terminals reattach), and a push outbids the losing lineage's rev;
  a throttled trailing write that drops after its optimistic ack re-owes the mirror
  (`markUnmirrored`); pending mirrors are flushed before the ControlMasters die at quit; and the
  SSH dialog **dedupes by endpoint+remoteCwd** (`openSshProject`, same contract as
  `openFolderProject`) instead of minting a fresh empty project for a folder that already has one.
- **Live terminal sessions** (tmux or the Windows session host): terminals continue where they
  left off across node remounts *and* full app restarts, including running processes. See below.

`settings.json` is a separate store (`main/settings-store.ts`, `state/settings.ts`).

**Local settings history is one fenced transaction across processes, core and renderer**
(`core/local-history.ts`, `renderer/state/settings.ts`, full write-up in
`docs/local-history.md`). A per-process Promise FIFO is not a cross-process lock. Every request first
publishes an owner-unique `0600` replay journal, builds its commit with an owner-unique
`GIT_INDEX_FILE`, and advances the history ref only through `update-ref <new> <observed>` CAS. A CAS
loser rebuilds on the winner; a killed process's complete journal is replayed without ever deleting
its private index/journal, and a suspended old publisher cannot overwrite the newer ref. Never
replace this with PID/age lock stealing, a shared index, `reset`, `clean`, or foreign `.lock`
deletion. Strip inherited Git repository-routing environment variables at the runner boundary; only
the explicit private index may redirect plumbing. Git calls and CAS retries are bounded and hooks
disabled. `list()` snapshots one exact head OID; restore validates a full reachable commit OID. An
initialized repository without a head returns
`[]`, while any real read failure remains unavailable. `SettingsStore` awaits the recorder, and the
renderer still suspends/epochs its 300 ms lane, joins dispatched saves, applies the revision, and
rehydrates Zustand `base` plus live settings. The Pages playground is separate browser state:
appearance undo reapplies DOM side effects, authenticator/lock/PIN/history fields never enter undo
snapshots or exports, sensitive deletions are explicitly record-only, and an empty log stays empty.

`scheduled-settings.json` has a deliberately three-state startup read. `ENOENT` is a normal empty
schedule; valid JSON is normalized; corrupt/unreadable evidence is left exactly in place while
`ScheduledSettingsRuntime` (the ONE runtime started by both Desktop and Server) serves an empty,
disabled in-memory schedule plus a structured `ScheduledSettingsLoadError` over IPC/WS. Saves stay
locked until the file is repaired/moved and nodeterm restarts, so the recovery copy cannot be
overwritten by an editor looking at safe defaults. The renderer's `ScheduledSettingsSaveQueue`
also has one in-flight owner: edits behind it remain pending, and both rejection and success release
the owner in `finally`. See `docs/scheduled-settings.md` and the store/runtime/real-server startup
tests named there.

**The shared School/Kids mode records must become watchable even when their directory is absent at
boot.** Both stores use `core/shared-record-watch.ts`: one `fs.watch` handle sits on the nearest
existing ancestor, promotes toward `~/.nodeterm/shared/` as it appears, and retries promotion after
a successful local record write. Promotion reloads once to cover a record written before the
narrower handle was armed; there is no poll timer, disposal closes the one handle, and a per-store
lifecycle generation makes a reload queued before disposal inert. An armed handle is only
recovering: every event/error/rearm invalidates authority, and only a strict read acknowledged
against the exact handle-generation and sync-epoch can make policy healthy. Only `ENOENT` proves
absence. Kids record mutations run their strict read, one-field reducer, and compared publication
inside the shared SQLite transaction, so a stale rename cannot replace a newer ON with cached OFF.
Invalid JSON may keep an OFF display but policy stays unavailable; every destructive caller
therefore takes the hardened path. Any other read/watch failure preserves the last-known display
state rather than silently weakening a live mode, while policy remains unavailable until a strict
canonical read succeeds.

## Projects (tabs)

### Global and per-project settings

`renderer/state/settings.ts` resolves settings once: project override over the persisted global
default, followed by a currently active scheduled override. SettingsPage changes only the editing
scope; every section remains the same component and `update()` routes to either `settings.json` or
the active project's sparse `settingsOverrides`. Canvas updates that context on tab changes.

Project overrides are machine-local in `WorkspaceIndexV3`. They are absent from `ProjectFileV1`
and `projectToFile()`, so Git-shared JSON cannot inject executable paths, credential/account ids,
host labels, or other machine-local values. Resetting removes sparse keys and immediately reveals
the current global values.

Each project is one canvas/page; terminals and notes belong to a project. The `projects`
zustand store (`renderer/state/projects.ts`) holds project metadata + the _serialized_ nodes
of all projects. **React Flow remains the single live source of truth for the _active_
project's nodes only.** The contract:

- The active-project effect in `Canvas.tsx` (keyed on `activeProjectId`) loads that project's
  serialized nodes into React Flow. `loadingRef` suppresses dirty-marking during this load.
  A real switch applies the project's saved viewport; an **in-place reload**
  (`reloadActiveProject` — external file change / SSH reconcile) sets `preserveViewportRef` so
  the load **keeps the user's current camera** — the incoming file's viewport is wherever
  another machine last saved, and restoring it mid-work teleported the camera (most visibly
  right after a cross-project sidebar focus, when the connect-time SSH reconcile landed a
  second after fitView centered the node).
- **Project order = array order**, and it is ONE order shared by the tab bar and the sessions
  sidebar (the sidebar no longer hoists the active project to the top). Both surfaces reorder
  via drag-drop through `reorderProject(draggedId, beforeId|null)` (null = to the end; tab
  strip empty area and sidebar body are the end-drop zones), persisted like any node reorder.
  Sidebar disclosure is **persisted**, for group frames as well as projects:
  `settings.sidebarCollapsedItems` maps `project:<id>` / `project:<id>:group:<groupId>` → collapsed
  (`isGroupCollapsed`), and `settings.sidebarAutoCollapse` (default on) now only supplies the
  DEFAULT for a project row nobody has toggled (on = active expanded / others collapsed, off =
  everything expanded). **This deliberately replaced the old "a project switch resets every manual
  toggle" effect** (2026-08, with the nested sidebar tree): a tree the user shaped by hand should
  still be that shape after a restart, and one transient rule for projects plus a sticky one for
  frames would have been two contracts in one list. `projectHeadClickAction` is unchanged — an
  inactive project row switches, the active one toggles its own (now persisted) collapse — and
  every write **prunes** keys that no longer address a live project/frame (`pruneCollapsedItems` /
  `liveCollapseKeys`), because settings.json is forever and a canvas churns through group ids.
- The bottom-left **canvas lock** freezes the CAMERA only (pan/zoom): nodes stay draggable,
  resizable and connectable while locked — the point is "stop the map sliding", not "freeze
  the work".
- Before any project switch / add / delete, `commitActiveToStore()` serializes the live
  React Flow nodes back into the store, so nothing is lost. Then disk is written.
- Switching away unmounts the old project's `TerminalNode`s → their persistent clients detach but
  the tmux/session-host sessions keep running; switching back reattaches. Session names are
  per-node-id (globally unique), so projects never collide.
- The tab caret menu's **Close project** (`closeProject`) is **non-destructive**: it sets
  `project.closed = true` (hidden from the tab bar, kept on disk with all nodes) and leaves the
  persistent sessions running, so closing just detaches like a project switch. Closed projects are
  reopenable from the **"Recently closed"** list on `WelcomeScreen` (`reopenProject` → restores
  nodes, which reattach warm or cold-restore). `hasProjects` counts only **open** projects, so
  closing the last open one shows the welcome screen. **Permanent** deletion (`deleteProject`:
  `transport.destroy(nodeId)` per terminal + drop agent status + SSH teardown) now only happens
  via the `×` on a "Recently closed" entry.
- A project's `cwd` (folder picker, `dialog:select-folder`) is passed to terminal/Claude
  node factories so new terminals open there. **Folder ↔ project is deduped:** "Open folder…"
  reuses the existing project with that `cwd` (and its nodes) instead of creating a duplicate.

## Terminal session continuity (tmux + Windows session host)

**Stock Windows has no native tmux.** When `PtyManager` finds no usable local tmux binary, it uses
a standalone **session host** process — a
from-scratch tmux-equivalent (real PTYs + `@xterm/headless` for server-side screen
reconstruction) that gives Windows the same cross-restart persistence this whole section
describes for tmux. See `docs/windows-session-host.md` for the full design; the short version is
`Session.sessionHost?: boolean` in `pty-manager.ts` and a handful of `else if (!this.tmuxPath)`
branches alongside the existing tmux CLI calls — everything below in this section still describes
the tmux path exactly as before.

**Windows profile trust boundary:** local Windows creation carries only `profileId` through
`PtyCreateOptions`. The trusted core validates and resolves that stable id immediately before
spawn; executable paths and argv never enter the public catalog, renderer state from a peer, or
the shared project file. Stable ids are `auto`, `pwsh`, `windows-powershell`, `cmd`, `git-bash`,
`custom`, and `wsl:<distribution>`. `auto` alone may fall through PowerShell 7 → Windows
PowerShell → `%COMSPEC%`/cmd. Explicit missing profiles fail closed. WSL enumeration parses
UTF-16/NUL output, uses the exact selected distribution's `wslpath`, then launches
`wsl.exe -d <distribution> --cd <linux-path>`; any enumeration, translation, or launch failure
performs no substitute spawn. See `docs/features/terminals/windows-shell-profiles.md`.

**A provisional session-host attach is not persistent state.** Do not add it to the session index
or report `persistent:true` until authentication and the correlated `attach` response succeed. A
rejection destroys the shim, ignores queued bytes/late exit, rolls back subscriber registration,
and rejects every coalesced creator with the real reason. Reconnect may replay only accepted
subscriptions. Capture/kill transport uncertainty is an error, not evidence the host or session is
absent, and attach failure never falls through to another shell.

 Several session-host invariants are easy to lose in an innocent refactor. First,
 `@xterm/headless`'s `Terminal.write()` is asynchronous: `HostSession` serializes writes through an
 output tail, and warm attach/capture/resize/exit must await it before reading or disposing the
screen. The tail is byte-bounded (4 MiB high water, 1 MiB low water) and owns an independent
node-pty pause ticket while the emulator is behind. A fire-and-forget write races a stale or
duplicated relay snapshot and can retain unbounded output. Second, node-pty's pause actuator is
global but its ownership is not: `PtyManager.pausedBy` arbitrates views inside one app process,
`SessionHostClient` retains one desired ticket per `SessionHostPty`, and the host keeps separate
per-socket explicit-flow and transport-backpressure ledgers across processes. A renderer resume,
named-pipe `drain`, emulator drain, detach, or socket close may return only its own ticket; the
final owner resumes. Each live view also owns a geometry claim. The client reduces same-process
claims and the host applies the componentwise minimum across sockets before a warm snapshot;
 dropping the smallest view grows the PTY for the survivors. Also keep the backend parity
leaves in `sessionExists`/`captureSnapshot`: relay and mobile attach use them before
`attachDetached`, so a tmux-only implementation reports a live Windows session as fresh and blank.
The host also keeps an exited generation in its session map until that output tail, exit broadcast
and disposal finish. Protocol events carry only the session name, so reusing it earlier lets a
delayed old-generation exit arrive after the same socket has attached to its replacement. The
retirement wait and replacement claim are serialized per name: two attach requests waking from one
`ending` promise must not both create. Grace-exit cancellation happens inside that claim *after*
the wait, because retirement can schedule a fresh empty-host timer before the waiter resumes.
Startup is not successful merely because the socket bound: token and atomic state publication must
both complete. A publication exception is caught inside the listen callback, all pre-publication
sockets are destroyed, the listener and owned token/state/endpoint are closed or removed, and the
host exits nonzero. Do not rely on an uncaught exception here; the daemon's diagnostic handler logs
those and intentionally prevents Node's default fatal exit.

 The client has a matching hand-off boundary: remove only the handshake's named listeners, install
the production frame listener, and only then resolve the connection. Broad data-listener cleanup
after that hand-off deletes the production listener and leaves the first real request pending on an
apparently live socket. Correlate the hello response by its request id, treat only `ENOENT` as an
absent token/state file, and keep request timeout/write-callback failures tied to the exact pending
entry; a late callback must never reject a newer request that reused the connection. A reconnect is
an awaited restoration barrier, not background best effort: reattach every still-live view with
its effective geometry and aggregate pause first, replace the renderer's complete buffer with
`CSI 3J` + `CSI 2J` + home plus the serialized screen, and only then allow the triggering request.
While subscribers remain, socket loss starts bounded automatic reconnect attempts even when the
viewer is idle. A `SessionHostPty` is likewise provisional until `ready` resolves: co-attach
waits behind that barrier, while rejection detaches and forgets the exact generation, cancels queued
output, preserves any deletion tombstone, and propagates the error. Capture and kill rejection stay
unknown rather than becoming empty/gone; snapshot retry and truthful deletion depend on that fact.
 Permanent renderer deletion therefore awaits the `pty.destroy` acknowledgement before removing
 the node or its local recovery state. A refused, rate-limited, or transport-ambiguous destroy keeps
 the node available for retry.
`src/core/pty-manager.ts` runs each terminal inside a persistent tmux session
(`tmux new-session -A -D -s nt-<nodeId>`) on a dedicated socket (`-L node-terminal`) with
a generated config (`-f <userData>/tmux.conf`, so the user's `~/.tmux.conf` never
interferes; status bar off, **mouse on**, 50k history, `set-clipboard on` + `terminal-features
",*:clipboard"`, and the copy-mode mouse bindings). Because the tmux _server_ outlives the app,
sessions survive when no client is attached. `src/shared/ssh.ts`'s `remoteTmuxConf` is the same
config for an SSH project's remote tmux.

**tmux owns the mouse — scrolling, selection, and the alternate screen are all its job.** This is
the native behavior, and it is deliberate:

- **The wheel scrolls tmux's own history** (`history-limit`), not the emulator's buffer.
- **The pane is on the alternate screen** (`\e[?1049h`) — capabilities are NOT blanked — which is
  what keeps a full-screen TUI's input box _put_ instead of scrolling away with the text.
- **Selection is tmux copy-mode.** A drag copies; apps that request mouse tracking themselves
  (vim, htop) still get their own mouse events — tmux forwards those regardless.

**Do not take scrolling away from tmux again.** A previous design did exactly that (`mouse off` +
`terminal-overrides ',*:smcup@:rmcup@:indn@'` to keep tmux on the _normal_ screen, so its output
flowed into xterm's scrollback, which was then hydrated from `tmux capture-pane` on reattach). It
failed structurally: **tmux is a screen PAINTER, not a stream.** Every redraw (attach, resize,
refresh) erases and repaints, so blank and duplicated rows leaked into the emulator's scrollback —
users saw black bands and duplicated screens when scrolling up — and the pane stopped behaving
natively. The hydration that design needed is gone (see the reattach seeding below).

**Copy → the system clipboard, via OSC 52.** `set-clipboard on` **plus** `set -as terminal-features
",*:clipboard"`: on copy, tmux emits OSC 52 to the attached client, and the renderer's OSC 52
handler (`TerminalNode.tsx`, `parseOsc52`) writes the system clipboard. Two traps, both measured on
tmux 3.4:

- **The `terminal-overrides ',xterm*:Ms=…'` entry does NOT work on tmux 3.2+** — with it, a copy
  emitted **zero** OSC 52 to the client. `terminal-features` is what actually enables the sequence.
  Do not "fix" the `Ms=` override back; it is why copying from SSH sessions never worked.
- **No `pbcopy` pipe.** The copy-mode bindings are bare `copy-pipe-and-cancel` (no command): piping
  to `pbcopy` was macOS-only, and over SSH it would have copied on the _remote_ host anyway. OSC 52
  is cross-platform and works over SSH.

**A tmux client is not necessarily a watcher.** `SessionInfo.clients` is a COUNT
(`#{session_attached}`), never a boolean, because one session can hold several: the app's painter,
the user's own `tmux -L node-terminal attach`, a second nodeterm on the same socket, and our own
**control-mode shadows** (`PtyManager.shadowAttach`, used for background writes without spawning a
painter). The session reaper subtracts ours via the `shadowed` seam — a shadow is a real client but
not a watcher, so a shadowed session must stay exactly as cullable as an idle detached one.

The count is carried numerically rather than collapsed at parse time **because the subtraction
needs it**: a session holding our shadow AND a real client must still read as attached, and a
boolean could only be forced to false — reaping the session out from under whoever that other
client belongs to. **Any future reader of `list-clients` / `session_attached` owes the same
subtraction.**

Lifecycle, by intent:

- **Offscreen release (in place, 2026-08-11)** → a mounted node fully offscreen past
  `settings.offscreenTerminalMinutes` detaches its PTY client and disposes its xterm without
  unmounting (plate shown; tmux keeps running; reattach-redraw on approach, measured <500 ms).
  See the Terminal node lifecycle section for the two invariants (mount-stable observer;
  `session.source` remote gate). Note the released node is a DETACHED tmux session — it joins
  the session reaper's candidate pool (6 h grace still protects it).
- **Every memory lever must ask whether the kill ends live work** (`terminal/live-work.ts`). The
  renderer reclaims terminal memory in FOUR places — park window expiry, the park's LRU cap, the
  memory-pressure drop (all three in `park-budget.ts`) and the offscreen viewer release
  (`offscreen-policy.ts`) — and all four were written as if dropping a PTY client were free,
  because "the persistent session keeps running and re-attach redraws". **That sentence is only
  true where tmux or the session host is actually underneath.** On the plain-shell fallback
  (persistent support switched off or unavailable) the pty IS the shell, so the
  identical call kills it and everything under it — an agent CLI mid-turn included. Issue #126: a
  project switch terminated a working Claude agent, which then auto-resumed from wherever the kill
  landed. The predicate is deliberately the narrowest one that closes it — a persistently backed
  session is never protected (the kill costs a redraw), and neither is a plain terminal, a
  finished agent or
  an unknown state (nothing is running to lose). **A fifth lever owes the same gate.**
- **Node unmount (project switch)** → the RENDERER **parks** the terminal (`TerminalNode.tsx`
  `parkedTerminals`): the xterm instance + its attached PTY stay alive with the `.xterm` element
  detached from the DOM, so a remount within `TERM_PARK_MS` (5 min) re-adopts them — instant, and
  exact (the tmux client never detaches, so mouse-tracking/alternate-screen modes and scrollback
  carry over; do NOT "optimize" this into a respawn+redraw — a fresh xterm on a reused client
  misses the attach-time mode sequences and breaks scrolling). The park timer then runs the real
  teardown: `kill()` detaches the PTY client; the tmux session keeps running. WebGL contexts are
  **viewport-scoped and budgeted** (browsers cap ~16 live contexts, and a canvas holds far more
  terminals). A per-terminal `IntersectionObserver` (`rootMargin` pre-announces approach) only
  REPORTS visibility to a **module-level budget coordinator** (`terminal/webgl-budget.ts`) that owns
  every grant decision and all timing: it keeps the contexts WE hold at/under the live budget
  (`WEBGL_BUDGET` 12 default — the browser Server Edition; on DESKTOP main raises Chromium's cap
  itself via `--max-active-webgl-contexts` = 32 and boot raises the budget to 24 via
  `setWebglBudget`, constants in `src/shared/webgl.ts`) so
  the browser never has to **force-evict** — which is the bug that flashed Chromium's dead
  "lost context" placeholder (white box + sad-face) on a visible terminal during a fast pan / zoom
  out, because the old per-node observers each acquired independently and momentarily overshot the
  cap. Rules: a client granted only after an **acquire debounce** (`WEBGL_ACQUIRE_DEBOUNCE_MS`, so a
  pan-through never grabs a context for a two-frame flash); if granting would exceed the budget,
  **reclaim on demand from the least-recently-visible HIDDEN holder** (bypassing its release delay);
  if every holder is currently visible (zoomed way out), the newcomer is NOT granted and **stays on
  the DOM renderer** — we never push past the budget. A hidden holder keeps its context for
  `WEBGL_RELEASE_DELAY_MS` (warm for a pan-back) but is the first reclaim candidate. `acquire()`
  returning false (WebGL2 unavailable) doesn't burn a slot; an externally-lost context
  (`onContextLoss`) is reported via `handle.contextLost()`, drops from the accounting, and — for a
  still-VISIBLE client — schedules ONE delayed budget-gated re-grant (sleep/wake GPU resets lose
  every context at once with no visibility change; without this every woken terminal sat on the
  DOM renderer until panned out and back). The NODE still never re-acquires itself (that loop is
  the eviction fight the design fears): the retry goes through `tryGrant` — never exceeds the
  budget, never reclaims a visible holder — and stops after `WEBGL_LOSS_STREAK_MAX` consecutive
  losses (visibility transition resets). The node registers via `registerWebglClient` on mount
  and `handle.dispose()`s on unmount (which releases + cancels timers). A parked terminal is
  off-screen so it holds no context. Permanent-delete paths call `disposeTerminalOnUnmount(id)` so a
  deleted node disposes instead of parking.
  **Which renderer a terminal uses** is `settings.terminalGpuRendering`, resolved by the single
  resolver `resolveTerminalRenderer(value)` (`src/shared/webgl.ts`) to `dom | webgl | shared`:
  `'off'` = xterm's DOM renderer, `'on'` = one budgeted WebGL context per terminal (everything the
  paragraph above describes), `'shared'` = **glyphgrid**, ONE canvas-wide WebGL2 context every
  terminal paints into (`src/renderer/glyphgrid/`, reached through `terminal/glyphgrid-attach.ts`;
  the per-terminal budget is OFF in this mode). `'auto'` (the default, and what legacy/unknown values
  fall back to) = **`webgl` on EVERY platform, macOS included** — the resolver takes no platform
  argument at all any more. **This line said "`shared` on macOS" until 2026-08-18 and it was stale
  by then**, which is worse than vague: a research pass sent to find a macOS-only shared-renderer
  default reads the doc, believes it, and never opens the eleven-line resolver that disagrees. Read
  `resolveTerminalRenderer` before trusting this sentence again. The history behind the collapse is
  in that function's own doc comment: macOS resolved to `dom`, then to `shared` (2026-08-05, after
  the device checklist in `docs/superpowers/plans/2026-08-03-phase1b-device-checklist.md`), and then
  to `webgl` once the blackout it was avoiding was root-caused to the addon-webgl 0.19 dispose
  crash rather than to the compositor. `shared` is no longer experimental and still falls back to
  the DOM renderer on failure; the four-way setting stays as the escape hatch, and `'shared'` is
  where the macOS branch goes back to if a field report contradicts the promotion.
- **Window close / app quit** → clients detach (`PtyManager.killAll()`); tmux or the standalone
  Windows host keeps the session running. `killAll()` deliberately does NOT kill sessions.
- **Node reopen / app relaunch** (nothing parked) → a new PTY attaches to the same
  `nt-<nodeId>` session. tmux redraws itself; the session host returns its serialized live screen.
- **User clicks ×** → `destroy(persistKey)` kills the backend session, permanently ending it. For a
  REMOTE node it kills the remote session **and then the local one of the same name** — normally a
  no-op, but it reaps the orphan the pre-`requireRemote` local fallback below could leave behind.
- **Windows “Restart with profile…”** → the destructive-action gate must state that the live
  process and persistent session end. Only confirmation destroys the old session, updates the
  machine-local `terminalProfileId`, and recreates the node. Cancellation mutates nothing. The
  profile snapshot is per node, so a later default change affects only newly created nodes.
- **A remote node is NEVER spawned locally** (`PtyCreateOptions.requireRemote`). `sshRemote` says
  "here is the master to run over"; `requireRemote` says "and if there isn't one, spawn NOTHING".
  Without it, a create with no `sshRemote` falls through to core's local tmux/plain-shell branches
  — which is how an SSH project's terminal opened while the ControlMaster was down (no network,
  host unreachable, `ssh` missing) quietly became a LOCAL shell in the local `$HOME`: same node id,
  same `SSH user@host` header chip, the REMOTE session's scrollback snapshot replayed into it, and
  — for an agent node — a cold-restore `claude --resume <remote session id>` running on the wrong
  machine under the local account, leaving an orphaned local `nt-<id>` behind. Refused on both
  sides: the renderer never calls `create` when `resolveSshRemote` came back empty
  (`CoState.offline` + the node's Reconnect button), and core refuses in `spawnNew`
  (`PtyCreateResult.unavailable`) so a master that dies inside the round-trip can't sneak through.
  The refusal is **only** in `spawnNew` — a co-attach JOIN to a live session for that node id is
  still correct. An offline node reports itself to `SshReconnector`, so the canvas heals itself;
  `retryNow` (banner Reconnect / node Reconnect) skips the backoff and clears the refuse window.
- **"Restart agent (resume)"** → deliberately NOT a session lifecycle event: `terminal/
agent-restart.ts` restarts the agent CLI _inside_ the pane and leaves the PTY, the tmux session
  and its scrollback untouched. It exists for **new-model pickup** — a freshly released model only
  shows up in a CLI's model list on a fresh launch, and doing that by hand means closing and
  re-resuming every agent node on the canvas. Choreography: write the CLI's own exit line (`/exit`
  for claude, `/quit` for codex — that table is also the gate, an agent not in it can never be
  restarted in place), poll `pty:pane-command` (`#{pane_current_command}`, local tmux socket or the
  project's SSH ControlMaster; any failure reads as "not a shell yet") every `RESTART_POLL_MS`
  (250 ms) until a SHELL owns the pane, then echo-deliver `resumeCommand(...)` — the same
  `claude --resume` / `codex resume` the cold restore uses. **Nothing is ever killed**: if the CLI
  has not quit within `RESTART_EXIT_TIMEOUT_MS` (6 s) the run reports `exit-timeout` and leaves the
  session running. A `working` **or `blocked`** session is refused — `/exit` typed into a
  permission prompt would ANSWER it, not quit — and a node is held one-restart-at-a-time until the
  resume line has actually LEFT the pane (an un-submitted line is where a second `/exit` would be
  spliced in). The bulk action runs the same per-node closure sequentially over every idle agent
  node in canvas order and reports one summary line. `performRestartResume` is now a COMPOSITION of
  `performExitPhase` + `performResumePhase` (2026-08-12, behavior-pinned split) — hibernation
  drives the halves separately; each half refuses independently.
- **Agent hibernation ("Eco", 2026-08-12, OPT-IN default off)** → `settings.agentHibernationEnabled`
  (+ `agentHibernationIdleMinutes`, default 30; Settings → Agents): a 60 s renderer sweep
  (`Canvas`) exits the CLI of up to **2** agent nodes per pass that are hook-idle in state `done`,
  fully offscreen (`isNodeWatched` — an open kanban card modal counts as watched), local, idle ≥
  window, non-recurring, without live subagents (`planHibernation` +
  `lib/hibernationCandidates.ts`, both pure/tested). tmux + shell survive; node shows a clickable
  SLEEPING chip; wake (view / chip / modal open) verifies a SHELL owns the pane
  (`isShellCommand` OR the persisted `hibernatedPane` the exit settled on — nu/pwsh users) before
  the KILL_LINE'd, echo-verified `withPermissionMode(resumeCommand(...))`. Sweep/wake/menu-restart
  share ONE `guardConcurrentRestart` set. Load-bearing rules a refactor must not undo:
  (1) **recurring fact is durable** — both loop-card dismiss surfaces route through
  `lib/loopCard.ts`, which HIDES a cron/schedule card but retains `agentStatus.loop`
  (`dismissed: true`); clearing it would let Eco `/exit` a CLI whose cron wakeup lives in that
  process. (2) **Fire-time re-asks**: still-offscreen, remote, eligibility — a plan-time verdict
  is stale by seconds. (3) `hibernated` **self-heals** on live hook states + SessionStart (never
  on `done` — a late Stop POST must not undo a just-performed hibernate); cold restore (`fresh`)
  clears it and lets the normal auto-resume own the node. (4) **Ordering with offscreen release**:
  Eco defers the Phase-2 viewer release until the node hibernates (hard cap idle+offscreen), but
  ONLY when the idle clock is known (`idleKnown` — `lastEventAt` is transient, so after an app
  restart nothing can hibernate and deferring would make Eco a memory regression). Eco is
  structurally inert for sessions with no turn in the current app run — documented follow-up.
  Device checklist (8 items) in PR #130 — owed before recommending Eco to anyone.

The node id is the `persistKey` (passed to `transport.create`), so it must stay stable.
If tmux is unavailable while persistent support is enabled, `PtyManager` selects the standalone
session host; a plain shell is the final non-persistent path when persistence is disabled or cannot
be used. `findTmux()` resolves an absolute path because GUI apps don't inherit the
shell PATH, and it tries three sources **in this order: fixed system paths → the shell's
PATH → the tmux the macOS app SHIPS** (`bundledTmuxPath`). System first is deliberate — a
machine that already has tmux keeps using its own, so the bundled copy is a floor, never an
override. `resourcesPath` is `undefined` on the **Server Edition**, so the bundled binary is
unreachable there by construction; a Linux host is expected to have its own. Under
`electron-vite dev` the last candidate resolves against `process.cwd()`, which is where
`scripts/build-tmux.mjs` writes its artifact. If tmux is unavailable from all three, selection
continues to the session host before the plain fallback; `TMUX`/`TMUX_PANE` are stripped from the
child env to avoid nesting refusal.

### Cold restore (machine reboot)

Both persistent backends survive an **app** restart, not a **machine reboot**: a reboot kills the
tmux server and the Windows session host, so every `nt-<nodeId>` session is gone. To bridge that,
`create()` returns `PtyCreateResult` with a `fresh` flag. The tmux path runs `tmux has-session`
before spawning; the session host returns `fresh` from its authenticated attach response. In both
cases `fresh=false` means a warm reattach and `fresh=true` means a cold start (first open OR
post-reboot). On a
cold start the renderer (`TerminalNode.tsx`) reconstructs state instead of relying on the dead
session (you can't keep a live OS process across a reboot):

- **Scrollback replay** — `main/scrollback-store.ts` keeps a byte-capped (`256 KB`) snapshot of
  each tmux session's recent output under `<userData>/terminal-scrollback/`, refreshed on a
  timer (`SCROLLBACK_SNAPSHOT_MS`) + on detach/quit (`tmux capture-pane -e`). On a cold start the
  renderer reads it via `pty.readScrollback` and writes it back into xterm (with a "session
  restored" separator). Warm reattach skips it (tmux already redraws). Deleted with the node in
  `destroySession`.
- **Agent resume** — on a cold start of a node whose `agentId` is in `RESUMABLE_AGENTS`, the
  renderer re-launches the agent CLI: `resumeCommand(agentId, sessionId)` (from the session id
  persisted in `agentStatus` localStorage — `claude --resume`, `codex resume`, `gemini
--resume`) when known, else the bare `launchCmd`. The one-shot `data.initialCommand` still wins
  on the very first open, so the agent is never double-launched.

### Seeding a fresh xterm (`attachReplay` / `seedPaint` in `terminal/terminal-config.ts`)

A newly mounted xterm is empty. Since tmux paints its own client, there is usually **nothing to
seed** — the cases are:

- **`none`** — the terminal was **parked** (its buffer is still live and correct), or it is a
  brand-new node with an `initialCommand`. Seeding either would duplicate content.
- **`cold-snapshot`** (`fresh` — reboot/first open) — the tmux session is genuinely gone, so replay
  the persisted `scrollback-store` snapshot, with a "session restored" separator.
- **`warm-attach`** (`!fresh` — app restart, tmux still alive) — **seed nothing.** tmux is attached
  to this client: it redraws the visible screen and owns the history under the wheel. This is where
  a `warm-history` hydration (`transport.captureHistory` → `tmux capture-pane`) used to run; it was
  **removed**, because writing into a buffer that tmux then repaints is what produced the black
  bands and duplicated screens. The single exception is a **co-attach joiner** (`seedPaint` →
  `create-screen`): tmux only repaints on SIGWINCH, so a joiner that did not resize never gets a
  redraw, and the screen captured server-side inside `create()` (`PtyCreateResult.screen`) is the
  only thing that paints it — see docs/team-presence.md. **A co-attach joiner also misses tmux's
  MOUSE-TRACKING modes** (`?1000h/?1002h/?1006h`): tmux emits them only at its OWN attach, and
  neither the `screen` capture (`capture-pane` carries no private modes) nor a SIGWINCH redraw
  re-sends them — so the joiner's wheel can't scroll tmux history until a keystroke makes the app
  re-request mouse. `join()` therefore sets `PtyCreateResult.coAttachMouse` for tmux-backed joins
  (gated on `persistKey`, on BOTH the screen and resize branches) and the renderer writes
  `CO_ATTACH_MOUSE_SEQ` into the fresh xterm (both `ModalTerminal` and `TerminalNode`). tmux is
  always `mouse on`, so this matches its invariant client state; the enable is idempotent. Was the
  "can't scroll the kanban card-modal terminal until you press a key" bug.

xterm's own `scrollback` (`xtermScrollback(settings.tmuxScrollback)`, floored at 1000, capped at
`XTERM_SCROLLBACK_MAX` = 10000) is kept for the sessions tmux does _not_ back (a plain shell when
tmux is unavailable) and for the cold-snapshot replay — it is not what the user scrolls in a tmux
session.

## Terminal node lifecycle (gotchas)

`src/renderer/nodes/TerminalNode.tsx` is the trickiest file:

- The xterm instance + PTY session are created once in a `useEffect(…, [data.respawnNonce,
offscreenEpoch])` and torn down on unmount. The component persists across re-renders because
  React Flow keys nodes by `id` — never change a node's id, or you'll respawn its terminal.
  **Third in-place state — "released" (2026-08-11, offscreen dispose):** a node fully offscreen
  in the canvas viewport for `settings.offscreenTerminalMinutes` (default 10, `0` = never;
  Settings → tmux) has its xterm + PTY client torn down IN PLACE — node stays mounted showing a
  plate, tmux session untouched — and revives (warm reattach) when it re-approaches the viewport.
  Pure policy: `terminal/offscreen-policy.ts`. Two load-bearing rules a refactor must not undo:
  (1) the **visibility IntersectionObserver lives in its own mount-stable `[termKey]` effect**,
  NOT the lifecycle effect — the down transition re-runs the lifecycle effect, and an observer
  owned there dies with it, making revive unreachable (permanent plate; caught in review). The
  lifecycle run publishes to it through refs (`visibilityReportRef`, `offscreenLiveRef`,
  identity-checked on clear). (2) The remote exclusion asks `offscreenCoreIsRemote(session.source)`
  (`'local'` only is eligible — relay/server tabs excluded), NOT `data.remote`, **a field nothing
  sets on node data** (a gate on it was constant false and type-invisible; pinned by tests).
  SSH-project nodes are also excluded; collapsed = hidden (same convention as the WebGL budget);
  a `respawnNonce` bump while released revives first. Agent-status/fan-out clears live in a
  dedicated unmount-only effect (a release or respawn must not blank a live badge).
- **React StrictMode is deliberately not used** (`main.tsx`) — double-mount would spawn
  two PTYs per node.
- The xterm container is `nodrag nowheel`; a transparent **hover-guard** overlay sits on top
  until you dwell `settings.panHoverDelay` (so quick drag = move node, scroll = pan). After
  the dwell the guard is removed and xterm takes input. The header stays draggable.
- A `ResizeObserver` drives `FitAddon.fit()` + `transport.resize`. Canvas zoom is a CSS
  transform, so it does _not_ change `clientWidth` — cols/rows stay stable across zoom.
  `scale-fix.ts` patches xterm's mouse coords so text selection stays aligned when zoomed.
  **That same CSS transform is why terminal text is soft, and there are TWO terms, not one**
  (measured 2026-08-18 on Windows 11 at 150% scaling, dpr 1.5, with the repo's own Electron 42 +
  xterm 5.5 + addon-webgl 0.18 and `quantizeCharSize` applied; metric = share of ink pixels fully
  on, the same one `glyphgrid/raster.ts` quotes, aligned zoom-1 baseline **0.552**):
  **SCALE** — a terminal's raster is built at `devicePixelRatio` and displayed at `dpr × zoom`, so
  every zoom ≠ 1 resamples it (zoom 0.83 → **0.311**, −44%); and **PHASE** — React Flow's viewport
  `translate(x, y)` carries arbitrary CSS fractions, and at a fractional dpr a whole-CSS-pixel pan
  is still a fractional DEVICE offset, so the raster is smeared across two device columns *at zoom
  1* (a 0.37/0.61 px offset → **0.335**, −39%). Phase is the term the "blurry at default zoom"
  report is about, and it is a Windows problem specifically because mac dprs are integers: at dpr
  1.5 a CSS offset is device-aligned only on multiples of ⅔. The DOM renderer measured the same as
  WebGL when aligned (0.566 vs 0.552), so **the renderer choice is not the cause** — the transform
  is. The pure rule (what raster scale a given dpr × zoom wants, and the ≤ half-device-pixel nudge
  that aligns a coordinate) is `terminal/device-pixel-fit.ts`, unit-tested on dpr 1 / 1.25 / 1.5 / 2.
  **It is not wired to anything yet**: both wiring sites are the viewport transform in `Canvas.tsx`
  and the renderer default, and neither change may ship without a device eyeball. Note the shared
  glyphgrid layer is already immune to PHASE — it is a `<ReactFlow>` sibling of the viewport rather
  than a child of it, and `glyphgrid/camera.ts`'s `snapPanToDevicePx` snaps its camera — which makes
  `'shared'` the ready-made escape hatch to point a Windows user at, and the leading candidate if
  the default is ever revisited.

## Node kinds (all rendered by React Flow custom nodes)

- **terminal** (`TerminalNode.tsx`) — xterm + tmux or the Windows session host (see above). Header: collapse, color,
  click-to-rename title, ✦ AI-name, ×. Body has a **hover guard** overlay: dwell
  `settings.panHoverDelay` (default 600 ms) before the terminal takes focus — before that,
  drag = move node, scroll = pan canvas. **Cmd/Ctrl+M** (while hovered) toggles a markdown
  render of the captured output. Tag chips via `NodeTags`.
  **Selection + copy is tmux's** (its mouse is on — see the tmux section): drag to select, wheel to
  scroll tmux's history. A drag copies via copy-mode, and tmux emits **OSC 52** to the client, whose
  handler writes the **system clipboard** — the one copy path on every platform _and_ over SSH (no
  `pbcopy`). OSC 52 writes an app emits itself (vim `"+y`, gh, yazi) reach the clipboard through the
  same handler (write-only — a read query is refused). The emulator's own copy chords stay for a
  selection xterm _does_ own (`copyKeyAction`/`isCopyShortcut`): **Cmd+C** (mac), **Ctrl+Shift+C**
  and **Ctrl+Insert** (Linux/Windows) — matched on `e.key` _or_ the physical `KeyC`, so non-Latin
  layouts still copy. A copy chord is **always swallowed**, selection or not: letting Ctrl+Shift+C
  fall through would reach the pty as `\x03` (SIGINT). Ctrl+Insert exists because Chromium reserves
  Ctrl+Shift+C for the inspector and a page cannot `preventDefault()` it — which is where Server
  Edition users land. Plain **Ctrl+C** is never intercepted. To select in **xterm** instead of tmux
  (or inside an app that grabs the mouse, like vim/htop), hold **Option** (mac —
  xterm's `macOptionClickForcesSelection`) or **Shift** (Linux/Windows) while dragging.
  **Copying now says so**: the OSC 52 handler floats a transient `Copied N lines` pill over the
  terminal's BOTTOM-RIGHT corner (`.term-copy-pill`, the same class on the canvas node and the
  kanban card modal — one session seen twice must not speak in two voices; bottom-right because
  every agent CLI writes its input line bottom-left, and `pointer-events: none` because it sits on
  the terminal and fires on every copy), because tmux's `copy-pipe-and-cancel`
  clears the highlight at the exact instant it copies — which read as "the copy failed" to a user
  whose other pane ran claude. And a drag that produced NEITHER an OSC 52 nor an xterm selection
  means the pane's app captured the mouse (claude does, codex does not), so a one-time
  `Hold ⌥ to select text` hint fires instead (`nodeterm.seenSelectHint`). **The whole layer is
  OFF for an agent in `SELF_REPORTS_COPY` (`reportsOwnCopy` — claude, which prints its own
  "copied N chars to tmux buffer" line): a second message for one gesture is noise, and a claude
  terminal is byte-identical to before the feature. **One owner per pill:**
  the `copied` receipt is raised ONLY by the OSC 52 path, the hint ONLY by the drag path — the two
  never race for the same slot. The emulator's own copy **chord** (Cmd+C / Ctrl+Shift+C) deliberately
  raises nothing: Claude Code prints its own copy line ("copied N chars to tmux buffer"), and a
  second message for one gesture is noise. Decision logic is the pure `terminal/copy-feedback.ts`;
  `useCopyFeedback` is the glue (it also yields to a clipboard-failure `nodeterm:toast`, so the
  Server Edition never shows a green receipt beside a red banner), and the node publishes its sink
  through the module-level `copySubs` map because the OSC handler survives a park.
  **Clipboard writes are acknowledged, never fire-and-forget:**
  `window.nodeTerminal.clipboard.writeText` resolves `true` only after the selected host route
  completes. Desktop uses invoke/handle IPC around Electron's system clipboard; Server Edition
  awaits `navigator.clipboard` and then its click-driven `execCommand` fallback. Every implementation
  owns transport/permission exceptions and resolves `false`, because older terminal/menu callers
  intentionally ignore this safe Promise. A caller with another fallback passes
  `{ reportFailure: false }`, tries that route, and reports only the final exhausted outcome — do
  not restore an eager Server toast that can race a later green receipt.
  **Shift+Enter** is remapped to `\x1b\r` (ESC+CR / M-Enter) so agent CLIs insert a newline
  instead of submitting (`terminalKeyAction` / `SHIFT_ENTER_SEQ` in `terminal-config.ts`; sent in
  all terminals — harmless in a plain shell). **Cmd (mac) / Ctrl+click** opens links in the
  output: URLs → default browser (`@xterm/addon-web-links`), file paths → editor node and
  directories → Explorer reveal (`terminal/file-links.ts`, existence-verified against the project
  fs via cached parent-dir listings, with `path:line[:col]` compiler-output suffixes). The path
  dialect follows the FILESYSTEM-OWNING CORE, not the viewer: desktop-local may use its own
  platform, Server Edition and relay tabs use the core's reported `process.platform`, and SSH
  projects are POSIX. A failed host-platform read disables file links for that connection — it
  never guesses from the browser. Standalone `ssh` terminal nodes remain URL-only because they
  have no remote fs API with which to verify a token; relay tabs do have a core-bound, jailed fs
  API and therefore support file links. Windows existence matching is case-insensitive and accepts
  both separators; UNC tokens are refused whole before they can be reinterpreted as cwd-relative.
- **Agent** (`createAgentNode(agentId, …)`) — a terminal preset that runs an agent CLI as its
  `initialCommand` (runs once on open via `transport.write`, then cleared), with `data.agentId`
  set. Builtins (`claude`/`codex`/`gemini`) come from `AGENT_CONFIG` (clay color etc.).
  Agent nodes get extra behavior **gated by the
  agent's capabilities** (see **Agent support** below): a busy/working badge + unread dot +
  completion notification + session-name chip (hook-capable agents), content search, and the
  Claude-only **Branch conversation** action. Custom user-defined agents spawn + show
  process/terminal-title status only.
- **sticky** (`StickyNode.tsx`) — colored note, free text, collapsible. Has link handles:
  connect a sticky to any terminal node to attach the note as context (see Context Link).
- **group** (`GroupNode.tsx`) — real React Flow parent/child frame, and frames **nest** (2026-08):
  a group may contain other groups to any depth. `groupSelectedNodes` wraps objects that share ONE
  container — frames included — creating the wrapper inside that container; a mixed-container set,
  or an ancestor selected together with its own descendant, is **refused** rather than scrambled
  (positions are only comparable within one container, and the descendant would be torn out of the
  ancestor being wrapped). Box-selection routinely catches both, so structural actions normalize
  the selection to its subtree roots first (`selectedRootIds`). `ungroupNodes` promotes a frame's
  direct children into **its own parent** (not to the root — that would move them by the whole
  ancestor offset); `reparentNode` moves a node OR a whole frame subtree, keeps its **root-space**
  position fixed (`rootPosition`, not the old add-one-parent's-origin math) and refuses a cycle;
  `addSelectionToGroup` adds a selection to an existing frame; `reorderGroupWithinParent` reorders
  a frame among its siblings, carrying its subtree. `nodeStatesToFlow`/`groupsFirst` emit frames
  **depth-first from the root** — a flat "groups first" sort is not enough once two groups compare
  equal — and that persisted order is also the downgrade contract (a pre-nesting build's stable
  sort leaves it alone, so a nested tree still hydrates parent-first and renders there).
  **A frame that gains a child bigger than itself is re-fitted, ancestors included**
  (`fitGroupToChildren` up the chain): a wrapper created at `(minX-28, minY-62)` relative to its
  parent is routinely negative, and `extent:'parent'` would make React Flow clamp it into an
  inverted range — snapping the frame hundreds of px away and dragging the whole wrapped subtree
  with it. Visually: a dashed rounded frame in the group color with a floating label pill (color
  dot + editable name) on the top border and ungroup/× top-right (on hover/selected). **The pill
  is the frame's `dragHandle`** and the frame body is `pointer-events: none` — a frame is a
  background container, not a giant drag target, so its body passes clicks to the pane and an
  outer frame cannot swallow the clicks meant for a frame drawn inside it. The
  `NodeResizer` line is hidden (`lineStyle` transparent) so it can't draw a sharp-cornered
  box; the selection ring is a `box-shadow` instead, which follows the same `border-radius`.
- **editor** (`EditorNode.tsx`) — Monaco code editor for a `filePath`; reads/writes via
  `fs:read`/`fs:write`, auto-detects language from the path, ⌘S saves, dirty dot. A
  **Preview / Edit** toggle (or ⌘M while hovered) renders the live content as markdown.
  **Image files** (png/jpg/gif/webp/bmp/ico/svg/avif) skip Monaco and show an `<img>`
  preview instead — read as base64 via `fs:read-binary` into a `data:` URL (CSP allows
  `img-src data:`), on a checkerboard backdrop with the pixel dimensions in the header.
- **diff** (`DiffNode.tsx`) — Monaco diff editor; `diffStaged` chooses HEAD↔index (staged)
  vs index↔working (unstaged) via `git:show-file` + `fs:read`. Read-only.
- **chat** — **REMOVED 2026-07.** The SDK-driven Claude chat node (`ChatNode.tsx`, `main/chat-driver.ts`,
  the `@anthropic-ai/claude-agent-sdk` dependency, and the whole chat-events/chatSessions stack) is
  gone — dropping the bundled SDK also removed a ~240 MB native binary per platform. A persisted `chat`
  node is migrated by `nodeStatesToFlow` into a **sticky tombstone** in place, carrying a
  `claude --resume <chatSessionId>` hint so the conversation continues in any terminal (a chat was an
  ordinary resumable Claude session). `CHAT_CAPABLE` / `canChat` survive but now gate **only** the
  ⌘M **ChatPanel** transcript view on a Claude _terminal_ node (see the terminal bullet's Cmd/Ctrl+M),
  not any SDK chat node.

Monaco is wired in `renderer/editor/monaco-setup.ts` (language workers bundled via Vite
`?worker` — no CDN; CSP `worker-src` allows them). Markdown rendering is shared in
`renderer/lib/markdown.ts` (`marked` + DOMPurify sanitize).

## Agent support (Claude / Codex / Gemini / opencode / Grok / custom)

The app is a pluggable multi-agent system: Claude Code is one builtin of
several. Extra terminal-node behavior is driven per agent by a registry + capability lists, a
shared 4-state model, and a **transient** zustand store `state/agentStatus.ts`
(`{state, agentId, unread, session, sessionId, loop}` per node id; the live `state` is **not**
persisted — only `unread`/`session`/`sessionId` go to localStorage under
`nodeterm.agentStatus`, migrated once from the legacy `nodeterm.claudeStatus` key).

- **Agent registry + capabilities** — `src/shared/agents/config.ts` holds `AGENT_CONFIG`
  (claude/codex/gemini/opencode/grok: id, label, spawn command, color, `promptInjectionMode`, …) keyed
  by an **open** `AgentId`
  type (so custom ids fit). Capabilities are membership lists, not flags:
  `AGENT_HOOK_TARGETS`, `RESUMABLE_AGENTS`, `SUBAGENT_CAPABLE`, `RECURRING_CAPABLE`,
  `BRANCH_CAPABLE`, `CONTEXT_LINK_CAPABLE`, `USAGE_CAPABLE`, `CHAT_CAPABLE`,
  `TRANSFER_SOURCE_CAPABLE`, `RENAME_CAPABLE`, `TITLE_READ_CAPABLE`, `CANVAS_CONTROL_CAPABLE`,
  `PERMISSION_MODE_CAPABLE`, with helpers (`hasHooks`,
  `canBranch`, `canContextLink`, `canChat`, `canRename`, `canReadTitle`, `hasPermissionMode`, …).
  Branch and the ⌘M **ChatPanel** transcript view (`CHAT_CAPABLE` / `canChat` — since the SDK chat
  node was removed, 2026-07, this is all `canChat` now gates) stay **Claude-only** purely by
  being in only `BRANCH_CAPABLE` / `CHAT_CAPABLE`. The other lists span more agents, and the
  memberships below are the ones to check before assuming "claude-only" (all verified against
  `config.ts`, 2026-08-09): the per-node **context meter** is `USAGE_CAPABLE = claude/codex/gemini`;
  the **permission mode** is `PERMISSION_MODE_CAPABLE = claude/grok/gemini/codex`; the session-name
  sync is **split in two** — `TITLE_READ_CAPABLE = claude/grok/gemini` (read) ⊇ `RENAME_CAPABLE =
claude/grok` (write), because gemini names its own sessions but has no rename command;
  **Context Link** spans four builtins
  (`CONTEXT_LINK_CAPABLE = claude/codex/gemini/opencode`, NOT grok). UI gates
  on these helpers — no hardcoded `=== 'claude'`. **Custom agents** (user-defined in Settings, `customAgents`) are in
  no capability list: spawn + terminal-title + process status only. Per-agent write-ups:
  **`docs/grok-agent.md`**, **`docs/gemini-agent.md`** (there is none for codex — its approval mapping
  and every value's reasoning live in `src/shared/agents/approval-mode.ts`);
  the distilled rules are **Adding a new agent** at the end of this section.
- **Grok** (`@xai-official/grok` 1.0.0, builtin since 2026-08) — in `AGENT_HOOK_TARGETS`,
  `RESUMABLE_AGENTS`, `RENAME_CAPABLE`, `PERMISSION_MODE_CAPABLE` and `CANVAS_CONTROL_CAPABLE`; NOT in
  `USAGE_CAPABLE` / `CONTEXT_LINK_CAPABLE` / `SUBAGENT_CAPABLE` (each blocked on a fixture that needs a
  logged-in grok session — the context meter, context links and subagent cards are **not implemented**
  for grok). Its hook config is a **directory** (`$GROK_HOME/hooks/*.json`, all merged), so nodeterm
  **owns one file outright** (`nodeterm-status.json`) instead of merging into a shared settings file —
  which is also why a malformed copy of it is _healed_ rather than preserved, locally and on an SSH
  host (`RemoteHooks.installGrokRemote`, under the host's own `$GROK_HOME`). Its dialect is
  **camelCase keys with snake_case event VALUES** (`{"hookEventName":"pre_tool_use"}`) — the SDK path
  flips the keys to snake_case, so `normalizeGrok` canonicalizes the event name and reads every field
  twice, and the shells share one decoder (`grokRawFields`). It carries **no `transcript_path`**, so a
  session directory is DERIVED from `cwd` + `sessionId` (`core/agents/grok-paths.ts`, the one
  `$GROK_HOME` rule — `core/usage/grok-usage.ts` delegates to it) and remembered in the shells' raw
  listener; the name read is `core/grok-session.ts` over `summary.json`, routed per agent by
  `core/agent-session-name.ts`. **The tool-event `matcher` is a regex: `.*`, never `*`** — a bare `*`
  is invalid and silently stops tool events firing (hence `ManagedHookEvent`). Grok also reads
  **`~/.claude/skills`** (Claude compat), which is why canvas control needed no new installer, and
  **`~/.claude/settings.json`**, so every grok event ALSO fires nodeterm's claude hook — an **inert**
  cross-fire (`normalizeClaude` finds neither grok's camelCase keys nor, in the SDK dialect, its
  lowercase event values), pinned by tests; canonicalizing claude's event-name compare would make it
  harmful. The `auto` permission-mode **version gate is claude's alone** (it is fed by a `claude
--version` probe), and grok's mode flag must go **BEFORE** its `--` separator, which is
  end-of-options. Full picture, dialect traps and the device checklist: **`docs/grok-agent.md`**.
- **Gemini + codex parity** (2026-08-09) — brought both up to grok's level in the lists above. Unlike
  grok, **both CLIs are installed** and gemini **ships its own hook reference**
  (`/usr/lib/node_modules/@google/gemini-cli/bundle/docs/hooks/reference.md`), so almost every fact is
  measured. The load-bearing ones:
  - **Gemini's envelope IS claude-shaped** — `session_id`/`transcript_path`/`cwd`/`hook_event_name`
    (`reference.md:46-58`), the exact opposite of grok's missing `transcript_path`, so the shells just
    jail the path they are handed. The **event names** are gemini's own: eleven exist, `GEMINI_HOOK_EVENTS`
    subscribes **seven**. `AfterModel` is excluded because it fires **per streamed chunk**
    (`reference.md:236`) = one hook process per chunk; `BeforeModel` is **not** per-chunk (it fires once
    per request) and is excluded only because it reports nothing we render.
  - **`Notification` → `blocked`, matched as a CLOSED set** (`notification_type === 'ToolPermission'`).
    Before this, a gemini node sat on RUNNING while it waited for a permission answer. The closed match
    is measured, not cautious: gemini's `NotificationType` enum has exactly ONE member, and it fires
    only after `shouldConfirmExecute` returns details — i.e. only for a real dialog, so an
    auto-approved/`yolo` call fires nothing. **Grok's `includes('permission')` strobed on every tool
    call**; widening this "to be safe" is the unsafe direction.
  - **Context meter from each agent's own transcript** — one tail per agent, each with its own `parse`
    dep on `createContextTail` (`core/gemini-session.ts`, `core/codex-session.ts`), in **both** shells.
    Gemini: `tokens.input` and a window from `geminiWindowFor`, which mirrors the CLI's own
    `tokenLimit()` — a **family rule with a 1M catch-all default**, so an unknown model gets the right
    answer instead of a confident wrong denominator. Codex: `last_token_usage.input_tokens` and its own
    stated `model_context_window`. Two traps: `total_token_usage` is **CUMULATIVE** (would render a
    13%-full session at 79%), and `cached` is **INSIDE** `input` for both — while claude's input
    _excludes_ cache reads, which is why claude sums them. **The formulas must not be unified.**
    The transcript jail is widened **per root** (`~/.gemini/tmp`, `<codexHome>/sessions`), never to
    `$HOME` — that predicate exists so a forged hook POST cannot aim a read at `~/.ssh/id_rsa`.
  - **`hasUsage` gated THREE features, not one.** Joining `USAGE_CAPABLE` also switched on
    `context.ensure` and the find bar's transcript index, both of which go through claude's
    `resolveTranscript` — whose **cwd fallback** then handed a codex node _the newest claude transcript
    for that cwd_: a stranger's session as its meter and its search hits. Now gated by the pure
    `readsClaudeTranscript` (`renderer/lib/transcriptGates.ts`), which reuses `CHAT_CAPABLE` rather than
    adding a fourth list. Non-claude agents lose only the mount-time head start.
  - **`TITLE_READ_CAPABLE` was created here**: gemini names its own sessions through its `update_topic`
    tool (the title is in that call's `args.title`, NOT a top-level field) but has no rename command, so
    the read and write legs split. Its read path is the transcript the context tail already tracks
    (injected as `AgentSessionNameDeps.geminiPathFor`, held in a `let` in `src/main/index.ts` to avoid a
    TDZ throw that would kill a node's whole poll chain).
  - **In-place restart** works for gemini: `EXIT_SEQUENCES.gemini = '/quit'` — and it must stay **bare**,
    because `/quit --delete` exits _and permanently deletes_ the session history, i.e. exactly what the
    restart exists to resume (pinned by its own test).
    Full picture, measurements, gaps and a device checklist: **`docs/gemini-agent.md`**.
- **Permission mode** (agents in `PERMISSION_MODE_CAPABLE` — claude, grok, **gemini**, **codex**) —
  the mode a session **starts** in (`claude --permission-mode <mode>`; Shift+Tab still cycles it at
  runtime). Membership no longer implies claude's flag spelling: **the per-agent translation lives in
  `src/shared/agents/approval-mode.ts`** (`approvalFlags` / `modeSupported`), which is also where
  `withPermissionMode` now lives — it moved one layer up out of `config.ts` to break a cycle.
  gemini = `--approval-mode default|auto_edit|yolo|plan`, codex = `--ask-for-approval
untrusted|on-request|never`. Two rules the mapping exists to enforce: a mode the CLI **cannot
  express emits NO flag**, never a substituted nearest match (codex has no `plan` and no
  edit-specific mode; **gemini has no `auto`** — nothing in its vocabulary means "approve most things
  but not edits", and since `auto` is the DEFAULT mode, mapping it to `auto_edit` would have switched
  auto-approve-edits on for every existing gemini node at upgrade time, silently), and "supports"
  must not be a lie either — codex's `manual` maps to
  `untrusted` because its built-in default is `OnRequest` (measured: `codex doctor`, no `approval`
  key in `~/.codex/config.toml`), so leaving it unflagged would deliver "the model decides when to
  ask" under an "Ask each time" label. **codex is the first agent where `manual` emits a flag.** The
  UI copy is DERIVED from the mapping (`permissionModeAgentIds` / `permissionModeAgentsLabel` /
  `unsupportedModesNote` / `bypassSandboxCaveat`) so a sentence cannot drift from what the table
  does — so the note now reads "Auto has no Gemini equivalent…" beside codex's two gaps, and the
  residual wart is only that `auto` and `manual` land on the same gemini policy (the _prompting_ one).
  `--sandbox` is a separate axis and deliberately untouched (`--ask-for-approval never`
  still sandboxes).
  `settings.claudePermissionMode` (global, default **`auto`** — a behavior change for existing
  users, who previously got a prompt per action) is overridden per project by
  `project.defaultPermissionMode` (persisted to `.nodeterm/project.json`, so a `bypassPermissions`
  override travels to everyone who clones the repo — the tab menu warns). Modes are
  `manual | auto | acceptEdits | plan | bypassPermissions`, labelled once in
  `PERMISSION_MODE_LABELS` (from which `ALL_PERMISSION_MODES` is derived — the dropdown and the
  validator can't desync). `resolvePermissionMode(project, settings)` is the resolver
  (`renderer/state/permissionMode.ts` `activePermissionMode(agentId)` binds it to the live stores **and
  applies the version gate below — for `agentId === 'claude'` only**). Every production launch first
  obtains a branded `ActiveAgentLaunchPlan` from `activeAgentLaunchPlan` (or the awaited
  `ensureActiveAgentLaunchPlan`) for one name in the closed `AGENT_LAUNCH_SURFACES` inventory;
  command builders and `createAgentNode` consume that proof rather than a raw mode. The behavior Chut
  runs every inventory row under Kids mode for both permissive inputs and asserts each agent's exact
  manual CLI arguments, so a new/bypassed surface is a red case rather than a source-text count.
  `commandForAgentLaunch` applies the branded decision through `withPermissionMode`.
  **WHERE the flag lands is decided at the composed layer** (`createAgentNode`), not in
  `withPermissionMode`: with no `argvPromptSeparator` (claude) it goes LAST, keeping the historical
  command byte-identical; with one (grok's `--`) it must go **BEFORE** the separator, because `--` is
  end-of-options and a flag after it is a positional — silently swallowed into the prompt or a clap
  usage error. Assert that at `createAgentNode`; a `withPermissionMode` test passes while the composed
  line is wrong. (gemini and codex declare no separator, so their flag goes last and their command
  lines stay byte-identical; grok is still the only agent taking the other branch.)
  UI: Settings → Agents, and the tab ⌄ menu for the per-project override.
  **Version gate (`auto` only) — CLAUDE's alone:** `--permission-mode auto` exists only in **Claude Code ≥ 2.1.71**;
  older CLIs validate the value against their own choices list and **exit 1** — and `auto` is the
  default, so an ungated flag would kill every Claude launch on an older CLI. So the CLI is probed
  (`core/claude-cli.ts` → `claude --version`, memoized, registered on `CorePlatform` so **both**
  shells serve it; reached from the renderer via `window.nodeTerminal.claude.cliCaps()`, with a
  **real** ws-bridge implementation) and `gatePermissionMode(mode, autoSupported)` degrades **only
  `auto`**, and only to `manual` = **no flag** = the bare pre-feature command. Everything **fails
  open**: unknown/unreadable version, a probe that failed or hasn't answered yet ⇒ bare command,
  never a blocked launch; the other four modes are never touched by the gate, and the user's
  _setting_ stays `auto` (only the emitted command line changes). **SSH projects** are gated on the
  **remote** host's CLI, never the local one: `SshProjectManager.connect` probes `claude --version`
  on the host (through a login shell — an ssh exec channel's rc file usually bails out early — with
  `$HOME/.local/bin` + `$HOME/.claude/local` prepended to PATH: the official installer targets
  `~/.local/bin`, which a stock root `.profile` never adds, so a host whose interactive shells run
  claude fine still probed "not found" and silently degraded `auto` to manual) and
  caches the answer on the connection → `useSshConn`; not connected / not yet probed ⇒ no `auto`
  flag. A FAILED remote probe (claude not found — often a transient login-shell hiccup) **retries
  on a bounded backoff** (`PROBE_RETRY_DELAYS_MS`; every attempt pushes its answer immediately so
  launch waiters never block on the retry tail; a definite version — old or new — never retries),
  and the status event carries `remoteClaudeVersion` (`null` = probe failed) beside the boolean.
  The cold-restore relaunch `await`s the (shell-warmed) local probe because it fires on mount —
  and on an SSH project whose resolved mode is `auto` it also waits (`SSH_AUTO_PROBE_WAIT_MS`,
  bounded, fail-open) for the REMOTE probe's first answer, which races the same mount. Because
  the degrade is silent by design, the tab menu's Auto rows surface it: `sshAutoModeHint`
  (tri-state `useSshConn.autoPermAnswer` + probed version) puts a ⚠︎ + tooltip on "Auto" / "Use
  global (Auto)" for an SSH project whose remote CLI is too old / missing / not yet probed.
  **Security:** mode values come from hand-editable, git-shared JSON and end up interpolated into
  a shell command line (tmux `send-keys`), so `permissionModeFlag` **re-validates** the mode at the
  interpolation site (the type is compile-time only) — an unrecognized mode yields **no flag**, i.e.
  the bare, safe command. `'manual'` likewise yields no flag, reproducing the pre-feature command
  bit-for-bit. The setting and the per-project override apply to **terminal (CLI) agent nodes only**
  (the SDK **chat node**, which never honored it, was removed 2026-07). **No other agent inherits this
  gate:** grok has accepted every mode since 1.0.0 and gemini/codex accept theirs on the versions we
  measured, so gating any of them on a `claude --version` probe would
  downgrade their sessions on a machine whose claude is old or absent — `activePermissionMode` gates
  only `'claude'`, `ensureActiveAgentLaunchPlan` awaits the probes only for `'claude'`, and
  `sshAutoModeHint`'s copy names Claude in every sentence for the same reason. An agent needing its
  own gate adds one beside claude's.
- **State via each agent's hooks → shared 4-state model** — detection uses the agent's own
  hooks, **not** output parsing. `src/shared/agents/normalize.ts` has per-agent normalizers
  (`normalizeClaude`/`normalizeCodex`/`normalizeGemini`/`normalizeOpencode`/`normalizeGrok`) that map each agent's native hook
  events to a `NormalizedAgentEvent` over the shared `AgentState` (`working | waiting | blocked
| done`) plus subagent/recurring/session kinds. Canvas's listener consumes
  `NormalizedAgentEvent` from `agent:status`, drives the `agentStatus` store, fires throttled
  (5s/node) background notifications, and records the session id. Header shows a pulsing
  **RUNNING** (working) / **NEEDS YOU** (waiting/blocked) badge.
- **Hook server (loopback HTTP)** — `src/main/agents/hook-server.ts` is a main-process
  loopback HTTP server (per-session bearer token, fail-open) that the installed hook scripts
  POST to; it replaced the old `fs.watch` signal-log mechanism. `buildPtyEnv` injects the
  node id + endpoint/token into each spawned session's env; because tmux sessions **outlive
  the app**, the server also writes `<userData>/hook-endpoint.env` so a relaunched main
  process re-advertises the same endpoint (restart handoff). A `setRawListener` channel feeds
  the per-node context-window meter (`context-tail.ts` — **one tail per agent**, each with its own
  `parse` dep: claude's usage records, `codexContextParse`, `geminiContextParse`) and the subagent
  live-transcript (`subagent-tail.ts`, claude only). The same events feed the **agent-status mirror**
  (`core/agent-status-mirror.ts`) the mobile companion reads; the mirror carries an optional
  `settings` block (`claudePermissionMode`/`autoSupported`/`claudeAccounts`) so the phone can
  launch agents with the desktop's permission mode + managed accounts, and SSH slices get their
  **per-host** settings (remote CLI caps + host-matched accounts) injected via
  `remote-status-push`'s `settingsFor` dep.
- **Hook installers** — `src/main/agents/hooks/` holds per-agent hook services + an installer
  registry `MANAGED_HOOK_INSTALLERS`. `managed-script.ts` builds the POSIX hook script that
  POSTs to the server (env-gated: a no-op in the user's normal terminals, active only in
  sessions nodeterm spawns; the `claude-signals` string is kept as the idempotency marker that
  migrates users off the old hook). claude → `~/.claude/settings.json` and gemini →
  `~/.gemini/settings.json` (shared `install-helper.ts`, merged/idempotent, preserving other
  tools' hooks); codex → `~/.codex/hooks.json` + `~/.codex/config.toml` trust entries
  (`codex-trust.ts` — the hash gates whether codex runs the hook); **grok → our OWN file
  `$GROK_HOME/hooks/nodeterm-status.json`** (its hook config is a directory whose files are all
  merged, so there is nothing of the user's inside ours — which is also why a malformed copy is
  _healed_, not preserved, on both the local and the SSH path). The per-event **`matcher`** the grok
  installer needs is why events are typed `ManagedHookEvent` (`string | {event, matcher}`): grok's
  tool matcher is a REGEX and must be `.*` — a bare `*` is invalid and silently stops tool events
  firing. Plain-string events keep their byte-identical output for every other agent.
  A live desktop harness therefore must isolate the **home as well as Electron userData**:
  `scripts/check-app-wired-core.mjs` redirects USERPROFILE/HOME, AppData, temp, XDG and every
  agent-specific config root before spawn, then fingerprints the exact real-home hook/config
  targets before and after. `NT_USER_DATA` alone is not a sandbox, and `HOME` alone is a no-op for
  Node's `os.homedir()` on Windows. The same harness passes its repo path to PowerShell as env data
  and uses a literal, separator-bounded match; `[?*` in a checkout name must never become wildcard
  syntax in a cleanup command.
- **Per-node hook identity** (`src/core/agents/node-auth-*.ts`, `node-token-*.ts`,
  `node-identity-policy.ts` — full write-up in **`docs/node-identity.md`**) — the shared bearer proves
  "a session on this machine", never _which_ session, so every node also gets a capability derived
  from one restart-stable secret (`kid.mac`, domain-separated HMAC over the node id), handed to the
  client as a 0600 file and verified three ways: `verified` / `legacy` / `forged`. `legacy` is "we
  cannot judge this", not a failure. Two invariants come out of this series and both cost real
  incidents to learn:
  - **A credential never rides argv — local or SSH.** Measured 2026-08-13: `buildPtyEnv` put the hook
    bearer in the tmux `-e` argv, which lands in a long-lived tmux client's `/proc/<pid>/cmdline`
    at **mode 444** on a stock Linux with no `hidepid`; combined with `open-terminal --cmd` not being
    in the confirm-gated `DESTRUCTIVE` set, that was arbitrary command execution as the victim from
    any account on the box. A remote command line is argv on **both** ends, so the same rule binds
    every `ssh`/`curl` we generate. Credentials travel by 0600 file or by **stdin**
    (`curl --config -`, already house style in `usage/remote-claude-usage.ts` and
    `codex-identity-proxy.ts`). Never add an argv fallback "for old curl" — that undoes the fix.
  - **Both raw listeners change together** — `src/main/index.ts` and `src/server/agent-status.ts`.
    A new field on the hook event (the `verified` flag was one) that reaches only the desktop leaves
    the Server Edition silently without the feature; the boundary tests cannot tell you a field is
    _missing_. `hook-verified-parity.test.ts` asserts it at source level because this repo has
    shipped a one-shell hook-server change three times.

  Enforcement is dated (`NODE_IDENTITY_STRICT_AFTER`, 2026-10-13, read through `isStrictInstant` so a
  clock years ahead cannot enter strict mode early) with a `settings.hookIdentityStrict` escape hatch
  in Settings → Agents. **Trust on first proof latches a node the moment it authenticates, so it
  refuses TODAY, not on the cutoff** — which is why every token sweep must also call
  `hookServer.forgetProvenNode`. `/hook/*` never 403s a missing token: the phone, the cross-instance
  failover and every pre-token session legitimately have none.

- **Fullscreen TUI (Claude)** — through the SAME `settings.json` seam the hook installer uses,
  nodeterm ensures Claude's `"tui": "fullscreen"` so a session takes the alternate screen + mouse
  and behaves natively in tmux (else a drag falls into copy-mode). Two guardrails: **write-if-absent**
  (any existing `tui` value — e.g. a user's `/tui default` — is never touched;
  `core/agents/hooks/claude-tui.ts` `ensureFullscreenTui`) and **version-gated** to CLI ≥ 2.1.89
  (`supportsFullscreenTui` / `claudeCliCaps().fullscreenTui`; unknown ⇒ don't write). Runs
  everywhere the hook seam does: local `~/.claude` + managed account dirs at launch/add-account
  (`ensureClaudeFullscreenTui{,Into}`), and the remote host + account dirs on SSH connect
  (`RemoteHooks.ensureFullscreenTui{,InAccountDir}`, gated on the connection's cached remote probe).
  **Grok has no analogue** — it runs full-screen by default, so there is nothing to write.
- **Unread + notification** — on a busy→idle edge while the window is unfocused
  (`document.hasFocus()`), the node is marked unread (header dot, minimap stroke, project-tab
  dot). If notifications are enabled, `window.nodeTerminal.notify()` → main `app:notify`
  (shown only when `mainWin.isFocused()` is false); clicking it focuses the window and sends
  `app:focus-node` → `Canvas.focusNodeById` (selects + centers, switching projects via
  `pendingFocusRef` if needed). A one-time consent prompt gates notifications; toggle in
  Settings (`notifyOnClaudeDone`). Unread clears on focus/select.
- **Session name ⇄ node title** — **two lists, because the two directions are separate facts**:
  `TITLE_READ_CAPABLE` (`canReadTitle` — claude, grok, **gemini**) is the READ leg, `RENAME_CAPABLE`
  (`canRename` — claude, grok) the WRITE leg, and **read ⊇ write** is an invariant pinned in
  `config.capabilities.test.ts`. Gemini is the reason: it names its own sessions but has **no rename
  command** (`/chat save <tag>` is a checkpoint, not a title), so one list for both legs would light
  the rename UI on a node where the write silently does nothing. The **write** is the same literal
  `/rename <name>` for claude and grok; the **read** legs are per-agent and none may ever
  search another's tree, so the routing lives in ONE place, `core/agent-session-name.ts`
  (`readAgentSessionName(sessionId, accountId?, agentId?, deps?)` — trailing/optional so every pre-grok
  caller is unchanged), serving the desktop IPC handler **and** both shells' session-name sweeps.
  Grok's read leg is `core/grok-session.ts` over `summary.json` in the session dir a hook told us
  about; gemini's is `pickGeminiTitle` (`core/gemini-session.ts`) over the transcript path its context
  tail already tracks — including the `$set` history a **resume** replays, which is exactly the case the
  read leg exists for. Routing is not cosmetic — claude's resolver _scans_ `~/.claude/projects` on a
  cache miss, so an unrouted grok/gemini node paid that scan every 60 s for a guaranteed null.
  **The sweep's gate lives in core, not in the shells:** `startSessionNameSweep` defaults `supports` to
  `supportsTitleRead` (`core/session-name-sweep.ts`) and neither shell passes it — the duplicated copies
  drifted, and reverting both to `canRename` left the whole suite green while silently skipping every
  gemini node.
  - **session → title (read, claude):** the authoritative name lives in the transcript `.jsonl`, not the
    OSC terminal title (`/rename` does **not** update OSC — a known Claude gap — so reading the
    file is the only thing that works after a **resume**). `main/transcript-reader.ts`
    `readSessionName(sessionId)` resolves the session file **strictly by sessionId** (no cwd
    fallback — that would make every Claude node in one folder resolve to the same newest transcript
    and adopt each other's names) and `pickSessionName` returns the latest `custom-title`'s
    `customTitle` (the `/rename` name) else the latest `ai-title`'s `aiTitle` (auto name). Exposed
    over `pty.readSessionName`. `TerminalNode` polls it (~4 s) **only once this node's own sessionId
    is known** and **while the title still auto-tracks** (`data.titleAuto`, default true on agent
    nodes), and adopts it as the `title`. `term.onTitleChange` now feeds the `session` chip only.
  - **title → session (write):** the moment the user renames the node by hand (header rename box /
    ✦ AI-name / sidebar / command palette → all funnel through `applyManualTitle` or
    `renameSession`), `titleAuto` flips to **false** (polling stops overwriting) and the chosen name
    is pushed into the live session as `/rename <name>` via `pty.sendText` (tmux `send-keys`, same
    one-way bridge as Branch's `/branch`; works whether or not the node is mounted).
  - The launch command is left bare (no `-n`) — Claude's own name is canonical until the user
    overrides it; `titleAuto` is persisted so an overridden name survives reload/resume.
- **Search** — the command palette (⌘K) matches the session name + tags + `nt-<id>` in the
  hint, and substring-searches each terminal's **visible buffer** (captured via `pty.capture`
  on palette open, cached ~3s); content matches show "found in output".
- **⌘M transcript view (`ChatPanel`) — resolution is three-legged, and each leg fails differently.**
  `chat.readTranscript(sessionId, cwd, accountId, nodeId)` returns `ChatTranscriptResult
{messages, found}`, NOT a bare array: an empty thread and an unresolvable transcript are
  different facts, and rendering both as "No conversation yet." is what made every failure below
  look like an empty session. (1) **Remote (SSH) nodes** — `remoteTranscriptBySession` is fed
  ONLY by hook POSTs, and a tmux session outlives the app, so after a restart an idle remote node
  has no ref and the local resolvers search the WRONG MACHINE. `remoteTranscriptRefFor` (main)
  therefore asks the host itself: the pure `core/remote-transcript-locate.ts` builds one `sh` line
  (exact `<root>/<encoded cwd>/<id>.jsonl` per root, then a glob; account root before the system
  one; `*` outside the quotes; **exits 0 on a clean miss** — "no transcript" is an answer, not a
  failed ssh), it runs over the ControlMaster, and the reply is jailed by
  `isSafeRemoteTranscriptPath` before it is read. A ref WE located is tracked in
  `locatedTranscriptSessions` so a dead one can be dropped on an empty read (the panel's Retry
  would otherwise replay it forever) — a HOOK-fed ref is never dropped that way, since an empty
  read there is usually a transient master hiccup and forgetting it sends the next read local.
  It is generated shell, so `remote-transcript-locate.test.ts` runs it for real through
  `core/testing/posix-shell.ts` against a fake host tree, including spaces/apostrophes and Git Bash
  path translation on Windows — keep it that way. (2) **The cwd fallback keeps `accountId`** in BOTH
  `resolveTranscript` and `contextEnsure`; without it a managed-account node fell back to the
  system root and could adopt an unrelated session's newest transcript. (3) **Relay tabs** stay
  local-only (a transcript read over the relay would read the GUEST's disk) and reject with
  `E_UNSUPPORTED`; ChatPanel catches it and says so instead of leaving the initial `[]` on screen
  as an empty conversation. Same `nodeId` rides `claude.readTranscript`, so the find-bar searches
  a remote node's transcript too.
  **Both channels live in `core/transcript-ipc.ts` (`registerTranscriptIpc`), so the Server
  Edition serves them too** — it used to have no handler at all, which is why ⌘M in the browser
  read as an empty conversation on EVERY session. The remote leg is an injected dep
  (`readRemote` — `null` = "not a remote session"): `src/main` supplies it, the server passes
  none, which is complete there because it runs ON the host whose transcripts it reads. The
  server registers it in `src/server/index.ts` right after `wireAgentStatus` (which now returns
  its `contextTail`, the hook-fed path authority). The browser's real reader is
  `buildTranscriptApi` in ws-bridge — deliberately NOT folded into `buildClaudeApi`, which the
  relay shares and must not adopt it.
- **Subagent visualization** (agents in `SUBAGENT_CAPABLE`) — `subagent-start`/`subagent-end`
  normalized events (from Claude's `PreToolUse`/`PostToolUse` on tool `Agent`/`Task`, correlated
  by `tool_use_id`) drive a transient `state/agentNodes.ts` store. Claude launches subagents
  **async by default**: that PostToolUse is only a launch ack (`status:'async_launched'`), NOT the
  end — normalize keeps the card working, the transcript tail keeps streaming, and the real end is
  the `<task-notification>` queued into the parent transcript (sniffed by the context tails →
  synthetic `subagent-end` in `index.ts`; the notification's `UserPromptSubmit` is also not a
  `newTurn`, so it doesn't clear the fan-out). Canvas renders each subagent
  as an **ephemeral** `SubagentNode` (display-only card: type + task + working/done) connected by
  an **edge** to its parent agent node. These ephemeral nodes/edges live outside the React Flow
  `nodes` state (merged only at the `<ReactFlow>` prop), so they're never persisted
  (`flowToNodeStates`) nor in undo/dirty. Fan-out is cleared on the next new turn / session-end /
  node close. (Subagents share the parent's process — no PTY.) Each card shows
  duration/tokens/tool-uses and **expands** (click) to a **live transcript**:
  `main/subagent-tail.ts` resolves the subagent's own transcript file
  (`<…>/<sessionId>/subagents/agent-<id>.jsonl`, matched by `tool_use_id` via the sibling
  `.meta.json`), tails it read-only, formats each line (assistant text + tool calls + results),
  and streams chunks over `agent:subagent-activity` into the store.
- **/loop, /schedule & /cron node** (agents in `RECURRING_CAPABLE`) — detected from the **tools**
  the agent invokes (robust; users often phrase it in natural language so the prompt rarely starts
  with the slash): `PreToolUse` for `Skill` (skill ∈ loop/schedule/cron), `CronCreate` (→ cron,
  label = cron expr · prompt), or `ScheduleWakeup` (→ loop) — plus a `UserPromptSubmit`
  `/loop|/schedule|/cron` prompt-prefix fallback, all surfaced as `recurring` normalized events.
  Sets `agentStatus.loop` ({count, prompt, items, kind}); for in-session `loop` each turn-done
  bumps the count + appends `lastMessage` (schedule/cron run in the background, so they aren't
  counted). Lifetime by kind: `loop` dies with its session; `cron`/`schedule` **outlive turns,
  sessions and app restarts** (`loop` is persisted in the agentStatus localStorage) and are
  cleared by a `CronDelete` `recurring`-end event or the card's own × (dismisses the card only).
  `clearForParent` (new turn) leaves the loop card's dragged position alone. Renders an ephemeral
  **LoopNode** labelled by kind, connected by an edge to the parent, plus a small header badge.
- **Branch conversation** — node action (`IconBranch`, Claude-only via `BRANCH_CAPABLE`): sends `/branch` into the
  existing terminal via `pty.sendText` (tmux `send-keys`) and opens a new Claude node that
  resumes the parked original with `claude --settings … -r <ORIGINAL_ID>`. The original id is
  the session id already known from hooks; `lib/claudeBranch.ts` is the fallback that parses
  `pty.capture` output when the id isn't known. The source node stays on the new branch.
- **Canvas control (manage-nodeterm-canvas)** — agents in `CANVAS_CONTROL_CAPABLE`
  (claude/codex/gemini/opencode/grok) can create/organize/control canvas nodes from inside their
  session: a POSIX **sh+curl** shim (`nodeterm.sh`, `CONTROL_SHIM_SCRIPT` in
  `main/canvas-control-core.ts` — the Electron-as-Node CLI is retired) POSTs
  **form-urlencoded** (`nodeId` + `arg.<flag>` fields; `curl --data-urlencode` is the only
  escaping sh can be trusted with — `parseControlBody` reads both this and the JSON dialect) to
  the hook server's `/control/<verb>` routes; `Accept: text/plain` makes the server render the
  reply (sh has no JSON parser). Env-gated on `NODETERM_CANVAS_CONTROL` (set by
  `buildPtyEnv`/`remoteHookEnvArgs` per `canControlCanvas`). Discovery: claude gets a
  `skills/manage-nodeterm-canvas/SKILL.md` (system `~/.claude` + each managed account dir);
  codex/gemini/opencode get a marker block (`<!-- nodeterm:manage-canvas:start/end -->`); **grok needs
  no installer at all** — it scans `~/.claude/skills` by default for Claude compat, so membership alone
  (which sets `NODETERM_CANVAS_CONTROL`) is the whole wiring. That premise rests on grok's shipped
  docs and is **unverified** (`grok inspect --json` never run); if it does not hold, grok takes the
  marker-block route instead — see docs/grok-agent.md.
  **SSH projects** (docs/ssh-agent-skills.md): the SAME shim + skill + blocks are installed on
  the remote host at connect (`RemoteHooks.installCanvasControl` + per-account
  `installCanvasSkillIntoAccountDir`), gated on the VERIFIED reverse hook tunnel — the shim
  carries no machine-specific paths and POSTs through the tunnel's unix socket, so remote agents
  control the desktop's canvas. The shim is generated source no compiler checks:
  `canvas-control-shim.test.ts` runs it for real (/bin/sh against a real hook server, port AND
  unix-socket transports) — keep it that way.
  **Flag syntax**: `--flag value`, `--flag=value`, or a valueless flag anywhere on the line. The
  shim used to consume the next token after any `--flag` _unconditionally_, so `--read --node b1`
  became `arg.read=--node` with `b1` silently dropped and the server answering about the wrong
  flag; it now peeks. The trade: a value that itself starts with `--` must use the `=` form
  (`--cmd=--version`), which was previously unexpressible in either direction. Two parsers are in
  play and both are tested — the sh loop (`control-shim-parse.test.ts`, real `sh` + a fake `curl`
  that records argv) and `parseControlBody` reading what it built (`canvas-control-shim.test.ts`).
  **A new verb must not DEPEND on the fix**: the shim is rewritten locally every app boot but onto
  an SSH host only inside `RemoteHooks.setup()` (on connect), so an already-connected project keeps
  the old loop with no signal on the wire. Give every flag a value and both loops agree.
  **Grouping verbs** (`group` / `ungroup` / `move` / `arrange` / `align`): `group` wraps **sibling**
  objects — nodes or frames — into a new frame in their shared container (a mixed-container set, or
  an ancestor plus its descendant, is refused with that reason); `ungroup --group <id>` dissolves a
  frame, promoting its direct children into the frame's own parent (nodes kept); `move
--nodes <id,id> [--group <id>]` reparents nodes OR whole frame subtrees INTO a frame (or
  `top`/`none`/omit → out to top level) via `reparentNode` — the ONE way to move a node between
  frames, which `group` won't do; a cycle (a frame into itself or its own descendant) is refused.
  `arrange`/`align` now run in ONE coordinate space: all top-level, OR all children of one frame
  (`commonParentId` decides; a mixed set is refused, not silently subset-arranged — the old
  behavior). When the ids are a frame's children, the frame is shrunk to hug the tidied layout
  (`fitGroupToChildren`) — the fix for "grouping keeps scattered positions so the frame is too
  wide". `move` also re-fits the source + destination frames. All pure + tested in
  `state/workspace.test.ts` + `workspace.layout.test.ts`.
  **Fan-in (`link`, 2026-07):** a spawned fan-out was previously write-only — nodes an agent
  opened were joined to it by a **rope** (`project.ropes`, explicitly _"Display-only — never
  context links"_), so an orchestrator could not read back what its own team produced and the
  skill told it to have the USER relay results. Now `open-claude`/`open-agent`/`spawn-team` also
  draw a real **context bridge** (`project.bridges`) to each agent session they open, and the
  `link --to <id,id> [--from <id>]` verb links nodes the agent did not open (or two other nodes).
  The rope stays — the two edges mean different things (lineage vs readable context) and a
  non-context-capable target still gets only the rope. Deliberately **silent**: the manual
  `onConnect` path pushes a discovery note into both endpoints, but doing that per team member
  would inject a prompt into every session an agent just spawned — the exact intrusion that push
  was reverted for. Links are pull-based, so nothing is lost. The refusal matrix is the pure
  `planBridges` (`renderer/lib/noteLink.ts`, unit-tested); Canvas only wraps it in setState.
  Callers that create and link nodes **in the same tick** must pass their own `lookup` — `setNodes`
  is async, so resolving fresh nodes off `nodesRef` would skip every one as "no such node".
  **Dependency edges (`--after`, 2026-07):** `open-terminal`/`open-claude`/`open-agent` accept
  `--after <id,id>`, which opens the node **armed** — `data.pendingLaunch` ({after, command},
  `PendingLaunch` in shared/types) holds the launch the factory built, and Canvas fires it once
  every dep reports `done`. This is what makes the canvas a DAG instead of a fan-out. Load-bearing
  details: (1) **an unknown agent state is NOT "satisfied"** — right after a fan-out no upstream has
  emitted a hook event yet, and reading "no news" as "finished" would fire every dependent
  instantly; a **deleted** dep IS satisfied (it can never report). (2) Only `hasHooks` agents may be
  waited on — a plain terminal never reports done, so `resolveAfter` **refuses** it rather than
  letting `launchesToFire` (which cannot tell "never will" from "not yet") hang the node forever.
  (3) If the deps are **already satisfied at creation**, the node is NOT armed: the command stays
  `initialCommand` so the node's own mount path delivers it through `writeWhenShellReady` —
  arming would hand delivery to the canvas effect, which races the node's PTY into existence.
  (4) Delivery is **exactly-once via `launchInFlight`** (an id stays in the set forever once
  `sendText` resolved true — clearing `pendingLaunch` is a state update that can lag a re-render),
  and a **refused** `sendText` retries (`LAUNCH_DELIVERY_ATTEMPTS`) instead of vanishing.
  (5) `pendingLaunch` **is persisted** (unlike `initialCommand`), but agent state is not — so after
  a restart nothing will ever report `done` and the node carries a manual ▶ **run-now** escape in
  its QUEUED badge. (6) Canvas subscribes to `armedDepSig`, NOT `useAgentStatus(s => s.byId)` —
  the same discipline as `loopSig`; the full map re-renders the canvas on every hook event.
  Pure logic + refusal matrix in `renderer/lib/pendingLaunch.ts` (unit-tested); the dashed dep→node
  edges are **derived, never persisted** (a pending dependency is a state that ends when the launch
  fires — the durable relation is the context bridge `--after` also draws).
  **Review panel (`verify`, 2026-07):** `verify --node <id> [--lenses …] [--focus …] [--agent …]
[--synthesis off]` opens one reviewer per LENS, each armed behind the target (`--after`) and
  bridged to it, wrapped in a `Verify: <title>` group, plus a judge armed behind the whole panel.
  It is **composition, not new machinery** — the two primitives above are the whole implementation.
  Prompt/lens logic is the pure, unit-tested `renderer/lib/verifyPanel.ts`; two wordings there are
  load-bearing and must not be "tightened away": reviewers are told **not to edit** (a panel is N
  agents pointed at ONE checkout — review and repair are different jobs, and only repair needs
  worktree isolation) and are explicitly **licensed to find nothing** (a reviewer under implicit
  pressure to produce findings invents them, and an invented finding costs someone else the time to
  disprove it). Unknown lens words are **kept** with a generic brief, not rejected — a table that
  only accepts what it already knows would be useless for the review nobody anticipated. Reviewers
  inherit the TARGET's `accountId` (its transcript resolves inside that account dir), not the
  caller's. The judge is armed on ids that exist only in that tick, which is why `armAfter` takes
  `extraLive` — without it the reviewers would look _deleted_, deletion counts as satisfied, and
  the judge would fire before a single review existed.
- **Context Link** — a node action gated by `CONTEXT_LINK_CAPABLE` (claude/codex/gemini/opencode;
  **grok**, custom agents + plain terminals excluded — grok's `updates.jsonl` parser is unbuilt): drawing an edge between two builtin-agent nodes lets each
  READ the other's context on demand (pull, not push). Architecture (2026-07, SSH-capable — see
  docs/ssh-agent-skills.md): the **desktop does the reading AND the parsing**; the CLI the agent
  runs (`context.sh`) is a thin POSIX **sh+curl** shim that POSTs to the hook server's
  `/context-link/<verb>` route and prints the text/plain reply (the Electron-as-Node CLI is
  retired — its embedded-JS parser now lives as tested TS in `core/context-link-render.ts`:
  parsers for **all four** formats — claude JSONL / codex rollout / gemini event-sourced chat /
  opencode export — plus `renderContextLink` over injected fetchers). `src/core/context-link.ts`
  holds the link docs in memory (per-node files under `<userData>/context-links/` remain as a
  debug aid), carries per-entry `agentId`/`sessionId`/`accountId`, and answers the route;
  **authorization** = the doc is selected by the REQUESTER's node id, so a token-holding caller
  can only read nodes in its own (directional) link map. Codex/gemini paths resolve via the
  handoff locators (`locateCodex`/`locateGemini` by sessionId); claude keeps the hook-fed path +
  `locateClaude(sessionId, accountId)` fallback (cwd-newest is claude-only); Canvas rewrites link
  files when a linked node's sessionId appears (`linkSessionSig`). **SSH projects:** the shim +
  skill are installed on the remote host at connect (`RemoteHooks.installContextLink`, gated on
  the VERIFIED reverse hook tunnel; POSTs ride `--unix-socket` through it); a remote node's
  transcript is read over the ControlMaster (`initContextLink(ptyManager, deps)` — `src/main`
  injects `isRemoteNode`/`readRemoteFile`/`runRemoteCommand`, bounded tail reads), its hook-fed
  path is jailed at ingest (`isSafeRemoteTranscriptPath`), and `resolveLinkTranscript` REFUSES
  the local locators for remote nodes (they'd resolve a stranger's local transcript). Server
  Edition passes no deps → local-only (context link is NOT wired there at all — `initContextLink`
  is never called from `src/server`). Discovery is per-agent: claude installs a
  `get-linked-context` skill; codex/gemini get an idempotent marker block
  (`<!-- nodeterm:get-linked-context:start/end -->`) merged into `~/.codex/AGENTS.md` /
  `~/.gemini/GEMINI.md`. On connect an idle-gated one-line note is injected into each endpoint
  (claude → skill pointer; codex/gemini → inline CLI command via `contextLink.info()`).
  (Replaced the earlier MCP-based bridge.)
  **Note links:** a sticky note can be connected to ANY terminal node (one-way, sticky →
  terminal). On connect, agent sessions get a one-shot idle-gated push of the note text
  (`buildNotePushMessage`, single-line, truncated at 2000 chars); plain terminals get no
  push (sendText appends Enter — the text would execute). The note's live text also rides
  the link file (`ContextLinkInfo.note`), so Claude reads the current text via the
  get-linked-context CLI (`summary`/`transcript` print it; `list` marks `(note)`). Pure
  edge/push/map logic in `renderer/lib/noteLink.ts`.
- **Managed Claude accounts** (Claude-only) — run several logged-in Claude identities side by
  side by giving each its own config dir. `settings.claudeAccounts` is a list of `ClaudeAccount
{id, label, email?, host?, pending?, createdAt}` (in `settings.json`; the account **list** is
  config, not credentials). Isolation is **config-dir**, not token storage: a local account's dir
  is `{userData}/claude-accounts/<id>` (`claudeConfigDirFor` / pure `localAccountConfigDir`),
  a **remote** account's is `~/.nodeterm/claude-accounts/<id>` on its `host` (keyed by
  `sshHostKey` = `user@host`; `remoteAccountConfigDir` is `~`-relative for ssh expansion,
  `remoteAccountConfigDirAbs` resolves it against the connection's `remoteHome`). The **claude
  CLI owns login, credential storage, and token refresh** inside that dir — the app NEVER writes
  credentials. On macOS this works because Claude Code **≥ 2.1** scopes its Keychain service per
  config dir (`Claude Code-credentials-<sha256(configDir)[:8]>`, `claudeKeychainService`); on
  < 2.1 one unscoped service is shared → accounts collide, so add-account **warns** (`claude
--version`, `isSupportedClaudeVersion`).
  - **`data.accountId` (terminal nodes)** — resolved **once at node creation**
    (`resolveNewNodeAccount`: explicit submenu pick → `project.defaultAccountId` → system default
    `~/.claude`), then **immutable** and **persisted** (serializers). `undefined` = system default
    = **bit-for-bit legacy behavior** (no env touched). Inherited by **Branch** (the
    terminal→chat fork it also fed is gone — the SDK chat node was removed 2026-07). A pending
    (not-yet-logged-in) account resolves to `undefined` until it completes.
  - **Env injection** — `pty-manager` sets `CLAUDE_CONFIG_DIR` in the spawn env AND as a tmux `-e`
    (local); for a remote node it emits an **absolute-path** remote tmux `-e` built from the
    connection-cached `remoteHome` (skipped **fail-open** if home is unresolved). `AUTH_ENV_STRIP`
    (`ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `CLAUDE_CODE_OAUTH_TOKEN`) is deleted from the
    child env so a stray env key can't shadow the account. A **missing** account dir → warn +
    silent system fallback.
  - **Login flow** — Settings → Accounts → **Add** creates a `pending` account and drops a canvas
    **login node** that runs `claude /login` under the account dir. Main polls the dir's
    `.claude.json` (`LOGIN_POLL_MS` 2 s, up to `LOGIN_TIMEOUT_MS` 5 min) for `oauthAccount.email`;
    on capture the account flips out of `pending` with its email as the default label. Account
    removal cancels any pending wait + `markDirty`.
  - **Hook install** — the managed hook is merged into **each account dir's** `settings.json` at
    add-account **and** at app launch (local, shared `install-helper.ts`) / via
    `RemoteHooks.installIntoAccountDir` (remote), so every identity reports agent status.
  - **Account-aware readers** — transcript resolution is scoped per account (`transcriptRootFor`
    picks the account dir's `projects/`, composite cache key includes `accountId`); the same
    threading runs through the session-name poll, restart handoff, and `ChatPanel` (the ⌘M
    transcript view, `chat.readTranscript`). The **usage indicator** is per account (`claude-usage.ts`: scoped Keychain
    service first, legacy unscoped fallback; popover lists a row per account with **System**
    first). **Remote (SSH host) accounts are included** — see **Remote usage** below.
  - **Pickers** — New Claude exposes an account **submenu** (pane menu; flat entries in
    the dock; palette commands; TabBar sets the **per-project default**). A **local** project
    lists local accounts, an **SSH** project lists only accounts whose `host` matches its
    connection; both offer a **System account** option. An SSH project whose host has **no**
    matching accounts gets a disabled hint row instead of a bare System-only list
    (`sshAccountsHint` — pane submenu, dock, TabBar; the palette deliberately omits it: a
    disabled row would surface as a search result) saying accounts for this host are added in
    Settings → Accounts while the project is connected — local accounts being invisible there is
    correct (their credentials aren't on the host) but read as "multi-account is broken on SSH".
  - **Remote accounts** — selection + login + env injection, plus **usage** (below); no
    per-account transcript readers beyond env.

- **The usage indicator is scoped to the ACTIVE project** (`renderer/lib/usageScope.ts`, pure +
  unit-tested) — it describes **the machine that project runs on**, and nothing else. A local
  project shows this machine (system + managed local accounts + the billing providers, whose
  credentials are all local); an **SSH project shows only that host's Claude accounts** — no local
  Claude, no local providers, no other host. Without this the panel showed every source at once:
  each addition was individually reasonable and the sum was unreadable, numbers from three
  machines sharing one line with nothing saying which was which. Deliberately NOT narrowed to the
  project's `defaultAccountId`: the local side lists every local identity, so the machine is the
  scope and the account is a row within it. The pill spells out the scoped machine's **system**
  account (falling back to the first identity with data, so a host used only through a managed
  login isn't blank), managed accounts stay popover-only — the rule the local side always had.
  `usageScopeKey`/`scopeFromKey` exist because the active project object is rebuilt on every node
  serialization: the zustand selector returns ONE primitive so the indicator doesn't re-render on
  every canvas edit. ⟳ refreshes only what is on screen, and `usage.remote({hostKey})` reads only
  that host (cache eviction still runs against the FULL target list, so switching between two SSH
  projects doesn't throw each host's cache away).

- **Remote usage** (SSH hosts, `src/core/usage/remote-claude-usage.ts`) — the source behind the
  SSH scope above. v1 excluded remote accounts, which left a user whose Claude only ever runs on a
  server staring at an empty indicator while the host had perfectly good numbers.
  **The token never leaves the host.** The desktop could `cat` the remote `.credentials.json` and
  call the API itself — it already reads remote transcripts over the same master — but a bearer
  token pulled off a (possibly shared) server into another machine's memory buys nothing: the host
  can make the request itself. So core generates a POSIX **sh+curl** command, the shell runs it
  over the project's ControlMaster, and only the JSON answer comes back. Three details are
  load-bearing:
  1. **The token is piped into `curl --config -`, never `-H` on the command line** — argv is
     world-readable via `ps` on a shared host.
  2. **`.credentials.json` holds more than one `accessToken`** — every MCP server the CLI has
     authorized keeps its own under `mcpOAuth`. The extraction narrows to the `claudeAiOauth`
     object first (exactly as the local `parseCreds` does), because grabbing the file's first match
     sends an MCP token to the endpoint, earns a 401, and reports a signed-in host as signed out.
     Caught only by running the command against a REAL credentials file — which is why
     `remote-claude-usage.test.ts` runs the generated script under a real `/bin/sh` against a fake
     `$HOME` + fake `curl`, the same discipline as the canvas-control shim.
  3. **A read that could not run is `error`, never `unavailable`** — a dead master says nothing
     about whether the account has a subscription, and 'unavailable' silently drops the row.
     Shape: `remoteUsageTargets` (pure) elects ONE connected project per host (several projects share
     a host's `$HOME`) and offers its system `~/.claude` plus every managed account pinned to that
     host. The service (`usage:remote`) caches per target under the usual debounce, evicts targets
     whose host disconnected, and coalesces concurrent reads. **On demand, never polled** — each row
     is an ssh exec plus an HTTPS request on someone else's machine; the renderer asks on mount, on
     popover open, on ⟳, and when the active project's connection comes up (an SSH project is opened
     before its master is ready). Deps are injected exactly like
     Context Link's (`src/main` supplies the ControlMaster; **Server Edition passes none** ⇒ `[]`, so
     the UI needs no capability check). Own Settings switch (`claude-remote`), because hiding local
     Claude usage must not silently take the hosts down with it. **Mobile: N/A** — the
     slice pushed to a host still drops `usage` (a host reading its own numbers back off us is
     pointless), and no keychain leg exists remotely (a headless macOS host would hang on the prompt,
     so a mac host reports nothing).

### Adding a new agent (or a new model) — what to watch out for

Every rule below is a mistake the grok branch or the codex/gemini-parity branch **actually made**, and
each one cost a review round or shipped a wrong number to the user. Read the concrete failure, not the
principle. Per-agent write-ups: `docs/grok-agent.md`, `docs/gemini-agent.md`.

**The mechanism**

1. **A capability is a membership list plus ONE leaf.** Add the id to the list in
   `src/shared/agents/config.ts`, write the one per-agent thing that list gates (a normalizer, a
   reader, a table row), and every consumer lights up — the whole point of the design. What you must
   never do is fork behavior at a call site with `=== 'claude'`; ask through the helper.
2. **Ask what ELSE the list gates before joining it.** `hasUsage` gated **three** features, not one.
   Joining `USAGE_CAPABLE` for the context meter also switched on `context.ensure` and the find bar's
   transcript index, both of which resolve through _claude's_ `resolveTranscript` — whose **cwd
   fallback** then handed a codex node **the newest claude transcript for that cwd**: a stranger's
   session as its meter (wrong numerator _and_ denominator, flapping against the correct tail) and that
   session's messages as its search hits. Preconditions were default-true, so it would have shipped.
   The fix was a new pure predicate (`readsClaudeTranscript`) reusing an existing list, not a fourth
   list meaning the same thing. **Grep every consumer of the helper before you add an id to its list.**
3. **A read leg and a write leg are different facts, and may need different lists.** Gemini names its
   own sessions but has **no rename command**, so `TITLE_READ_CAPABLE` (read) split from
   `RENAME_CAPABLE` (write), with `read ⊇ write` pinned as an invariant. One list would have lit the
   rename UI on a node where the write silently does nothing — the worst kind of feature, one that
   looks like it worked.
4. **State Desktop / Server Edition / Mobile for the capability, even when the answer is "N/A".**
   Put the logic in `src/core` behind `CorePlatform` or the Server Edition silently doesn't have it,
   and give `window.nodeTerminal` a REAL bridge implementation or a documented degrade — a `noop` stub
   compiles fine while doing nothing. (Live example: the session-title READ has no server handler at
   all, so it is stubbed for **claude too** — a pre-existing gap that keeps being rediscovered per
   agent.)

**Measuring the CLI**

5. **Measure the CLI; do not assume claude's shape.** Three real bugs, all from assuming:
   - grok's `--` is **end-of-options**, so a flag appended _after_ the prompt separator is a
     positional — silently swallowed into the prompt, or a clap usage error that kills the launch.
     Where the flag lands is decided at the **composed** layer (`createAgentNode`); a
     `withPermissionMode` unit test passes while the composed line is wrong.
   - codex's `total_token_usage` is **CUMULATIVE**, not the live context: against its own window it
     rendered a 13%-full session at **79%** and would have crossed 100% two turns later. The right
     field is `last_token_usage`.
   - `cached` tokens are **INSIDE** `input` for codex and gemini, and **OUTSIDE** it for claude (whose
     reader therefore sums them). Copying claude's formula double-counts. **Do not unify the
     formulas.**
6. **Prefer the agent's own stated number over one you infer.** Codex prints
   `model_context_window` right beside its usage — use it. When there is none, mirror the CLI's own
   resolver rather than building a per-model allowlist: gemini's `tokenLimit()` is a family rule with
   a **1M catch-all default**, so an unreleased model gets the _right_ answer where an allowlist would
   be confidently wrong, silently. **And if you cannot establish a trustworthy denominator, ship no
   meter** — a percentage over a guessed window is a wrong number presented as a fact (this is exactly
   why grok has no meter).
7. **A closed set beats a substring, for notification/event types.** Grok's
   `type.includes('permission')` matched a notification grok fires before _every_ tool call, so a
   working node strobed NEEDS YOU: unread dot + chime + OS notification + phone inbox card, per tool
   call. Gemini is matched `=== 'ToolPermission'` and stays quiet on an unknown type. A badge stuck on
   a finished node has no later hook to clear it, so widening "to be safe" is the unsafe direction.
8. **"Supports" can be as dishonest as "doesn't support."** Codex claimed `manual` / "Ask each time"
   while emitting **no flag** — but its built-in default is `OnRequest` ("the model decides when to
   ask"), so two dropdown entries collapsed onto one behavior under a label that promised otherwise.
   Rule: a mode the CLI cannot express emits **no flag** (never a substituted nearest match), and a
   mode it _can_ express must actually emit it. Derive the UI copy from the mapping
   (`unsupportedModesNote`, `permissionModeAgentIds`) so a sentence cannot drift from the table.
   **The nearest match is most dangerous on the DEFAULT mode:** gemini has no value for `auto`, and
   `auto` is `DEFAULT_PERMISSION_MODE`, so translating it to `auto_edit` ("auto-approve edit tools")
   would have widened permissions for every existing gemini node at upgrade, with `modeSupported`
   answering `true` so the derived copy stayed silent. Check what an UNTOUCHED setting emits before
   you accept any mapping.
9. **A capability gate that is fed by a version probe belongs to the agent it probes.** Claude's
   `auto` gate is fed by `claude --version`; applying it to any other agent downgrades that agent's
   sessions on a machine whose _claude_ is old or absent. `activePermissionMode` gates only
   `'claude'`, and every hint string names Claude for the same reason. An agent needing its own gate
   adds one beside claude's.

**Not writing the same rule twice**

10. **A duplicated rule drifts, and this branch was bitten three times.** The remote installer's hook
    event lists (it subscribed gemini to _claude's_ event names, so remote gemini reported nothing at
    all), grok's raw-listener field decoding, and the two shells' session-name sweep gates (reverting
    both to `canRename` left the entire suite **green** while silently skipping every gemini node).
    The fix each time was **one definition in `src/core`** consumed by both shells — a default inside
    core beats an argument each shell passes correctly today.
11. **Both shells' raw hook listeners must stay in parity** (`src/main/index.ts`,
    `src/server/agent-status.ts`). If you add a branch to one, add it to the other or write down why
    not (the desktop's extra skip for remote SSH nodes is a legitimate asymmetry: the server has no
    SSH-project manager).
12. **Widen the transcript-path jail per ROOT, never to `$HOME`.** Hook POSTs can arrive over the
    remote reverse tunnel, and `isSafeLocalTranscriptPath` exists so a forged one cannot aim a read at
    `~/.ssh/id_rsa`. Add the narrowest directory that holds the transcripts (`~/.gemini/tmp`,
    `<codexHome>/sessions`) and honor the agent's own relocation env var — getting that wrong fails
    **closed** (the meter silently never fills), which is the quieter and therefore worse failure.
13. **Re-validate a hand-editable value at the interpolation site, not by its type.** Modes come from
    git-shared JSON and end up on a tmux `send-keys` line. A table lookup guarded only by
    `mode in table` accepted a forged `constructor` and returned a **Function** headed for that
    command line; `isPermissionMode` at the top of `approvalFlags` is what closes it. Same rule as
    `SAFE_SESSION_ID`. An unrecognized value must yield the **bare, safe** command.

**Degrading, and admitting what you did not measure**

14. **A guess must degrade to nothing, never to something wrong.** A title reader that cannot resolve
    returns `null` (the node keeps its own name); an unknown notification type is a no-op; a failed
    probe means the bare command, never a blocked launch. Say in the code which facts are _composed_
    rather than captured (gemini's resumed-transcript shape is) and what the wrong-guess cost is.
15. **Kill the "in place" actions carefully.** An exit sequence must be the CLI's documented primary
    and **bare**: gemini's `/quit` also takes `--delete`, which exits _and permanently deletes the
    session history_ — the very conversation the restart exists to resume. It has its own test.
    Refuse the restart while the node is `working` **or** `blocked`: an exit line typed into a
    permission prompt **answers** it.
16. **Write the device checklist for what you could not run.** Every unverified claim becomes a
    numbered item; group the ones that fall out of a single capture run. `docs/grok-agent.md` §9 and
    `docs/gemini-agent.md` §9 are the format.

## Session memory (the RAM pill + the per-session panel)

A bottom-left **RAM pill** (`components/SystemResourcePill.tsx`) beside the usage pill, and the
**session-memory panel** it opens (`components/SessionMemoryPanel.tsx`): used/total RAM of the
machine the **active project** runs on, and every `nt-*` tmux session on that machine sorted by the
memory its whole process TREE holds, each row travelable (`goToNode`) and killable. Scope is
`usageScopeKey` — the same helper the usage indicator uses, so the two pills can never disagree
about which machine they describe. Reading + parsing is `core/session-memory.ts` (this machine) and
`core/session-memory-remote.ts` (an SSH project's host), served over one RPC by
`core/session-memory-service.ts`, which BOTH shells boot. Full write-up + the device checklist:
**`docs/session-memory.md`**.

- **The memory is the agent CLI's own V8 heap — nodeterm does not allocate it, and it is not a
  leak.** Measured on the production host that prompted this (64 GB, 95 live `claude` processes): a
  `claude` process alone averages **335 MB** and peaked at **1159 MB**; 95 of them held **31.1 GB**;
  MCP children add 30–200 MB per session (playwright-mcp + Chrome ≈ 200 MB alone), so one "Claude
  terminal" tree is **440 MB – 1.2 GB**. `RssAnon` is essentially all of the RSS (1165 MB of 1187 MB
  on the largest process) and the repo sets no `NODE_OPTIONS`, so V8 sizes its heap off system RAM
  (`heap_size_limit` 4144 MB there). It is flat with process age — 0–24 h avg **340 MB** vs 7 day+
  avg **326 MB** — so each process takes a baseline and never returns it. **Write those numbers down
  rather than re-deriving them.** The user's number was right and their attribution was wrong; what
  the product was missing was not the allocation but the **blindness** — nothing told them 18
  sessions were live, that one was 1.2 GB, or that six belonged to a project they closed weeks ago.
- **The reaper no longer treats attachment as protection, and this paragraph used to say it did.**
  When the session-memory panel was built, `core/session-budget.ts` reaped only **detached**
  sessions past a grace window — which is why its kill list on that host was **EMPTY**: 60 `nt-`
  sessions, 50 attached, 0 eligible, while 31 GB sat there. That rule has since been removed on
  purpose (read the module header): measured on the multi-tenant host, **54 of 54** sessions
  reported `attached=1` and `planReap` returned `[]` on every sweep it had ever run, because tmux
  "attached" only means a mounted node exists on some canvas — not that anyone is looking. Activity
  staleness now carries the protection alone, which is why the grace window defaults to a **day**
  rather than the 6 h that was safe while attachment was also required. So an idle session IS
  reaped while attached, ours or somebody else's (`session-budget.test.ts`: "reaps an idle session
  even while attached (attachment is not a signal)"). What this feature adds is still **sight**,
  not policy — but do not read this paragraph as a promise that an attached session is safe.
- **`ok:false` is not `ok:true` with no rows** — the rule the whole feature exists to honour, and
  every layer preserves it. A sweep fails (no tmux, unreadable process table, **no socket answered**,
  a missing or out-of-order marker in the SSH reply, a rejected call) ⇒ `ok:false` and no rows; the
  panel then says "Could not measure sessions on this machine", and the grand total and the "_n_
  sessions" count are gated on a `measured` flag so a failure can never render as `0 B / 0 sessions`.
  "We looked and there is nothing" is its own sentence. A socket with **no tmux server** is an
  ANSWER, not a failure (`isNoServerError`), and that classifier is **anchored to tmux's own connect
  message**: `promisify(execFile)` folds stderr into `err.message`, and a bare `no such file or
directory` also matches a tmux client missing a shared library (exit 127 on _every_ socket) and a
  dead ssh ControlMaster — laundering either into "no sessions here" prints an empty panel over 20
  live ones. **The SSH leg applies the SAME classifier to the same rule**: each socket is fenced in
  the reply with its tmux exit status and its stderr (`##SOCK <name>` … `##SOCKRC <n>`, `2>&1`), and
  zero answers ⇒ `ok:false`. Its first form threw both away (`{ tmux …; tmux …; } || true`), so a
  host whose tmux client could not start emitted a stream byte-identical to an idle host's and the
  panel reported thirty live sessions as "No sessions are running here.". Do not "simplify" the
  fence back out — and do not replace the classifier with a blunt "any error ⇒ ok:false" either: on
  a host with no tmux server at all EVERY socket fails, and there "there are no sessions" is the
  honest answer.
- **`readMemInfo` has exactly one home** (`core/session-memory.ts`); `session-budget.ts` imports and
  re-exports it. The reaper's watermark and the pill must never disagree about how much RAM is free,
  and a second copy is exactly the drift this file warns about elsewhere. `null` = could not read,
  never zero.
- **The local reader reads `/proc/<pid>/status`, never `statm`.** `status` carries `PPid` and `VmRSS`
  in one file, already in kB; `statm` reports RSS in **pages**, forcing a page-size assumption — a
  hard-coded 4096 under-reports **4×** on a 16 KiB-page arm64 kernel and **16×** on the 64 KiB-page
  enterprise arm64 builds (40 MB printed for a 640 MB session). **Do not optimise this back to
  `statm`.** Non-Linux falls through to one `ps -eo pid,ppid,rss` call, through the same injectable
  seam as tmux.
- **`childCount` counts ALL descendants**, the agent CLI included: `pane_pid` is the pane's SHELL, so
  a claude session with two MCP servers reports **3**. The UI therefore says "**child processes**",
  never "MCP" — a plain `npm run dev` has children too.
- **The cadence split follows the cost.** A **local** scope polls the pill's number every 30 s
  (`HOST_POLL_MS`, one file read, free). An **SSH** scope is **never polled**: one read on scope
  entry, one when that project's ControlMaster comes up (an SSH project is opened before its master
  is ready, and with no timer behind it a first read against a dead master leaves the pill blank),
  and one per panel open / `⟳`. Same rule this file already sets for **Remote usage**, for the same
  reason: every remote read is an ssh exec plus a `ps` of somebody else's whole process table. The
  full sweep runs on the panel's MOUNT (it is unmounted while closed) and on `⟳` — never on a timer,
  never from the pill.
- **The pill is the single owner of the store's `startHostPoll` / `stopHostPoll`** — the timer and the
  active-scope stamp are MODULE SINGLETONS. The panel must never call them: a `stopHostPoll` on
  unmount would clear the pill's interval with nothing left to restart it, and the number would
  silently freeze until the next scope change.
- **A closed project is not an orphan.** `closeProject` keeps the project and its nodes on disk, so
  its sessions resolve to a real title and are labelled with their project; calling them orphans
  would invite the user to kill sessions they deliberately parked. `resolveSessionRows` is therefore
  fed EVERY project — filtering to the open tabs defeats the rule silently, from outside the file
  that states it. And **`orphan` is the distinguishing field, NOT `state === null`**: a plain
  terminal never enters the agent-status map, so deriving orphan-ness from a missing agent state
  would flag every one of them. Orphans are the point — they are what the reaper cannot see and no
  canvas can show.
- **On an SSH scope the kill routes over the ACTIVE project's master** (`lib/sessionKill.ts` →
  `sshProject.killSessions`), because `transport.destroy(nodeId)` reaches a remote session only
  through a LIVE local client carrying `sshRemote` — which an orphan has not, and neither has a node
  owned by a non-active project. Before this, every orphan row's `×` on an SSH project **promised a
  kill it could not perform**: the local socket was touched, the host's `nt-<id>` kept running, and
  the row came back on the next refresh unexplained. It is safe because it is a **round trip, not a
  lookup** — the row's `nodeId` is literally `session.slice('nt-')` from the sweep and `killSessions`
  maps it back through the same idempotent `sessionName()`, so the exact session name the sweep
  observed is killed on the host it observed it on (node ids are only per-launch unique, and nothing
  here rests on more). Ownership is re-resolved at click time, not taken from the row's stale
  `orphan` flag, so a node created since the sweep is not killed as an orphan.
- **The name and the host were never the hard part — the SOCKET was.** Two nodeterm tmux sockets
  live on one machine at once (`node-terminal` for a nodeterm running ON it, `nodeterm-rmt` for one
  SSH-ing INTO it) and the sweep lists **both**, while the kill targeted one — so every row off the
  other socket got "this stops its tmux session" and a kill that landed nowhere. Not exotic: a host
  running its own `nodeterm-server` while being SSH'd into is exactly that, and the local mirror
  (this machine's panel listing the `nodeterm-rmt` sessions another machine's nodeterm spawned here,
  all orphans locally) is the same shape. A kill that knows only a NAME therefore goes to **every
  socket that name could be on** (`KILL_TMUX_SOCKETS` → `remoteTmuxKillEverySocketArgs` /
  `localKillSockets`), which is safe because tmux's "can't find session" was already the ignored
  case, because the target is **exact** (`-t =nt-<id>`: without `=` tmux falls back to fnmatch then
  PREFIX matching on a miss, and `nt-…-1` is a prefix of `nt-…-12`, so a miss could kill a different
  session), and because the fan-out is **opt-in and asked for by exactly one caller**: it needs both
  "we do not know the socket" AND `everySocket` from the caller. The renderer makes that promise in
  the behavior-tested `destroySessionForScope` / `killRemoteSessionsForScope` dispatchers: every
  session-memory row widens both its local and remote kill, including a row that still owns a canvas
  node, while project deletion and ordinary node × omit the option entirely. The wire legs still
  demand a literal `true`. The sweep and the reaper keep their own copies of
  the socket list **on purpose**: for them the ORDER decides first-wins de-duplication, for a kill
  it means nothing.
- **The generated SSH shell is tested under a real POSIX shell** (`session-memory-remote.test.ts`
  against a fake host tree, using `core/testing/posix-shell.ts` so Windows runs it through Git Bash
  with native paths translated at the shell boundary; same discipline as `remote-claude-usage.test.ts` and
  `canvas-control-shim.test.ts`) — and it is not ceremony: the plan's own script said `echo ##MEM`,
  which prints an **EMPTY LINE** under POSIX sh (an unquoted `#` starts a word-initial comment) and
  would have made **every healthy host report `ok:false`**. The markers are quoted for that reason,
  every section header is printed unconditionally (a missing one means the stream was cut short, not
  that the host had nothing), and the socket names + `-F` format come from the shared constants so
  the two legs cannot look at different sockets.
- **Which machine answers** is decided in `session-memory-service.ts` by OR-ing two independent
  claims of remoteness — the renderer's `remote` flag and the shell's `isRemoteProject` — because a
  source that answers "no" while momentarily uninformed (index not loaded, master just dropped)
  would turn a remote query into a LOCAL sweep and publish this machine's sessions under the host's
  name. `sshScopePredicate` answers from **identity, not liveness** (`workspaceStore.sshProjectIds()`
  — a DISCONNECTED SSH project is still someone else's machine), OR-ed with the live masters. The
  `remote` option pair is deliberately asymmetric: `run` is optional, `isRemoteProject` is
  **required** — reading-without-knowing is a compile error.
- **Surfaces.** **Desktop**: full. **Server Edition**: the service runs and the ws-bridge has a REAL
  implementation, so the pill and panel describe the machine the server is served from; an SSH scope
  answers `ok:false` (no ControlMaster injected) and says so **by identity** via `sshScopePredicate`
  rather than trusting the renderer's flag — see docs/SERVER.md, including the silent dependency on
  the boot-time `workspaceStore.load()`. **Relay tabs**: the stub answers `ok:false` and the panel
  says session memory is not available there, which is a different story from a failure. **Kanban**:
  Canvas passes `overBoard={kanbanOpen}` (the same prop `UsageIndicator` takes), raising the pill to
  z 26 over the board's opaque 25, and an open panel to 60; with the board CLOSED the open panel
  still has to clear the sessions sidebar (z 12), which is the separate
  `.sysres-indicator:has(.sessmem-panel) { z-index: 13 }` — both `:has()` rules work only because
  the pill cluster is mounted OUTSIDE `<ReactFlow>`, whose wrapper's inline `z-index: 0` would trap
  any value inside it. **Mobile**: **N/A for v1** — _nodeterm
  mobile_ attaches to tmux sessions over the transport protocol and has no per-session host-memory
  concept; adding one means extending that protocol (follow-up in the iOS repo).

**Offscreen release makes the macOS reaper bug far more visible, and the two shipped days apart.**
A node released while offscreen detaches its PTY client — so it becomes a DETACHED tmux session and
joins the reaper's candidate pool once past the 6 h grace. On a Mac reading `os.freemem()` the
watermark was permanently tripped, so those sessions were culled on the next sweep. More automatic
detaching + an always-true pressure signal is why the symptom read as "my sessions keep
disappearing" rather than as an occasional cull. The `vm_stat` reader is what makes the pool safe
again; the grace window was never the thing that was wrong.

## Canvas interaction & panels (`Canvas.tsx` is the hub)

**A root-mounted drawer is outside the project-keyed `SessionProvider`, so context there is NOT
the active project's core.** `useSession()` at that level resolves the root/local session and
`window.nodeTerminal` is the viewer's preload; either one silently runs an otherwise-correct action
on the viewer when the selected tab is a relay project. Every core-bound global panel must resolve
through `useActiveSessionApi()` (or, outside React, `sessionForProject(activeProjectId)` /
`activeSessionApi()`) and keep that API through the whole operation. The file converter and Ollama
manager are the concrete tripwires: status reads, queued work, and destructive actions such as
model deletion all go through the active session. Their relay namespaces deliberately reject with
`E_UNSUPPORTED`, and the drawers render that refusal instead of retrying against local state.
Clipboard is the deliberate counterexample: it is app-global, so a relay tab still copies on the
viewer through the local clipboard bridge. Behavior tests need distinct local/relay spies; a test
with only one API cannot prove which machine an action reached.

**Server browser uploads have two deliberately different carriers.** `buildServerFilesApi` alone
adds `files.saveUploadBlob` and sends the browser-owned `File` directly as an authenticated
same-origin HTTP body. `buildFilesApi` must remain RPC because the relay API shares it; changing the
default builder to same-origin HTTP writes on the viewer. The raw path checks the shared 64 MiB
limit from `Blob.size` before fetch, while the server checks `Content-Length` and counts streamed
bytes again. Keep the WebSocket receiver at 8 MiB: a 7 MiB base64 message already exceeds that
frame, and increasing the socket cap weakens every multiplexed request. The server streams into a
private unique staging directory and publishes only after EOF. On a streamed over-limit request it
sends `413` and keeps discarding through natural EOF; exiting Node's default async iterator early
destroys the request stream, resets slow senders, and defeats keep-alive. Tests must cover the live
bridge assembly, exact non-repeating bytes, zero RPC/File reads on the Blob path, over-limit before
fetch, no partial artifact, and reuse of the same slow-tail socket.
When an upload request carries `Origin`, require its host to match `Host` before writing anything;
native clients may omit `Origin` but still pass the normal session/proxy authentication gate.
Legacy POSIX upload trees need an upgrade path too: `mkdir(..., { mode })` does not repair an
existing permissive directory. `tightenUploadPermissions` uses `O_NOFOLLOW` descriptor opens and
descriptor `chmod` for the managed root, token directories, and immediate single-link files. Never
replace it with `lstat` followed by path `chmod` (a symlink-swap window), and never chmod a
multiply-linked inode whose other name may be outside the staging tree.

- **Context menus** (`components/ContextMenu.tsx`, portal, icons from `components/icons.tsx`):
  pane right-click = add nodes at cursor (terminal / Claude / sticky / open file) + select
  all + fit + **Tidy canvas** (`arrangeAllNodes` — packs every top-level node, including group
  frames as rigid units, into a non-overlapping grid via `arrangeNodes`, sorted by current
  (y, x) so the pack roughly preserves reading order; mirrored in ⌘K as "Tidy canvas"; both
  hidden below 2 top-level nodes, where it could only be a visual no-op that still writes
  `project.json`) + restart-idle-agents (the bulk in-place agent restart, mirrored in ⌘K; both
  hidden when the canvas holds no restartable agent node, where they could only report "0
  restarted");
  node/selection right-click = group, color, duplicate, align-to-grid, collapse,
  markdown-view (terminals), refresh-terminal (terminals — bumps `respawnNonce`: fresh PTY attach
  to the SAME tmux session; manual recovery for a stuck/unpainted terminal, and the same action
  sits in the node header as `term-node__refresh` since a dead view is a bad place to hunt for a
  right-click; nothing running is interrupted), restart-agent
  (single agent node — the in-place CLI restart above; absent for a CLI we cannot quit + resume,
  disabled with a hint while the session is busy or has no id yet), delete. Actions live
  in `Canvas.tsx`, operate on `targetIds`. The non-destructive rows are user-hideable from
  **Settings → Appearance** ("Node menu items" / "Terminal header buttons"), stored as HIDDEN
  lists in `settings.hiddenNodeMenuItems` / `settings.hiddenHeaderButtons` (empty = everything
  shows). `lib/ui-visibility.ts` owns the two inventories, `isHidden` (only answers for ids it
  knows — so Delete, restart-agent, branch/transfer, terminal Search and Close can never be hidden,
  whatever settings.json says), and `tidySeparators` (generic over any row with an optional
  `type`, so both the always-built menu literals here and ContextMenu's live filter below share ONE
  definition of "this rule would dangle"). The group-frame menu's colors strip answers to the same
  `colors` id; builders run through `tidySeparators` so a hidden row leaves no dangling rule. The
  canvas **pane menu groups its rows through ONE decision, `canvas/paneMenuGroup.ts`** (2026-08-18).
  Named `label` sections (2026-08 — Terminals, Agents, Canvas objects, Worktree, Drawing, Canvas)
  had replaced unlabeled rules because a flat ~17-row list read as an endless list, but headings
  alone are still one long list, so a group now collapses to a **submenu with its own icon** —
  except where that is the worse trade, which the helper decides per group: an **empty** group emits
  NOTHING (every builtin agent can be disabled in Settings and Kids mode can reach zero, so "Agents"
  really does hit zero rows; an empty trigger/heading claims a group that isn't there); a group of
  **ONE** row emits that bare row with no heading and no submenu (a hover to reach exactly one
  self-describing thing — "New worktree…" — is pure cost); and a group **already containing a
  submenu** falls back to the previous labelled flat section, because `ContextMenu` renders no
  second-level flyout (`child.type === 'submenu'` → `null`) and nesting it would DELETE the Claude/
  Codex account pickers rather than indent them. Today: Canvas objects ▸ (`IconShapes`) and
  Drawing ▸ (`IconPencil`) are submenus, Agents ▸ (`IconAgent`) is one whenever no agent row is an
  account picker, Worktree is one bare row, Canvas keeps a heading (Fit view / Select all are
  frequent — burying them behind a hover is the regression this change undoes), and the terminal
  rows stay flat and headless at the top: "New terminal" owns ⌘T and is what the menu is opened for,
  and "New terminal with profile…" is itself a submenu. Each group's rows still ride the same
  `tidySeparators` wrapper. **The row count is load-bearing**: the smallest pane menu now has 7
  actionable rows against `FILTER_THRESHOLD` 6, so grouping one more block silently removes the
  filter field — `canvas/paneMenuGroup.test.ts` pins that.
- **Sectioned menus are filterable, not just flat ones** (2026-08). `isFilterableMenu`
  (`components/menu/menuVisibility.ts`) counts only ACTIONABLE rows — plain items and submenu
  triggers, not separators/labels — against `FILTER_THRESHOLD` (6), so structural padding can't
  push a small menu over the line or hide a large one under it. Once a menu qualifies,
  `menuRowVisibility` (same file) is the single pure decision for which rows a query leaves
  visible, index-for-index with the input array — this used to be impossible because filtering
  required a FULLY FLAT menu (no separator/label/submenu/colors mixed in); nobody had decided what
  a group's label/separator does once every row under it filters away. The decisions it encodes:
  a plain item matches its own label; a **submenu matches on its own label OR any child's label**
  (typing a terminal-profile or account name must not hide the one row that reaches it — the
  submenu's children are never individually filtered, only whether the trigger row shows); a
  **`colors` row has no label, so it hides once a query is active** and reappears with an empty
  query (a swatch strip with nothing left in its section reads worse than briefly losing
  color-picking mid-search); a **`label` (section heading) survives only when some row in its own
  section — up to the next label or the menu's end — survived** (an empty heading would lie about
  what's below it); **`separator` visibility is decided last**, against the already-decided rows,
  by the SAME `tidySeparators` the unfiltered builders use, so there is one definition of "this
  rule would dangle." `ContextMenu.tsx` wires this in: it computes the full per-row visibility once
  (`rowVisible`), derives a KEYBOARD-navigable subset from it (only items/submenu triggers — a
  label/separator/colors row has no "activate" semantic), and hands that subset to
  `useMenuFilter`. That hook no longer owns the matching rule itself — it used to hardcode
  `items.filter(it => search.test(it.label))`, which cannot express "match on this OR a child's
  label" with one string field — so it now takes the caller's own `useRegexSearchField()` instance
  plus an ALREADY-FILTERED candidate list, and only tracks `activeIndex`/keyboard nav over
  whatever it's given. `onActivate` still maps a filtered row back to `items[Number(fi.id)]` by
  index (unchanged contract), but now also handles a `submenu` row: **Enter on a filtered submenu
  opens its flyout** (the same target `ArrowRight` already reaches) instead of silently no-op'ing,
  since submenu rows are keyboard-reachable through the filter for the first time.
- **Add menu** = bottom dock (`Dock.tsx`) `+`, mirrored by the pane menu and command palette.
- **Undo/redo**: debounced snapshot of the nodes array on settle (drag/edit), `pastRef`/
  `futureRef` stacks, ⌘Z / ⌘⇧Z + dock buttons. History resets per project load; skipped
  while typing in inputs/terminals.
- **Selection/pan**: box-select on left-drag (`SelectionMode.Partial` — touch to select);
  pan = middle-drag or trackpad two-finger (`panOnScroll`, `zoomOnScroll:false`); pinch
  zoom. Right mouse is free for the context menu.
- **Every node/session close uses one runtime funnel** (`renderer/lib/nodeDeletion.ts` →
  `Canvas.requestDeleteNodes`): Delete/Backspace, canvas menu, every node header × (caught at
  React Flow's `onBeforeDelete` boundary), kanban, Cmd/Ctrl+W, sessions sidebar/session-memory,
  and agent-control `close`. Kids mode upgrades EVERY surface to the two-key destructive gate;
  ordinary mode preserves each surface's historical contract. Do not call `deleteElements` as a
  complete deletion path or add a second confirmation branch: `deleteNodes` owns the canonical
  teardown, and the planner/dispatcher is what authorizes reaching it. React Flow expands a parent
  deletion to descendants before `onBeforeDelete`, so `managedDeletionRoots` must reduce the set
  back to roots — deleting a frame frees its children rather than deleting them. App-created
  worktree removal keeps non-destructive Unbind separate in an option-bearing confirmation. Kids
  mode starts disk deletion unticked, and an OFF→ON change resets an already-open dialog before
  paint while still allowing a later deliberate checkbox opt-in. Disk removal requires an opaque
  one-shot core proof over the canonical repo/worktree/common/admin generations, full symbolic ref and tip,
  tracked/untracked/ignored bytes, directories, symlink targets, and machine-local ownership. The
  renderer rechecks target and Kids policy after confirmation; core consumes the proof before its
  first await, double-measures again under the SQLite transaction, and supplies a final callback
  immediately before `git worktree remove`. Existing-branch checkout creation owns the directory
  but never the branch; an app-created branch is deleted only by full-ref/expected-tip `update-ref`
  CAS after Git proves its tip reachable. Shared `createdByApp` fields are UI provenance only.
- **Zoom chords** (`renderer/lib/zoomShortcut.ts`): **⌘/Ctrl+0 → `zoomTo100`** (actual size — what
  the browser AND Electron's default View menu already mean by that key) and **Shift+1 → `fitAll`**
  (the Figma/tldraw/Excalidraw "zoom to fit"). Matched on `e.code`, like the project-jump chord,
  which excludes `Digit0` so the two can never collide. The module is a PURE decision because both
  chords move the camera and a camera move here is not read-only — `onMove` → `markDirty` persists
  the viewport and casts it to the team session — so it refuses while the kanban board is up and
  while focus is in a text surface (input/textarea/contenteditable/Monaco/xterm, where Shift+1 is
  just the `!` key), and on auto-repeat (both actions animate; a held chord would restart the tween).
  Desktop ⌘0 does NOT arrive as a keydown: the default menu's `resetZoom` accelerator wins, so
  `main/index.ts` intercepts it in `before-input-event` and forwards `app:zoom-actual-size`, which
  re-asks the same refusals. Server Edition needs no intercept (no menu; Chrome/Firefox hand ⌘0 to
  the page) and stubs the subscription.
- **"Go to node" (`goToNode`)** — the one camera-travel path (notification click, sessions
  sidebar, ⌘K jump, presence travel, minimap double-click, double-click focus). It frames the node
  with `fitView({nodes:[{id}]})` **only when React Flow has MEASURED it**: `getFitViewNodes` filters
  the fit set by `measured` (no `width`/`height` fallback in there), so an unmeasured node leaves the
  set EMPTY, its bounds collapse to `{0,0,0,0}` and the camera lands on the canvas **ORIGIN** at max
  zoom — empty canvas, node off-screen. That is the state every node is in for the first tick after
  its project loads, which is why **cross-project** focus (the load and the focus happen in the same
  tick, and measuring can lose the race — heavier canvas = more likely) used to land on nothing and
  only work on a second try. `renderer/lib/nodeFocus.ts` computes the identical framing from the
  node's PERSISTED size for that window (`nodeFitRect` resolves the group-parent chain →
  `viewportForRect` → `setViewport`), and the measured check reads React Flow's **store**
  (`getInternalNode`), not our node object — `measured` reaches our state one render later (via
  `onNodesChange`), so our copy lies about nodes the store has long sized. Unknowable size ⇒ the
  camera **stands still**; never fall back to a bare `fitView` there, that IS the origin jump.
- **Command palette** (`CommandPalette.tsx`): ⌘/Ctrl+K; `Canvas.buildCommands` (create,
  switch project, jump to node by title/tag, open file…).
- **Explorer** (`ExplorerPanel.tsx`, 🗂 / ⌘⇧E): lazy file tree of the active project `cwd`
  (`fs:list`); click a file → opens an editor node; right-click → Copy Path / Reveal /
  **New File… / New Folder…** (empty-area right-click targets the root; SSH projects create on the
  host). Canvas pane right-click and ⌘K also expose **New file…** (creates under the project cwd,
  opens an editor node). These use `mkdir` + `exists` added to `FsApi`/`SshFsApi` across
  desktop/server/SSH (`core/fs-ops.ts`, `main/ssh-fs.ts`; relay remote-fs degrades to `false`).
  Expanded dirs **persist per project** across drawer close + app restart (`state/explorer.ts`
  zustand store, localStorage `nodeterm.explorerExpanded`).
- **Source Control** (`main/git-service.ts` system `git` + `gh`, `SourceControlPanel.tsx`,
  ⎇): file-level **stage/unstage** (+/−), **discard**, click a file → **diff node**,
  **branch switch/create**, commit (message box at top) + push / sync / publish, **gh
  sign-in** banner (runs `gh auth login` in a new terminal via `initialCommand`), recent
  commits. **AI commit message** (✦ Generate) and **AI terminal naming** both use
  `main/commit-message.ts`: a BYO local agent CLI (claude/codex/custom) spawned read-only on
  the staged diff / captured terminal output (no built-in model); agent + extra prompt in
  Settings. The panel operates on a **selected scope**, not on the project cwd — see Worktrees.
  **Open latency + reopen**: `status()` must never await `gh auth status` — it hits the GitHub
  API (~700ms) and used to hold the panel's first paint hostage; `ghAuthedSwr()` returns the
  cached answer and refreshes in the background (the accurate `ghAuthed()` is still awaited on
  the publish flow). Status/history live in the per-cwd `state/scmCache.ts` store (same pattern
  as `scmDraft`), so the close→reopen cycle paints the last-known data instantly while the
  mount refresh replaces it silently — do not move them back into component `useState`.
- **Worktrees** (bound to **group frames**) — a git worktree binds to a group node
  (`data.worktree: GroupWorktree {repoPath, branch, baseRef, path, createdByApp}`, persisted), and
  every node created inside that frame inherits the worktree path as its `cwd`
  (`cwdForNewNodeIn`) — the frame _is_ the binding, so an agent per branch is just a group per
  branch. Creation is **one step** — **"New worktree…"** from the pane menu / command palette /
  Source Control — with the repo resolved from the project cwd via `git.repoRoot()` and existing
  worktrees listed for adoption. (Both git IPCs existed before this feature and had **zero**
  renderer callers, which is why it was unusable: the dialog's repo field was always empty and had
  to be typed by hand. Don't re-strand them.)
  - **One store, one poller** — `renderer/state/worktrees.ts` is the **only** caller of the worktree
    /status _read_ IPCs (`git.repoRoot`, `git.worktreeList`, `git.status`); the group chip, the
    creation dialog and the Source Control panel all read that store. Three independent pollers would
    triple the `git` subprocess load and drift out of sync. It is **epoch-guarded** (a project switch
    bumps the epoch, so a stale in-flight refresh can never overwrite the newer project's
    `repoRoot`/orphans — worktrees are _created_ under `repoRoot` and orphans are offered for
    _deletion_) and **fails open**. Exactly **two** direct `git.status` reads live outside it, both in
    `Canvas.tsx` and both deliberate: the one-shot probes on the **Remove** confirm (the dirty-file
    count in the warning) and on **↪ Move into worktree** (staleness only arrives by poll, so the
    directory is re-checked immediately before an irreversible session kill). Anything recurring
    belongs in the store.
  - **Scoped Source Control** — the panel operates on a selected `ScmScope` (the main checkout or a
    bound worktree). A worktree scope's **id is its group node id**, which is what lets the canvas
    selection preselect it. `scmScopes` / `defaultScmScope` / `selectedScmGroupId`
    (`shared/scm-scope.ts`) decide the list and the default. The panel derives its `cwd` **once** so
    its ~49 call sites follow — and every Canvas callback it invokes (`onOpenDiff`,
    `onOpenCommitDiff`, `onExplainCommit`, `onRunInTerminal`) must take the **scope's** cwd, never
    the project's.
  - **Reconciliation** (`shared/worktree-reconcile.ts`) — bindings are reconciled against `git
worktree list`: a worktree deleted outside the app makes its group **stale** (chip reads
    "· missing", Merge/Remove hide, ↪ hides, and nothing spawns into the dead path — Unbind is the
    only action, and it takes the dead cwd off the children with it); a worktree bound to no group
    is an **orphan**, recoverable from the creation dialog.
  - **Two non-obvious facts the code depends on — do not "simplify" these away:**
    1. `git worktree list --porcelain` **keeps listing a worktree whose directory was deleted
       behind git's back**, tagging it `prunable` — and that tag only exists on **git ≥ 2.36**. So
       `worktreeList` additionally **stats** each path through an injected `pathExists` seam
       (`prunable: e.prunable || !pathExists(path)`; `git-service` wires `fs.existsSync`), or the
       whole stale/orphan story silently fails on the Server Edition's own target platform (Debian 11
       / Ubuntu 20.04 ship git 2.30).
    2. **A failed git read is never evidence of absence.** `listWorktrees` returns `{ok, entries}`
       so "git failed" (spawn EAGAIN, NFS hiccup, corrupt index) stays distinguishable from "git
       listed nothing" — a transient failure must never be read as "the worktree is gone", at any
       layer (`ok:false` changes no facts). Staleness from the status poll likewise needs **two
       consecutive** failed reads (`WORKTREE_STALE_STRIKES`), and the streak is scoped per project
       so a there-and-back tab switch cannot forget it.
  - **Destructive safety** — `createdByApp` gates removal: nodeterm deletes only worktrees it
    created; one the user merely **adopted** unbinds by default, and deleting its directory is an
    explicit opt-in that **defaults to off** (its branch is kept either way).
    Under Kids mode, or while the renderer cannot establish a loaded + subscribed Kids record,
    every disk-removal choice defaults off and then requires the two-key gate. Both the status-probe
    await and final confirmation re-read the owning project, binding generation, group incarnation,
    repo/path/branch/base/creator fields, and affected-node identities. Core also re-measures the
    checkout registration, HEAD, index, tracked differences, and untracked-content fingerprint and
    compares that proof immediately before forced removal; a rebound or content-changed worktree
    cannot spend the earlier dialog on its replacement, and an in-flight Git result cannot clear a
    newer binding.
    `isDangerousWorktreeRemovalPath` refuses a path that is the repo, `$HOME`, `/`, or an ancestor
    of any of them, on **every** removal path. **Merge** always confirms — it merges into the base's
    _working tree_ (`decideMergeStrategy`: merge in the base's checkout when it is clean, else a
    `fetch . branch:base` when the base is checked out nowhere, else blocked) — and its push to
    `origin/<base>` is disclosed in that dialog and **opt-in, default off**: a push to origin cannot
    be politely undone.
  - **Every path that drops a bound group goes through unbind** — Unbind, Remove, **Ungroup** and
    **Delete** all route through `releaseWorktreeBinding`, the one place that knows what a dropped
    binding owes: `displacedByWorktree`'s descendants (terminals whose cwd sits inside the
    worktree) get that cwd taken off them, and git's registration gets a `pruneOnly` prune. Ungroup
    and group-delete _keep_ the children, so skipping this left a **dead cwd persisted in
    `project.json`** — invisible until a reboot cold-starts the terminal into a directory that is not
    there — and left a stale registration that makes a later `worktree add` at the same path fail.
  - **SSH projects: not supported in v1** — every affordance is shown **disabled with that reason**
    (a silently-missing row teaches nothing). The gate asks whether the node is a **remote session**
    (`data.ssh` / `data.sshRemoteTmux`) or the project is an SSH project — **not** `data.remote`,
    which only _relay_ nodes carry: guarding the wrong field let a live remote tmux session be
    killed into a local path that does not exist on the host (`isRemoteSessionNode` asks about all
    three). The ops themselves **refuse** a remote repo (`git-service.isRemoteRepo`, via
    `resolveGitRemote`) rather than guess: the `git` executor routes over the project's ControlMaster
    while `pathExists` is a **local** `fs.existsSync`, so answering would stat the wrong machine and
    report _everything is gone_ — a refusal is a plain failed op and, crucially, never `worktreeGone`,
    so nothing is destroyed on a bad guess. Real support needs the worktree path to derive from the
    connection's cached `remoteHome` and `pathExists` to stat the **remote** fs (a `test -e` over the
    ControlMaster).
  - **Mobile companion: not applicable in v1** (the three-surfaces call, made deliberately). A
    worktree binds to a **group frame** on the canvas, and _nodeterm mobile_ (separate repo, `nodeterm-ios`)
    has no canvas — it attaches to tmux sessions over the `TerminalTransport` protocol, which carries
    no group/binding concept at all. So there is nothing to degrade gracefully: a worktree's terminals
    are ordinary tmux sessions and mobile already reaches them, it simply cannot see that they belong
    to a worktree. Surfacing the binding (a read-only "worktree: <branch>" label per session, say)
    would mean extending the transport protocol — a **follow-up in the iOS repo**, not this branch.
    Creation/merge/remove stay desktop+server only: they are destructive git operations, and a phone
    is the last place to confirm one.
  - **Known follow-up** — the Explorer tree and the ⌘K file index stay scoped to the **project cwd**,
    so a bound worktree's files are not browsable/searchable from them (its terminals and editor
    nodes work fine). Deliberately out of scope here: both index a single root, and making them
    scope-aware is the same "which checkout am I looking at?" question Source Control already answers
    with `ScmScope` — that is the seam to reuse when it is built.
- **Kanban view** (`components/kanban/KanbanView.tsx`; toggle is a Trello-style icon ON the
  **active project tab** (`.tab__board-toggle`, after the name, before the caret — the view
  belongs to the project; earlier homes were the tab-strip end, then the controls-cluster,
  both rejected in use) plus ⌘⇧B / ⌘K): per-project
  full-page SESSION board OVER the canvas — cards ARE the project's session nodes (React Flow
  type `terminal`), derived LIVE from the canvas nodes (title/color/kind/agentId), with
  RUNNING / NEEDS YOU badges + unread dot from the default `agentStatus` store; click = back to
  canvas + `focusNodeById`. The canvas stays MOUNTED under the opaque overlay (agent-status
  listeners live in Canvas.tsx; `display:none` would 0×0-resize every terminal into a tmux
  SIGWINCH), and canvas-only shortcuts (undo, ⌘T/⌘⇧C, Delete) early-return via `isKanbanOpen`.
  Board data is `project.kanban` ({columns, assignments: [{nodeId, columnId}]}, order = array
  order) in `.nodeterm/project.json` — git-shared, rides rev/mirror/watcher; absent until the
  first edit (`defaultKanban` seeds To Do / In Progress / Done). The virtual **Ungrouped**
  column (never persisted, undeletable/unrenamable, always first) holds every session with no —
  or dangling — assignment, in canvas order, so the board never opens empty. **Assignment is
  board metadata only**: drags never move canvas nodes or change groups; dead nodes' assignments
  prune lazily on each board change (`pruneAssignments`). Column delete is confirm-free (cards
  return to Ungrouped; no last-column rule — Ungrouped remains). The one shape rule is
  `validKanban` (`core/workspace-files.ts`), applied on EVERY load path — `fileToProject` AND
  `loadV3`'s inline (cwd-less) branch, which bypasses fileToProject — so a v1 `{columns, cards}`
  or hand-mangled board drops to the fresh default instead of crashing the render (view choice
  persists in localStorage, so a render throw would boot-loop). Pure transforms in
  `renderer/lib/kanban.ts`; view choice is personal (`state/viewMode.ts`, localStorage
  `nodeterm.projectView`). The board opens with a **title strip** (`.kanban-header`: project
  dot + name) whose height clears the floating controls-cluster icons — columns never sit under
  them. **Cards collapse/expand on single click** (transient state); the expanded detail row
  reuses `ContextMeter` (model + % pill, per the node header) + session chip + an ↗
  open-on-canvas button; double-click opens the node directly. Z-order contract: overlay 25 <
  `.controls-cluster` 26 (Explorer/SC/Settings stay clickable ON the board) < `.top-banners` 27
  (a mandatory-update card must not hide behind the board) < tabbar 30. An assigned session
  node shows its column as a **half-pill flush on the node's TOP edge** — see the pill sentence
  below. A card's ↗ / double-click opens the **card modal** (`components/kanban/CardModal.tsx`, body
  portal on the dialog-stack, scrim z 55, scrim/Esc close — Esc in CAPTURE phase, and an Esc
  during a header rename only cancels the edit). Terminal cards get a LIVE second view of the
  tmux session (`ModalTerminal.tsx`): the pty subscriber ledger is keyed by the composite
  `(ClientId, viewerId ?? PRIMARY)` (`core/pty-manager.ts` — **viewer identity**; viewerId is an
  optional TRAILING arg through preload/ws-bridge/LocalTransport, absent = bit-for-bit legacy, and
  a client's per-connection socket pause survives a single view's departure). The modal viewer
  seed-paints from the joiner screen (`toXtermText` transforms — raw capture-pane staircases),
  handles fresh-cold via scrollback snapshot + hint (agent auto-resume stays canvas-only), has
  deliberately no park/WebGL/hover/flow-control, and kills ONLY its own viewer on close. Sticky
  cards edit their text in the modal (live both ways).
  The modal header carries the terminal node's actions (search via `useTerminalSearch`+
  `FindBar` on the modal xterm; dictate via the same `nodeterm:dictate` event — `.dictation`
  overlay z is 60, ABOVE the modal scrim; ✦ `pty.generateName` through the modal rename funnel).
  **The 💬 icon means COMMENTS on both surfaces** (repurposed from the markdown view — ⌘M still
  toggles markdown/chat on the canvas node): on a terminal node it opens a right-side comments
  flyout (`.term-node__comments`, a sibling of the overflow:hidden root, hosting BoardLogPanel
  with `card: Pick<KanbanSession,'id'>`); in the modal it collapses/reopens the panel, which is
  OPEN BY DEFAULT there. Under the modal header sits the **card metadata strip** (`CardMetaBar.tsx`): Members (assign) —
  colored initial avatars, picker pool = me + live presence peers + board-log authors (name-keyed,
  NO separate membership system) — and a Due date (`datetime-local`, red Overdue chip past due;
  cards show mini avatars + a due chip). Data = `kanban.meta [{nodeId, assignees, dueAt, priority}]` (priority low/medium/high/urgent, colored chips)
  (tolerant readers via `cardMeta`; pruned with dead nodes; empty entries dropped). Assign/due
  changes are logged through the SAME diff funnel (`member-assigned/unassigned`, `due-set/cleared`;
  unknown future event types render neutrally). Feed rows show ABSOLUTE Trello-style stamps
  (relative in the tooltip). The modal's right third is the **board log** panel (`BoardLogPanel.tsx`, `state/boardLog.ts`):
  per-person comments + card activity from `<cwd>/.nodeterm/board-log.jsonl` — append-only JSONL
  (`core/board-log.ts`: tolerant newest-first parse cap 500; text clamped `BOARD_LOG_TEXT_MAX`
  16KB — an SSH append is ONE printf arg, ARG_MAX would silently drop it), author = presence
  identity, registered via `core/board-log-handlers.ts` in BOTH shells (client sends only a
  projectId — the path always derives from the server's own registry, no jail needed). Events
  come from ONE pure funnel (`lib/boardLogDiff.ts` — binding invariant: its `cardTitle` arg
  returns '' for and ONLY for dead nodes; column deletion suppresses per-card moved-to-Ungrouped
  noise; prunes/reorders log nothing) + `createNodeInColumn`'s card-created. Local projects push
  changes via fs.watch; desktop SSH projects poll 5s while subscribed; inline projects show a
  hint. Relay tabs BRIDGE boardLog to the host (pre-dispatch `sharedProjectId` scope guard in the
  relay dispatch — an out-of-scope projectId is refused before any registry/path resolution; a
  connection drop replays its outstanding onChanged unsubscribes). Deliberate v1 gaps: column-level
  events are stored but no card feed shows them; canvas-born nodes get no card-created; no
  card-deleted type.
  Per-column "+ New session" menus create agents/terminal/sticky nodes assigned to the column
  (assignment written UN-pruned — the fresh node isn't in the derived list yet). The column
  half-pill itself: (`components/kanban/ColumnPill.tsx`, `columnForNode` in lib/kanban; rendered
  as a SIBLING of the node root — the roots are overflow:hidden — hidden for Ungrouped/dangling,
  click opens the board). Server Edition works as-is (pure renderer + workspace.save). Scope: no
  agent-driven card movement yet, no board undo, mobile N/A.
- **Settings** (`SettingsPage.tsx`, ⚙ / ⌘,): font/cursor (live to xterm + Monaco), default
  shell, grid + snap, **default node size** (`defaultNodeWidth`/`defaultNodeHeight` — new
  terminal/agent nodes only, clamped in `terminalNodeSize()` in `state/workspace.ts`),
  pan-hover delay, double-click focus, accent, tmux on/scrollback, commit agent,
  `seenShortcuts`.
- **Shortcuts** (`ShortcutsPanel.tsx`, ? / ⌘/): shown once on first launch (`seenShortcuts`).
- **Welcome** (`WelcomeScreen.tsx`): shown when no projects exist.
- **Window chrome**: macOS integrated title bar (`titleBarStyle: 'hiddenInset'`); the tab
  bar (`TabBar.tsx`) is the drag region with the `nodeterm` logo + a rounded pill of project
  tabs. Cmd+M is intercepted in `main/index.ts` `before-input-event` (else macOS minimizes)
  and forwarded to the renderer via `app:toggle-markdown`; Cmd+W (`app:close-node`) and Cmd+0
  (`app:zoom-actual-size`) are taken back from the same default menu the same way. We never call
  `Menu.setApplicationMenu`, so Electron's DEFAULT menu is live and owns every accelerator in it —
  a chord that collides with one never reaches the renderer at all
  (`main/menu-accelerator-intercepts.test.ts` pins the three we steal).
- **Theme**: macOS dark palette as CSS tokens in `styles.css` `:root` (`--accent` = systemBlue,
  label/separator opacities, SF font stack). Canvas background is black with dot grid. A runtime
  accent is expanded by `lib/accentTokens.ts`, not assigned as one isolated property: hover,
  readable text, RGB tint and every Material primary/container foreground move with it and are
  re-derived against the resolved light/dark panel. HSV and CMYK remain picker/copy formats, while
  the value crossing into stored/live CSS is RGBA so Chromium accepts it and alpha survives.
  Custom-logo processing is generation-owned: an older decode/crop/fit may not overwrite a newer
  adjustment or synchronous preset choice, and shallow `appLogo` patches retain `customImage`
  unless the explicit Remove action is used. Preset Blob exports share the 30-second delayed URL
  revocation path; same-turn revocation can cancel Chromium before the download starts.

## Remote access (Docker-hosted relay) — free, not Pro

The interactive surface is **Docker host**. It retains the existing relay transport, single-use
offer, E2EE handshake, and mutual SAS approval. Hosting has a free one-connection floor and no
entitlement requirement. The pairing request omits legacy entitlement metadata when none exists;
it never invents a credential. Packaged builds use the configured relay, while development still
requires an explicit `NODETERM_RELAY_URL`.

`main/remote/docker-host-runtime.ts` is the execution boundary. It discovers contexts with
`docker context ls --format {{json .}}`, validates bounded settings at point of use, and starts one
labelled random-name container per host seat using `execFile` argument arrays. The container is
never privileged, receives no Docker socket, drops all capabilities, has no-new-privileges,
read-only root, bounded CPU/memory/PIDs, a tmpfs `/tmp`, no network by default, and a read-only
project bind by default. `RelayPtyCreateSource.docker` makes the trusted relay PTY authorizer replace
all host/profile execution with `docker exec -i <owned-container> /bin/sh`. Revoke, socket close,
stop, cancellation, and failed startup remove only that task-owned container; bind data survives.

**LAN pairing is encrypted or it does not start.** `pairing-service.ts` loads the host's persistent
NaCl key before binding the one-shot HTTP listener and advertises that public key as `hostKey` in
the QR. `/pair` accepts only `{epk,box}`: the request (one-time token + SSH public key) and the
success response (including `agentToken` and an optional `relayDeviceToken`) are authenticated and
encrypted under the ephemeral-client/host shared key. There is no plaintext-success compatibility
path; a missing/locked host key, malformed envelope, bad MAC, or response-encryption failure must
produce no credential write. `PairingPayloadInput.hostKey` is mandatory and the pure payload builder
also rejects a missing/blank value at runtime, so stale compiled or hand-written callers cannot
construct an unsealed QR. The attempt's synchronous `settled` latch is separate from
`server.close()` because Node keeps already-accepted sockets alive: the fifth wrong short code and
the first valid request latch before any persistence await, so a parked request cannot wake later
and write. **Server Edition deliberately does not host this desktop LAN listener** —
`PairingApi.supported` is false in the browser bridge, the quick action is absent, and Settings
shows an explicit desktop-only explanation.

The pairing registry is also the revocation authority, so its read and write ordering is
security-sensitive. Only `ENOENT` means `agent.json` is absent; invalid JSON, a wrong root/devices
shape, `EACCES`, `EIO`, and every other read failure propagate without rewriting the file. A new
pairing publishes its device entry before appending `authorized_keys`. Thus a registry failure
grants no SSH access, while a later append/chmod failure leaves any possibly-live key represented
by a visible, revocable device entry. The encrypted bearer response is not sent on either failure.
The append path may treat only `ENOENT` as a new key file: `EACCES`, `EIO`, and unknown read
failures stop before append, because an unreadable existing file may lack its final newline and a
blind append would splice the new key into the previous one. The already-published registry row
stays visible as the revoke handle.

The desktop's late-adoption relay advertisement (`main/remote/relay-advertise.ts`) sweeps abandoned
publication temps before creating its own. It delegates recognition, the 24-hour grace, and the
signal-0 owner decision to `sweepStaleTempFiles`: a foreign pid is not death, and unreadable
metadata or an unjudgeable owner preserves the candidate. Only a recognized old temp whose owner
is no longer visible is collected; malformed names stay untouched, temp contents are never read,
and a failed publication still removes exactly the UUID temp minted by that call. This is desktop
runtime hygiene only: the Server Edition does not publish `~/.nodeterm/relay.json`, and the mobile
companion only reads the canonical advertisement through its existing SSH bootstrap.

Pairing completion carries a distinct failure reason, and Settings refreshes the registry even on
failure so a partial grant is immediately reported and can be revoked rather than called a timeout.
Revocation has the same absence rule on `authorized_keys`: only `ENOENT` permits the registry entry
to be removed without a key-file rewrite. `EACCES`, `EIO`, and unknown read failures leave both the
key and its visible device entry unchanged, so a possibly-live SSH credential is never hidden.
Settings keeps the device row and shows a persistent “access may still be active” retry warning
when that revoke rejects; a bridge rejection must never become an unhandled promise or a false
success.

`agent.json` is a shared cross-process registry. Desktop pairing and revoke take the exclusive
`~/.nodeterm/agent.json.lock` before the authoritative read and hold it through the complete
registry/`authorized_keys` transaction. Acquisition is bounded and fails closed; the lock contains
only owner diagnostics, and an old-looking lock is never deleted on age alone because doing so can
split a live writer's critical section. Atomic rename prevents torn bytes but does not prevent a
stale read-modify-write from erasing a concurrent writer. The separately shipped companion host
agent is also an `agent.json` writer and therefore must adopt this exact lock contract, with a
symmetric two-process test, before the combined release is considered verified; its source is not
in this repository, so that adoption remains an external release blocker. Clearing it requires an
exact companion commit and artifact hash, an inventory proving every writer takes the lock before
its authoritative read, both real-process contention orderings, a timeout/no-mutation proof, and a
mixed-artifact run. A host-shaped worker in the desktop Chut proves only this helper—not companion
adoption; the evidence checklist lives in `docs/ios-protocol-migration.md` §0.1.

Renderer pairing assigns a cryptographic UUID before awaiting `pairing.start(attemptId)`. Main echoes
that UUID in the start result and every completion event, and `pairing.stop(attemptId)` cancels only
the matching active attempt. The renderer also invalidates every continuation with an epoch on stop,
unmount, completion, or replacement. Both checks are required: epochs stop stale state writes inside
one mounted hook, while the cross-process ID prevents a late unmounted hook or delayed completion
event from owning a newly mounted replacement. The service rechecks attempt ownership after
publishing the registry, before activating SSH, and after the key append returns. Cancellation before
append leaves a visible, revocable registry row without a key; cancellation during append removes
the attributable key before rejecting the response. Neither path delivers a bearer.

- Phone relay remote access ("Reach this Mac from anywhere") is a **Core (free) feature** as of
  2026-08-01 — the iOS app is itself paid, so a desktop Pro gate double-charged the same feature.
  The former Pro gate AND the free-tier monthly quota (`core/relay-quota.ts`, `RelayQuotaBanner`,
  the ProCompare meter, the `relayQuota` IPC/preload/bridge surface, docs/relay-quota.md) were all
  **removed**. The toggle (`settings.phoneAccessEnabled`, Settings → Phone + quick-pair popover)
  shows for everyone; the standing host reconciles on `enabled && relayAllowed()` alone, with no
  quota metering at `onPeerReady`. **Entitlement passthrough remains**: a stored Pro entitlement is
  sent on mints, else the `{deviceId,…}` body (host-token `{deviceId, hostPublicKeyB64}`, device
  mint `{deviceId, hostDeviceId, hostPublicKeyB64, label}`). **The backend is the real gate now**:
  `POST /v1/relay/host-token` / `/v1/relay/device` must admit deviceId (no-entitlement) mints, and
  the relay server may rate-limit free hosts independently — a client-side gate must NOT be
  reintroduced to work around a backend refusal (fix the backend policy instead).

**Approved-device persistence has one mutation funnel** (`src/main/remote/approved-devices.ts`). The
standing phone host, mutual-trust settlement and revocation all change the same pin list. Atomic
temp+rename protects bytes, but it cannot protect a stale snapshot: an approval for device B used to
load `[A]`, a revoke could publish `[]`, and the delayed approval could then publish `[A,B]`, silently
resurrecting revoked device A. Every writer now passes its `pinDevice` / `unpinDevice` intent to
`mutateApprovedDevices`, which serializes the complete read-modify-write decision; the full-snapshot
writer is deliberately private. The loader returns empty only for `ENOENT`. Invalid JSON, an invalid
shape, permissions and other I/O failures reject and preserve the existing bytes — a failed read is
not an empty trust list. A failed pin remains safe for the current explicitly-approved session (the
next reconnect asks again); a failed revoke still cuts the live socket and reports
`persisted:false`. Normal packaged operation is single-instance; the dev-only `NT_MULTI=1` flow must
keep using a distinct `NT_USER_DATA` per instance because this queue is process-local.

### Relay RPC authorization is an exact allowlist

A mutually approved relay peer receives shell-equivalent access to the project/session it joined,
but it does **not** become the host renderer. That distinction is enforced at the narrow inbound
boundary in `src/main/platform-electron.ts`: every request, cast, and host→peer event must appear in
the exact allowlists in `src/main/relay-rpc-policy.ts`. Inbound checks run before the recorded
CorePlatform handler/listener is even looked up; outbound checks run before a peer sink is called
(the host renderer still receives its local broadcast). An unlisted request answers `E_FORBIDDEN`;
unlisted casts/events are dropped because they have no reply channel. A new handler, listener, or
broadcast therefore fails closed until somebody reviews its relay semantics and adds it deliberately.

This second gate is mandatory because `platform.handle()` serves two different remote surfaces.
The Server Edition legitimately registers machine-global core services such as settings, School /
Kids mode, scheduled settings, toy locks, and the authenticator. The relay API deliberately keeps
those namespaces — plus licensing and usage credentials — on the **viewing** desktop. Registration
alone used to erase that distinction: a raw approved peer could dispatch
`authenticator:reveal` or `authenticator:export-secrets`, skip the renderer's reveal/two-key export
confirmation, and make the host process unseal the stored TOTP seeds. The whole `authenticator:*`
namespace is now local-only (live TOTP codes are credentials too), as are the other machine-global
credential/control namespaces; tests drive raw encrypted relay frames and prove rejection occurs
before the authenticator handler is entered or its store is loaded, sealed, unsealed, or saved.
The outbound half is equally load-bearing: usage updates include the host account email,
converter events contain local
paths, and local model streams contain prompt/response content. None may ride an unrelated
machine-global broadcast to a peer merely because CorePlatform is the emitter.

The allowlist intentionally includes destructive `fs:*`, `git:*`, and terminal lifecycle methods:
the mutual-consent copy grants the peer shell access, so withholding a git discard while allowing a
terminal would be theatre. GitHub issue methods are likewise allowed but remain jailed to the
shared project in `relay-host.ts`; GitHub credential control stays local. Keep both layers: method
authorization answers *which service*, while the host-session scope checks answer *which project*.
Whole-workspace save is not allowed: its payload can rewrite the host's index and remove unrelated
projects, while relay tabs already converge the shared project through ordered canvas mutations.
`git.setActiveRemote` also refuses over relay until Desktop owns a scoped CorePlatform handler.

**A browser/Electron File path belongs to the viewer, not automatically to the session machine.**
Every terminal/canvas file-drop resolver takes the current session's `NodeTerminalApi`; it never
reaches back to `window.nodeTerminal` for `getPathForFile`, `files.*`, or `sshProject.uploadFile`.
The relay API makes `getPathForFile` answer empty, forcing viewer-held bytes through the host-routed
`files.saveUpload` / `files.saveCanvasImage` methods before a host path is pasted or persisted. The
Server Edition prefers its optional raw-Blob HTTP upload (with the shared 64 MiB guard) and relay
retains base64 RPC. SSH-project control/filesystem has no scoped relay carrier in v1, so it refuses
instead of using the viewing desktop's unrelated ControlMaster; add a host-scoped composite carrier
before enabling that path.

**Surfaces:** Desktop relay is the enforcement point. The Server Edition's authenticated browser
socket is unchanged and continues to receive its full explicitly-built API. The current mobile
companion still uses the legacy phone dialect; when it migrates to the raw RPC tunnel it will
inherit this host-side allowlist without a protocol change (call out any newly required method to
`@eneskirca` rather than widening a namespace).

## The unlock ladder (Server Edition lockout)

Five wrong credentials from one network peer lock that peer's login path, and instead of a bare
countdown the lockout screen offers a
way to play out of it: **dim sum** (one dish, four choices) → after 5 wrong dishes **ten easy sums**
→ after one wrong sum **whack-a-mole**. Clear any rung and the wait ends; lose the lot and you are
where you started, waiting, with the ladder not re-offered for that lockout. State machine is the
Electron-free `src/core/unlock-ladder.ts`; served at `/auth/unlock/{challenge,verify}` and drawn by
`lockedPage()` in `src/server/http.ts`. Full write-up: **`docs/unlock-ladder.md`**.

**Lockout decisions are scoped to the kernel-observed TCP peer, never a forwarding header.**
`authClientKey()` uses `req.socket.remoteAddress` alone; `X-Forwarded-For`, `Forwarded`,
`X-Real-IP`, source port, cookie and user-agent are spoofable or unstable and cannot select a
bucket. One peer's five failures therefore cannot impose its exponential wait on another peer.
Password proofs enter a same-peer FIFO before asynchronous scrypt and share a bounded process-wide
pool (2 active, 32 pending, 5 pending per peer); lockout is re-checked after the request body, after
the pool wait, and after the proof, while a generation boundary prevents a pre-lockout proof from
waking after expiry/ladder clear and charging or clearing the next cycle. The 1024-entry peer table
never evicts a locked or pending-password-proof peer; at capacity it may replace the oldest unlocked source so a
one-shot distributed flood cannot manufacture a permanent global lockout. A reverse proxy's
password callers share its TCP peer bucket; configured proxy-SSO callers do not use password auth.

Each locked peer owns an independent `UnlockLadder`, but every ladder receives one shared
`UnlockLadderBudget`. The final rolling-hour slot is claimed atomically at grading time, not merely
when a challenge is issued, so correct answers already outstanding on several peers cannot all
clear one remaining slot. Ladder nonces are separately capped at 8 per peer / 256 account-wide;
grading consumes every sibling nonce so an old answer cannot cross a rung or exhaustion boundary.
WebAuthn freshness state is also bounded (8 per peer, 256 global), peer- and purpose-bound, and swept
in one bounded O(n) pass that remains correct after clock rollback. Logout revokes the presented
persisted session before clearing its cookie; a captured old bearer stays revoked across restart
without signing out other browsers.

**Five rules are the entire safety of it. Keep the games and drop any one and you have shipped a
second, much weaker password:**

1. **It clears the WAITING, never the CREDENTIAL.** No session, no cookie — the user lands back on
   the password form. `clearLockoutByLadder()` never changes the failure count, escalation streak,
   credentials, or sessions; it only ends the wait and advances stale-proof bookkeeping. Pinned by
   a route test asserting no `Set-Cookie`.
2. **No attempt refund.** Waiting returns five attempts, so the ladder returns five. The moment
   solving beats waiting, brute force gets cheaper — the one thing a lockout exists to prevent.
3. **`LADDER_BUDGET` (3 clears/rolling hour) is the real defence, not the difficulty.** Every rung
   is machine-solvable — four choices is one-in-four, ten sums are trivial, a mole schedule is
   arithmetic. A ladder without the cap has quietly removed the lockout it decorates.
4. **The escalation is untouched.** `nextLockoutMs` now doubles the lockout per consecutive lockout
   (60 s → 2 m → 4 m …, hour cap — replacing a flat 60 s that charged the same for the first wrong
   guess and the five hundredth), and clearing the ladder never resets that streak.
5. **Server-generated, server-graded, single-use nonce, consumed BEFORE grading** — so a wrong
   answer cannot be retried against the same question and a right one cannot be replayed.

Two more that cost the whole rung when missed: a **timed game cannot be won faster than it lasts**
(a whack submission arriving before `WHACK_DURATION_MS` is rejected, or a script posts a perfect
score the instant it gets the schedule), and **each mole grades once** (else "hit the moles" becomes
"send enough taps"; the on-screen score is encouragement and is regraded server-side).

**School mode** removes every dim-sum surface, so under it the ladder **starts at the maths** —
absent, not disabled-with-a-message, since naming the hidden thing is what School mode forbids.
`firstRung()` is the only decider and `issue('dimsum')` still returns maths under the mode. Read
through a closure (`auth.setSchoolModeSource`), never sampled at boot: it is a live shared switch a
running app must pick up without a restart.

**Surfaces:** Server Edition only, and that is a decision rather than a gap — the desktop app has no
password gate, and the Pages site's toy locks (`site/app/shared/locks-state.js`) have no lockout at
all (a wrong password returns `false`, unlimited retries), so there is no wait to skip. _If a
lockout is ever added to either, it owes the ladder._ Guarded by an `unlock-ladder` row in
`scripts/check-app-contract.mjs` whose needles all carry a delimiter — a bare `clearLockoutByLadder`
matches inside `clearLockoutByLadderRENAMED` and `LADDER_BUDGET` matches inside
`LADDER_BUDGET_WINDOW_MS`, and both stayed green through a deliberate rename before that was fixed.

## School Mode presentation boundary

`useSchoolMode` starts with `{ enabled: false, hydrated: false }`. The `false` is a placeholder,
not evidence that the shared mode is off. Every language/funny-level, narrator-language,
personal-vocabulary, and dim-sum boundary must call `schoolModeAllowsOptionalFeatures` and allow
the optional behavior only for `{ hydrated: true, enabled: false }`. A failed load stays
unhydrated and retries; a live record that arrives during the initial load wins over its stale
snapshot.

Re-check at the point of use, not only when rendering a control. A shared update can land after an
event or input is queued. In particular, both Canvas narrator paths go through
`canvas/narration-policy.ts`: School Mode enabled or unknown preserves an enabled English narrator
but strips the Cantonese track and voice. Passing `settings.narratorLanguage` directly to
`narrate()` recreates the startup/reconnect leak this boundary exists to prevent. Persisted
preferences remain unchanged and resume only after a confirmed-off record hydrates. Canvas also
binds an allowed→suppressed live transition to `suppressNarratorTrack('yue')`; queue entries carry
the track-policy generation captured before debounce and re-check the live policy immediately
before synthesis. That invalidates old Cantonese work and cancels only an active Cantonese
utterance, preserving queued/active English and the narrator's important-error guarantee. A
Cantonese-only event carries a dormant English copy so the same transition degrades it to English
instead of turning an enabled narrator silent.

## Speech / dictation (desktop + server)

Voice-to-text input captured via microphone, turned into terminal text via on-device Whisper. Works on desktop (Electron) and Server Edition (browser); iOS support is separate (`nodeterm-ios`, private — see the three-surfaces entry under Conventions).

- **Service seam** (`src/core/speech/`) — `SpeechService` (core) + `PlatformSpeechProvider` interface + shell implementations (`PlatformElectron` / `PlatformServer`). Models are stored under `${dataDir}/speech-models/`, with fenced downloads + orphan sweep (`removeUnusedModels`). A model part is `<file>.part.<store-id>.<part-id>`: both ids are cryptographic and the name is reserved with `wx`, so a repeated candidate cannot truncate a fragment. Dedupe is per `WhisperModelStore`, not per data directory — another desktop/server/container may be downloading the same model — so `removeParts` deletes this store's inactive fragments immediately but preserves foreign fragments until their mtime is at least 24 hours old; a failed stat preserves them. Core validates license: **tiny** free (always); **base·small·large-v3-turbo** Pro (via `isPremium()`). One model loaded at a time (FIFO memory management), lazy smart-whisper import degrades to a friendly error if the native dep is unavailable (`"Local whisper is unavailable…"`).
- **Cloud contract (iOS parity)** — `/v1/transcribe` multipart endpoint (not built yet; SDK `transcribe()` call matches iOS byte-for-byte) for future remote transcription. IPC channels `speech:*` wired in **both** Electron (`src/main/platform-electron.ts`) and Server (`src/server/platform-server.ts`): `speech:request-consent` (Electron mic-prompt only, server always true), `speech:synthesize`, `speech:cancel`, returning `Promise<{text, audio}>`.
- **Renderer capture** — `PcmCapture` AudioWorklet (16kHz single-channel PCM, WebAudio or fallback SPN) + DictationOverlay (⌘⇧D dock mic / Cmd key; Settings → Speech section for model choice + progress). **Send** appends text + Enter to the terminal; **Insert** sends text-only via `sendText(…, {enter: false})`. **Nothing auto-submits** (user always decides when to send).
- **Browser constraints** — `getUserMedia` requires HTTPS or `localhost`; mic permission prompt is the browser's own (not handled by nodeterm). Model downloads land on the **server's data dir** (accessible across sessions).
- **Electron + native dep** — smart-whisper is externalized + `asarUnpack`'d (not bundled); `postinstall` rebuilds it against Electron's ABI. Device verification of the ABI rebuild is not yet exercised on a dev machine — test paths exist but have not been run in CI.

## Packaging & auto-update

Built with **electron-builder** (config in the `package.json` `build` block: appId
`com.nodeterm.app`, productName `nodeterm`, mac dmg+zip for arm64 **and** x64, `asarUnpack`
node-pty, output `dist/`). The app icon is generated from the nodeterm mark by
`scripts/make-icon.mjs` (sharp → `build/icon.png`, 1024², gitignored — regenerated by
`make-icon`); electron-builder derives the `.icns`. Scripts: `npm run make-icon`, `npm run dist`
(local **unsigned** arm64 `.dmg` smoke test). Production release signing/notarization remains
outside this repo. The macOS/Linux update feed is hosted separately; Windows consumes Squirrel
assets attached to the project's stable GitHub Release.

**Windows** (the active delivery target for CI): `build.win` targets Squirrel.Windows
(`build.squirrelWindows`), signing permanently disabled — no `CSC_LINK`/`CSC_KEY_PASSWORD` is
ever set, `CSC_IDENTITY_AUTO_DISCOVERY=false` in CI, Windows `signExecutable: false`, and root
`build.forceCodeSigning: false`. Resource editing remains enabled so the unsigned executable
still receives its icon and version metadata. The Squirrel package id must remain
`node-terminal`, matching the published `0.3.0` `.nupkg`; do not enable `useAppIdAsId`, which
would rename that update identity. Runtime and installed shortcuts instead share the exact
AppUserModelID `com.squirrel.node-terminal.nodeterm`, derived from the effective package id and
`nodeterm.exe` rather than from `build.appId`.
`npm run dist:win` routes every supported Windows package through
`scripts/windows-installer.mjs`. The wrapper requires a clean checkout, regenerates the committed
seven-frame ICO, proves it equals the current commit's blob, derives a public immutable raw URL
from the full source SHA, and verifies the downloaded bytes before invoking electron-builder. It
then rejects stale or unexpected output, requires semantic nupkg ID/version/title plus exact
`RELEASES` name/size/SHA-1 agreement, and compares the nuspec URL and the icon/version resources in
Setup, the installed app, and its execution stub. The current commit must already be reachable in
the public GitHub repository; local-only commits fail before packaging. Squirrel's vendor
`Update.exe` remains vendor-branded and outside the PE-resource gate because the pinned builder
exposes no supported project hook for editing it.

`.github/workflows/release.yml` is a manual-only
`workflow_dispatch` pipeline and its first step refuses every ref except the `main` branch.
Feature-branch and prerelease artifacts must never become the authority behind
`releases/latest/download`. The stable tag is exactly `v<package.json version>`; consequently the
package/app version must advance before every release (`0.4.0` is the next candidate after
`0.3.0`). Publication is a
transaction: validate Setup + `RELEASES` + full `.nupkg` locally, stage/upload only on a draft,
compare the remote names and sizes, then make that one complete release public. Reruns verify the
tag still targets the run's commit and reuse it without clobbering an already-public asset. The
runner executes no tests, type-check or
lint; `scripts/check-release-workflow.mjs` guards those semantics locally. See
`docs/ci-and-releases.md` for the full policy and `scripts/release-notes.mjs` /
`scripts/count-lines.mjs` for what the release notes carry. Automatic publication is disabled
because the workflow has no push trigger. The committed definition is manually dispatchable from
`main`, while the hosted workflow is recorded as manually disabled pending final packaged
install/update interactions. This updater change does not dispatch it, and no `0.4.0` release is
claimed until those interactions are complete.

Auto-update runs **only when `app.isPackaged`** (dev = no-op), checks on launch + every 6h, and
forwards its lifecycle to the renderer over IPC. **Windows uses Electron's built-in
`autoUpdater`**, because the project packages Squirrel.Windows rather than NSIS. Its stable feed
is `https://github.com/Ding-Ding-Projects/material-nodeterm/releases/latest/download`, whose
release must contain a matching `RELEASES` and full `.nupkg`. Do not put an app-side release-list
parser in front of Squirrel: the final, manually dispatched `main` release is the channel
authority and avoiding a second fetch also avoids a time-of-check/time-of-use split. Built-in
Squirrel exposes no byte-level progress, so `UpdateCard` shows an honest indeterminate download;
it must not display a fabricated `0%`. Duplicate checks are coalesced and **Restart to update**
can call `quitAndInstall()` only once, after `update-downloaded` made the install ready. That gate
controls the immediate-restart action, not Squirrel's whole lifecycle: a successfully downloaded
update can apply on the next normal app launch even when the button was never used. A parseable
post-download version/channel mismatch is therefore diagnostic UI and immediate-restart refusal,
not an installation barrier. The manual `main`-only stable publisher is the channel authority.

`src/main/bootstrap.ts` handles `--squirrel-install`, `--squirrel-updated`,
`--squirrel-uninstall`, and `--squirrel-obsolete` before importing the application graph. A
`--squirrel-firstrun` launch delays the first automatic check so Update.exe can release its
package lock. An unreachable or 404 feed never implies that no update exists: automatic checks
stay out of the way and retry normally, while an explicit user check reports the error without
blocking the installed app. **macOS/Linux deliberately retain `electron-updater`** and their
existing determinate/manual-download behavior; macOS silent self-install still requires a
signed+notarized build. Server Edition and the mobile companion have no Squirrel install and are
explicitly not applicable to this desktop-only updater.

The installed Windows `0.3.0` build cannot discover `0.4.0`: its app-side updater expected NSIS
metadata at the old generic feed, while the published Windows artifacts are Squirrel
`RELEASES`/`.nupkg`. The transition therefore requires a one-time manual production Setup download.
Because `0.3.0` lacks the new `--squirrel-obsolete` startup handling, neither running Setup with
the old app closed nor leaving it running is proved safe yet. Closing it first is only the
provisional pre-proof recommendation. The final production-identity proof must exercise both
states and publish the supported sequence. Keep that `0.3.0` → `0.4.0` manual migration distinct
from the isolated fixture pair below, which proves that the updater code first shipped in `0.4.0`
can discover and apply a later Squirrel package.

The collision-safe Windows update fixture uses temporary test-only identity `name`
`node-terminal-squirrel-fixture`, `productName` `nodeterm Squirrel Fixture`, and `appId`
`com.nodeterm.squirrel-fixture`, plus versions `0.4.0-fixture.1` → `0.4.0-fixture.2`. Apply those
values only in a disposable checkout/copy and never commit them or reuse the production identity.
The app/runtime keeps those dotted versions; `electron-winstaller` normalizes the NuGet package
versions in `.nupkg` filenames and `RELEASES` to `0.4.0-fixture1` / `0.4.0-fixture2`. Only a
fixture-version build accepts
`NODETERM_SQUIRREL_FIXTURE_URL`, and only for loopback HTTP(S); a stable or unrelated prerelease
must refuse that override. The production `dist:win` wrapper deliberately cannot create this pair:
the fixture manifest edits make the checkout dirty, while production provenance requires a clean,
publicly reachable exact commit. A dedicated fixture-only provenance route is still pending; do not
weaken the production clean-tree guard to manufacture the pair. Once that bounded route exists,
serve the second package with
`scripts/serve-squirrel-update-fixture.mjs`, install only in a disposable Windows Sandbox/VM,
wait at least 10 seconds after the normal `--squirrel-firstrun` app opens, quit it explicitly, then
launch the installed `.1` executable again with the feed environment. Resolve its install path
dynamically rather than assuming `%LOCALAPPDATA%`, verify
Settings → Updates / `app.getVersion()`, executable/package version metadata, and settings
persistence after `.2` applies. Quit the fixture and prove every process running from its exact
install root has exited before invoking that registration's Update.exe to uninstall. Building the
pair or exercising controller Chuts does not substitute for that packaged interaction, and the
fixture does not substitute for the separate production-identity `0.3.0` → `0.4.0` migration
proof. Until the fixture-only packaging route exists, that packaged interaction remains blocked
rather than partially verified.

### Server Edition container image

The root `Dockerfile` is a separate Node-runtime packaging path. `npm postinstall` is unusable in
that path because it rebuilds native addons for Electron's ABI; the deps stage uses
`--ignore-scripts` and explicitly rebuilds **both** `node-pty` and `smart-whisper` against the same
Node major the runtime stage uses. Rebuilding only node-pty produces a healthy terminal server whose
browser dictation fails later with a missing `smart-whisper/build/Release/smart-whisper` binding —
the health check cannot see that feature-specific native load.

The legacy image ran as root and therefore left existing `/data` volumes root-owned. The container
entrypoint exists solely to bridge that upgrade: while uid 0, it scans the literal `/data` filesystem
and changes only uid/gid-0 entries, without dereferencing symlinks, then `exec`s through `gosu` as the
image's `node` user (uid 1000), leaving Node as PID 1 so `docker stop` reaches the server's SIGTERM
handler. It must never follow `NODETERM_DATA_DIR`: that value is operator-controlled, and a hand-edited
`/` would turn a compatibility migration into filesystem-wide damage. A new image/compose/host-wrapper
change owes the real `node scripts/test-docker-host.mjs` smoke: build, health/auth page, both native
loads, uid of PID 1, graceful shutdown, volume persistence across restart and recreation, and the
first-boot-only password contract.

That smoke may target a local socket or an explicit `ssh://` Docker endpoint, but it must remain a
safe guest on a shared daemon. The selected endpoint is pinned on every command after inherited
context/TLS/builder controls are removed; `tcp://` and HTTP API endpoints are refused. Each run uses
a cryptographic UUID and preflights every exact name as absent. Its image, volumes, server, and
one-shot helpers all carry exact run/role/source-SHA labels, while image/container iid/cid files and
a volume creation fingerprint supply cleanup identities. Runtime containers publish no port, use
`network=none`, have CPU/memory/swap/PID/no-new-privilege/capability limits, and the HTTP/auth/asset
probe executes inside the server container with its password arriving only over stdin. Cleanup
rechecks identity and labels before removal and a zero-residue label scan is part of the green
verdict. The predeclared recovery journal lives outside the checkout, pins the daemon identity, and
`--cleanup-run <uuid>` is the only recovery route; it refuses a daemon, resource-identity, or label
mismatch rather than adopting a lookalike.
SSH host trust remains the user's persistent OpenSSH policy: the harness removes an inherited
`DOCKER_SSH_COMMAND`, never disables host-key comparison, never creates an ephemeral trust store,
and never mutates the user's SSH configuration.

The wrappers create the first-boot password before starting the build. Root `.env` and the wrappers'
`.env.bak` / `.nodeterm-env-*` temporary files therefore belong in **both** `.gitignore` and
`.dockerignore`: Git exclusion alone still sends them through `COPY . .` into the BuildKit context
and cache. Wrapper starts pin the Compose file/project/profiles and export the exact password,
loopback bind and port they validated. Do not replace that with a partial dotenv parser: Compose
accepts whitespace, quotes, colon delimiters and predefined control variables that can otherwise
redirect the stack or bypass the loopback decision.

**Backend check feed** (`src/core/check.ts`, successor to the static `announcements.json`): the
**main process** calls `GET https://api.nodeterm.dev/v1/check?version=&os=&channel=stable` (so the
renderer CSP stays `'self'`) on launch + every 6h, cached 5 min, returning `{ messages, update }`.
Exposed split over two IPC handlers: `announcements.fetch()` → `messages`, `appUpdatePolicy` →
`update`. `components/AnnouncementBanner.tsx` (stacked above `UpdateCard` under the tab bar in a
`.top-banners` column) shows the newest message the user hasn't dismissed (dismissed `id`s persist
in `localStorage`); `update.mandatory`/`minSupported` flips `UpdateCard` into a blocking required-
update state. The call no-ops under `DO_NOT_TRACK`/`NODETERM_TELEMETRY_DISABLED` or in unpackaged
builds (unless `NODETERM_API_BASE` targets a local server). Schema example:
`docs/announcements.example.json`.

**The banner is fail-closed by KIND, not blocklisted** (`renderer/lib/announcementPolicy.ts`,
pure + unit-tested). `classifyAnnouncement` reads title, body AND `url` and returns
`operational | promotional | unknown`; `shouldShowAnnouncement` renders ONLY `operational`.
Promotional beats operational, and `unknown` never renders. The previous filter was allow-by-
default — it hid a list of known nag phrasings and showed everything else — and a feed entry
announcing an iOS app on the App Store ("we'd really appreciate it if you could subscribe …")
walked straight through it, because that wording was in no list. **An unclassified message is
exactly how the next promo gets in**, so silence is the safe failure. Do not "fix" this back
into a blocklist, and do not let the feed self-declare its kind: `level` is a remote-supplied
COLOR, and a `kind` field the untrusted publisher fills in hands the bypass right back. The
cost is bounded on purpose — a forced update rides `update.mandatory` to `UpdateCard` and never
passes through this predicate, so refusing a mixed message here cannot strand anyone on an
unsupported build. Applies to Desktop and Server Edition alike (one renderer); the mobile
companion is a separate private repo and owes its own gate. **Telemetry** (`src/main/telemetry.ts`) is a separate opt-out
ping to `api.nodeterm.dev/v1/telemetry` (version/OS on launch + daily), gated on
`settings.telemetryEnabled` + the same build/DNT guards; toggle in Settings → Privacy.

## Windows support

**`docs/windows-support.md` is the single page for this** — what is fixed, what is still missing,
and the pattern behind it. Read it before touching anything path-shaped.

The theme, because it recurs: almost every Windows defect found so far is code that is genuinely
CORRECT on POSIX. `fs.rename` is atomic; `split('/')` splits a path; `startsWith('/')` means
absolute; a bare catch on unlink means "already gone". Each is true on the platform most of this
was written on and false on the one it ships to, so none of them looks wrong to a reviewer, a type
checker, or a suite whose fixtures are POSIX paths. Twice now, one file in the tree already
documented the trap and none of the twenty others doing the same thing knew — which is why these
are enforced by scanning guards rather than by comments.

Native `path.basename` is not a cross-dialect parser: it follows the process that is reading the
string. A transcript written on Windows can later be indexed by a Linux Server Edition, and a
POSIX filename may legally contain a backslash while a Windows desktop reads it. Recorded paths
without owner metadata use `core/path-basename.ts`: anchored drive/UNC syntax selects
`path.win32`; everything else selects `path.posix`, preserving ambiguous backslashes as text.
Every consumer test carries both dialects so replacing the helper with native basename is red on
either host.

## Building on Windows: close the app first

`npm run dist:win` and `npm run rebuild` both run electron-rebuild, which deletes and recompiles
node-pty. **Windows refuses to delete a DLL mapped into a live process**, so any running instance —
a `npm start` dev window, a packaged build, a leftover from a test run — makes the build fail with:

```
⨯ [Error: EPERM: operation not permitted, unlink '...
ode-ptyuild\Release\conpty.node']
⨯ node-gyp failed to rebuild '...
ode-pty'
```

Nothing in that says "close the app", and the usual reactions (admin terminal, reinstall
`node_modules`, blame antivirus) all fail because none of them is the cause. It is invisible on
macOS/Linux, where unlinking an open file is ordinary — so it only bites on the platform this
project ships.

After Node bootstrap, `download-dependencies.bat` runs
`scripts/ensure-windows-build-toolchain.mjs`, `scripts/ensure-windows-python.mjs`, and then
`scripts/check-build-preflight.mjs`, all before `npm ci`/`npm install`. The toolchain phase installs
Build Tools + the C++ workload on a fresh machine, or modifies an existing instance, and always
selects the separate rolling component
`Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre`; ARM64 hosts also add
`Microsoft.VisualStudio.Component.VC.Runtimes.ARM64.Spectre` while retaining x86/x64. The installed `setup.exe` receives
`modify --installPath ... --add ... --quiet/--passive --norestart` without `--wait` (unsupported
there); only the fresh-machine bootstrapper receives `--wait`. Both routes independently recheck
the workload plus real `.lib` files for every required architecture below
`VC\Tools\MSVC\*\lib\spectre` instead of trusting exit zero. A fresh machine uses the exact Microsoft
bootstrapper URL in `dependencies.manifest.json`, hashes it in Node, stages it beneath protected
Program Files, and runs it only on a match; privileged executable lookup never trusts inherited PATH.

Visual Studio has no user-scoped Build Tools installation, and Microsoft requires programmatic
quiet/passive changes to start elevated. The script prechecks the token: unelevated callers exit
with ERROR_ACCESS_DENIED before starting an installer or UAC and print an absolute command ending
in `--silent --elevated-toolchain-only`. Only that helper command may run elevated. The helper then
exits; the root BAT must be rerun normally, and explicitly refuses to continue into per-user Python
or npm under an Administrator token. Do not “helpfully” add `Start-Process -Verb RunAs`: `/s`
promises no prompts, and ordinary dependency installation is automatic too. This is measured, not
inferred: an unelevated quiet modify parsed every option, then exited 5007 saying it must be run
elevated from the beginning.

Python is a separate prerequisite, not part of `Microsoft.VisualStudio.Workload.VCTools`:
`smart-whisper` runs node-gyp in its install lifecycle, and the root postinstall rebuilds it and
`node-pty`. The helper accepts a proven 64-bit Python 3.10-3.14; otherwise it installs pinned Python
3.13 per-user with no launcher or persistent `PATH` mutation. Bare `py.exe`/`python.exe` aliases are
not probed because current Windows aliases can install or open UI. Canonical winget is tried first, then
the exact python.org URL/SHA fallback. Exit zero is followed by an isolated exact patch/architecture
probe, and the absolute executable crosses `setlocal` in process-local `PYTHON`,
`NODE_GYP_FORCE_PYTHON`, and `npm_config_python` so stale inherited node-gyp settings cannot win.

The preflight placement means both root BAT entry points name the exact locked file and PID even on
a machine that started with no Node on `PATH`. The old pre-dependency placement skipped the check
on exactly that fresh-machine path and never retried it before npm removed `node_modules`. The
preflight independently checks the **Spectre-mitigated MSVC libraries** too: node-pty's own
`binding.gyp` sets `SpectreMitigation`, that component is not part of a default C++ workload, and
without it the build dies minutes in with four copies of `MSB8040`. Deliberately not worked around
with `/p:SpectreMitigation=false` — node-pty asks for the mitigation on purpose, and disabling it
would ship an unmitigated native module. It reports EVERY failed precondition in one run, because
discovering them one at a time cost three separate multi-minute builds: the locked DLL hid the
missing Spectre libs entirely, since the rebuild never reached the compile. It detects the lock by opening each addon for WRITING (`r+`) and closing it — measured
against a genuinely locked `conpty.node`: **rename succeeded, open-for-read succeeded, only
open-for-write returned `EBUSY`.** The tempting proxy (can I rename it?) does not work, because
Windows blocks DELETE on a mapped image and a same-directory rename does not need it.

Also wired into `dist:win` and `rebuild`, deliberately **not** into `postinstall` — that runs
automatically in contexts a hard stop would be more disruptive than the underlying failure.

## Real POSIX-shell tests on Windows

Generated remote shell still needs to run under a real POSIX shell on Windows; skipping every
`/bin/sh` suite removes the only behavioral proof for quoting, fallback and credential transport.
The test adapter is `src/core/testing/posix-shell.ts`. It resolves Git for Windows' `usr/bin/sh.exe`
from `git --exec-path` (no assumed install directory), supplies that installation's `usr/bin` and
`mingw64/bin`, converts native paths to MSYS `/c/...` paths, and can place a fixture bin first only
after the shell has initialized.

The last point is load-bearing. Measured on this host, exposing only `Git\cmd` left 66 tests unable
to spawn `sh`; adding `Git\bin` made the shell available but its startup put `/mingw64/bin` ahead of
the fixture, so 16 tests called Git's real `curl` instead of the recorder. A native PATH prefix did
not prove fixture precedence. `posixShellScriptArgs` performs the prefix inside the running shell,
and its live collision test is deliberately named `curl`; changing it to an invented command would
let the original defect pass. AF_UNIX-only cases remain explicit Windows skips, while TCP, parsing,
fallback, credential-stdin and syntax cases all run through real Git Bash.

## Atomic writes (never a bare `fs.rename`)

Every store persists temp-file-then-rename. That is correct on POSIX and **silently lossy on
Windows**: `MoveFileEx` fails with `EPERM` whenever the destination is open by anyone at that
instant, and what opens a file you just wrote is Defender's real-time scanner, the search indexer,
OneDrive over a synced profile, or two of our own concurrent writers racing one destination. The
save throws and the data is gone — intermittently, unreproducibly, and **more often on the machines
that are best protected**.

`renameAtomic` / `writeFileAtomic` (`src/core/fs-atomic.ts`) retry briefly. Each attempt is still
one indivisible rename, so a retry cannot tear a write. They deliberately do NOT retry forever
(several callers report a failed save as `persisted:false`, and that contract outranks a save that
eventually lands), do not retry `ENOENT`/`ENOSPC`, do not branch on platform (or the behaviour under
test on a Mac is not the behaviour shipped to Windows), and never swallow the final error.

**A unique temp name owes random UUID entropy. `Date.now()` and pid-plus-counter are not global
dimensions** — two bridge calls routinely start in the same millisecond, while containers can both
be PID 1, worker isolates share a PID with separate module counters, and the OS reuses PIDs after
crashes. `tempNameFor` owns UUID uniqueness while retaining pid/sequence for ownership and
diagnostics. The cleanup is equally strict:
`sweepStaleTempFiles` never reads “foreign pid” as “dead process”; desktop multi-instance mode and
two Server Edition processes can deliberately share a directory. It never auto-deletes a
PID-bearing temp: signal-0/`ESRCH` is namespace-local and cannot prove a writer on a shared volume
is dead. Only the exact historical ownerless `<target>.tmp` shape is collectible after the 24-hour
grace. Credential clear paths use `clearAtomicTarget`: it removes the canonical file without
sabotaging that possible writer, inspects for every canonical-lowercase-v4 or legacy temp, and
rechecks the canonical path last. The PAT/cookie/token callers propagate `clear-incomplete` while
bearer bytes remain, inspection fails, or a concurrent publisher recreates the destination.

**Unique paths prevent splicing, not stale generations.** A writer that snapshots a whole document
must also serialize publishes (or reject an out-of-date generation). `agent-status-mirror.flush`
demonstrated the separate race: flush A captured old state and slept while publishing, flush B
published new state, then A woke and atomically replaced it with the complete but stale document.
A FIFO fixed that only inside one process; desktop multi-instance mode and two Server Edition
processes aimed at one data directory have independent queues. The mirror now uses a two-phase
cross-process protocol (`core/mirror-publication.ts`): reserve the next durable generation under a
SQLite `BEGIN IMMEDIATE` transaction **before snapshotting**, write the UUID temp without holding
the transaction, then lock again, re-read the canonical generation, and rename only if it is still
older. Gaps are valid (a process may crash after reservation); an absent generation on an old v1
mirror is generation zero. The sidecar and canonical reads fail closed on malformed/unreadable data
rather than resetting the counter. Contention retries are bounded, but timeout only abandons this
best-effort flush: it never steals from a live owner. SQLite's OS file lock is released when a
process crashes, with no heartbeat window or successor lock that a resumed old owner could remove.
The lock realpaths the parent before the mirror exists, so symlink aliases of one data directory
cannot split it. The reservation is the linearization point: this prevents a lower, already-
reserved generation from publishing after a higher one, but deliberately does not merge two
independently disagreeing in-memory stores or infer semantic freshness from wall-clock call order.
The real two-process barrier test parks generation 1 after its temp write, lets generation 2
publish, releases generation 1, and must stay red if the final generation comparison is removed.
The crash test holds the real transaction in one live process (proving the peer stays blocked),
aborts the owner without JS cleanup, and proves that same peer immediately acquires and publishes.
This orders peers running the generation-aware build; an already-running older binary does not know
the lock or field and must not share the directory during a rolling upgrade.

**A serializing FIFO must not double as a fuse, and a background save must not be `void`-ed.**
`AtomicJsonArrayStore` (`core/atomic-json-store.ts`, shared by the converter queue and the Ollama
pull queue) orders whole-document publications behind one promise. Written as
`this.writing = this.writing.then(() => write(items)); return this.writing` it fails twice on a
single rejected write, and both failures are silent. `rejected.then(onFulfilled)` never calls
`onFulfilled`, so the chain stays rejected forever and **every later save is skipped without
touching the disk** — one transient Windows `EPERM` (the exact case `renameAtomic` exists for)
disables that queue's persistence for the life of the process while the in-memory queue looks
healthy. The same rejected chain is also what fire-and-forget callers received, so it resurfaced
later as an unhandled rejection attributed to an unrelated save. `save()` therefore keeps the
internal chain SETTLED (a failed write only ORDERS the next one, it never cancels it) and returns a
separate promise that still carries this write's real error; do not collapse the two values back
into one. Callers that cannot await — `ConverterService.persistInBackground` — attach a handler
rather than `void`, because an unhandled rejection terminates the process by default on every
supported Node, which would turn a failed advisory snapshot into a dead main process. Pinned by
`core/atomic-json-store.test.ts` and `core/converter/service.background-persist.test.ts`; both go
red on the one-liner and on `void`.

**Credential documents hold a separate cross-process transaction across the strict read.** A
save-only queue cannot close load → mutate → save lost updates, and a process-local FIFO does not
coordinate Desktop and Server Edition processes sharing one data directory.
`core/fs-transaction-lock.ts` uses SQLite `BEGIN IMMEDIATE` across strict read, mutation, exact-
revision publication, clear, and prune. Enqueue begins before the read; only `ENOENT` is empty.
Corrupt/unreadable canonical bytes and sidecars remain evidence and fail closed. The lock rendezvous
realpaths the existing parent so symlink/junction aliases converge, and publication compares the
SHA-256 revision read inside the transaction immediately before rename.

Do not replace this with a PID/timestamp lease. A suspended process keeps SQLite's OS lock, process
death releases it, and bounded busy retry uses a monotonic deadline ending in `lock-timeout` without
deleting foreign ownership evidence. `SecureStore.mutate` applies this physical-file-global rule
to toy-lock and authenticator credentials, rejecting duplicate/non-v4 IDs and malformed documents.
Scheduled Home Assistant set/clear/alternate-format cleanup/prune uses one directory transaction;
provider-cookie, shared-mode, and Desktop/Server GitHub credentials use the same primitive. GitHub's
controller FIFO begins before network validation so a later Clear cannot be resurrected by an
earlier Save. Separate processes have no shared pre-validation clock and are ordered at their final
SQLite transaction entry. The real process Chut proves blocked stale reads, crash release, bounded
busy timeout, alias convergence, queue recovery, and exact corrupt-evidence preservation; replacing
`BEGIN IMMEDIATE` with `BEGIN` must turn the barrier red.

The SQLite module is loaded only after `core/node-runtime.ts` has performed the exact startup
preflight. Keep it lazy: a static `node:sqlite` import is evaluated before either shell can print an
actionable incompatibility error. The supported runtime is
`^22.22.2 || ^24.15.0 || >=26.0.0`; package engines,
the headless installer, the pinned container stages and both shell preflights are one contract.
`scripts/check-node-runtime.mjs` also opens and closes an in-memory database, because a version
number does not prove a custom build or a runtime launched with `--no-experimental-sqlite` exposes
the capability.

**Nothing in the toolchain catches the bare version.** 28 files had it, across three spellings — the user's canvas, their
settings, their sealed credentials, their pinned devices — and every one of them reads as a correct
atomic write, because on the platform most of this was written on it is one. The only signal in a
6,000-test suite was one store's overlapping-saves test, red on Windows for that store's whole life.
So it is enforced by scan: `src/core/fs-atomic.guard.test.ts` covers core, both shells and the
standalone session host, and fails on any bare `fs.rename` outside the two publication helpers
(`core/fs-atomic.ts`; `session-host/state-file.ts`, which cannot import core). Full write-up,
including the separate shared-temp-name bug at the same sites:
**`docs/atomic-writes.md`**.

SSH/scp staging follows the same ownership rule outside direct `fs` calls. Atomic remote stdin
writes use `src/main/remote-atomic-write.ts`: a bounded `.nodeterm-<uuid>.tmp` leaf is placed beside
the target BEFORE both complete paths are quoted, then the shell preserves the write/move status
while cleaning that exact temp. The temp leaf must stay independent of the target leaf — appending
`.uuid.tmp` to a valid `NAME_MAX` target makes the write impossible. It currently protects
filesystem API writes, tmux.conf, the private hook endpoint, node
tokens, agent status and pending answers; generated hook scripts/config merges still use their
existing direct writes and must not be described as atomic. Upload directories use UUIDs across app
processes. Downloads and media-cache copies use hidden UUID `.part` names; user-visible downloads
also hold an exclusive candidate lock until the rename and cleanup finish. Never simplify any of
those back to `<target>.tmp` / `<target>.part` or a read-only "does the destination exist?" check —
the overlap tests exercise the resulting race.

## Conventions

- **Two docs, two audiences — keep both.** This file holds the deep invariants with their
  reasoning and measurements; it is dense on purpose and is loaded automatically by coding agents.
  **`CONTRIBUTING.md` is the short human door**: setup, the process-boundary rules, the house rules
  that get a PR sent back, and the testing habits. When you change or discover something **other
  developers must know before touching the code** — a boundary that is now enforced, a trap that
  costs an hour to diagnose, a habit that catches a class of bug — **add it to `CONTRIBUTING.md`
  too, not only here.** An invariant that lives only in this file (or worse, only in a commit
  message) is one refactor away from being violated by a contributor who never opened it. Keep the
  split by audience, not by topic: the _why it must be this way_ stays here, the _what you need to
  know before your first PR_ goes there.

- Code comments, UI strings, and identifiers are all in **English**. Match this when editing.
- Path aliases: `@shared/*`, `@renderer/*` (see the tsconfig files / vite config).
- **Subagent model:** when dispatching subagents (implementers, reviewers, etc. — e.g. in
  the subagent-driven-development workflow), use the latest model, **Opus 5**
  (`claude-opus-5`). This overrides any cheaper-model defaults in a skill's model-selection
  guidance.
- **Three surfaces — design every feature for all of them.** nodeterm now ships on three
  fronts, and a feature is not "done" until you've decided how it behaves on each (even if
  the decision is "not applicable here"):
  1. **Desktop** (Electron) — the primary app (`src/main` + `src/renderer` via the preload).
  2. **Server Edition** (Linux, browser) — `src/server` + the `src/renderer/bridge` shim (see
     the `src/server/` bullet above and docs/SERVER.md).
  3. **Mobile companion** — _nodeterm mobile_, a **separate PRIVATE repo** (`nodeterm-ios`)
     — outside contributors cannot see or PR it, so a mobile implication is raised in the
     desktop PR and **@eneskirca** is mentioned to carry it over
     (SwiftUI + SwiftTerm/Citadel, tmux-integrated, talks the `TerminalTransport`/RemoteTransport
     protocol).

  **The canvas and the kanban board are TWO VIEWS of the same nodes — treat the board as a
  first-class surface, not an afterthought.** Every session/node feature you add to a canvas node
  (a header action, a context-menu item, a status badge, file drop, dictation, …) should be
  considered for the kanban **card** and its **card modal** too, so we don't keep shipping a
  feature on one view and then bolting it onto the other in a follow-up. The board already mirrors
  most of the node's surface: the card modal co-attaches the same tmux session (`ModalTerminal`),
  carries the node's actions (search / dictate / AI-name / comments), accepts file drops
  (`terminal/file-drop.ts`), renders browser webviews (`BrowserSurface`), and its cards support
  right-click actions + `+ New`. When you touch a node's UI, ask "does the board need this too?"
  and wire it through `KanbanView`/`SessionCard`/`CardModal` in the SAME change. Kanban itself is
  desktop+Server-Edition (pure renderer + `workspace.save`); the iOS board is a separate read/move
  mirror (`nodeterm-ios`, `KanbanGrouping`/`ProjectBoardView`).

  Practical rules that keep the surfaces in sync:
  - **Put new service/main-process logic in `src/core` behind `CorePlatform`, never inline in
    `src/main`.** That is the seam the Server Edition boots from — logic left in `src/main`
    silently doesn't exist on the server (the `no-electron` tests enforce the boundary, but
    they can't tell you a feature is _missing_ server-side).
  - **A feature that touches `window.nodeTerminal` needs a real `src/renderer/bridge`
    implementation, not just a stub** — or a deliberate, documented graceful degrade
    (`E_UNSUPPORTED` + the affordance hidden, like the Electron-only `shell.reveal`). The
    bridge's `satisfies NodeTerminalApi` gate forces you to _declare_ every member, but a
    `noopUnsub`/`unsupported` stub compiles fine while doing nothing — decide per member.
  - **Consider whether the mobile companion should surface the feature** over its
    transport/protocol. It's a different repo and stack (Swift), so this is usually a
    follow-up note rather than same-PR work — but flag it so it isn't forgotten.
    When a change is genuinely desktop-only (native menus, auto-update, Keychain), say so; the
    point is to make the call consciously, not to leave the other surfaces to rot.
