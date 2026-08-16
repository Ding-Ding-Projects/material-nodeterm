# Handoff

**Baseline: `63722558` on `main`, released as `v0.3.0-ci.173`.** Everything below was measured
against that commit during the session that wrote this, not recalled. Where something is unverified
it says so — an unverified claim in a handoff is worse than a gap, because the next owner spends
their time re-deriving it instead of reading it.

## What state the repository is in

| | |
|---|---|
| Working tree | clean, `main` identical to the remote |
| Test files | 460 |
| Tests | **5,995 passed**, 157 skipped, 0 failed (see the parallelism note below) |
| Contract guard | 520 assertions across 44 features |
| Site guard | 326 assertions |
| Interaction harness | 6/6 against the built app |
| Latest release | `v0.3.0-ci.173`, non-draft, targets `63722558` |
| Stashes | none |

**Run the suite with `--no-file-parallelism` before believing a failure.** The full parallel run
intermittently reports ~3 failures, always in suites that spawn a real `/bin/sh`, always different
ones, and every one passes in isolation. Serially it is 5,995/0. That is contention on Windows, not
regression — do not "fix" it by widening a timeout, which would only hide the next real hang.

## The checks, and which ones look at the real thing

Only two of these exercise the built artifact. That distinction matters more than it sounds: the
source scans would all pass on an app whose every control was inert.

| Check | Kind | What it would miss |
|---|---|---|
| `npm run check:wired` | **built artifact**, over CDP | nothing about the UI's *appearance* |
| `npm run shots` | **built artifact**, screenshots | whether controls do anything |
| `scripts/check-build-preflight.mjs` | machine state | — |
| `scripts/check-app-contract.mjs` | source scan | a feature present but non-functional |
| `scripts/check-site-contract.mjs` | source scan | same, for the Pages site |
| `scripts/check-vocabulary.mjs` | local precondition | see below |

`check-vocabulary.mjs` gates `npm run build` and a `pre-push` hook. It derives a lock from a private
source outside this repository and stores **no value here at all**. It fails *open* when that source
is absent — an outside contributor is skipped with the reason printed — and *closed* when the source
is present but stale.

## What is genuinely unverified

- **Nobody has installed and launched a packaged build.** CI publishes one on every push and
  `build-installer.bat /s` now produces one locally (199 s, 205.8 MB `Setup.exe`), and the release
  asset downloads — but no one has run the installer and used the result. This is the highest-value
  check outstanding.
- **The session host is proved by probe, not by living with it.** The three defects described in
  `docs/windows-support.md` are fixed and confirmed against a real host (`listSessions` returns the
  session by name), but nobody has restarted the app and watched a terminal genuinely survive.
- **`ssh-askpass` cannot bind on this machine**: `listen EACCES … .nodeterm\askpass\<id>.sock`. Seen
  repeatedly in main-process output, not investigated. Unix-domain socket in a user profile path;
  the session host uses a named pipe and is unaffected.

## Local build prerequisites (Windows)

Both `build.bat` and `build-installer.bat` preflight and fail in ~3 s naming every blocker at once.

1. **Close every running instance first.** Windows cannot delete a binary a live process has mapped,
   and `npm ci` removes `node_modules` wholesale — so a forgotten dev window kills the install on
   `electron.exe`. The preflight names the PID.
2. **Spectre-mitigated MSVC libraries** must be installed (Visual Studio Installer → Individual
   components). node-pty's own `binding.gyp` requires them. Their installer refuses `--quiet`
   without elevation, so this needs one admin run, once. CI never needs it.

## Foreign lanes on disk — do not delete

`git worktree list` shows **23** checkouts. One is this repo; the other **22** are
`material-nodeterm-pup-*` and `material-nodeterm-chicken-integration`, carrying `fix/chicken-*`
branches from other sessions. Every one of them holds unmerged commits and twelve are also dirty (up
to 33 uncommitted files in one).

They are not this session's to integrate or remove, and no cleanup here has touched them. Anyone
running a cleanup pass must prove each one separately: unmerged work is refused even with explicit
authorisation.

## Known limitation of the completeness guards

Both contract guards now check their own completeness — every `docs/*.md` must be named by a feature
row or listed as deliberately not a contract, and every `site/app/features/*.js` must be covered by
a row. That closes the gap where five shipped features had no row at all.

It cannot catch a feature that ships with **no doc**. This project documents features as it ships
them, so a doc is the earliest artifact a scan can catch — but that is a real boundary, not a
complete guarantee.

## Issue tracking

**Issues are disabled on this repository**, so the customary practice of posting a handoff and
per-task progress to an issue thread cannot be followed here. This file is the handoff of record
until issues are enabled.
