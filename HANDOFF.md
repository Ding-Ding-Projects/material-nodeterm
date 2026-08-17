# Handoff

**Baseline: `effb73a3` on `main`, pushed and verified against the remote.** Everything below was
measured against that commit, not recalled. Where something is unverified it says so — an unverified
claim in a handoff is worse than a gap, because the next owner spends their time re-deriving it
instead of reading it.

The previous version of this file described commit `63722558`, 460 test files and 23 checkouts.
All three were stale. Treat any number here the same way: re-measure before relying on it.

## Read this first — the release was blank, and why

A packaged release opened to a **completely blank window** with only the system window controls.
Fixed on `main` in `effb73a3`; **rebuild the installer from that commit or later.**

The cause is worth understanding because it will happen again if the mechanism is disturbed. The
Squirrel bootstrap imports the application graph lazily, so Rollup emits that graph as a *dynamic
chunk*. Vite's default `chunks/` directory moves it one level down — which silently relocates
`__dirname`. Every path anchored to it (preload, renderer HTML, HUD preload, HUD renderer, the
unpackaged icon) then resolves one directory off. **Nothing errors.** You get a window with no
preload bridge, which reads as a renderer failure and sends you looking in the wrong place entirely.

Two things hold it now, and both are needed: `chunkFileNames` pins the chunk beside the entry, and
`desktopBuildPaths()` refuses outright when it is not running from `out/main`, so a future config
change fails loudly at the boundary instead of shipping a blank page.

## State of the repository

| | |
|---|---|
| `main` | `effb73a3`, clean, identical to the remote |
| Test files | 522 |
| Typecheck | passes, both `tsconfig.web.json` and `tsconfig.node.json` |
| Test suite | **not run this session** — see below |
| Latest release | `v0.3.0-ci.211` |
| Local branches | 43 |
| Linked checkouts | 42 |
| Branches still unmerged into `main` | **38** |
| Stashes | none |

Every one of the 43 branches is pushed and SHA-verified on the remote. Nothing exists only on this
machine.

## What landed this session

- **Blank release window** fixed (`effb73a3`) — described above.
- **Typing did nothing in ordinary Windows terminals** (`1c305ec2`). Two defects, both from the
  checkpoint commit below. The shipped default profile id `'auto'` was read as a deliberate user
  choice, so *every* plain terminal was routed through the new session host instead of the direct
  spawn that had always served it — and `SessionHostClient.write()` is fire-and-forget with an empty
  catch, so a broken round trip drops keystrokes with no error, no banner and no log. Separately,
  preload advertised `pty.executeLaunchIntent` while main never registered a handler and
  `PtyManager` has no such method, so every agent launch down that route rejected.
- **Everything is free** (`66222613`). The paid tier is gone, not discounted. `isPremium` is now the
  user's own `proFeaturesEnabled` switch, default on. One value decides every gate, so a feature
  added later that reaches for `isPremium` is free by construction. The switch survives only as a
  **performance** control — a locked app does less background work — and Settings says so, alongside
  a warning that anyone charging for nodeterm is not legitimate.
- **Personal vocabulary uploads** (`274f9920`) accept the shapes that exist in practice: `schemaVersion`
  as well as `version`, a `terms` list, and companion documents carrying no substitutions.
- **A 179-file checkpoint** (`a4e3b13d`) preserving Windows terminal-profile, session-host and
  installer work that existed in **exactly one place on disk** — not on any branch, 83 of its files
  untracked. It is preserved, **not verified**, and it is the source of both regressions above.
- 4 branches merged into `main`; 4 fully-merged branches and their checkouts removed with ancestry
  proof.

## What is genuinely unverified

- **The test suite has not been run this session.** Typecheck passes on both projects; that is all.
  The 522 figure is a file count, not a pass count.
- **Nobody has installed and launched a packaged build carrying the blank-window fix.** That is the
  single highest-value check outstanding — the bug it fixes was invisible to every source-level gate.
- **`a4e3b13d` is unreviewed.** Roughly half of it is tests, but nobody has run them. Two real
  regressions have already come out of it; assume there are more.
- **CI runs no tests and no lint by policy.** It builds, packages and publishes. A green run means
  "it built", never "it passed."

## The 38 unmerged branches

A merge pass was attempted across all of them. **4 merged cleanly, 38 did not.** They are 100+
commits apart and collide on the same five files every time: `CLAUDE.md`, `CONTRIBUTING.md`,
`CHANGELOG.md`, `docs/windows-session-host.md`, `docs/windows-support.md` — mostly additive prose,
but the code conflicts underneath are real and semantic.

Conflict counts run from 1 file to 53. **Merge in ascending order**: each one that lands shrinks the
conflicts for those behind it.

Two warnings for whoever finishes this:

1. **A textually-clean merge can still break the build.** One of the four that merged without
   conflict left `src/core/pty-session-host.test.ts` uncompilable — a hoisted mock lost its
   parameters, so every test asserting on those parameters stopped type-checking. Typecheck after
   every merge, not at the end.
2. **Never resolve with `git checkout --ours/--theirs` on a whole file.** These branches are
   independent real work, not competing drafts; a conflict almost always means both sides added
   something true. Discarding one side silently is the worst available outcome, and it looks
   exactly like success.

Nothing may be deleted until its tip is proved an ancestor of the pushed `main`.

## Open items

- **Kids mode can lock a user out with no way back.** It is on, it demands a "Grown-up PIN" to turn
  off, and no PIN was ever set. Requiring a credential that was never configured is a lockout with
  no key. **Not yet fixed.**
- **14 upstream PRs** await integration on `eneskirca/nodeterm` (#275 #274 #273 #267 #189 #177 #175
  #156 #149 #113 #112 #111 #98). Decisions already taken: **#111 contributes psmux only — its NSIS
  packaging is rejected**, because Squirrel is the sole Windows installer path here and NSIS is
  explicitly not an acceptable substitute. #177 (vite 7→8) goes last and alone so a broken build
  stays bisectable. #112 is 100 files and should land after `main` settles.
- **4 open issues** worth acting on: #128 (an abandoned new-project setup screen blocks existing
  projects), #119 (Claude Code hardcodes `resize-pane -x 30%`, squeezing the pane you type into),
  #42 (opencode's slash-command dropdown never appears; spawned subagent nodes vanish from the
  canvas while still running), #145 (annotation tools). #78 is a contributor's own roadmap — reply,
  do not action.
- Queued and not started: per-feature unlock toggles, client-side suppression of promotional
  announcements, Ollama for local models, a Material Design overhaul with a side-by-side compare
  app, automatic Tailscale setup for the Docker host.

## Local build prerequisites (Windows)

Both `build.bat` and `build-installer.bat` preflight and fail in ~3 s naming every blocker at once.

1. **Close every running instance first.** Windows cannot delete a binary a live process has mapped,
   and `npm ci` removes `node_modules` wholesale — so a forgotten dev window kills the install on
   `electron.exe`. The preflight names the PID.
2. **Spectre-mitigated MSVC libraries** must be installed (Visual Studio Installer → Individual
   components). node-pty's own `binding.gyp` requires them. Their installer refuses `--quiet`
   without elevation, so this needs one admin run, once. CI never needs it.

## Issue tracking

**Issues are disabled on this repository**, so the customary practice of posting a handoff and
per-task progress to an issue thread cannot be followed here. This file is the handoff of record
until issues are enabled. PR #276 on the upstream carries the same summary in its description.
