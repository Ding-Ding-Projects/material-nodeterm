# Contributing to nodeterm

Thanks for looking. This file is the short door: enough to get running, plus the house rules that
actually get a pull request sent back. The long version — every subsystem and the reasoning behind
its invariants — lives in `CLAUDE.md` at the repo root, which is also loaded automatically if you
work with an AI coding agent.

nodeterm is licensed **BUSL-1.1** (converts to MIT after four years — see `LICENSE`). Contributions
are accepted under that license.

## Getting set up

```bash
npm install        # patches node-pty, rebuilds node-pty + smart-whisper, and proves both Electron ABI loads
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

**Always check the canonical upstream for new commits before starting work in this repo** —
`git -C upstream/nodeterm fetch origin main && git -C upstream/nodeterm log --oneline HEAD..origin/main`
(or `git ls-remote https://github.com/eneskirca/nodeterm.git main` if the submodule isn't
initialized yet). This is a check, not an auto-sync: refreshing the pin is still the deliberate,
reviewed step above, never a background pull.

Run `node scripts/check-canonical-upstream.mjs` after reviewing a proposed pin. The check verifies
the `.gitmodules` path, URL, and `main` branch, the top-level gitlink, the nested checkout's
`origin`, and the reviewed commit. It also probes `refs/heads/main` without changing either
repository. A successful result means the local metadata and the reachable canonical ref agree.
When the probe cannot reach the service, the result is `offline-unverified` and exits non-zero; it
must not be reported as a verified lineage. `--offline` performs only the local checks and keeps
the same non-zero, unverified result. The focused red-then-green cases live in
`scripts/check-canonical-upstream.test.mjs`.

The supported Node runtime is **`^22.22.2 || ^24.15.0 || >=26.0.0`**. This is a minor/patch
boundary, not
"Node 22" shorthand: the cross-process agent-status mirror uses `node:sqlite`, which was absent in
22.0–22.4 and remained opt-in through 22.12, while the locked dependency graph sets the stricter
floors above and excludes Node 23 and 25. Both Desktop and Server Edition probe the real
`DatabaseSync` capability at
startup, so a custom build or `--no-experimental-sqlite` fails before persistent services start.

**If `src/main/node-pty-patch.test.ts` is red, your `node_modules` is unpatched — not your code.**
Run `npm run rebuild`. node-pty 1.1.0 deletes its Windows ConPTY baton without closing the HPCON
it owns, leaving orphaned conhosts behind a taskkill-first teardown; we patch its `conpty.cc`
before `electron-rebuild` compiles it, and that test guards the patch surviving upgrades. (The
script's former darwin ptmx-leak patch —
[node-pty#950](https://github.com/microsoft/node-pty/issues/950) — left with the macOS desktop
target.)

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

1. **Desktop** (Electron, Windows — the delivery target; Linux packages are also built)
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

- **No raw form controls outside `src/renderer/ui/md3/`.** Render `Button`, `IconButton`,
  `Chip`, `ChipRow`, `TextField`, `SearchField`, `Select`, `Switch`, `Snackbar`, `Dialog`… from the
  primitive barrel instead of a bare `<button>`/`<input>`/`<select>`/`<textarea>`; that is what
  keeps a panel on the tokens, the state layers and the focus rings. `npm run check:md3-controls`
  enforces it against a shrink-only allowlist — a file you migrate comes OFF the list in the same
  change. See `docs/md3-primitives.md`.

- **Anything path-shaped: read `docs/windows-support.md` first.** Windows is the delivery target
  and most of this was written on macOS, so the recurring defect is code that is genuinely correct
  on POSIX — `split('/')`, `startsWith('/')` as an is-absolute test, a bare `fs.rename`. Use
- **Anything path-shaped: Windows is a delivery target.** Most of this was written on
  macOS/Linux, so the recurring defect is code that is genuinely correct on POSIX —
  `split('/')`, `startsWith('/')` as an is-absolute test, a bare `fs.rename`. Use
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
  **Spectre-mitigated MSVC libs** and repairs them through the narrowly scoped elevated helper when
  needed — node-pty asks for the mitigation in its own `binding.gyp`, and without them the build
  dies minutes in with `MSB8040`. Visual Studio changes require elevation; an interactive run hands
  only that helper to UAC, waits for its result, and reruns normal-user verification. A silent run
  stays prompt-free and exits access-denied with the exact helper route. The root BAT and npm
  lifecycle scripts never inherit elevation. The BAT also ensures
  x86/x64 are always checked and ARM64 is added on ARM64 hosts. The BAT also ensures a supported
  per-user Python for node-gyp, with SHA-pinned fallbacks for machines without winget, and exports
  the verified interpreter through every node-gyp precedence channel.
  Native rebuilding is intentionally limited to `node-pty` and `smart-whisper` through
  `@electron/rebuild --only`. Do not replace it with `--which-module`: that option adds modules to
  the detected walk, so unrelated optional native packages compile too. Both packages are denied
  their own install lifecycle through `allowScripts` because the root postinstall owns the one
  patched rebuild. The wrapper runs modules sequentially with MSBuild node reuse disabled and allows
  three total attempts with bounded backoff only for measured MSBuild 17.14 runtime/JIT signatures.
  It then loads both required packages under Electron. Ordinary compiler failures are never retried
  or converted into success.
  The measured signatures include `MSB4018` with the exact
  `System.IO.StreamWriter..ctor(System.String, Boolean, System.Text.Encoding)` missing-method form,
  and `MSB4093` naming either the `TLogReadFiles` parameter of `CL` or the `ContentFiles` parameter of
  `GenerateDesktopDeployRecipe` with no `"set"` accessor. Installer application builds separately
  retry once only for process status `0xC0000409`, after removing partial `out/`. That retry never
  reruns or changes local-versus-published icon verification, never enables signing, and never admits
  an ordinary build error.
  Keep root `build.npmRebuild` set to `false`: postinstall already patches, rebuilds exactly
  `node-pty` and `smart-whisper`, and proves both under Electron. The electron-builder default is a
  separate discovery-based native scan that also touches unrelated optional packages.
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
  unless the owning filesystem is known to be Windows.

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

- **A serializing promise chain must never stay rejected, and a background write must never be
  `void`-ed.** `p = p.then(() => write(next))` looks like a FIFO and is also a fuse: a rejected
  promise's `then(onFulfilled)` skips `onFulfilled`, so ONE failed write disables every later write
  for the life of the process, silently. Keep the chain settled and hand the caller a separate
  promise that still carries the real error (`AtomicJsonArrayStore.save`). And an unhandled
  rejection terminates the process by default on every supported Node, so a fire-and-forget
  `void store.save(...)` turns a failed advisory snapshot into a dead main process — attach a
  handler that reports the loss instead. Both are reachable on the delivery platform: `renameAtomic`
  exists because Windows fails a publish with `EPERM` while a scanner holds the target.
  temp/part staging name must also be unique per call across processes and cleaned by its owner —
  including paths embedded in generated SSH commands or handed to scp, which the `fs` scan cannot
  see. Keep a remote temp's own leaf bounded: extending an already-valid maximum-length target leaf
  with a UUID suffix turns an atomic write into a guaranteed `ENAMETOOLONG` failure.

- **Never unmount, move or re-key a browser/web node's element.** An Electron `<webview>`'s guest
  process dies on DOM detach — and a detach includes any `insertBefore`/`appendChild` MOVE of an
  attached element, which React performs whenever a kept child's relative order among kept keyed
  children changes. That is why webview-hosting nodes render in one stable pool region at the tail
  of the `<ReactFlow>` nodes prop (`renderer/lib/webviewKeepAlive.ts` — read its header before
  touching the merge, the node array swap in Canvas's load effect, or anything that reorders
  nodes), and why a background project's pages stay mounted as hidden ghosts instead of
  unmounting. `display:none` is safe (measured: state, scroll and viewport size survive); a reorder
  or unmount reloads the user's page and loses their in-page state.

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

**The app shows no unsolicited marketing, and the gate for it fails closed.** Messages from the
remote `/v1/check` feed reach `AnnouncementBanner` only if
`renderer/lib/announcementPolicy.ts` positively classifies them as *operational* (security,
mandatory update, broken release, outage). *Promotional* and *unknown* both render nothing —
promotional wins over operational so a campaign cannot buy a render by saying "critical", and an
unclassified message is exactly how a promo sneaks back in. This was allow-by-default once, and an
App Store cross-sell shipped through it. Never reintroduce a blocklist, and never trust a
feed-supplied kind/severity field: the publisher is the untrusted party. A forced update is
`UpdateCard`'s job (`update.mandatory`), not the banner's.

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

**A spawn-env write does not reach a tmux session on its own.** The shared tmux server takes each
new session's env from its own GLOBAL env (inherited from whichever client *started* the server) —
the creating client's process env only matters for names listed in `update-environment` (or passed
as non-secret `-e` pairs). Setting `env.FOO` in `pty-manager` therefore works for the plain-shell
fallback and for the one client that happens to start the server, and silently does nothing (or
worse, leaks the server-starter's value into everyone else) after that. That is how issue #419
shipped: managed-account `CLAUDE_CONFIG_DIR` leaked into system-account sessions. New per-session
env either joins `ACCOUNT_SCOPE_UPDATE_ENV` / the gateway list, or rides `-e` — and gets a
real-tmux test (`account-env.realtmux.test.ts` is the pattern).

**A new keyboard chord has to survive the shells, not just the renderer.** The application menu is
ours (`buildAppMenu` in `main/index.ts`), but its command-style accelerators — ⌘Q, ⌘M, ⌘W, ⌘0, ⌘⇧B,
⌘, — are still handled above the page, so your `keydown` branch simply never runs: steal the chord
back in `main/keydown-intercept.ts`'s `before-input-event` allowlist and forward it, like the three
already there. Two legs stand the menu down instead of stealing — the terminal-first policy and an
armed shortcut recorder (`menuStandsDown` → `menuItemIdsToSuspend`, since a disabled item suppresses
its accelerator) — and Reload (⌘R / ⌘⇧R) is the named exception that always stays with the app,
because it is the crash-recovery lever. Browsers own a different set. And any chord that reaches the canvas needs the two refusals every canvas shortcut
here has: not while the kanban board covers it, not while the user is typing.

**Every agent launch carries a branded launch plan.** Add a new production surface to
`AGENT_LAUNCH_SURFACES`, obtain its `ActiveAgentLaunchPlan` at the moment of launch, and pass that
proof to `commandForAgentLaunch` / `createAgentNode`. Never thread a raw permission setting into a
command builder: it skips the live CLI-version and Kids-mode gates. The funnel gate executes every
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

**There are two stylesheets, and load order decides which one wins.** `src/renderer/boot.tsx`
imports `fonts.css`, then `styles.css`, then `styles.md3.css`, in that order. `styles.css` is the
token layer (every `--md-*` role, dark on bare `:root`, light under `:root[data-theme='light']`)
plus most of the app's structural CSS; `styles.md3.css` is the newer Material 3 chrome and
component restyle, imported last, so it wins wherever the two disagree. Restyling an existing
surface's look goes in `styles.md3.css`; changing a token's *value* goes in `styles.css`'s
`:root`. Every colour comes from a `var(--md-*)` token — no hex literals — and there is no
`box-shadow` anywhere in either sheet; elevation is tonal (the surface-container ladder), and the
one exception is React Flow's own connection-handle ring, which needs a shadow because a
transform there breaks React Flow's own centering translate. `design/v2/md3/tokens.css` is the
token contract and `design/v2/md3/HANDOFF.md` the component recipes both sheets were built
from — read those before inventing a new colour or spacing value; they are the design bundle
this app was implemented from, not files the running app reads. `scripts/check-app-contract.mjs`
scans the whole `styles.md3.css` file for balanced comment/brace counts (a merge that drops a
`/*` opener parses as a broken build, not a lint warning) and scans every file under
`src/renderer` for a hardcoded font/icon CDN host, including inside a comment — nothing in this
app ever fetches a font over the network; every glyph and every typeface is a committed local
asset.

**Material Design 3 conformance is required for every rendered element.** This includes nested
node controls, menus, dialogs, fields, buttons, tabs, progress and error states, settings,
documentation surfaces, accessibility-only labels, and all separately mounted renderer entrypoints.
A Material container does not exempt a legacy, browser-default, or unstyled child control. Use the
shared tokens and primitives for colour roles, typography, shape, elevation, motion, state layers,
focus, target sizing, responsive containment, and reduced-motion behavior. Add the element to the
hand-written completeness inventory and keep its implementation, documentation, localization,
focused interaction coverage, built-artifact record, and visual evidence current. A marker-only
check is insufficient because it can pass while another element in the same file remains outside
the design system.

The existing Kids-mode-default documentation and landing site is the one visual-style exception.
Preserve its established appearance and do not restyle it to match the desktop application. This
exception is limited to appearance: stale facts, broken links, missing or decorative controls,
localization, personal-vocabulary behavior, accessibility, clipping, responsive behavior, and all
other functional contracts still need to be corrected and kept current within that visual style.
**The complete desktop Material Design 3 inventory is `docs/features/appearance/material-3-audit.md`.**
`scripts/check-material-audit.mjs` fails closed when any named screen, node, dialog, panel, menu,
dropdown, picker, tab, settings section, overlay, status, empty state, error state, or style
marker disappears. Every rendered Windows desktop element must use the shared Material Design 3
primitives and project tokens for color, typography, shape, tonal elevation, state layers, focus,
motion, density, scaling, and accessibility. Legacy controls and custom lookalikes are defects,
not exemptions. The audit is source-level until a later permitted built-artifact verification pass.

The documentation and landing site runs in Kids mode by default and its current visual style is
preserved. Site changes are limited to stale facts, data, releases, links, features,
accessibility, and broken behavior. Do not restyle the site as part of a desktop audit.

**A new icon is a `MaterialSymbol` call, not another one-off inline `<svg>`.**
`components/MaterialSymbol.tsx` renders one glyph from the app's own locally bundled, subsetted
Material Symbols Rounded font (`src/renderer/assets/fonts/material-symbols/`, regenerated by
`scripts/build-fonts.mjs` from a pinned devDependency). Pass a `name` from the generated
`materialSymbols.generated.ts` codepoint union — an unknown name is a TypeScript compile error,
not invisible tofu in a shipped build — and `size`/`fill`/`weight` for the FILL/wght/opsz
variable axes. The subset was built by CODEPOINT, with GSUB/ligature substitutions stripped, so
the component renders each glyph's raw private-use-area character directly; never render an icon
*name* as literal text expecting a ligature to substitute it, because there is no ligature table
left to do that. This is not a completed migration: `components/icons.tsx` (the shared line-icon
set used across menus and the command palette) and a number of node-kind SVGs still predate
`MaterialSymbol` and are unconverted, currently coexisting with it — Explorer, git history,
source control, branch selection, the merge-conflict bar, the file converter, the Ollama manager
and the authenticator's export gate already use `MaterialSymbol`. Add new icons through it; leave
an existing `icons.tsx` glyph alone unless you are already touching that surface.

**Treat session-host state as desired ownership, not a sequence of best-effort commands.** Several
`SessionHostPty` views share one client socket, so pause and geometry must retain the individual view
identity and cross the wire only after aggregation. Reconnect must await attach/pause/size restoration
before ordinary requests, and transport or emulator backpressure must own tickets independent from
renderer flow. Only `ENOENT` proves an ownership file absent, and a permanent node deletion may update
the canvas only after the backing session-host kill acknowledges. Focused gates for this subsystem
must include co-attach, delayed response, socket-drop, and write-backpressure races; a happy-path mock
does not exercise the contracts that keep persistent processes truthful.

**A context menu with sections is filterable too, not just a flat list.** `isFilterableMenu` /
`menuRowVisibility` (`components/menu/menuVisibility.ts`) decide which rows survive a query —
counting only real actionable rows against the threshold, matching a submenu on its own label OR a
child's, hiding a `colors` strip once a query is typed, hiding a section `label` only when nothing
under it survived, and settling `separator` visibility last through the same `tidySeparators`
(`lib/ui-visibility.ts`) the unfiltered menu builders use. `useMenuFilter` no longer decides
matching itself — pass it your own `useRegexSearchField()` instance and an already-filtered
candidate list; it only tracks keyboard `activeIndex`. See CLAUDE.md's Context menus section for
the full reasoning. The canvas pane menu's groups all go through ONE decision —
`canvas/paneMenuGroup.ts` — which turns a group into a submenu with an icon, into a bare row (a
group of one), or into the older labelled flat section, and emits nothing for an empty group. Add a
new pane-menu group through it rather than hand-writing a heading or a `submenu` literal, and note
two traps it exists for: **a submenu cannot contain a submenu** (`ContextMenu` renders no
second-level flyout — a nested trigger is skipped, so the rows vanish silently), and every group you
collapse removes a top-level row, which can drop the menu under `FILTER_THRESHOLD` and take the
filter field away with it.
**A generated sh client reads its node token through the one resolver.** Every POSIX-sh client we
emit (the managed hook script, `nodeterm.sh`, `context.sh`) presents this node's per-node identity by
calling `nt_read_node_token` from `core/agents/node-token-sh.ts` — never by re-typing
`head -n 1 "$NODETERM_NODE_TOKEN_DIR/$NODETERM_NODE_ID"`. That copy was issue #384: a session is
pinned for life to the endpoint FILE path it got at tmux creation, so a client that trusts only what
that file advertises presents nothing forever when the file is old or unreadable — and because the
hook script alone could heal itself, the same node proved itself through one client and was refused
through another for the life of the session.

**A stream error is not a throw you can catch.** When a write to `process.stdout`/`stderr` fails —
`EPIPE` down a closed pipe, `EIO` after macOS revokes a closed terminal's tty — node reports it by
emitting `'error'` on the stream a tick later, and the default for an unhandled `'error'` event is
to kill the process. The stack it carries was captured at the write, so the crash *reads* as if it
happened synchronously at your `console.log`, and wrapping that call in `try/catch` changes nothing
(measured on node 22). If you write to a stream that can go away, attach an `'error'` listener and
latch the writer off — `installLogSink` (`src/core/log-sink.ts`) is the worked example. Issue #382.

**Agent features attach to base harness capabilities, not frontend allowlists.** A custom agent can
inherit a builtin harness, so add the capability and its one shared leaf (`src/shared/agents`) and
let every UI ask the helper. Repeating Claude/Codex/etc. cases in menus breaks that inheritance and
eventually drifts.

## Testing

`npm test` must pass, and `npm run typecheck` is the fastest gate.

**A synchronous retry cannot wait for async work in its own process.** `fs.rmSync`'s `maxRetries`
blocks the event loop, so it can never let an in-flight promise in the same process finish and
release the file it holds — the loop waits for the thing it is preventing. If a test deletes a
directory its subject also writes into, `await fs.promises.rm(...)` instead. Measured: one suite
went from 2-4 failures per 6 runs to 8 of 8 on that one keyword, after 30 synchronous attempts over
3 seconds had failed identically. The synchronous form is still right for a handle held by ANOTHER
process (the virus scanner is the usual one), where the event loop is irrelevant.

**When a temp directory refuses to delete, ask what is still IN it before asking who is to blame.**
Five hypotheses were eliminated by reasoning on one such failure — retries, git background
maintenance, an undisposed platform, a lingering subprocess, a `gh` spawn — and the answer came from
listing the two files that survived. Then remove writers one at a time: as each disappeared from the
leftover, the next one named itself. Note also that a scan which opens files for *append* reports
"nothing is locked" for a SQLite file, because its byte-range locks do not block that open.

**Do not raise a timeout to make a test green.** It hides the next real hang. The workspace sets 30
seconds, which is already six times vitest's default and far below any genuine deadlock; a test that
exceeds it is telling you something.

**Worker count is not free.** Vitest defaults to one worker per CPU, which assumes CPU-bound tests;
35 files here spawn git, cmd.exe, bash, node and a real sshd. On a 32-CPU machine the default ran
505 s with 13 failures, and 8 workers ran 217 s with none — oversubscription cost throughput as well
as determinism. The cap lives in `vitest.config.ts` and is derived from the host.

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

### Never write a backslash through a shell heredoc

Every layer between an edit and the file on disk eats one backslash, and the damage is silent in
both directions. This bit three separate edits in a single session, all of them small:

- `\\b` written into a regex through a heredoc arrived as a **literal backspace byte**, so the
  pattern could never match anything. Visible only in `od -c`.
- `\r\n` in a fixture arrived as two real newlines, so a CRLF fixture was quietly testing LF.
- A multi-line regex written that way ended up with a real newline inside the pattern.

The rule is not "escape more carefully", because counting layers is exactly what fails. Write the
file with the editor tools, or from a script file rather than an inline heredoc, and then **read
the result back** before trusting it. A `grep` for the needle is not enough -- it prints
`\.` and a backspace identically. `od -c` is what tells you.

Where a value can avoid a backslash entirely, prefer that: build a CRLF from
`String.fromCharCode(13, 10)`, match a literal dot with `[.]`, and split rather than pattern-match.

### Break a guard before you trust it -- and break it by REMOVING, not appending

A guard nobody has watched fail is a comment. But the break has to be a real one: renaming
`IPC.remoteRevokePeer` to `IPC.remoteRevokePeerV2` does **not** break a check that looks for
`IPC.remoteRevokePeer`, because the new name still contains the old one. Three checks were
declared toothless on exactly that mistake and were fine.

So: delete the thing, watch red, restore, watch green. And anchor the needle to a whole line or a
trailing delimiter, so a rename that merely appends cannot satisfy it either.

## Pull requests

- Branch from `main`. **GitHub Actions runs no tests, no type-check, and no lint** — see
  [`docs/ci-and-releases.md`](docs/ci-and-releases.md) for the full policy. `ci.yml` builds the
  app on your PR as fast disposable feedback (nothing required, nothing gated); `CodeQL` and
  `Dependency review` still run and are worth reading if they flag something. **Run
  `npm run typecheck` and `npm test` yourself before you push** — that is where checking
  actually happens now, and a failing local test is still a real defect to fix in the same
  change even though nothing in Actions will stop you from pushing it.
- **If you touched `docs/`, run `node scripts/build-docs-bundle.mjs` and commit the result.** The
  in-app documentation browser bundles articles at build time, so an article that never reached
  `src/shared/docs-data.ts` is one the app silently does not have. This is the only thing that has
  ever turned this repository's release red, and it has done it twice; the failure lands inside the
  packaging step, so it reads as a build problem and nothing ships until somebody opens the log.
  Opting into the repo's hooks (`git config core.hooksPath .githooks`) makes the push refuse
  instead. Never hand-edit that file: it is generated output.
- Explain **why**, not just what. If a decision has a trade-off, name it and say what you rejected.
- If you measured something, put the numbers in — they save the next person the same afternoon.
- Say what you did **not** verify. That is more useful than a confident summary.

## Documentation

### Settings scopes and Docker hosting

Add app settings once to the shared `Settings` type and existing section. Global and Project modes
route the same control through the central store; do not create project-specific section copies.
Project overlays belong only in the machine-local workspace index and never in
`.nodeterm/project.json`, whose cloned content must not inject executable, credential, path, or
host-local fields.

Remote-access UI calls the free encrypted flow **Docker host**. Preserve single-use pairing and
mutual SAS approval. Never add a purchase or entitlement check to the first host connection, and
never fabricate a credential for an anonymous free pairing request.

Docker host execution belongs behind `docker-host-runtime.ts`: use `execFile` argv, keep context and
image selections guided, validate again at use, bound CPU/memory/PIDs, drop capabilities, prohibit
privileged and socket mounts, default network to none and the project bind to read-only, and remove
only the labelled random-name container the session created. Relay PTYs must be `docker exec`, never
the local profile with a Docker-looking label painted over it.

### Hosted-resource backup and restore

Use `src/shared/backup-restore.ts` for every hosted-service backup contract. A manifest must record
the framework schema, product, resource id and kind, edition, source, ownership evidence, version,
payload hashes, byte totals, and explicit omissions. Credentials, provider sessions, machine paths,
host identifiers, process state, caches, and generated runtime data never travel in the archive.

Use `src/core/backup-restore.ts` for bounded ZIP framing and atomic local publication. Restore code
must show the compatibility and ownership review before calling a provider, stage and validate
before publication, report byte-aware progress and cancellation, and retain an expiry-bound rollback
contract. Every list and picker added by a hosting node gets its own plain-text search and adjacent
anchored regex builder, with a concrete disabled reason when verified metadata or review is absent.
The framework intentionally does not deploy or mutate a provider on import.

Two files, two audiences:

- **`CONTRIBUTING.md`** (this file) — what another human needs before touching the code.
- **`CLAUDE.md`** — the deep invariants, per subsystem, with the reasoning and the measurements.

**If you change or discover something other contributors must know, update this file too.** An
invariant that only lives in a commit message is one refactor away from being violated by someone
who never saw it.
