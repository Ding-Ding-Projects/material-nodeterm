# Windows session host

**What this is:** a tmux-equivalent session-persistence backend for Windows (and any other
platform where a real `tmux` cannot be found), so closing the app — or the app crashing — no
longer kills every running terminal and every agent CLI mid-task. It is a standalone,
long-lived Node process that owns the real PTYs and outlives the Electron app.

This document describes the Windows desktop implementation. It does not embed Microsoft Windows
Terminal, and it does not change the Server Edition or mobile companion.

Selected automatically, per session, in this order:

```
real tmux found on this machine  →  tmux (unchanged, every platform)
no tmux found, tmuxEnabled       →  session host (this document)
neither                          →  plain shell (no persistence, as before)
```

Stock Windows provides no native tmux, so the session host is the normal persistence backend
there. On macOS/Linux nothing changes: if tmux is installed, it is still preferred every time.

## Why not just port tmux's approach

tmux does not exist on Windows, full stop — there is no binary to bundle. The session host is a
from-scratch analogue built out of three pieces this codebase (or the wider Node ecosystem)
already has good building blocks for:

1. A **real PTY** per session — `node-pty`, the same dependency the rest of the app already uses.
2. A **server-side terminal emulator** per session — `@xterm/headless` + `@xterm/addon-serialize`,
   so the host can answer "what does this screen currently look like" without a human ever having
   looked at it. This is the piece tmux gets from its own C implementation; here it's the same
   xterm.js core the renderer itself uses, just running headless in Node.
3. A **tiny bespoke IPC protocol** (newline-delimited JSON over a local named pipe / unix socket)
   instead of tmux's binary control-mode protocol, because there is no existing "attach to a named
   session and stream its output" primitive to reuse on Windows.

## Architecture

```
Electron main process                    Session-host process (standalone, detached)
┌─────────────────────┐                  ┌──────────────────────────────────────────┐
│ PtyManager           │                  │ net.Server (named pipe / unix socket)     │
│  spawnSession()      │  local IPC       │  ── per-connection: hello + dispatch      │
│   └ SessionHostPty ──┼─── (JSON lines) ─┼─→ Map<name, HostSession>                  │
│      (IPty-shim)     │                  │      ├─ node-pty IPty  (the real process) │
│                       │                  │      ├─ TerminalEmulator (headless xterm) │
│  session-host-client  │                  │      └─ subscriber sockets (co-attach)    │
│   (one connection,    │                  │                                          │
│    auto-spawns host)  │                  │  exits when its last session is killed,  │
└─────────────────────┘                  │  plus a grace window (see "Lifetime")     │
                                           └──────────────────────────────────────────┘
```

- `src/session-host/` — the standalone process. Pure Node, no Electron dependency anywhere in
  this directory (verified: it does not even import `../core` or `../main`). Bundled with esbuild
  (`npm run host:build`, mirroring the existing `server:build` script) to
  `out/session-host/host.cjs`, with `node-pty` kept external (native module — the same reason
  `server:build` externalizes it).
- `src/core/session-host-client.ts` / `session-host-launcher.ts` / `session-host-backend.ts` /
  `session-host-pty.ts` — the Electron-main-side client. `src/core` stays Electron-free
  (`no-electron.test.ts`); these files import only `net`/`fs`/`crypto` and the pure protocol/paths
  modules.
- `src/core/pty-manager.ts` — the integration seam: `Session.sessionHost?: boolean`
  marks a session-host-backed `Session`, and every call site that reaches past `session.proc` to
  run a tmux CLI command directly (`sendText`, `paneCommand`, `captureSession`, `captureSnapshot`,
  `snapshotScrollback`, `captureForResync`, the final kill in `destroySession`,
  `listNodetermSessions`) gained one `else if (!this.tmuxPath) { … session-host equivalent … }`
  branch, in the same shape the existing `sshRemote` branch already used. `spawnSession()` selects
  this backend between the tmux branch and the plain-shell fallback, and constructs a
  `SessionHostPty` instead of calling `pty.spawn` directly.

## Windows profile resolution

The profile catalog is a trusted desktop service. Its public API returns only a stable `id`,
display label, kind, availability, and an optional unavailable reason. Executable paths and argv
remain private. `PtyCreateOptions.profileId` crosses the desktop bridge; the trusted core validates
and resolves it immediately before either `node-pty` or the session host spawns a process.

Stable ids are `auto`, `pwsh`, `windows-powershell`, `cmd`, `git-bash`, `custom`, and one
`wsl:<distribution>` per installed WSL distribution. `auto` is the only profile allowed to search
down a precedence list: PowerShell 7, then Windows PowerShell, then `%COMSPEC%`/`cmd.exe`. An
explicit unavailable or malformed profile fails; it never becomes a different shell.

For WSL, distribution discovery parses the UTF-16/NUL-padded output of
`wsl.exe --list --quiet`. The selected distribution's own `wslpath` translates the Windows project
directory, after which launch keeps the structured `wsl.exe -d <distribution> --cd <linux-path>`
prefix and runs a trusted distro-side cwd guard before replacing it with the configured default
shell. The guard independently changes to the positional Linux path so a directory removed after
translation cannot silently open in `/`. Enumeration,
translation, and launch failures keep their real reason and perform no fallback spawn. A
distribution name containing spaces remains one argv element.

The profile id is a machine-local snapshot, not project content. `terminalProfileId`, legacy
custom `shell`, and advanced SSH execution values are removed from shared project files, portable
exports, and inbound canvas traffic. A shared file or peer can therefore neither inject argv nor
select a local executable. See
[`features/terminals/windows-shell-profiles.md`](features/terminals/windows-shell-profiles.md).

### The IPty-shim (why the integration is this small)

`PtyManager`'s entire co-attach / flow-control / subscriber / park / reap machinery operates on
`Session.proc`, and only ever calls `.onData()`, `.onExit()`, `.write()`, `.resize()`, `.pause()`,
`.resume()`, `.kill()`/`.destroy()` on it — never `.pid`, never anything ConPTY/Unix-specific.
`SessionHostPty` (`src/core/session-host-pty.ts`) implements exactly that subset, backed by the
session-host connection instead of a real OS pty. Cast at the one construction site in
`spawnSession()` (`as unknown as pty.IPty`), it is otherwise indistinguishable from a real
node-pty `IPty` to every other line in `pty-manager.ts` — every subscriber, every flow-control
ticket, every park/reap decision keeps working unmodified.

## The protocol

Newline-delimited JSON, defined in `src/session-host/protocol.ts` (imported by both sides — it is
the one module the standalone bundle and the Electron-main bundle genuinely share). Every request
carries a monotonic `id`; the host echoes it on the response, so replies self-correlate over one
long-lived connection (no positional-FIFO fragility, unlike this app's tmux control-mode client).

| Verb (`SessionHostRequest.cmd`) | tmux equivalent                         | Coverage |
|---|---|---|
| `hello`                          | (no tmux equivalent — auth handshake)   | full |
| `attach`                         | `new-session -A` / `attach-session`     | full, plus a screen the tmux path never needed (see below) |
| `hasSession`                     | `has-session -t <name>`                 | full (implemented; not on the hot create path — see below) |
| `write`                          | raw bytes on an attached client's stdin | full |
| `resize`                         | ConPTY/pty resize + `refresh-client -C` | full; each view claims a size and the effective grid is the componentwise minimum |
| `pause` / `resume`               | node-pty `pause()`/`resume()`           | full; per-viewer in core and per-connection in the host (first pause / last resume) |
| `sendKeys`                       | `send-keys -l -- <text>` (+ `Enter`)    | full — works with no attached client, exactly like tmux |
| `paneCommand`                    | `display-message -p '#{pane_current_command}'` | approximated — see `process-tree.ts` |
| `capture`                        | `capture-pane -p -e [-S -N]`            | full, and strictly more (mode restoration — tmux's plain-text capture carries none) |
| `killSession`                    | `kill-session -t <name>`                | full |
| `detach`                         | a client's own `tmux detach-client`     | full |
| `listSessions`                   | `list-sessions -F '#{session_name}'`    | full |
| `ping`                           | (liveness probe used during the startup race) | full |

**Not implemented — deliberately out of scope for this pass:**

- `paneOwner` / bracketed-paste detection (`bracket_paste_flag`) / `#{cursor_x} #{cursor_y}
#{cursor_flag}` as a _separate_ query. These are real tmux features this app also uses
  (`pty-manager.ts`'s `paneOwner`, `bracketPasteRequested`, `paneCursor`), but none of them are in
  the task's minimum verb list, and cursor position is already carried for free inside `capture`'s
  output (`SerializeAddon` repositions the cursor as part of its own serialization — see below), so
  a separate cursor query would be redundant for this backend specifically. A session-host-backed
  node simply never calls the tmux-only paths that use these (they stay gated on `this.tmuxPath`
  being set, which it never is when session-host is selected).
- The tmux control-mode "shadow client" / shared background-write client
  (`PtyManager.shadowAttach` / `shared`). Session-host does not need an equivalent at all: unlike a
  tmux CLI command (a whole subprocess per invocation), every session-host verb is a stateless
  request over the ONE already-open connection, addressed by session name — the exact problem the
  shadow-client machinery exists to make cheap for tmux is simply not a problem here. See the
  `sendKeys`/`paneCommand`/`capture` rows above: none of them need an attached client.

## The seeding trap (read this before touching `spawnNew`/`join`/`SessionHostPty`)

CLAUDE.md's tmux section states the load-bearing rule for THAT backend: on a warm reattach, the
renderer must **seed nothing**, because tmux's own attaching client repaints the screen by itself
(the redraw arrives as ordinary PTY output, over the same channel as everything else). Writing
into the buffer yourself on top of that is what produced black bands and duplicated screens in an
earlier design.

**The session host is not a painter.** Attaching a new connection to an existing `HostSession`
does not make anything repaint itself — nothing writes fresh bytes into the pty on attach. Get
this backwards in either direction and you ship a visible bug:

- Seed nothing on this backend (copying the tmux rule verbatim) → the reattached terminal is
  **blank** until the next byte of real output arrives.
- Seed unconditionally on every backend → the tmux backend gets a **duplicated screen** on top of
  its own real redraw.

The fix is `Session.proc.ready` + `PtyCreateResult.screen`, used exactly the way the pre-existing
co-attach JOIN path (`PtyManager.join()`) already used `screen` for a same-process second
subscriber — this task did not have to invent a new field, only populate the existing one from a
new source:

- `SessionHostPty.ready` resolves with `{fresh, screen}` from the SAME `attach` round trip the
  constructor kicks off. `fresh: true` (cold start — nothing to paint) or `fresh: false` with a
  `screen` string reconstructed from the host's live headless terminal.
- `spawnNew()` awaits `ready` (after `spawnSession()` returns) and folds `screen` into the
  `PtyCreateResult` it hands back — the exact field `join()` already populates for a same-process
  co-attach.
- A rejected `ready` is a failed create, never a cold-but-working terminal. The provisional local
  `Session` is detached and removed, queued output is cancelled, and the original error reaches the
  renderer. Racing creates wait behind that result instead of joining the provisional index entry;
  a detached relay receives a non-zero sink exit because its legacy API cannot return a promise.
- **The renderer needed zero changes.** `seedPaint()` (`src/renderer/terminal/terminal-config.ts`)
  already treats _any_ non-empty `screen` on a `warm-attach` replay as paintable
  (`create-screen`), regardless of whether it arrived via a co-attach join or a plain reattach —
  that generality already existed, unused by anything but `join()`, before this task. Verified by
  reading `seedPaint`'s body rather than assumed.

Relay/mobile attach does not use that renderer create round trip: it asks
`PtyManager.sessionExists()` and `captureSnapshot()` before `attachDetached()`. Those two public
leaves must route through `sessionHostHasSession` / `sessionHostCapture` when tmux is absent. If
they fall back to the older tmux-only implementation, a live Windows-hosted agent is reported as
fresh and its phone mirror starts blank even though the session host still owns it.

### Private-mode restoration (mouse tracking, bracketed paste, …)

A pane's cursor position and its DEC private modes (has the app running inside it requested mouse
tracking? bracketed paste? is it on the alternate screen?) are not visible in plain captured text.
tmux's own answer to this is `PtyCreateResult.coAttachMouse` / `CO_ATTACH_MOUSE_SEQ` — a hardcoded
mouse-enable sequence the renderer writes because tmux's `capture-pane` carries no mode
information at all, and this app always runs tmux with `mouse on`.

The session host does better, because `@xterm/headless` + `@xterm/addon-serialize` know the real
mode state:

- **Verified, not assumed** (read `SerializeAddon`'s compiled `_serializeModes()` in
  `node_modules/@xterm/addon-serialize/lib/addon-serialize.js` rather than trusted the docs):
  `serialize()`'s output already restores application-cursor-keys, application-keypad,
  bracketed-paste, insert mode, origin mode, reverse-wraparound, send-focus, wraparound, the
  alt-buffer switch, AND the cursor position — all embedded directly in the returned string as
  ANSI escape sequences.
- **The one known gap:** `SerializeAddon` does not emit `CSI ?1006h` (SGR extended mouse
  coordinates) even when mouse tracking is active — there is no separate field on the public
  `IModes` API for it to read (`mouseTrackingMode` only says which tracking _protocol_ is on:
  none/x10/vt200/drag/any, not the coordinate _encoding_). Filled in explicitly by
  `TerminalEmulator.serialize()` in `src/session-host/terminal-emulator.ts`: whenever
  `mouseTrackingMode !== 'none'`, `\x1b[?1006h` is appended by hand.

Because all of this rides inside the `screen` string itself (as real escape sequences the
renderer writes verbatim), **`PtyCreateResult.coAttachMouse` is never set for a session-host
session** — there is nothing left for that separate flag to carry.

### Output ordering, flow ownership, and geometry

`@xterm/headless` applies `Terminal.write()` asynchronously. A PTY data callback therefore does
not mean the emulator is ready to serialize that byte yet. `HostSession.recordOutput()` chains
those promises in arrival order, and every warm attach, capture, resize and final exit crosses the
same tail before it reads or disposes the emulator. Do not replace that with a fire-and-forget
`void term.write(data)`: a relay/phone can then receive a warm snapshot missing output the host has
already observed, and an attach racing a pending write can get the same chunk once live and once in
its seed. The new socket joins the subscriber set only _after_ the barrier and snapshot, which is
the other half of avoiding that duplicate.

That promise tail is also a memory boundary. Bytes accepted but not yet applied to xterm are
counted as UTF-8; at 4 MiB the host takes an emulator-flow ticket and pauses node-pty, then returns
only that ticket after the queue drains to 1 MiB. This ticket is independent from both explicit
renderer flow control and named-pipe backpressure. Likewise, a `socket.write()` returning `false`
takes one transport ticket for every session subscribed on that socket, and only that socket's
`drain` returns it. A drain must never cancel a renderer pause or an emulator backlog.

Ownership is preserved at both aggregation layers. Every in-process `SessionHostPty` is a distinct
pause and geometry owner even though all of them share one `SessionHostClient` socket. The client
sends a pause only on the local 0→1 edge and a resume only on 1→0; the host then combines that one
connection-level ticket with other process sockets. Geometry follows the same shape: the client
reduces its live view claims, the host reduces all socket claims componentwise, and it resizes the
PTY and headless terminal before serializing a warm screen. Detaching a viewer recomputes the
grid.

**The client's reduction is "most recently active", not "smallest".** Under tmux a
phone mirroring a node is its own tmux client, and tmux's default `window-size latest` gives the
window to whichever client was active last — so a phone that dismissed its keyboard got its rows
back. Here the phone (a relay-served `SessionHostPty`) and the desktop node share ONE client
socket, and the old componentwise minimum held the phone to the desktop node's rows with nothing on
screen saying why. `latestClaimSize` (`core/pty-size.ts`) now picks the claim with the highest
recency: an attach, a claim that CHANGES (a re-fit to the same size does not count, or every fit
would steal the session), and a write that is not a terminal report (`core/terminal-reports.ts` —
every attached xterm answers a DA/CPR/OSC query, and counting those would hand the session to
whoever answered last). Three rules come with it:

- **A viewer that cannot adapt is a ceiling.** Every renderer view renders the size it is told
  (`pty:size`: letterbox a smaller grid, clip a larger one, as a tmux client does). A pty wider than
  the phone's screen would wrap into garbage there, or — rendered at the pty's size — be clipped to
  its left ~45 columns, so a relay sink is `bounding` unless `pty.attach` carried
  `resizedFrames: true`, and the chosen size is clamped componentwise to every bounding claim. The
  iOS app keeps it that way on purpose: it reads `OP.Resized` only to explain the empty band
  ("Sized to another screen") and to offer "Fit this screen", which re-claims the size with a
  rows+1 → rows wiggle (an unchanged claim is not activity). Because the phone clears that hint
  every time it sends a size, the host ANSWERS every sink report, unchanged or not — the sink's
  `sinkShown` is forgotten on each report.
- **The pty's real size flows back to every viewer.** `SessionHostPty.onSize` → `PtyManager`
  `applyBackendSize` → `pty:size` to each view whose xterm is not already at it, and `OP.Resized`
  (payload = `OP.Resize`'s, 2× uint16 LE) to the relay sink. A session-host `Session` only VOTES in
  `applySize`; its views are corrected from the backend's answer, which the client sends after every
  vote, changed or not.
- **The host's `geometry` push is negotiated at hello, never assumed.** `hello` carries
  `features: ['geometry']`; the host answers with the subset it speaks and pushes `geometry` frames
  (and adds `geometry` to attach replies) ONLY on connections that asked. This is not caution: an
  older client treats every push frame that is not `data` as an EXIT, so a geometry frame sent to it
  retires a live session on the first resize (`session-host/geometry-host.test.ts` pins it against
  the real bundled host). Against a host without the feature the client reports its own applied size,
  which is exact while it is the host's only connection. Across connections (two apps on one host)
  the HOST still takes the componentwise minimum.

The same name is also a generation boundary. Data and exit events contain a session name but no
generation id, so an exiting `HostSession` remains registered until its queued output, final exit
broadcast and disposal complete. A same-name attach waits on that retirement promise before it can
spawn a replacement. The old socket may therefore see its old exit before the new attach response,
but the replacement can never receive an indistinguishable delayed exit from its predecessor. The
whole wait/inspect/create decision is serialized per session name; otherwise two concurrent attach
requests can both wake from the same retirement promise, both observe the empty slot, and spawn two
PTYs before either continuation publishes its choice. Grace-exit cancellation is part of that
atomic claim and runs after the wait, so it also cancels any new empty-host timer retirement just
scheduled before the replacement was created.

### Reconnect (a dropped client connection is not a dead session)

Sessions live in the host process, not in the client. If the Electron-main-side connection drops
(a transient IPC hiccup — not the host dying), `SessionHostClient` begins bounded automatic
reconnect attempts while any desired subscriber remains; an idle viewer does not stay frozen until
some later keypress. Establishing the socket includes an awaited restoration barrier. It replays
every still-live attachment with the local effective geometry and aggregate `paused` flag before
the request that triggered the reconnect is allowed onto the wire. The host applies that pause
before snapshot or live subscriber activation, so output cannot leak through the reattach window.

Any returned `screen` is delivered through the ordinary `onData` path as a full-buffer replacement:
`CSI 3J` clears scrollback, `CSI 2J` clears the viewport, home resets the cursor, and the serialized
screen restores the authoritative cells and DEC modes. Omitting `CSI 3J` merely clears the visible
page and duplicates xterm scrollback after every reconnect. Reusing the ordinary data channel keeps
this recovery local to the session-host client instead of adding a separate renderer resync IPC.

Restoration is never fire-and-forget. A delayed replay attach cannot overtake `hasSession`, `write`,
or a confirmed `killSession` and resurrect the deleted name afterward. If a desired resume, detach,
or replay acknowledgement is transport-ambiguous, the client destroys that socket so the host's
close handler releases all connection-owned tickets, then reconnects and replays only the still-live
desired state. A final unsubscribe racing an in-flight attach schedules a compensating detach after
the attach settles, preventing a ghost subscription.

The `hello` hand-off owns named `connect`/`data`/`error`/`close` listeners. It removes only those
listeners, installs the production frame listener, and then resolves the connection promise. Never
restore broad `removeAllListeners('data')` cleanup here: the original ordering installed the
production listener and immediately deleted it, so all real responses disappeared while the socket
still looked connected.

An initial `attach` registers its local subscriber before sending because startup output may race
the response. If the request rejects, it rolls back only that subscriber and its own remembered
options; a concurrent co-attach remains intact. Empty capture and already-absent kill are confirmed
host responses, while transport rejection remains unknown and propagates. That distinction keeps a
failed snapshot dirty for retry and prevents deletion from claiming an unconfirmed persistent
process is gone.

The same truth boundary reaches the renderer. `pty.destroy` is an acknowledged request on both the
Electron preload bridge and the Server Edition WebSocket bridge. Canvas, sidebar, project, and
agent-control deletion paths remove local nodes and recovery state only after the backing kill is
confirmed; validation, rate-limit, and transport failures keep the node present and retryable.

### A provisional attach is not a session

An `attach` is provisional until the host has authenticated the connection and returned the
correlated successful response. `PtyManager` does not index that shim, report it as persistent, or
expose it to subscribers before `SessionHostPty.ready` resolves.

If the attach is rejected, times out, or the transport fails:

- the provisional shim is destroyed and never enters the persistent-session index;
- queued bytes and a late exit from that rejected shim are ignored;
- every caller coalesced behind the same in-flight create receives the real attach failure;
- failed subscriber registrations are rolled back, so reconnect cannot replay a ghost attach;
- capture or kill transport uncertainty remains an error rather than being read as absence; and
- no plain shell or different profile is spawned as a substitute.

This is deliberately fail-closed. A non-persistent fallback carrying the same node identity would
look healthy while losing the one property this backend promises, and could run a local command in
the wrong shell or directory.

The `hello` hand-off has an equally strict ownership boundary. The handshake installs named
`connect`/`data`/`error`/`close` listeners, accepts only the response carrying its captured hello
request id, removes only those listeners, and then installs the production frame listener before
resolving the connection promise. Never restore broad `removeAllListeners('data')` cleanup here:
the original order installed the production listener and immediately deleted it, so the first
`attach` response and every later frame disappeared while the socket still looked connected.

An initial `attach` registers its local subscriber before sending because startup output may race
the response. If the request rejects, it rolls back only that subscriber and its own remembered
attach options; a concurrent co-attach's state is left intact. Capture and kill preserve the same
failure distinction across reconnects: an empty capture and an idempotently absent kill are both
confirmed `{ok:true}` host responses, while a transport/request rejection remains unknown and is
propagated. That propagation is what lets the periodic snapshot keep its dirty bit for a retry and
what prevents a delete from claiming a persistent process is gone when the host never confirmed it.

The `hello` hand-off has an equally strict ownership boundary. The handshake installs named
`connect`/`data`/`error`/`close` listeners, accepts only the response carrying its captured hello
request id, removes only those listeners, and then installs the production frame listener before
resolving the connection promise. Never restore broad `removeAllListeners('data')` cleanup here:
the original order installed the production listener and immediately deleted it, so the first
`attach` response and every later frame disappeared while the socket still looked connected.

An initial `attach` registers its local subscriber before sending because startup output may race
the response. If the request rejects, it rolls back only that subscriber and its own remembered
attach options; a concurrent co-attach's state is left intact. Capture and kill preserve the same
failure distinction across reconnects: an empty capture and an idempotently absent kill are both
confirmed `{ok:true}` host responses, while a transport/request rejection remains unknown and is
propagated. That propagation is what lets the periodic snapshot keep its dirty bit for a retry and
what prevents a delete from claiming a persistent process is gone when the host never confirmed it.

## Staged host runtime

A host launched from Squirrel's `app-<version>` install directory would map the installed
executable, its DLLs and `resources.pak`, so that directory could not be retired while its sessions
live. Ported from upstream (`src/core/session-host-runtime.ts`), the staged runtime runs the host
from a private copy instead.

**What happens.** In a packaged Windows build, before the app spawns a host it stages a private
copy of the runtime into

    %LOCALAPPDATA%\node-terminal-session-host-runtime\app-<app version>-<fingerprint>\
        session-host-runtime.exe             (the Electron executable, renamed)
        *.dll, icudtl.dat, resources.pak, snapshot_blob.bin, v8_context_snapshot.bin, locales\
        resources\session-host\host.cjs + node_modules\node-pty\...
        nodeterm-runtime.json                (marker: file list, sizes, SHA-256)

and launches the host from there. The fingerprint hashes every source file's path, size and mtime,
so a reinstall of the same version with different bytes gets its own directory. `app.asar` is not
copied (the host never reads it). The staging root comes from `CorePlatform.sessionHostRuntimeDir`,
which the desktop supplies only for a packaged Windows build.

**Why the copy is more than the executable.** The previous staging copied only the executable and
the host bundle. An `ELECTRON_RUN_AS_NODE` process also needs Node's ICU data (`icudtl.dat`) and the
executable's load-time DLLs, so that copy could not be expected to start; the set above is the
conservative one an `ELECTRON_RUN_AS_NODE` process can plausibly touch, and the smoke run below is
the per-machine proof. It was not measured on a device (checklist item 1).

**Never a half-staged directory.** Files are copied into `.staging-<uuid>` beside the target, each
copy is re-read and compared by SHA-256 to what was read from the install directory, and the copy is
smoke-run once: `session-host-runtime.exe -e ...` with `ELECTRON_RUN_AS_NODE=1` must load, `require`
its own node-pty and exit `42`. Only then is the marker written, and the directory is published by
one `renameAtomic`. A directory without a valid marker (or whose files no longer have their recorded
sizes) is moved aside and restaged, never launched. Two app processes staging the same version at
once both succeed: the second rename loses and adopts the first one's directory.

**Fail closed.** Every staging failure (no `%LOCALAPPDATA%`, a missing required file, disk full, a
failed hash, a smoke run that does not answer 42 within 60 s, an AppLocker or WDAC policy blocking
executables under the profile) makes the launch fail with a named error; the node then falls back
to a non-persistent shell and reports why, as for any other unavailable host. A first launch of a
new version waits at most 45 s for staging; past that the launch is refused and the finished copy
serves the next one. A staging failure is remembered for the rest of the app run. Staging progress
and failures are appended to `<userData>\session-host.log` with an `[app]` tag. Unlike upstream,
there is no fallback to a launch from the install directory: that would pin the old `app-*` tree.

**Old copies.** After staging, copies other than the current one are collected, fail-closed: only
when a Win32_Process query SUCCEEDS, no `session-host-runtime.exe` process has an unreadable path,
nothing runs from under that directory, the directory is older than 10 minutes, and renaming it
aside succeeds (Windows refuses while an image inside is mapped). A failed query deletes nothing.
A host started by an older version therefore keeps its copy for as long as it runs; once it exits
(30 s after its last session), the next app launch removes that copy. The `app-<version>` copies
the previous, executable-only staging published are collected by the same rule.

**Versions talk to each other.** There is one host per user-data directory, whichever runtime
started it. A newer app connects to a host started by an older runtime through the existing
negotiation: the state file's protocol version and the `hello` feature list
(`SESSION_HOST_FEATURES`, e.g. `geometry`, `shutdown`). New sessions go to that host as long as it
is compatible; it exits by itself once it empties, and the next host is launched from the current
version's copy. The rule for every future change: **the host protocol is additive-only**. A new
command or push frame is negotiated at `hello`, never assumed, and an app never kills a host to
replace it.

## Updates, "Prepare for update" and the host shutdown command

Because the host runs from its own copy, a Squirrel update installs while every session keeps
running. The running host keeps its **older** version until it stops. "Prepare for update..." (the
command palette, and the update card once an update is found or required) ends it on purpose,
without deleting a node:

1. It lists every session the host holds, across every project including closed ones, and refuses
   while any agent is working or waiting on the user (the renderer's agent store or the core status
   mirror), with a Go button for each.
2. It asks each idle, resumable agent on a mounted node to quit cleanly through the
   `registerAgentUpdateExit` registry. (The TerminalNode registration is not wired yet; until it is,
   every idle agent is listed as "stops without a clean exit" and resumes from its last saved turn.)
3. It says what still stops (shells, agents not on the canvas, sessions on no canvas) and confirms
   with Cancel focused.
4. It asks the host to shut down, and quits the app only once the host confirms it is gone.

The host's `shutdown` command is gated on a negotiated `shutdown` hello feature. It refuses new
sessions while it runs, ends every session through the existing kill path (a bound per session),
replies, removes its state and token files and exits after the reply flushes. A kill it cannot
confirm fails the whole shutdown by name and the host keeps serving. The client's
`inspectForUpdate` / `shutdownForUpdate` never launch a host, send `shutdown` only to a host that
advertised it, latch against reconnecting into a fresh host, and report "shut down" only once the
state file and the pid are gone. A host from an older build gets the manual steps
(`MANUAL_UPDATE_STEPS` in `src/shared/update-prep.ts`); there is no kill fallback.

The three IPC channels (`app:update-prep-inspect`, `app:update-prep-shutdown`,
`app:update-prep-quit`) are raw `ipcMain` handlers that refuse any sender except the main window and
are listed in `HOST_ONLY_CHANNELS`. The Server Edition bridge answers `unsupported`, so both entry
points stay hidden there; the mobile companion has no equivalent. Upstream's NSIS installer
preflight (`windows-update-preflight.ps1`) is not part of this fork: Squirrel has no installer gate
to refuse on.

## Lifetime

Mirrors tmux's server lifetime rule as closely as a different OS allows:

- **Spawned detached, unref'd, `stdio: 'ignore'`, `windowsHide: true`**
  (`session-host-launcher.ts`) — survives the spawning app process exiting entirely.
- In a **packaged** app the host is launched only from a verified staged copy of its runtime under
  `%LOCALAPPDATA%/node-terminal-session-host-runtime/` (see "Staged host runtime" below), with
  `ELECTRON_RUN_AS_NODE=1`, which runs plain Node without Chromium or a window. Squirrel can
  replace its own `app-*` directory without touching that mapped runtime. If no staged copy can
  be produced the launch is refused; it never falls back to the install directory.
- The client probes the existing state, token, and pipe before resolving or staging any runtime.
  A host from a previous app run therefore remains the owner and receives warm attachments rather
  than being replaced during an upgrade.
- **One-time legacy boundary:** a host that an older release already launched from a Squirrel
  `app-*` directory cannot re-exec itself or transfer live ConPTY ownership. Do not terminate it for
  Setup. Keep its sessions attachable and postpone a full Setup install until they end naturally;
  every host launched after this change uses the stable runtime and no longer creates this lock.
- A client disconnecting **detaches only** — the underlying `node-pty` process, and the
  `HostSession` holding it, are completely untouched. This is the entire point.
- The app quitting detaches every client (the OS closes the sockets; the host's own `'close'`
  handler removes that socket from every session's subscriber set **and returns its pause
  ticket**) and leaves the host
  running. `PtyManager.killAll()` was NOT touched — it already never kills tmux sessions, and it
  correctly does nothing to session-host sessions either (no code path in it reaches this backend
  at all).
- The host exits when its **last session is killed** (`killSession`, or a session's own pty
  exiting naturally with nothing else left), plus a **30-second grace window**
  (`GRACE_EXIT_MS` in `host.ts`) so an app restart that briefly closes every node does not tear
  down a host about to be handed a fresh session moments later. A host that never receives a
  single real `attach` also eventually exits via the same grace timer, armed at boot.
- **Startup race** (two app instances launched at once, or two windows racing a lazy first
  connect): both processes may spawn a host. Exactly one may create the state file exclusively
  (`fs.openSync(statePath, 'wx')`); the loser polls that file (bounded, ~1.5s) waiting for the
  winner to finish writing `{pid, endpoint, tokenPath, …}` and answer a real `hello`, then exits
  quietly. A state file that resolves to nothing alive within that window is treated as stale
  (a previous host crashed mid-startup) and reclaimed. The same "connect first, only spawn if that
  fails" shape is what `SessionHostClient.doConnect()` does from the app side, so a host from a
  _previous_ app run is found and reused rather than duplicated.
  The winning state publication uses a PID+counter temp path and a bounded retrying atomic rename
  (`session-host/state-file.ts`, kept local so the standalone bundle does not import `src/core`). A
  fixed `<state>.tmp` lets a stale-lock reclaim collide with another publisher, and a bare rename
  loses startup when a Windows scanner briefly holds the destination open.
  Binding the pipe/socket is not the success boundary: token write and atomic state publication
  must both finish. If either fails, the host closes its listener, destroys any socket from that
  pre-publication window, removes its owned token/state/endpoint, and exits nonzero. This catch is
  explicit because the daemon's `uncaughtException` hook is diagnostic and suppresses Node's
  default fatal exit; letting publication throw into it creates an undiscoverable orphan host.
  Only `ENOENT` means an ownership file is absent. Unreadable, directory, malformed, and empty-token
  observations fail closed without reclaiming or launching a competing host. The client also
  requires the state file's exact protocol version before hello; because the host outlives app
  upgrades, silently connecting a version-2 client to a version-1 host would lose atomic pause and
  geometry restoration.

The spawned program follows the same resolver as a direct local PTY. With no explicit program and
an empty `settings.defaultShell`, Windows selects PowerShell 7, then built-in Windows PowerShell,
then `COMSPEC`/`cmd.exe`; the host must never substitute POSIX-only `bash` there.

## Auth — bearer token, never on argv

`crypto.randomBytes(32)` generated at host start, written to `<userData>/session-host.token` with
mode `0600`, read by every client before its first request and sent in a `hello` frame. Every
other request is refused (`unauthorized`, socket closed) until `hello` succeeds.

**This repository has a measured security incident from putting a bearer token on a command
line** (`docs/node-identity.md` — a hook bearer landed in a long-lived tmux client's
`/proc/<pid>/cmdline` at mode 444, readable by anyone on the box). The session host repeats none
of that shape: the token is never an argv element anywhere (the host is launched with only
`<scriptPath> <userDataDir>` — nothing sensitive), never an environment variable a `ps`/Task
Manager listing could expose, and never logged (`host.ts`'s own diagnostic log never includes it).

**Honest limitation on the transport itself:** the endpoint is a Windows named pipe / POSIX unix
socket. Node's default pipe/socket creation does not carry an explicit, verified per-user ACL in
this implementation — the bearer-token check is the load-bearing access control, not the
transport's own permissions, exactly as the task's instructions require ("Refuse any connection
whose hello token does not match, and close it" is implemented; a separately audited pipe DACL is
not). A local unprivileged process that can guess/observe the token could still connect; guessing
a 256-bit random hex token is not feasible, and observing it requires filesystem access to a
0600-mode file this app's own user account owns — the same trust boundary every other secret this
app already keeps at rest (accounts, hook tokens) relies on.

## Memory bound

Each `HostSession` holds one `@xterm/headless` `Terminal` with `scrollback` capped at
`settings.tmuxScrollback` (default 50,000 lines) — the exact same setting that already bounds real
tmux's `history-limit`, so a machine that already accepted the cost of N tmux panes accepts the
same order of cost for N session-host sessions. The per-session cost is a cell buffer sized
`cols × (rows + scrollback)`, plus `SerializeAddon`'s own transient string-building cost only at
the moment `serialize()` is actually called (attach, join, periodic snapshot, capture request) —
never held continuously. This is a genuinely new per-session cost the tmux backend does not pay
(tmux's server keeps its own C-side pane buffer regardless, but that cost is outside this app's
process); it was a deliberate choice per the task brief ("bound the memory... document the cost
you chose and why") rather than an oversight.

## Honest limitations

- **If the session-host process dies, or the machine reboots, its sessions die with it.** This is
  a strictly weaker guarantee than a real tmux server, which is a mature, independently-shipped C
  daemon this project does not maintain. The existing **cold-restore path** (persisted scrollback
  snapshot + agent `--resume`) already exists for exactly the "machine rebooted" case and applies
  here unchanged: `spawnNew()` correctly reports `fresh: true` when a fresh host has no record of
  a previously-running session, which is what triggers the renderer's cold-start replay
  (`attachReplay` → `'cold-snapshot'`) and the agent CLI's `--resume`. The periodic scrollback
  snapshot (`snapshotScrollback`) runs for session-host-backed sessions on the same 15-second timer
  as the tmux path, using the same on-disk format (`scrollback-store.ts` is entirely
  backend-agnostic — no changes needed there at all).
- **A WSL profile does not turn its distribution's tmux into the Windows backend.** nodeterm
  launches that distribution's default shell through `wsl.exe`, and the Windows session host owns
  the resulting process. A genuinely Windows-reachable tmux found by the existing resolver still
  follows the tmux path; a `tmux` installed only inside WSL is not on the native Windows PATH.
- **`paneCommand`'s answer can be imprecise** when a session has multiple concurrent child
  processes (an agent CLI plus MCP servers) — see `process-tree.ts`'s doc comment. The one caller
  that depends on it (in-place agent restart) only needs "is a shell back in charge of this pane
  yet", which every non-shell answer satisfies equally, so this imprecision is harmless for that
  caller specifically; a future caller with finer-grained needs should not assume more precision
  than this.
- **The node-pty actuator is global, so ownership is ledgered rather than guessed.** Within one app
  process, `pty-manager.ts` keeps a per-viewer/owner `pausedBy` ledger. The standalone host then
  keeps a second set keyed by authenticated socket: the first socket to pause actuates node-pty,
  an unrelated socket's resume is a no-op, and only the last owner leaving/resuming actuates
  resume. `detach` and transport `close` return that socket's ticket. This cannot give two
  connections independent output streams (node-pty has one read side), but it preserves the
  necessary slowest-viewer semantics and, critically, a crashed viewer can no longer freeze the
  live session for every healthy viewer forever.
- **Windows named-pipe/unix-socket ACL is not independently audited** — see "Auth" above; the
  bearer token is the enforced boundary.
- **No equivalent of `paneOwner` / `bracketPasteRequested` / a standalone `paneCursor` query** —
  see the protocol table's "Not implemented" note. Nothing in this app currently calls these for a
  session-host-backed node (they are gated behind `this.tmuxPath` being set), so nothing is
  silently broken; a future feature that wants one of these on Windows needs a new host verb.
- **ConPTY helper teardown can emit `Error: AttachConsole failed`** from
  `node-pty/lib/conpty_console_list_agent.js`. The protocol test determines kill success from the
  host response and follow-up session state rather than stderr text. Whether this cosmetic
  dependency message appears in the packaged app remains part of the pending artifact run.

## Automated verification

The focused suites exercise behaviour rather than scan implementation source:

- the Windows profile resolver covers detection precedence, standard Git Bash locations, custom
  absolute paths containing spaces, `%COMSPEC%`, unavailable executables, malformed ids, WSL
  UTF-16/NUL output, distribution names containing spaces, and cwd-conversion failures;
- resolver/spawn tests assert that `node-pty` and session-host creation receive only the trusted
  launch plan, and that explicit unavailable profiles perform no fallback spawn;
- `pty-session-host.test.ts` exercises successful creation plus provisional/rejected attach
  teardown, coalesced callers, late events, and the persistent result;
- `session-host-client.test.ts` uses real local sockets to exercise the hello transition,
  correlated responses, failed-subscriber rollback, reconnect replay, and transport uncertainty;
  and
- workspace/node-exec tests prove `terminalProfileId` never enters shared/exported/inbound state
  and that the local overlay survives reload.

The guards were mutation-checked by temporarily accepting a hostile profile, allowing a missing
WSL distribution to fall back, and removing machine-local stripping; each corresponding focused
test must turn red. The former source-text shell regression test is intentionally gone.

The original session-host implementation was also verified by hand against a real ConPTY session.
The ordering, connection-owned pause ledger, no-tmux relay probe/capture, platform shell selection,
and atomic state publication are now additionally behaviour-tested with adversarial scheduling and
injected sharing violations. That source/runtime evidence does not replace the packaged check.

### Direct ConPTY agent messages (separate from the persistent host)

The desktop can also hold a **non-persistent native PTY**, indexed by canvas node id but
without `Session.persistKey`. Checking only persisted sessions incorrectly returned `targetGone`
for such a running OpenCode. `hasLiveSession` now uses the common runtime lookup.

`core/native-windows-pane.ts` implements message delivery for those direct PTYs. It uses a
headless terminal for observed bracketed-paste mode and capture, and reads native executable
identity through console membership and an unambiguous shell-child chain. Process birth times
and a generation id detect replacement/PID reuse. It deliberately does not choose an arbitrary
deepest descendant, interpret prompt text as an executable, or accept a detached console.
This Windows ownership evidence is not POSIX foreground-group semantics; ambiguous console
trees refuse. An interpreter is identified by its script: the probe keeps only the first
positional argument (`CommandLineToArgvW`, inside PowerShell) and `scriptCommandName` resolves it
to the command its npm package publishes in `bin`, else to the script basename. Measured on
Windows 11 (2026-09-14) against a live Codex pane opened from the canvas: the PR-era probe read
`node` and the installed app refused `send` with `targetNotAgentPane (observed: node)`, while the
new probe read `codex` (`agent`) from the same console. A fake npm package in a separate console
confirmed the prompt argument never appears in the probe output. The
interpreter is the leaf; its children (a native `codex.exe`, MCP servers) do not count. Existing project consent, verified idle hooks,
delivery locks, post-write verification and receipt tracking remain in force.

The persistent host has a separate, additive messaging extension (`messageOwnerV1`,
`messagePasteReadyV1`, `messageEnvelopeV1`). `session-host/message-pane.ts` observes the OS console
under the **host's** session generation and reads the host's existing emulator after its output
barrier. Before sending, it repeats the identity probe, checks paste mode again, and confirms
that the same session object is still registered after every await. It then writes one sanitized
multiline bracketed paste, watches its own emulator until the envelope footer renders, and sends
Enter as a second write, only while the same generation is still registered
(`core/settled-submit.ts`, shared with the Server Edition). With the Enter inside the paste write,
Codex 0.154 left the envelope unsent in its composer and the delivery reported `stalled`. Main still owns the project/consent/hook/binary
and receipt gates. The direct adapter is never used for host-backed sessions.

A host-backed session stays addressable after the desktop releases its client (park expiry,
offscreen release). `targetLive` comes from `PtyManager.sessionExists`, and the three messaging
probes route by `sessionHostOwns`, which reads the release record when no `Session` is left and
otherwise applies `sendText`'s rule (no local tmux means the host owns persistence).

The extension is independently versioned so the existing terminal protocol v1/v2 is unchanged.
Old live hosts reject the new command names, and the client returns null/false without falling
back to `write`, `sendKeys`, or a local tmux. **Installing a new app does not upgrade an already
running host.** It must retire after its existing sessions have ended, at a user-coordinated time;
the next host starts from the new bundle. Never terminate a user's live host as an upgrade step.
There is no hot migration of an existing ConPTY generation to another host.

The upstream smoke and simulation scripts (`scripts/smoke-session-host-messaging.ts`,
`scripts/smoke-windows-agent-messaging.ts`, `scripts/sim-agent-messaging-windows.ts`) are not part of
this fork yet: they import the upstream messaging service module, which this fork keeps in
`src/main/agent-messaging.ts`. The installed-device acceptance upstream recorded (OpenCode
coordinator, architect and coder exchanging messages on direct Windows PTYs) has not been repeated
on this fork.

`PtyManager.sendText` keeps this fork's boolean IPC contract: a Windows delivery that pasted the
text but could not confirm its submit (`'pasted-not-submitted'`) answers `true`, because callers
treat `false` as "nothing was written, retry" and would paste the same text twice. The detailed
result is available from `sendTextResult` for a caller that can show the uncertainty.

### Launch-line delivery inside the host

The host's own launch delivery (`src/session-host/session.ts`) verifies both ends of the echoed
command line, not just its tail: an rc file reading the same tty can swallow the first character
while the tail echoes intact. Between retries it clears the pending line with the shell's own
gesture (`src/shared/shell-kill-line.ts`): Escape for PowerShell and cmd.exe, Ctrl-U for POSIX
shells. The renderer's delivery keeps this fork's Ctrl-C abort. An injected prompt is framed from
the pane's own bracketed-paste state (`src/session-host/send-keys-delivery.ts`).

## Packaged verification still owed

### Ported session-host, messaging and updater work: device checklist

Written and unit-tested on Linux in this fork; nothing below has run on Windows yet.

1. **Measure the staged file set.** On a packaged build, run Process Monitor filtered to
   `session-host-runtime.exe` during host start and an attach; record every file opened under the
   staged directory and prune the planned set in `session-host-runtime.ts` to it.
2. **Smoke run passes.** Fresh install, open a terminal: `session-host.log` shows
   `[app] staged runtime: published <key>`, and Task Manager, Details shows `session-host-runtime.exe`
   with a path under `%LOCALAPPDATA%\node-terminal-session-host-runtime\app-...`.
3. **Fail closed.** Block executables under the profile (AppLocker or WDAC): the smoke run fails,
   no host starts from the install directory, the node falls back to a non-persistent shell with a
   named reason, and the log says which staging step failed.
4. **Update with live sessions.** With the staged host holding live shells and agents, let Squirrel
   install the next build and restart: every session re-attaches warm to the same host pid; the old
   `app-*` directory is retired on a later launch.
5. **Prepare for update.** With idle agents, a plain shell and a closed project's session on the
   host, run "Prepare for update...": busy agents block with Go buttons, the confirm lists what
   stops, the host exits, the app quits, and the next launch starts a host from the new copy with
   every canvas node intact and agents resuming. Repeat against a host started by an older build:
   the manual steps appear and nothing is killed.
6. **Old copies.** After the old host exits and 10 minutes pass, the next launch removes its
   directory; with PowerShell blocked by policy nothing is removed.
7. **Defender / AV.** Time the first staging with real-time protection on and confirm a scan
   holding the new executable does not fail the publish rename.
8. **Agent messaging on a direct Windows PTY.** With persistence off, open two agent nodes and send
   a message between them: the envelope lands as one block and is submitted in a second write; an
   npm-installed CLI (Codex) is recognized as the agent, not as `node`.
9. **Agent messaging on a session-host pane.** Same through the persistent host, including a node
   released offscreen (still reachable) and a replaced process with the same PID (refused).
10. **Shared-session sizing.** Mirror a node to the phone over Relay, dismiss the phone keyboard
    while a shorter desktop node is attached: the phone gets its rows back; "Fit this screen" on the
    phone re-claims the size.
11. **Launch-line delivery.** A PowerShell and a cmd.exe pane whose first launch echo is mangled:
    the retry clears the line with Escape and the command runs once.
12. **No update channel.** A package built with `nodeTermUpdates=disabled`: "Check for updates"
    shows "No update channel" with the download link, never "You're up to date".
13. **Codex launcher PATH.** A managed Codex node on Windows finds `codex` (the launcher prepend
    lands on `Path`, and the child sees one path variable).

The real Windows x64 installer must still be exercised through the required cheap headless route:
create every available profile, verify input/output/resize/Unicode/copy/cwd and labels, relaunch
around a long-running process, switch a node through the destructive profile warning, and record
the picker, profile terminal, unavailable state, and post-relaunch reattachment. Until that built
artifact evidence exists, this document makes no claim that the full packaged verification has
completed.

`paneOwner`, `bracketPasteRequested`, the standalone `paneCursor` query, and independently audited
Windows named-pipe DACL hardening remain outside this profile pass as described under
"Honest limitations".

## What was deliberately not done

- The original implementation was verified by hand against a real ConPTY session. The ordering,
  connection-owned pause ledger, no-tmux relay probe/capture, platform shell selection and atomic
  state publication are now additionally behavior-tested with adversarial scheduling and injected
  sharing violations. A packaged installer launch on a separate Windows device is still owed (see
  `docs/windows-support.md`); these tests do not pretend to replace that device check.
- `paneOwner`, `bracketPasteRequested`, and a standalone `paneCursor` query were not ported — see
  "Honest limitations".
- Windows named-pipe DACL hardening beyond Node's own defaults was not attempted — the bearer
  token is the enforced boundary, documented as such rather than silently assumed to be perfect.
- The relay host's `createDetached`/`attachDetached` paths were left to fall through to
  `spawnSession()`'s new branch automatically (they call it directly with no prior async
  pre-check), so they work, but were not separately hand-verified end-to-end through the relay
  feature itself in this pass — only the primary create/join/reconnect/capture/kill paths were.
