# Contributing to nodeterm

Thanks for looking. This file is the short door: enough to get running, plus the house rules that
actually get a pull request sent back. The long version — every subsystem and the reasoning behind
its invariants — lives in `CLAUDE.md` at the repo root, which is also loaded automatically if you
work with an AI coding agent.

nodeterm is licensed **BUSL-1.1** (converts to MIT after four years — see `LICENSE`). Contributions
are accepted under that license.

## Getting set up

```bash
npm install        # also patches + rebuilds node-pty against Electron's ABI (postinstall)
npm run dev        # dev mode with renderer HMR
npm run typecheck  # tsc for both the node and web projects — the fastest correctness gate
npm test           # vitest, unit + integration
```

`npm run server:dev` boots the Server Edition (browser UI) if you are working on that surface.

### Refreshing the canonical upstream pin

`upstream/nodeterm` is a Git submodule pinned to the canonical
[`eneskirca/nodeterm`](https://github.com/eneskirca/nodeterm) repository. Initialize the recorded
pin after cloning with:

```bash
git submodule update --init -- upstream/nodeterm
```

The top-level checkout's `origin` and optional `upstream` remotes are separate from the nested
repository. Inside `upstream/nodeterm`, `origin` is the canonical repository, and `.gitmodules`
records `main` as the branch followed by `git submodule update --remote`. Refresh the pin only as
an intentional repository change:

```bash
git submodule sync -- upstream/nodeterm
git submodule update --init -- upstream/nodeterm
git submodule update --remote --checkout -- upstream/nodeterm
git -C upstream/nodeterm remote get-url origin
git -C upstream/nodeterm rev-parse HEAD
git add .gitmodules upstream/nodeterm
git diff --cached --submodule=log -- .gitmodules upstream/nodeterm
```

The URL check must print `https://github.com/eneskirca/nodeterm.git`. Review the new commit before
committing the gitlink; do not treat a fetch of either top-level remote as an upstream-pin update,
and do not commit edits made inside the nested repository.

The supported Node runtime is **`^22.22.2 || ^24.15.0 || >=26.0.0`**. This is a minor/patch
boundary, not
"Node 22" shorthand: the cross-process agent-status mirror uses `node:sqlite`, which was absent in
22.0–22.4 and remained opt-in through 22.12, while the locked dependency graph sets the stricter
floors above and excludes Node 23 and 25. Both Desktop and Server Edition probe the real
`DatabaseSync` capability at
startup, so a custom build or `--no-experimental-sqlite` fails before persistent services start.

**If `src/main/node-pty-patch.test.ts` is red, your `node_modules` is unpatched — not your code.**
Run `npm run rebuild`. node-pty 1.1.0 leaks a pty device per spawn on macOS
([node-pty#950](https://github.com/microsoft/node-pty/issues/950)); we patch its source before
`electron-rebuild` compiles it, and that test guards the patch surviving upgrades.

## Where code goes

The repo is split by Electron process boundary and the split is enforced, not advisory:

| Directory | What lives there |
|---|---|
| `src/core/` | Electron-free service core. Talks to its shell only through `CorePlatform`. |
| `src/main/` | The Electron shell around `src/core` — windows, IPC, dialogs. |
| `src/server/` | The Server Edition shell (browser UI over WS-RPC). |
| `src/preload/` | The only bridge: `contextBridge` exposing `window.nodeTerminal`. |
| `src/renderer/` | React UI. Reaches main *only* through `window.nodeTerminal`. |
| `src/shared/` | Types and IPC channel names imported by all sides. |

`src/core/no-electron.test.ts` and `src/server/no-electron.test.ts` fail if `src/core` or
`src/server` import `electron` or `../main/*`.

**Put new service logic in `src/core` behind `CorePlatform`, not inline in `src/main`.** That is the
seam the Server Edition boots from; logic left in `src/main` silently does not exist there, and the
boundary tests cannot tell you a feature is *missing*.

## Three surfaces

A feature is not done until you have decided how it behaves on each — even if the decision is "not
applicable here":

1. **Desktop** (Electron)
2. **Server Edition** (Linux, browser)
3. **Mobile companion** — *nodeterm mobile*, a **private** repo (`nodeterm-ios`, SwiftUI). You
   cannot open a PR against it, so this is normally a follow-up note rather than same-PR
   work: say in your PR what the mobile side would need, and **mention @eneskirca** so it
   gets picked up there. "Not applicable" is a fine answer — just make it a stated one.

Anything reachable from `window.nodeTerminal` needs a **real** implementation in
`src/renderer/bridge/`, or a deliberate, documented degrade. The `satisfies NodeTerminalApi` gate
forces you to *declare* every member, but a no-op stub compiles fine while doing nothing.

**A globally mounted panel does not inherit the active project's session.** Drawers mounted above
the project-keyed `SessionProvider` see the root/local API, and `window.nodeTerminal` is likewise
the viewer's local preload. Any panel action that operates on a core-owned machine — files,
converter queues, Ollama models, and similar namespaces — must resolve the active project through
`useActiveSessionApi()` / `sessionForProject(activeProjectId)`. If that session does not implement
the capability, show its `E_UNSUPPORTED` refusal; never fall back to mutating the viewer's machine.
App-global capabilities such as the clipboard intentionally remain local.

The **canvas and the kanban board are two views of the same nodes.** When you add something to a
canvas node — a header action, a badge, a menu item — ask whether the board's card and card modal
need it too, and wire it in the same change.

## House rules

- **Anything path-shaped: read `docs/windows-support.md` first.** Windows is the delivery target
  and most of this was written on macOS, so the recurring defect is code that is genuinely correct
  on POSIX — `split('/')`, `startsWith('/')` as an is-absolute test, a bare `fs.rename`. Use
  `path.basename`/`join`/`sep`, publish files with `renameAtomic`, and write at least one test with
  a real `C:\`-shaped input. Guards enforce some of this and will fail your PR. In the Server
  Edition and relay tabs, the browser's OS is NOT the filesystem's OS: obtain the dialect from the
  core that owns the files, and keep an unobserved host unknown rather than guessing. Conversely,
  on POSIX a backslash is legal filename text — do not treat both separators as interchangeable
  unless the owning filesystem is known to be Windows. Native `path.basename` also follows the
  current process, not a serialized path: for records that can cross hosts, select `path.win32` or
  `path.posix` from explicit owner metadata or anchored drive/UNC syntax instead of the runner OS.

- **Building on Windows requires a callable Node runtime in the supported range
  `^22.22.2 || ^24.15.0 || >=26.0.0`, the Visual Studio C++ workload plus Spectre libraries, a
  supported 64-bit Python, and an unlocked native-module tree.** The root BAT reuses a supported
  PATH Node, obtains one through winget when suitable, or falls back to the exact SHA-pinned
  portable manifest version. It verifies or repairs the toolchain and Python, then runs the
  two-check preflight before npm can replace `node_modules`; `npm run dist:win` and rebuild rerun
  that preflight up front.
  Close every running instance of the app first: Windows will not delete a DLL a live process has
  loaded, so a dev window you forgot about makes the build die with an `EPERM` about a `.node`
  file that says nothing about the real cause. The bootstrap detects the
  **Spectre-mitigated MSVC libs** and repairs them through the separately elevated helper-only
  command when needed — node-pty asks for the mitigation in its own `binding.gyp`, and without them
  the build dies minutes in with `MSB8040`. Visual Studio changes require elevation; the script
  never triggers UAC, so an unelevated run exits access-denied and prints one exact
  **helper-only** command. Run only that helper elevated, close the Administrator prompt, then rerun
  the root BAT normally — npm lifecycle scripts must never inherit elevation. The BAT also ensures
  x86/x64 are always checked and ARM64 is added on ARM64 hosts. The BAT also ensures a supported
  per-user Python for node-gyp, with SHA-pinned fallbacks for machines without winget, and exports
  the verified interpreter through every node-gyp precedence channel.
  The preflight names the PID holding a file and independently verifies the component, reporting
  both problems at once. Neither check can fail on macOS or Linux.

- **Windows packaging and Windows updating are one Squirrel contract.** `npm run dist:win`
  produces an unsigned `Setup.exe`, `RELEASES`, and full `.nupkg`; the installed app consumes that
  set with Electron's built-in updater, not `electron-updater`'s NSIS metadata. Stable update
  continuity depends on the existing Squirrel package id `node-terminal`: do not enable
  `useAppIdAsId`. The runtime and installed shortcut AppUserModelID must both remain
  `com.squirrel.node-terminal.nodeterm`, derived from the effective package id and executable.
  Stable update authority is one manually dispatched release from `main`, tagged exactly with a
  newly advanced stable package version. Never publish a feature-branch build behind
  `releases/latest/download`,
  never manufacture byte progress that Squirrel does not expose, and handle Squirrel lifecycle
  arguments before loading the normal app. The one-shot button controls an immediate restart; a
  downloaded update can still apply on the next normal launch, so the stable publisher—not a
  post-download UI check—is the channel boundary. Use the isolated `0.4.0-fixture.1` →
  `0.4.0-fixture.2` loopback fixture in a disposable Windows VM/Sandbox for a real update proof;
  that proves the new updater code, not the one-time production migration. Installed Windows
  `0.3.0` expects NSIS metadata at the old generic feed and cannot discover the Squirrel `0.4.0`
  release. Separately prove `0.3.0` → `0.4.0` with the downloaded Setup while the old app is
  closed and while it is running, then document which sequence is supported. Closing first is a
  provisional recommendation, not a verified fact. The collision-safe fixture identity and
  loopback runtime contract exist, but its dedicated dirty-manifest-safe packaging provenance
  route is still pending; do not weaken the production wrapper's clean-tree/exact-commit guard to
  create fixture artifacts. The Server Edition and mobile companion do not use this desktop
  installer.

- **Never publish a file with a bare `fs.rename`.** Use `renameAtomic` or `writeFileAtomic` from
  `src/core/fs-atomic.ts`. On Windows a rename fails with `EPERM` whenever anything has the
  destination open — Defender scanning the file you just wrote, the search indexer, OneDrive — so
  the plain version loses saves intermittently and only on other people's machines. A test scans
  for this and will fail your PR; `docs/atomic-writes.md` explains why the retry is safe. Every
  temp/part staging name must also be unique per call across processes and cleaned by its owner,
  including paths embedded in generated SSH commands or handed to scp. Keep a remote temp's leaf
  bounded so a UUID suffix cannot turn a valid maximum-length target into `ENAMETOOLONG`.
  Names require random UUID entropy; PID and sequence are ownership/diagnostic fields only. Never
  sweep a PID-bearing temp merely because its pid differs or signal-zero reports `ESRCH`: those
  checks are namespace-local. `sweepStaleTempFiles` collects only the exact aged ownerless legacy
  `<target>.tmp` shape, while current writers remove their own UUID temp on failure. The relay
  advertisement uses the same conservative sweep and leaves malformed, young, unreadable, and
  unjudgeable candidates untouched. Credential Clear uses `clearAtomicTarget`, rechecks the
  canonical path, and surfaces `clear-incomplete` while recognized temp evidence remains.

- **Unique temp files do not order whole-document writers.** If two flushes can snapshot the same
  store concurrently, publish them FIFO or reject stale generations. A read-modify-write FIFO
  begins before the read and ends after publication, and is keyed by the resolved physical file.
  Process-local ordering is insufficient for shared Desktop/Server directories: the mirror reserves
  a durable generation under SQLite `BEGIN IMMEDIATE` before its snapshot and checks the published
  generation before rename. Credential stores similarly hold their SQLite transaction across
  strict read, mutation, publication, clear, and prune. Only `ENOENT` means empty; corruption,
  unreadable bytes, lock evidence, and malformed metadata remain evidence and reject. A paused
  writer is not a dead writer, so there are no PID/timestamp leases; busy retries are monotonic and
  bounded. The exact revision is compared before rename, and controller queues begin before
  network validation so a later Clear cannot be overtaken. Keep the supported runtime floor and
  lazy SQLite capability loading in package metadata, installers, containers, and both shells.

These are the ones that come up in review most often. Each exists because its absence caused a real
bug.

**A failed read is never evidence of absence.** "Could not measure" and "there is nothing" are
different facts and must stay distinguishable at every layer. Collapsing them is how a panel ends up
reporting "no sessions" on a host running thirty.

For `scheduled-settings.json`, this rule includes startup: only `ENOENT` is an empty schedule.
Corrupt/unreadable evidence must remain untouched while both shells boot with overrides disabled,
surface the structured recovery state, and refuse a save that could overwrite it. Start/stop the
feature through `ScheduledSettingsRuntime`, not a shell-local store/service sequence. In the
renderer, release the scheduled-save in-flight owner on failure as well as success so one rejected
bridge request cannot wedge later edits.

**School Mode optional features require a confirmed-off record at their execution boundary.** The
renderer begins with `enabled: false` before it has loaded anything; that placeholder is not
permission to use Cantonese/bilingual copy, funny levels, personal vocabulary, dim sum, or
Cantonese narration. Use `schoolModeAllowsOptionalFeatures`, and re-check it immediately before an
effect or write. Both Canvas narrator paths must go through `canvas/narration-policy.ts`: enabled or
unknown School Mode keeps an opted-in English narrator, but never passes the persisted Cantonese
track or voice to `narrate()`. Keep the queue's actual-start check and selective Cantonese
invalidation too; canceling the whole narrator would wrongly discard English app errors, while
dropping a Cantonese-only track without its dormant English fallback would silence that event.

**Serialize a shared store's decision, not only its final write.** Atomic rename prevents torn
bytes, but it does not stop two callers from loading the same snapshot and publishing complete,
conflicting replacements. Funnel read-modify-write operations through one mutation API; the
approved-device store does this so an older approval cannot land after a revoke and restore the
revoked key. Only a checked `ENOENT` is an empty store — unreadable or corrupt data must stay an
error so the next mutation cannot overwrite it as if it were absent.

**A Git-backed history write must be fenced across processes, not only queued in one process.** This
store never shares its working file/index transaction: it writes an owner-unique replay journal,
builds through an owner-unique `GIT_INDEX_FILE`, and publishes with old-OID `update-ref` CAS. A loser
rebuilds; a crash is replayed. Never steal an aged/PID lock, delete a foreign index/journal, or use
`reset`/`clean` as recovery — a suspended live writer may still own it. Reads snapshot one exact
head OID, and restore accepts only a full reachable commit. Strip inherited `GIT_DIR`, worktree,
object-directory and namespace redirects; only the private index override is allowed. Git
calls/retries are bounded and hooks disabled. An unborn repository is a readable empty history. A
settings restore is not complete until the awaited history recorder settles, the renderer
cancels/epochs coalesced saves, joins dispatched saves, and rehydrates live state.

**Degrade to nothing, never to something wrong.** A probe that fails means the bare, safe command —
never a substituted nearest match. A hand-editable value that is unrecognised must yield the safe
default, never something more destructive than the default.

**Re-validate hand-editable values at the point of use**, not by their TypeScript type. Settings
are machine-local, while `.nodeterm/project.json` is git-shared; either can be hand-edited before a
value reaches an execution boundary.

**Windows terminal profiles cross the desktop boundary as stable ids only.** The public catalog may
expose `id`, label, kind, availability and a reason—never executable paths or argv. Resolve the id
inside the trusted core immediately before spawn. `terminalProfileId`, legacy custom `shell`, and
advanced SSH execution fields belong in `LocalNodeExec` and must be stripped from shared files,
exports, and inbound canvas traffic. Explicit missing profiles fail closed; only `auto` follows
PowerShell 7 → Windows PowerShell → `%COMSPEC%`/cmd.

**WSL cwd belongs to the selected distribution.** Parse `wsl.exe --list --quiet` as its real
UTF-16/NUL-padded output, keep names with spaces as one argument, and call that distribution's
`wslpath` before `wsl.exe -d <distribution> --cd <linux-path>`. A failed enumeration, translation,
or launch is an actionable error, never permission to guess `/mnt/<drive>`, switch distributions,
or open a different shell.

**Test generated shell for real.** If you generate a shell command, run it under an actual POSIX
shell (`/bin/sh` on POSIX) against a fixture tree. A composed fixture will not tell you that
`echo ##MEM` prints an empty line because `#` starts a comment.

On Windows, keep those tests real rather than blanket-skipping them. Use
`src/core/testing/posix-shell.ts`: it resolves Git Bash from Git's own installation, translates
native fixture paths to the shell's `/c/...` spelling, and puts fake tools ahead of Git Bash's
bundled tools *after* the shell initializes. Passing a native `C:\...` path into generated shell,
or prepending a fake `curl` only to the parent process's PATH, silently exercises the wrong file.
Only behavior that fundamentally requires an AF_UNIX socket should use an explicit Windows skip.

**Credentials never ride argv — local or SSH.** Not a tmux `-e` pair, not `curl -H`, not a remote
command string. `/proc/<pid>/cmdline` is mode 444 on a stock Linux, and a remote command line is argv
on the host too: we shipped the hook bearer that way and any other account on the machine could read
it and open a terminal running an arbitrary command. Pass secrets by 0600 file or by **stdin**
(`curl --config -`), and never add an argv fallback. See `docs/node-identity.md`.

**Server password admission is one ordered, bounded decision per TCP peer.** Do not put a synchronous
password hash back in the HTTP handler or split `loginAllowed` from the proof/result update: slow
request bodies can all pass an early check, and synchronous scrypt stalls every terminal socket.
`Auth.attemptPassword` owns the same-peer FIFO, bounded async-scrypt pool and authoritative checks
after each wait. Lockout identity comes only from `req.socket.remoteAddress`; forwarding headers,
cookies, user-agent and source port are caller-controlled or unstable. Peers have independent
failure/escalation/ladder state over one shared ladder-clear budget. Ladder and WebAuthn challenges
have per-peer plus process-wide ceilings; old ladder nonces cannot cross a rung transition, while
WebAuthn nonces bind the peer plus login/register purpose. Logout must delete the presented persisted
bearer before clearing its cookie. The deterministic barriers and restart replay proofs live in
`src/server/auth.test.ts`, `src/server/http.test.ts` and `src/server/unlock-ladder-routes.test.ts`.

**Phone-pairing credentials never ride plaintext LAN HTTP.** A pairing start must load and
advertise the host's NaCl public key; the client POSTs `{epk,box}`, and the success response is a
single encrypted `box`. If the host key or encryption is unavailable, pairing refuses before it
writes an SSH key or bearer. Never restore the old `{token,publicKey}` plaintext fallback.
`PairingPayloadInput.hostKey` is required, and `buildPairingPayload` must reject a missing or blank
value at runtime too; TypeScript alone does not protect stale compiled or hand-written callers.
Only `ENOENT` proves the pairing registry absent: corrupt, wrongly-shaped, or unreadable
`agent.json` must propagate without rewrite. Register a paired device before activating its SSH
key, so every possibly-live key remains visible and revocable even when the second write fails.
The key-append path also treats only `ENOENT` as absence; appending after an unreadable
`authorized_keys` read can splice two keys when the existing file lacks its final newline.
Likewise, revoke may treat only an `ENOENT` `authorized_keys` read as absence; every other read
failure must leave the visible registry entry in place rather than hiding a possibly-live SSH key,
and the UI must retain the row with an explicit retry/access warning. Take
`~/.nodeterm/agent.json.lock` before every authoritative registry read-modify-write and hold it
through the related key-file mutation. Atomic rename is not cross-process serialization, and a
lock timeout must fail closed rather than guessing that another writer is stale. Every external
  host-agent writer must honor the same lock protocol. Pairing owners also need a cryptographic
  attempt ID carried through start, targeted stop, and completion plus cancellation guards after
  every credential await: a stopped or superseded attempt may leave a visible registry record, but
  must remove any attributable key activated while cancellation was in flight and must not deliver a
  bearer. A renderer epoch alone is instance-local and cannot keep an unmounted surface from stopping
  a newly mounted replacement.

**The Server Edition image has two native addons, not one.** Both `node-pty` and `smart-whisper`
must be rebuilt for Node's ABI in the Docker deps stage; the normal postinstall targets Electron's
ABI and cannot be used there. The image's entrypoint always enters as root, limits that phase to
migrating root-owned entries in `/data`, then must exec Node as uid 1000 so Node remains PID 1 and receives
SIGTERM directly. The wrappers' generated `.env` and temporary credential files must stay out of
both Git and the Docker build context. Wrapper launches must pin the Compose file/project/profiles,
export the exact bind/port/password values they validated, and reject inherited Compose controls;
otherwise Compose's richer dotenv syntax can bypass a hand-written safety parser. Run
`node scripts/test-docker-host.mjs` after changing the image or host wrappers. To use an SSH daemon,
pass an explicit `--docker-host ssh://...` endpoint. The harness pins that endpoint, creates only
cryptographically unique and labelled resources, publishes no host port, applies runtime resource
and capability limits, sends probe credentials over stdin, and treats verified cleanup as part of
success. It never weakens SSH host-key checking; provision non-interactive persistent trust before
the run. If an interrupted run retains its recovery journal, `--cleanup-run <uuid>` removes only
resources whose recorded daemon identity, immutable resource identity, and ownership labels still
match.

**Registering a CorePlatform handler does not authorize relay access.** The Server Edition and the
desktop relay share the same handler-registration seam, but a relay peer may call or receive only
the exact request/cast/event allowlists in `src/main/relay-rpc-policy.ts`. When adding a host-routed
relay method or event, wire it in `src/renderer/bridge/relay-api.ts` and review/add that one channel
to the allowlist in the same change. Machine-global namespaces — settings, licenses, usage
credentials, School/Kids mode, scheduled-setting tokens, toy locks, and the authenticator — stay
local and fail closed before a raw relay frame reaches their handler or a host-global broadcast
reaches their socket. Do not replace this with a denylist: a newly registered credential service
must be unreachable by default.

**Destructive approval expires when its target or policy changes.** Node, authenticator and
worktree confirmations re-read their exact identity and authoritative Kids policy at the commit
boundary; an unreadable policy takes the two-key path. Live worktree deletion additionally requires
an opaque, one-shot core proof over canonical Git/filesystem generations and the complete ignored
as well as untracked byte inventory. Never make that proof optional, derive branch authority from
shared canvas JSON, collapse path I/O errors into absence, or replace the exact-tip ref CAS with a
plain branch delete.

**A File path is scoped to the machine that produced it.** File drop/paste helpers must take the
active session API explicitly. Never use `window.nodeTerminal.getPathForFile` or global `files.*`
from a session-bound surface: in a relay tab that turns a viewer-local path/write into text pasted
into the host shell. Force byte upload through the session API, and visibly refuse any nested SSH
case until a scoped host-side carrier exists.

**Both raw listeners change together** — `src/main/index.ts` and `src/server/agent-status.ts`. A new
field on a hook event that reaches only the desktop leaves the Server Edition quietly without the
feature, and the boundary tests can only tell you an import is wrong, never that a field is missing.
The same applies to any hook-server signature change; this repo has shipped one to a single shell
three times.

**Do not take scrolling away from tmux.** It owns the mouse, the scrollback and the alternate
screen. A previous design moved that into the emulator and failed structurally; `CLAUDE.md` explains
why in detail.

**A new keyboard chord has to survive the shells, not just the renderer.** Electron's default
application menu is live (we never replace it) and owns ⌘0, ⌘M, ⌘W, ⌘Q, ⌘R and friends — a menu
accelerator is handled before the page, so your `keydown` branch simply never runs. Steal it back in
`main/index.ts`'s `before-input-event` and forward it, like the three already there. Browsers own a
different set. And any chord that reaches the canvas needs the two refusals every canvas shortcut
here has: not while the kanban board covers it, not while the user is typing.

**Every agent launch carries a branded launch plan.** Add a new production surface to
`AGENT_LAUNCH_SURFACES`, obtain its `ActiveAgentLaunchPlan` at the moment of launch, and pass that
proof to `commandForAgentLaunch` / `createAgentNode`. Never thread a raw permission setting into a
command builder: it skips the live CLI-version and Kids-mode gates. The funnel Chut executes every
inventory row and must distinguish both permissive inputs from the resulting manual CLI arguments.

**Every node/session close goes through `renderer/lib/nodeDeletion.ts`.** That includes node-header
× buttons (intercepted at React Flow's `onBeforeDelete`), the canvas and kanban, Cmd/Ctrl+W, the
sessions sidebar/session-memory panel, and agent-control `close`. The funnel preserves ordinary
behaviour but makes the Kids-mode two-key gate unavoidable. Do not add a direct `deleteElements`
or `deleteNodes` path: the former expands group deletion to every descendant, while nodeterm's
canonical delete frees the children, and the latter performs irreversible teardown with no ask.

**A confirmation authorizes the disclosed target, not an id-shaped slot.** The asynchronous
node/session, managed-account, authenticator-seed, and worktree-removal funnels re-read both their
target and Kids policy immediately before the irreversible call through
`renderer/lib/destructiveAuthorization.ts`. Missing, unreadable, renamed, rebound, or replaced
targets perform nothing. A one-button confirmation that outlives a Kids OFF→ON or
ready→unavailable transition performs nothing and starts a fresh two-key request. Keep the callback
one-shot: a double click or re-entrant acknowledgement must not run a deletion twice. Apply the same
boundary to any new asynchronous destructive funnel; a synchronous native confirm has no await gap.

**Comments explain WHY, and name the failure they prevent.** The codebase is deliberately dense with
reasoning. A comment that restates the code is noise; one that says "do not simplify this back,
here is what broke" is the point.

**Treat appearance choices as families and async previews as generations.** A nested settings
patch replaces the whole object, so selecting a shipped logo must retain an existing custom image
unless the user explicitly removes it. Image decode/crop/fit completions may arrive out of order;
only the newest generation may publish. Likewise, an accent is not only `--accent`: update its RGB,
hover, readable-text and Material primary/container roles together for the current light/dark
surface. HSV/CMYK are editor formats, not browser CSS—persist their RGBA conversion, including
alpha. Blob downloads keep their object URL alive past the click turn before revoking it.

**Treat session-host state as desired ownership, not a sequence of best-effort commands.** Several
`SessionHostPty` views share one client socket, so pause and geometry must retain the individual view
identity and cross the wire only after aggregation. Reconnect must await attach/pause/size restoration
before ordinary requests, and transport or emulator backpressure must own tickets independent from
renderer flow. Only `ENOENT` proves an ownership file absent, and a permanent node deletion may update
the canvas only after the backing session-host kill acknowledges. Focused Chuts for this subsystem
must include co-attach, delayed response, socket-drop, and write-backpressure races; a happy-path mock
does not exercise the contracts that keep persistent processes truthful.

## Testing

`npm test` must pass, and `npm run typecheck` is the fastest gate.

For renderer controls, `npm run build && npm run check:wired` drives the built app and asserts
observable consequences over CDP. Keep that harness profile-isolated (`NT_MULTI` + a disposable
`NT_USER_DATA`) and cleanup in `finally`: a gate must never toggle the operator's real settings or
leave the persistent session host holding `electron.exe` after an early connection failure. A
probe-created element proves the browser primitive, not the app; consequences must come from a real
app control and persistence claims must cross a reload.

The lazy Squirrel bootstrap makes the normal main application a Rollup dynamic chunk. Keep main
chunks directly in `out/main`, beside the bootstrap entry. Moving them into Vite's default
`out/main/chunks` directory changes `__dirname`, so the real preload, renderer, HUD, and unpackaged
icon paths all point at files that do not exist. The production path resolver rejects that layout;
the focused path gate and `npm run build && npm run check:wired` cover the source and built behavior.

Beyond that, one habit is worth more than any other here:

**Mutation-test your guards.** Delete or invert the check you just added and confirm a test *fails*.
A green suite is not evidence on its own — during one recent feature this caught nine tests that
passed with the code they were meant to pin removed, including one mutation that survived the entire
4,500-test suite because the class it touched had no test file at all.

Watch for fixtures that cannot discriminate: if every row in your fixture happens to make the
mutant's output identical to the real one, the test proves nothing while looking thorough.

**Never pin behaviour by reading source text.** `expect(SRC).toContain('...')` is the fixture that
can never discriminate: it is satisfied by code that is present *and wrong*. We shipped one —
`src/main/menu-accelerator-intercepts.test.ts` matched three strings inside the `before-input-event`
handler, and stayed green on a tree where a shared guard had moved out from under them and the bare
`0` key was swallowed app-wide. It was, precisely, red on the fix and green on the break. If a
module is untestable because it imports `electron` at the top, that is the thing to fix: lift the
decision into a pure function next to it (`keydown-intercept.ts`, `main-window.ts`,
`zoomShortcut.ts`) and press the keys.

The Windows profile/session-host guards are behavioural examples: resolver tests inject
filesystem/process probes, spawn tests observe the exact trusted launch plan, and real local-socket
tests exercise provisional attach, reconnect and rollback. Mutation-check them by accepting a
hostile profile, allowing missing WSL to fall back, and removing machine-local stripping; each
focused suite must fail before the guard is trusted.

Where a behaviour can only be verified on hardware we do not have in CI (a Mac, a real SSH host, a
GPU), say so explicitly rather than implying coverage. Several docs carry numbered device
checklists for exactly this.

**A harness that boots the desktop app owns a disposable home, not just disposable `userData`.**
Boot installs managed agent hooks and instruction files through `os.homedir()` and agent/XDG config
variables. On Windows, setting only `HOME` does not move Node's home; `USERPROFILE` is the
load-bearing override. Follow `scripts/check-app-wired-core.mjs`: redirect the complete home,
AppData, temp, XDG, and agent config set before spawn, verify `userDataDir()` from the live main
process, and sentinel the exact real-home targets before and after. Likewise, process cleanup must
pass paths as data and compare them literally—never put a checkout path into a shell wildcard.

## Pull requests

- Branch from `main`. **GitHub Actions runs no tests, no type-check, and no lint** — see
  [`docs/ci-and-releases.md`](docs/ci-and-releases.md) for the full policy. `ci.yml` builds the
  app on your PR as fast disposable feedback (nothing required, nothing gated); `CodeQL` and
  `Dependency review` still run and are worth reading if they flag something. **Run
  `npm run typecheck` and `npm test` yourself before you push** — that is where checking
  actually happens now, and a failing local test is still a real defect to fix in the same
  change even though nothing in Actions will stop you from pushing it.
- Explain **why**, not just what. If a decision has a trade-off, name it and say what you rejected.
- If you measured something, put the numbers in — they save the next person the same afternoon.
- Say what you did **not** verify. That is more useful than a confident summary.

## Documentation

Two files, two audiences:

- **`CONTRIBUTING.md`** (this file) — what another human needs before touching the code.
- **`CLAUDE.md`** — the deep invariants, per subsystem, with the reasoning and the measurements.

**If you change or discover something other contributors must know, update this file too.** An
invariant that only lives in a commit message is one refactor away from being violated by someone
who never saw it.
