# Windows support: what works, what is fixed, what is still missing

**The honest summary first: nobody has run a packaged Windows build of this app end to end.** The
installer has never been produced on this machine — see [Building](#building) for the three
separate reasons why, two of which are now diagnosed in one second instead of discovered over ten
minutes. Everything below is either measured against real Windows behaviour or explicitly labelled
as unverified.

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

### Delete-to-stop-something

`removeRelayAdvertisement` was an unlink in a bare catch commented *"already absent — fine"*. True
of `ENOENT`, false of `EPERM` — so on Windows a held-open file read as success, leaving a live
relay advertisement on disk after the user turned phone access **off**, and phones would keep
minting tokens against a host that will never answer. It now reports whether the file is actually
gone.

## Building

`npm run dist:win` and `npm run rebuild` preflight through
[`scripts/check-build-preflight.mjs`](../scripts/check-build-preflight.mjs), which reports **every**
failed precondition in one run — discovering them one at a time cost three separate multi-minute
builds, and the first blocker hid the second entirely because the rebuild never reached the
compile.

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

## Known gaps, deliberately not fixed

- **Ctrl+click file links do not work for a local Windows project.** The token matcher requires a
  `/` and the resolver is POSIX throughout, so a Windows path is never tokenised — it fails
  *closed* (no link offered) rather than resolving to something wrong. SSH projects are unaffected
  on any client OS, because remote paths are POSIX regardless of the desktop's platform. That is
  also what makes the fix non-trivial: the resolver must know which convention applies **per
  session**, not per platform, and a scanner matching `C:\…` risks linkifying prose. Pinned by
  tests in `file-links.test.ts` so the gap is visible rather than reading as an oversight.
- **No packaged build has been launched.** Everything above is source-level or unit-tested. The
  runtime behaviour of a real installed Windows build — tmux absence and the session-host fallback
  in particular (see [windows-session-host.md](windows-session-host.md)) — is unverified.

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
