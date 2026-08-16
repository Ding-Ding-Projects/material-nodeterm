# Windows support — the engineering view

**Two Windows pages, and this is the contributor one.** [`windows.md`](windows.md) is for people
USING nodeterm on Windows: what works, what degrades, shell and SSH resolution, the unsigned
installer warning, how to install. This page is for people CHANGING the code: which
platform-difference defects were found, what now guards against them, and what is still unverified.
Keep the split — a user reading "what degrades" should not have to wade through regex archaeology,
and a contributor about to touch a path needs the archaeology.

**The Windows installer workflow builds and publishes each branch push whose ref contains the
corrected workflow, on `windows-latest`** — a real Squirrel.Windows set (`Setup.exe`, full
`.nupkg`, `RELEASES`), unsigned by policy. CI
stages it as a draft, verifies the complete remote inventory, and only then makes it non-draft and
downloadable; an upload failure exposes no empty release. That is the shipping path.

**It also builds locally now**, which it did not for most of this work. `build.bat /s` completes in
about 107 s and `build-installer.bat /s` in about 199 s, producing the same three-artifact Squirrel
set (a 205.8 MB `nodeterm-Setup-0.3.0.exe`, the full `.nupkg`, `RELEASES`), unsigned per policy.
That needed one elevated install of the Spectre-mitigated MSVC libraries — see
[Building](#building).

What has NOT happened is anyone **installing and launching one**. So the runtime behaviour of an
INSTALLED build is still unverified — though the session-host path underneath it is no longer
guesswork: it is now exercised directly against a real host, and the three defects that made it
silently useless are fixed and covered below.

> An earlier version of this page said no packaged build had ever been produced. That was wrong:
> it confused "I could not build one on this machine" with "the project does not build one". The
> distinction matters, because the first is a local toolchain gap and the second would be a
> release-pipeline failure. Both are now false anyway — CI builds one on every push, and so does
> this machine.

Windows is the active delivery target, but most of this codebase was written on macOS. That
asymmetry is the theme of this page: **almost every defect here was code that is genuinely correct
on POSIX**, which is why it survived review, survived a 6,000-test suite, and only showed up when
somebody looked on the platform that ships.

## The pattern worth internalising

Four unrelated subsystems failed the same way this week:

| Written | On POSIX | On Windows |
|---|---|---|
| `fs.rename(tmp, target)` | atomic, always works | `EPERM` whenever anything has the file open |
| `p.split('/')` | splits a path | returns the whole path as one element |
| `p.startsWith('/')` | "is absolute" | always false |
| `catch { /* already absent */ }` | true of `ENOENT` | also swallows `EPERM`, which means "still there" |

None of these looks wrong when you read it. Each one is invisible to a reviewer, to the type
checker, and to a test suite whose fixtures are POSIX paths written on a Mac. **The only thing
that found them was looking on Windows**, and in two cases the signal was a single test that had
been failing there for the entire life of the code.

A second, sharper lesson: in three of the four cases **one file in the tree already knew**.
`github/cache.ts` documented the rename problem with a measurement and carried its own retry loop.
`speech/whisper-models.ts` documented the `split('/')` problem and its `basename()` fix. Neither
reached the twenty-odd other files doing the identical thing a few directories away, because a
comment protects only the file it is written in. That is the argument for the scanning guards
described below rather than for writing another comment.

## Fixed

### Atomic writes ([docs/atomic-writes.md](atomic-writes.md))

Every store persisted with temp-file-then-rename, which loses the write on Windows whenever a
scanner, the search indexer, OneDrive, or a concurrent writer has the destination open. **28 files,
across three spellings** (`fs.rename`, `renameSync`, a destructured `rename`). The stores affected
held the user's canvas layout, their settings, their sealed credentials and their pinned remote
devices.

`renameAtomic` / `renameAtomicSync` / `writeFileAtomic` / `removeAtomic` in
[`src/core/fs-atomic.ts`](../src/core/fs-atomic.ts) retry briefly; a guard test fails on any bare
rename anywhere in `src/core`, `src/main`, `src/server` or the standalone `src/session-host`, apart
from the two platform-appropriate publication helpers themselves.

Five of those sites also shared a **fixed temp name**, so two writers could publish each other's
half-written bytes. Fixed, and guarded by the collision-resistant property rather than by “must
call the helper,” because an inline random UUID is equally valid.

The property is specifically **random UUID entropy**. `Date.now()` collides inside one millisecond;
pid-plus-counter collides across PID namespaces, worker isolates, and PID reuse. Same-millisecond
saves collided in the sealed-secret, scheduled-settings-secret,
shared-mode credential, generic atomic-JSON and Ollama chat stores; the node-token writer had the
same weak suffix. The old guard also saw only templates ending in `.tmp`, so the two `tmp-…` forms
were invisible until its matcher was widened. Cross-run cleanup now has one rule too: a foreign pid
may be a live second instance, so `sweepStaleTempFiles` waits 24 hours and removes a pid-bearing temp
only when that pid is no longer visible in this process's namespace. Unknown probe results preserve
the file; ESRCH is not treated as global cross-namespace proof without the age grace.

Credential Clear paths use `clearAtomicTarget`: they remove the canonical file but return an
explicit `clear-incomplete` failure while any recognized temp remains or the directory could not be
inspected. That keeps a plausible cross-namespace live writer safe without telling the UI that a
PAT, cookie, or Home Assistant token is completely gone while bearer bytes remain on disk.

One more race is orthogonal to the temp name. A whole-document flush that snapshots old state can
stall in the retry loop, let a newer flush publish, then wake and replace it with an intact but stale
document. `agent-status-mirror` now publishes flush generations FIFO, with a barrier-controlled test
that recreates the old ordering.

A later SSH audit found the same race outside direct `fs` calls: remote shell writes
shared `<target>.tmp`, scp downloads and media-cache fetches shared `<target>.part`, and upload
directories used a timestamp plus a per-manager counter. Those now use per-call UUID staging,
clean only their own failed stage, and reserve user-visible download names
across app processes before transferring.

### Paths

| Site | Was | Effect on Windows |
|---|---|---|
| `media-protocol` `mediaUrlFor` | `split('/')` | **every image and video failed to load** — the drive letter was swallowed into the URL authority, so the path jail 404'd the app's own files |
| `subagent-tail` | `split('/').pop()` | subagent cards showed a full absolute path instead of a filename |
| `transcript-index-core` | `split('/')…pop()` | the find bar labelled every result with an absolute path |
| `explorerCreate` `newEntryPath` | `split('/')` | **traversal escape**: `..\evil.txt` was accepted and created a file outside the project |

The last one is the serious one: it is user-typed input, and the guard refusing `../evil` while
accepting `..\evil` is exactly what made it look like it worked.

The first repair for `subagent-tail` and `transcript-index-core` changed the split to native
`path.basename`, which fixed a Windows process but stayed host-dependent: a Linux Server Edition
still treated a recorded `C:\…` path as one long POSIX filename. Their shared
`basenameForPathSyntax` now selects `path.win32` only for anchored drive/UNC syntax and
`path.posix` otherwise. That opposite default matters because a backslash is legal filename text
on POSIX; blindly accepting both separators would display a different file from the one recorded.

**Explorer reveal** was broken the same way and is now fixed. It compared
`revealPath.startsWith(base + '/')` — false for every backslash path — so `rel` became the whole
absolute path, the traversal guard split it on `/`, saw one segment with no `..` and let it
through, and the effect built `C:\proj/C:\Users\me\proj\src\a.ts`, expanded no directories and
selected a row that does not exist. Reveal did nothing, silently.

The arithmetic now lives in `revealTargets`, where it is unit-tested — including the genuinely odd
convention it has to honour: the tree's ROOT is a native path while every level below it is
composed by the component as `${parent}/${name}`, so a real node path is legitimately **mixed**
(`C:\Users\me\proj/src/a.ts`). That is not a bug — Windows accepts mixed separators, and these
strings are matched against row keys rather than handed to the filesystem — but it means the
helper must emit exactly that shape, and must compare case-insensitively under a drive letter
(where NTFS does) while staying case-sensitive under a POSIX root (where `/home/Me` and `/home/me`
are different directories).

### Ctrl+click file links

The token matcher required a `/` and the resolver was POSIX throughout, so a Windows path was
never even tokenised — the feature was absent rather than wrong, failing *closed* with no link
offered.

`matchFileTokens` and `resolveFileToken` take a `{ windows }` option, and the Windows matcher is a
**separate** regex rather than a widened separator class: the POSIX path is what every existing
user runs and stays byte-identical, and widening it would start matching Windows-shaped text
inside a POSIX session, where it can only ever be wrong. Within the Windows matcher, both slash
styles are accepted (Windows tools emit both), and the parent-directory existence check compares
entry names case-insensitively while keeping POSIX names case-sensitive.

The gate is **per-filesystem host, not per-viewer**. A Windows browser may be looking at a Linux
Server Edition (including one in a container), while a Linux browser may be looking at a Windows
host; a relay guest and host can differ in the same way. `TerminalNode` therefore uses the
core-bound `tmuxStatus().platform` fact for Server Edition and relay tabs. An SSH project's paths
stay POSIX however the client is spelled. If the host-platform read fails, file links are absent
for that connection — a failed read is not evidence that the host is Linux, and borrowing the
browser's OS would open the wrong path dialect. The local desktop may use its viewer platform only
because the viewer and filesystem core are the same process.

Two deliberate limits. A **UNC path is refused** rather than half-handled: there is no drive to
anchor on, its first two segments are a host and a share rather than directories, and resolving it
would aim a directory listing at a network host. The tokenizer consumes and refuses the WHOLE UNC
token; otherwise it can start after the two leading slashes and accidentally reinterpret
`server\share\file` as a cwd-relative path, bypassing the resolver's refusal. And **spaces are not
part of a segment**, so
`C:\Program Files\…` does not link — an unquoted path in terminal output gives no way to tell where
it ends, and allowing spaces made the matcher swallow the rest of the sentence. The POSIX matcher
takes the same position, so this is parity rather than a Windows shortfall.

The same host-dialect rule applies to media URLs. `mediaUrlFor` splits only on `path.sep`: splitting
on both slash styles is required-looking on Windows but corrupts a legal POSIX filename containing
a literal backslash (`/tmp/a\b.png`) into a different path (`/tmp/a/b.png`). The allowlist then
correctly rejects the app's own file. The separator is injectable in the pure URL builder only so
both host dialects are exercised on every test machine.

### The session host: every persistent terminal was quietly disposable

Three defects stacked so each hid the next, and two more that made the whole stack invisible. The
app opened terminals that worked and did **not** survive a restart — the one thing this backend
exists to provide, on the one platform that has no tmux.

1. **The connection went deaf the instant it succeeded.** `tryConnectOnce`'s `finish()` ran
   `removeAllListeners('data')` unconditionally, one statement after `attachSocket()` installed the
   reader. Every frame the host sent afterwards went unread.
2. **`request()` had no deadline**, so a deaf socket meant the promise never settled. The caller
   awaits it inside a `try`/`catch`, and **a catch cannot help a promise that never settles**.
   Measured at 45 s, still pending, silent.
3. **The spawn asked for `bash`.** This backend is selected precisely when tmux is absent — i.e.
   on Windows — so it defaulted to a shell that does not exist there. Proved against a live host:
   `shell='bash'` → `{"ok":false,"error":"File not found: "}`, `shell='powershell.exe'` → `ok`.
   The ordinary pty branch had always resolved this properly via `resolveWindowsShell()`; two
   places deciding one question is what let them disagree, and there is now one
   `resolveSessionShell`.

**What hid it** is the part worth remembering: a bare `catch {}`, and `persistent` derived from the
path CHOSEN rather than the outcome. A failed attach still reported `persistent: true`, so the
renderer believed a throwaway shell would survive a restart, and every memory lever that spares a
persistent session was reasoning about a session that did not exist.

**How it was actually confirmed**, after two false summits. `10,017 ms → 6 ms` looked like a fix
and was not — 10,017 was exactly the new timeout, and 6 ms was an immediate silent failure.
`persistent: true` looked like a fix and was not. The only check that settled it was asking the
host itself: `listSessions` now returns the session **by name**. Anything short of that cannot tell
"reports persistent" from "is persistent".

### Delete-to-stop-something

`removeRelayAdvertisement` was an unlink in a bare catch commented *"already absent — fine"*. True
of `ENOENT`, false of `EPERM` — so on Windows a held-open file read as success, leaving a live
relay advertisement on disk after the user turned phone access **off**, and phones would keep
minting tokens against a host that will never answer. It now reports whether the file is actually
gone.

## Building

`download-dependencies.bat` preflights through
[`scripts/check-build-preflight.mjs`](../scripts/check-build-preflight.mjs) after it has made Node
available but before npm replaces `node_modules`; `npm run dist:win` and `npm run rebuild` also
invoke the same check. This reports **every** failed precondition in one run — discovering them one
at a time cost three separate multi-minute builds, and the first blocker hid the second entirely
because the rebuild never reached the compile. Running it after Node bootstrap matters: the old
root-BAT placement skipped the check on a machine with no initial Node and went straight into npm.

1. **A running instance holds `conpty.node`.** Windows will not delete a DLL mapped into a live
   process, so a forgotten `npm start` window makes electron-rebuild die with an `EPERM` about a
   `.node` file that says nothing about the cause. The preflight names the file and the PID.
   Detection is by opening each addon for **writing** — measured against a genuinely locked file:
   rename succeeded, open-for-read succeeded, only open-for-write returned `EBUSY`.
2. **The Spectre-mitigated MSVC libraries are missing.** node-pty's own `binding.gyp` sets
   `SpectreMitigation`, and that component is not part of a default C++ workload. Deliberately not
   worked around with `/p:SpectreMitigation=false`: node-pty asks for the mitigation on purpose,
   and disabling it would ship an unmitigated native module.
3. **`NoDefaultCurrentDirectoryInExePath=1`** makes `cmd /c GetCommitHash.bat` fail with "is not
   recognized" inside node-pty's vendored winpty build, even though the file is right there. This
   one is **not** a user-facing problem — it was set in an agent harness's process environment, not
   in the User or Machine registry — so it is recorded here only so the next person who meets it
   does not spend a build on it. Clear it for the build process only; never for the machine.

## Testing generated POSIX shell

Windows has no literal `/bin/sh`, but Git for Windows provides a real POSIX-compatible shell. Tests
for generated remote commands should use `src/core/testing/posix-shell.ts`, not skip the behavior or
reimplement it in TypeScript. The adapter derives `usr/bin/sh.exe` from `git --exec-path`, adds the
matching runtime bins, translates native paths to `/c/...`, and puts a fake tool directory first
inside the running shell. That last step matters because `Git\bin\sh.exe` initializes its own PATH
with `/mingw64/bin` ahead of a parent-process prefix; without the adapter, a fake `curl` fixture can
silently invoke Git's real curl and make the test observe the network path instead of its recorder.

AF_UNIX socket binding is still unavailable in the native Node test host, so those narrowly scoped
cases retain an explicit `process.platform === 'win32'` skip. The same files' TCP, parser, fallback,
credential and shell-syntax cases continue to run under real Git Bash.

## Known gaps

- **No packaged build has been INSTALLED and launched.** CI is configured to build and publish the
  installer on each update of a branch carrying the corrected workflow (verified historically:
  `v0.3.0-ci.165` carries a 206.8 MB `nodeterm-Setup-0.3.0.exe`, non-draft,
  HTTP 206 on a range request), but nobody has run one. So the runtime behaviour of a real install
  — tmux absence and the session-host fallback above all (see
  [windows-session-host.md](windows-session-host.md)) — is unverified. Downloading one and clicking
  through it is the single highest-value Windows check still outstanding.
- **The hosted workflow has now produced and validated unsigned Squirrel assets**, and this
  machine now has the Spectre-mitigated MSVC component. A production-BAT build from the final
  reconciled commit, followed by a real install/launch/update/uninstall check, is still required;
  an older local package does not prove the final tree or the installed runtime.

## If you are adding code that touches a path

- Use `path.basename` / `path.join` / `path.sep`. Never `split('/')`, never `startsWith('/')` as an
  is-absolute test.
- Publish files with `renameAtomic`, never a bare `fs.rename`. A guard enforces it.
- Ask which machine owns the filesystem. The browser/viewer OS is irrelevant for Server Edition
  and relay tabs; SSH is POSIX even from a Windows client. Getting that distinction wrong is how an
  SSH fix breaks local behaviour, or a Windows browser breaks links on a Linux container host.
- On POSIX, `\` is filename text. Split on both separators only after the owning dialect is known
  to be Windows.
- Write at least one test with a real `C:\`-shaped input. Every defect on this page was invisible
  to a suite whose fixtures were all POSIX.
- Use `String.raw` for backslash literals — except when the string ends in one, which a raw
  template literal cannot express (the backslash escapes the closing backtick and the file stops
  parsing). And distrust a negative assertion containing a backslash: a mangled needle makes
  `not.toContain` pass forever without erroring.
