# Windows session host

**What this is:** a tmux-equivalent session-persistence backend for Windows (and any other
platform where a real `tmux` cannot be found), so closing the app — or the app crashing — no
longer kills every running terminal and every agent CLI mid-task. It is a standalone,
long-lived Node process that owns the real PTYs and outlives the Electron app.

Selected automatically, per session, in this order:

```
real tmux found on this machine  →  tmux (unchanged, every platform)
no tmux found, tmuxEnabled       →  session host (this document)
neither                          →  plain shell (no persistence, as before)
```

On Windows, tmux is never found, so the session host is the default persistence backend there.
On macOS/Linux nothing changes: if tmux is installed, it is still preferred every time.

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
- `src/core/pty-manager.ts` — the one file with an actual seam: `Session.sessionHost?: boolean`
  marks a session-host-backed `Session`, and every call site that reaches past `session.proc` to
  run a tmux CLI command directly (`sendText`, `paneCommand`, `captureSession`, `captureSnapshot`,
  `snapshotScrollback`, `captureForResync`, the final kill in `destroySession`,
  `listNodetermSessions`) gained one `else if (!this.tmuxPath) { … session-host equivalent … }`
  branch, in the same shape the existing `sshRemote` branch already used. `spawnSession()`'s
  branch-selection `if/else if/else` chain gained ONE new `else if` between the tmux branch and
  the plain-shell fallback, and the `let proc: pty.IPty` construction now has a
  `useSessionHost` fork that constructs a `SessionHostPty` instead of calling `pty.spawn`
  directly. Nothing else in that ~3200-line file changed.

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
| `resize`                         | ConPTY/pty resize + `refresh-client -C` | full |
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
  #{cursor_flag}` as a *separate* query. These are real tmux features this app also uses
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
- **The renderer needed zero changes.** `seedPaint()` (`src/renderer/terminal/terminal-config.ts`)
  already treats *any* non-empty `screen` on a `warm-attach` replay as paintable
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
- **The one verified gap:** `SerializeAddon` does not emit `CSI ?1006h` (SGR extended mouse
  coordinates) even when mouse tracking is active — there is no separate field on the public
  `IModes` API for it to read (`mouseTrackingMode` only says which tracking *protocol* is on:
  none/x10/vt200/drag/any, not the coordinate *encoding*). Filled in explicitly by
  `TerminalEmulator.serialize()` in `src/session-host/terminal-emulator.ts`: whenever
  `mouseTrackingMode !== 'none'`, `\x1b[?1006h` is appended by hand.

Because all of this rides inside the `screen` string itself (as real escape sequences the
renderer writes verbatim), **`PtyCreateResult.coAttachMouse` is never set for a session-host
session** — there is nothing left for that separate flag to carry.

### Output ordering — a screen is a write barrier

`@xterm/headless` applies `Terminal.write()` asynchronously. A PTY data callback therefore does
not mean the emulator is ready to serialize that byte yet. `HostSession.recordOutput()` chains
those promises in arrival order, and every warm attach, capture, resize and final exit crosses the
same tail before it reads or disposes the emulator. Do not replace that with a fire-and-forget
`void term.write(data)`: a relay/phone can then receive a warm snapshot missing output the host has
already observed, and an attach racing a pending write can get the same chunk once live and once in
its seed. The new socket joins the subscriber set only *after* the barrier and snapshot, which is
the other half of avoiding that duplicate.

### Reconnect (a dropped client connection is not a dead session)

Sessions live in the host process, not in the client. If the Electron-main-side connection drops
(a transient IPC hiccup — not the host dying), `SessionHostClient` reconnects lazily on the next
call and replays `attach` for every session it still has local subscribers for
(`replayAttachesAfterReconnect`), delivering any returned `screen` as a synthetic repaint through
the ordinary `onData` path (prefixed with a clear+home so it reads as a clean redraw rather than
appending after whatever was on screen before the drop). This deliberately reuses the plain data
channel rather than wiring a dedicated `pty:resync` IPC round trip all the way up from this layer
— a smaller, self-contained fix for what is expected to be a rare case (the host survives a client
drop by design; only an actual host death turns into a real session loss).

## Lifetime

Mirrors tmux's server lifetime rule as closely as a different OS allows:

- **Spawned detached, unref'd, `stdio: 'ignore'`, `windowsHide: true`**
  (`session-host-launcher.ts`) — survives the spawning app process exiting entirely.
- In a **packaged** app, `process.execPath` is the Electron binary itself (there is no separate
  `node` executable to shell out to), so the child is spawned with `ELECTRON_RUN_AS_NODE=1`,
  which tells Electron to run as a plain Node process with no Chromium/BrowserWindow machinery.
  Harmless on a real Node binary too (dev mode): unrecognized, ignored.
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
  *previous* app run is found and reused rather than duplicated.
  The winning state publication uses a PID+counter temp path and a bounded retrying atomic rename
  (`session-host/state-file.ts`, kept local so the standalone bundle does not import `src/core`). A
  fixed `<state>.tmp` lets a stale-lock reclaim collide with another publisher, and a bare rename
  loses startup when a Windows scanner briefly holds the destination open.

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
- **A user who wants tmux-grade durability on Windows can install tmux** (WSL, MSYS2, Cygwin, a
  native Windows tmux port) — if a real tmux is found on the resolved PATH, it still wins, exactly
  as `findTmux()` already prefers a system tmux over anything this app bundles.
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
- **A cosmetic ConPTY artifact was observed, not investigated further**: killing a session-host
  child process on Windows sometimes prints `Error: AttachConsole failed` from
  `node-pty/lib/conpty_console_list_agent.js` to stderr during that process's own teardown. This
  fired during manual verification (see below) AFTER every protocol operation in that run had
  already completed and verified correctly (including the kill itself, confirmed by a follow-up
  `hasSession` returning `false`) — it is node-pty's own ConPTY helper-process teardown, unrelated
  to anything in this task's code, and it does not affect the host's own process exit or any
  session's correctness. Left as a documented observation rather than "fixed" — the underlying
  cause is inside `node-pty`, the same dependency this app already carries a documented patch for
  on macOS (`scripts/patch-node-pty.mjs`) for an unrelated leak.

## Verifying by hand

1. `npm run host:build` (or `npm run build`, which now runs it too) — confirms
   `out/session-host/host.cjs` exists.
2. Spawn it directly and drive the protocol with a small Node script (connect, `hello`, `attach`,
   `write`, `capture`, second `attach` from a new connection to confirm warm-reattach `screen`,
   `killSession`, `hasSession` after kill). This is exactly how the implementation itself was
   verified end-to-end during this task — a real ConPTY `cmd.exe` session, real output capture, a
   real second-connection warm reattach that correctly returned a non-empty `screen` containing
   prior output.
3. On a machine with no tmux on PATH (any stock Windows install), open a terminal node in the
   app, run something, quit the app, relaunch it — the terminal should reattach with its prior
   output visible (via the `screen` seed) and the process should still be running, exactly like
   the tmux backend's own promise on macOS/Linux.
4. Check `<userData>/session-host.log` for the host's own lifecycle log (start, listen, each
   attach/kill, grace exit) — this is the only visibility into a process with no attached console.

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
