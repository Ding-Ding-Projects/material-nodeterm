# Windows support — the engineering view

**Two Windows pages, and this is the contributor one.** [`windows.md`](windows.md) is for people
USING nodeterm on Windows: what works, what degrades, shell and SSH resolution, the unsigned
installer warning, how to install. This page is for people CHANGING the code: which
platform-difference defects were found, what now guards against them, and what is still unverified.
Keep the split — a user reading "what degrades" should not have to wade through regex archaeology,
and a contributor about to touch a path needs the archaeology.

**The Windows installer is built and published on every push, by CI, on `windows-latest`** — a real
Squirrel.Windows set (`Setup.exe`, full `.nupkg`, `RELEASES`), non-draft, downloadable, unsigned by
policy. That is the shipping path and it works.

What has NOT happened is anyone **installing and launching one**. So the runtime behaviour of a
packaged build — the session-host fallback where there is no tmux, above all — remains unverified,
and everything below is source-level or unit-tested unless it says otherwise.

Building the installer **locally on a developer machine** is a separate matter and is currently
blocked here; see [Building](#building) for the three reasons, two of which are now diagnosed in
one second instead of discovered over ten minutes. None of them affects CI, which has the toolchain
components a local machine may be missing.

> An earlier version of this page said no packaged build had ever been produced. That was wrong:
> it confused "I could not build one on this machine" with "the project does not build one". The
> distinction matters, because the first is a local toolchain gap and the second would be a
> release-pipeline failure.

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
rename anywhere in `src/core`, `src/main` or `src/server`.

Five of those sites also shared a **fixed temp name**, so two writers could publish each other's
half-written bytes. Fixed, and guarded by the property (a pid or a counter in the name) rather than
by "must call the helper", because several stores build the same name inline and are correct.

### Paths

| Site | Was | Effect on Windows |
|---|---|---|
| `media-protocol` `mediaUrlFor` | `split('/')` | **every image and video failed to load** — the drive letter was swallowed into the URL authority, so the path jail 404'd the app's own files |
| `subagent-tail` | `split('/').pop()` | subagent cards showed a full absolute path instead of a filename |
| `transcript-index-core` | `split('/')…pop()` | the find bar labelled every result with an absolute path |
| `explorerCreate` `newEntryPath` | `split('/')` | **traversal escape**: `..\evil.txt` was accepted and created a file outside the project |

The last one is the serious one: it is user-typed input, and the guard refusing `../evil` while
accepting `..\evil` is exactly what made it look like it worked.

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

`matchFileTokens` and `resolveFileToken` now take a `{ windows }` option, and the Windows matcher
is a **separate** regex rather than a widened separator class: the POSIX path is what every
existing user runs and stays byte-identical, and widening it would start matching Windows-shaped
text inside a POSIX session, where it can only ever be wrong.

The gate is **per-session, not per-platform** — an SSH project's paths are POSIX however the client
is spelled, so `TerminalNode` computes `isWindowsPlatform() && !remoteSession`. Getting that
backwards would break the SSH links that already work in order to fix the local ones that never
did.

Two deliberate limits. A **UNC path is refused** rather than half-handled: there is no drive to
anchor on, its first two segments are a host and a share rather than directories, and resolving it
would aim a directory listing at a network host. And **spaces are not part of a segment**, so
`C:\Program Files\…` does not link — an unquoted path in terminal output gives no way to tell where
it ends, and allowing spaces made the matcher swallow the rest of the sentence. The POSIX matcher
takes the same position, so this is parity rather than a Windows shortfall.

### Delete-to-stop-something

`removeRelayAdvertisement` was an unlink in a bare catch commented *"already absent — fine"*. True
of `ENOENT`, false of `EPERM` — so on Windows a held-open file read as success, leaving a live
relay advertisement on disk after the user turned phone access **off**, and phones would keep
minting tokens against a host that will never answer. It now reports whether the file is actually
gone.

## Building

After making Node available, `download-dependencies.bat` first runs
[`scripts/ensure-windows-build-toolchain.mjs`](../scripts/ensure-windows-build-toolchain.mjs). It
adds the channel-current x64/x86 Spectre runtime component to an existing Visual Studio instance,
or verifies and runs the exact Microsoft bootstrapper pinned in the dependency manifest to install
Build Tools + the C++ workload on a fresh machine. The privileged helper stages that file below
protected Program Files and never resolves a package manager through a user-controlled `PATH`. On
ARM64 it also adds the rolling ARM64 Spectre component and verifies ARM64 libraries without dropping
x86/x64. It then ensures a supported per-user Python through
[`scripts/ensure-windows-python.mjs`](../scripts/ensure-windows-python.mjs), and preflights through
[`scripts/check-build-preflight.mjs`](../scripts/check-build-preflight.mjs)
before npm replaces `node_modules`; `npm run dist:win` and `npm run rebuild` also invoke the same
check. The installer result is independently checked on disk, and the preflight reports **every**
remaining failed precondition in one run — discovering them one at a time cost three separate
multi-minute builds, and the first blocker hid the second entirely because the rebuild never
reached the compile. Running both after Node bootstrap matters: the old root-BAT placement skipped
the check on a machine with no initial Node and went straight into npm.

1. **A running instance holds `conpty.node`.** Windows will not delete a DLL mapped into a live
   process, so a forgotten `npm start` window makes electron-rebuild die with an `EPERM` about a
   `.node` file that says nothing about the cause. The preflight names the file and the PID.
   Detection is by opening each addon for **writing** — measured against a genuinely locked file:
   rename succeeded, open-for-read succeeded, only open-for-write returned `EBUSY`.
2. **The Spectre-mitigated MSVC libraries are missing.** node-pty's own `binding.gyp` sets
   `SpectreMitigation`, and that component is not part of a default C++ workload. Deliberately not
   worked around with `/p:SpectreMitigation=false`: node-pty asks for the mitigation on purpose,
   and disabling it would ship an unmitigated native module. The bootstrap adds
   `Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre`; ARM64 hosts also add
   `Microsoft.VisualStudio.Component.VC.Runtimes.ARM64.Spectre`. Both the helper and preflight
   independently check that the effective VS 2022 toolset contains real `.lib` files for every
   required architecture below `VC\Tools\MSVC\*\lib\spectre`.

   Visual Studio has no per-user Build Tools install, and Microsoft forbids programmatic
   `--quiet`/`--passive` use by an unelevated user. The script checks elevation before starting the
   installer and exits access-denied with an absolute **helper-only** Administrator Command Prompt
   remedy. Run only the printed `ensure-windows-build-toolchain.mjs ...
   --elevated-toolchain-only` command elevated, close that prompt, and rerun the root BAT normally.
   The root BAT refuses to continue toward Python/npm under an Administrator token. It does not
   trigger UAC, because `/s` is prompt-free and ordinary dependency installs are automatic too.
   An observed non-elevated `setup.exe modify ... --quiet --norestart` parsed the command but exited
   5007 with “run elevated from the beginning,” matching the documented boundary.
3. **Python is missing or unsupported.** npm lifecycle scripts compile `smart-whisper`/`node-pty`
   through node-gyp, and the Visual Studio C++ workload does not include an interpreter. The BAT
   reuses an explicitly selected supported 64-bit Python 3.10-3.14 or installs pinned Python 3.13
   per-user. Bare Store/Python Manager aliases are never launched as a probe. Winget is tried
   first; the python.org fallback runs only after its manifest SHA-256 matches. The verified exact
   interpreter is passed process-locally in `PYTHON`, `NODE_GYP_FORCE_PYTHON`, and
   `npm_config_python`; no launcher or persistent `PATH` is changed.
4. **`NoDefaultCurrentDirectoryInExePath=1`** makes `cmd /c GetCommitHash.bat` fail with "is not
   recognized" inside node-pty's vendored winpty build, even though the file is right there. This
   one is **not** a user-facing problem — it was set in an agent harness's process environment, not
   in the User or Machine registry — so it is recorded here only so the next person who meets it
   does not spend a build on it. Clear it for the build process only; never for the machine.

## Known gaps

- **No packaged build has been INSTALLED and launched.** CI builds and publishes the installer on
  every push (verified: `v0.3.0-ci.165` carries a 206.8 MB `nodeterm-Setup-0.3.0.exe`, non-draft,
  HTTP 206 on a range request), but nobody has run one. So the runtime behaviour of a real install
  — tmux absence and the session-host fallback above all (see
  [windows-session-host.md](windows-session-host.md)) — is unverified. Downloading one and clicking
  through it is the single highest-value Windows check still outstanding.
- **Building the installer locally is blocked on this machine's current unelevated token.** Both
  root BAT entry points now diagnose the missing Spectre component and stop before starting the
  installer or npm. An elevated run of the automatic installer path has not been performed here,
  so the final native rebuild and local installer artifact remain unverified on this host.

## If you are adding code that touches a path

- Use `path.basename` / `path.join` / `path.sep`. Never `split('/')`, never `startsWith('/')` as an
  is-absolute test.
- Publish files with `renameAtomic`, never a bare `fs.rename`. A guard enforces it.
- Ask whether the path is **local** (platform-native) or **remote** (always POSIX, even from a
  Windows client). Getting that distinction wrong is how an SSH fix breaks local behaviour.
- Write at least one test with a real `C:\`-shaped input. Every defect on this page was invisible
  to a suite whose fixtures were all POSIX.
- Use `String.raw` for backslash literals — except when the string ends in one, which a raw
  template literal cannot express (the backslash escapes the closing backtick and the file stops
  parsing). And distrust a negative assertion containing a backslash: a mangled needle makes
  `not.toContain` pass forever without erroring.
