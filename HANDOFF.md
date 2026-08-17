# Handoff

This document records the measured repository state before the 2026-08-16 branch-convergence pass.
It is intentionally explicit about evidence that belongs to an older commit and work that remains
unintegrated. A passing check on one branch is not presented as proof for another branch. Treat
every branch, worktree, test, and release count as a dated snapshot and re-measure it after
convergence.

## Historical main baseline and blank-window fix

The aggregate side entered this merge with an earlier baseline at `effb73a3` on `main`, verified
against the public repository at that time. The version before it described `63722558`, 460 test
files, and 23 checkouts; all three figures had already become stale, which is why this handoff now
binds evidence to exact commits instead of presenting remembered counts as current.

A packaged release opened to a **completely blank window** with only the system window controls.
It was fixed on `main` in `effb73a3`; any replacement installer must be built from that commit or a
descendant that preserves the fix.

The cause is worth understanding because it will happen again if the mechanism is disturbed. The
Squirrel bootstrap imports the application graph lazily, so Rollup emits that graph as a *dynamic
chunk*. Vite's default `chunks/` directory moves it one level down — which silently relocates
`__dirname`. Every path anchored to it (preload, renderer HTML, HUD preload, HUD renderer, the
unpackaged icon) then resolves one directory off. **Nothing errors.** You get a window with no
preload bridge, which reads as a renderer failure and sends you looking in the wrong place entirely.

Two things hold it now, and both are needed: `chunkFileNames` pins the chunk beside the entry, and
`desktopBuildPaths()` refuses outright when it is not running from `out/main`, so a future config
change fails loudly at the boundary instead of shipping a blank page.

## What this project is now

nodeterm is a public BUSL-1.1 Electron/React spatial terminal manager. Persistent terminal and
agent sessions live as draggable nodes on a canvas and as cards on a kanban board. An
Electron-free core powers both the desktop shell and a Linux browser-based Server Edition;
terminal continuity uses tmux where available and a standalone Windows session host otherwise.
A separately maintained mobile companion connects through the relay protocol. The current
unpublished integration line combines Windows, persistence, pairing, scheduled-settings,
local-history, appearance, data-format, and relay hardening, but the branches listed below still
need to converge before it can replace `main`.

## Measured repository state

Snapshot time: `2026-08-16T17:03:02-04:00`.

| Item | Measured value |
|---|---|
| Integration branch | `fix/yum-tong-final` |
| Integration commit | `552362f243b86c341f2346c1c8cc791ce1229fff` |
| Integration working tree | clean and identical to `origin/fix/yum-tong-final` |
| `main` / `origin/main` | `c31683c630936b38c1734b15b2344c2c8317df44` |
| Integration divergence from `origin/main` | 81 commits ahead, 0 behind |
| Linked worktrees | 37 |
| Local branches | 39 |
| Stashes | 0 |
| Repository visibility | public |
| Repository issues | disabled |
| Release workflow | manually disabled (workflow ID `334756298`) |

All authored changes were committed and pushed to their owning branches by the end of the
preservation sweep. Two local-only items need special handling before their worktrees can be
removed:

- `material-nodeterm-pup-atomic` contains an untracked dependency/test cache under
  `.atomic-vitest-cache/tweetnacl/`. It is not project source and must not be committed as source.
- `material-nodeterm-pup-docker` contains an ignored local `.env` with a secret-like value. Its
  value was not read and it must never be committed or deleted implicitly.

The final branch/worktree counts must be regenerated after integration. The numbers above are a
snapshot, not deletion authorization.

## Earlier main-side changes carried into convergence

The aggregate side also carried these commit-bound changes into this merge. They are implementation
history, not proof that the final combined tree has passed its gates:

- **Blank release window** fixed (`effb73a3`) — described above.
- **Ordinary Windows terminal typing and agent-launch regressions** fixed (`1c305ec2`). The
  checkpoint had treated the default `auto` profile as an explicit request for the session host,
  whose fire-and-forget write path could drop input silently; it also advertised
  `pty.executeLaunchIntent` without a matching main-process handler.
- **All formerly paid features made free** (`66222613`). `isPremium` now follows the local
  `proFeaturesEnabled` performance switch, which defaults on; it is no longer a payment gate.
- **Personal-vocabulary upload compatibility** widened (`274f9920`) to accept `schemaVersion` or
  `version`, a `terms` list, and companion documents with no substitutions.
- **The 179-file Windows checkpoint** (`a4e3b13d`) preserved terminal-profile, session-host, and
  installer work that had existed only on disk. It was explicitly unverified at that checkpoint,
  and later repairs do not turn that old commit into verification evidence.

## Test inventory and evidence ledger

The current integration commit collects 527 test files. Of those, 522 contain 6,518 runnable
tests in the current Windows environment. This is a collection result, not a passing full-suite
result.

| Area | Active files | Runnable tests |
|---|---:|---:|
| `scripts` | 1 | 5 |
| `site/app` | 4 | 22 |
| `src/core` | 162 | 2,266 |
| `src/main` | 63 | 786 |
| `src/preload` | 1 | 8 |
| `src/renderer` | 205 | 2,535 |
| `src/server` | 17 | 165 |
| `src/session-host` | 4 | 13 |
| `src/shared` | 45 | 639 |
| `test/remote` | 9 | 49 |
| `test/server` | 11 | 30 |
| **Total active** | **522** | **6,518** |

Five collected files have no runnable case in the current Windows environment:

- `src/core/local-send-keys.realtmux.test.ts`
- `src/core/paste-injection.realtty.test.ts`
- `src/core/remote-ssh/control-master.realsh.test.ts`
- `src/renderer/lib/sessionRename.realtty.test.ts`
- `test/ssh-docker/askpass-e2e.test.ts`

The exact individual-file inventory is reproducible without running the tests:

```powershell
npx vitest list --filesOnly --json
npx vitest list --json
```

The evidence ledger is commit-bound:

| Evidence | Exact commit | Command or route | Result | What it proves |
|---|---|---|---|---|
| Last frozen full Windows suite | `f6d6d66e5093ae5f931cc8b131577cddcec61011` | `npm test -- --no-file-parallelism` | 515 passed / 5 skipped files; 6,419 passed / 166 skipped tests; 0 failed; 32.47 s | Source-tree unit and integration behavior at that commit |
| Frozen Windows inventory | `f6d6d66e5093ae5f931cc8b131577cddcec61011` | Vitest list commands above | 520 files, 515 active, 6,419 runnable | Collection only |
| Current inventory | `552362f243b86c341f2346c1c8cc791ce1229fff` | Vitest list commands above | 527 files, 522 active, 6,518 runnable | Collection only; not a green run |
| App contract | `552362f243b86c341f2346c1c8cc791ce1229fff` | `node scripts/check-app-contract.mjs` | 520/520 assertions across 44 features | Source/contract scan, not runtime interaction |
| Site contract | `552362f243b86c341f2346c1c8cc791ce1229fff` | `node scripts/check-site-contract.mjs` | 326/326 assertions | Source/contract scan, not runtime interaction |
| Vocabulary precondition | `552362f243b86c341f2346c1c8cc791ce1229fff` | `node scripts/check-vocabulary.mjs` | passed | Local build precondition |
| Last recorded built-app wiring | `63722558` | `npm run build && npm run check:wired` | 6/6 | Built `out/` artifact driven over CDP; stale for the integration line |
| Authoritative desktop captures | `b5815d21381bb8b578a09b2f7e4c1a98a815b325` | capture workflow | six real built-app captures; live-agent and SSH captures explicitly skipped | Built-artifact visual evidence, not behavior tests |
| Last Linux-host full suite | `c42d8ec196913296203a8b0ecad8e3060b8c6dfe` | isolated container test route | 488 passed / 2 skipped files; 6,423 passed / 21 skipped tests; 0 failed | Linux source/runtime evidence, not Windows package evidence |
| Public release workflow | `c42d8ec196913296203a8b0ecad8e3060b8c6dfe` | workflow run `31966413527` | build and publication passed | Packaging only; the workflow explicitly ran no tests, typecheck, or lint |

`npm test`, typechecking, and the contract scripts do not interact with an installed application.
Only `check:wired`, real captures, and a future installed-package exercise cross that boundary.
There is no exact-final built-artifact interaction result yet.

## Published baseline

The latest public release was verified through the GitHub API, the exact tag ref, and public asset
requests:

- Tag: `v0.3.0-ci.208`
- Target: `c42d8ec196913296203a8b0ecad8e3060b8c6dfe`
- Published: `2026-08-16T19:12:56Z`
- State: non-draft and non-prerelease
- All three asset requests followed redirects to HTTP 200

| Asset | Bytes | SHA-256 |
|---|---:|---|
| `node-terminal-0.3.0-full.nupkg` | 216,733,412 | `7e90eeb4b8fb6ef38c2b1e4ee37b6c25806df5da12c5b914a4b69ea4393d4a8e` |
| `nodeterm-Setup-0.3.0.exe` | 216,853,504 | `f3d30ccc7b62cf9bfcb56aca9f7e3ba5c3c2e2278ed82283bd129fc1dc7dd9cd` |
| `RELEASES` | 84 | `308012e562128a9c53b0234b5c22b0646e84e8ab8cdfc5806bc15b337210dc31` |

No newer release was created during this finish pass. The current integration manifest is still
`0.3.0`; the `0.4.0` updater work is on an unintegrated branch. The hosted Release workflow remains
manually disabled.

## Completed branches awaiting integration

These commits are pushed and their worktrees are clean, but they were not ancestors of the
integration branch when this handoff was written:

| Area | Branch | Exact commit | Branch-local evidence |
|---|---|---|---|
| Server authentication | `fix/yum-tong-server-auth` | `cade1d083fda385eba4acd9ef7720d70e1a46df8` | 184 server tests; 74 focused authentication tests; typecheck; Server build; 528 app-contract assertions; security re-review |
| Atomic credential transactions | `fix/yum-tong-atomic-reconcile` | `a2114fb421e83e25415aba930ce66d031a00c6c0` | 324 tests across 32 files; typecheck; three mutation classes; no full app/server build |
| Session-host ownership | `fix/hardening-session-client-final` | `12a1f9acc5e4a9e37a1b346de9fb224d48d45d3a` | 305 tests across 24 files; typecheck; full app build; mutation proofs |
| Kids/destructive safety | `fix/yum-tong-kids-final` | `11c2e5a79684fb6911614d3dfe1cdeb51af2d443` | 127 focused and 189 expanded tests; typecheck; full app build; 520 app-contract assertions |
| Updater checkpoint | `fix/yum-tong-updater` | `4becbe1127d07813bcf9f32eb25c7575c2148410` | 167 focused tests; typecheck; full app build; workflow checker; 326 site assertions |
| Windows build checkpoint | `fix/hardening-build-scripts` | `ee3c36c282a2f0ac82a904eabcdc78ca8dab3103` | 52 real `cmd.exe` BAT tests; 50 focused version/asset/icon tests; syntax, CRLF, manifest, and diff checks; full typecheck/build not rerun after scope freeze |

The updater and Windows build branches overlap in `package.json`, `package-lock.json`,
`.github/workflows/release.yml`, and `scripts/release-assets.mjs`. Integration must preserve the
legacy Squirrel package ID `node-terminal`, runtime AUMID
`com.squirrel.node-terminal.nodeterm`, version `0.4.0`, manual-main-only workflow, internal NuGet
identity checks, release manifest/digest checks, and the Windows asset/icon validations. Do not
enable `useAppIdAsId`.

## Known boundaries and unfinished work

No item in this section has an issue number in this repository because repository issues are
disabled. The list must be converted into tracked issues if issue tracking is enabled.

### Integration and verification

- The completed branches above need conflict-aware integration and ancestry proof.
- No full suite, typecheck, desktop build, Server build, built-app interaction run, package build,
  install, update, restart, or uninstall proof exists at the eventual final combined commit.
- The Release workflow is deliberately disabled.
- The updater still needs real packaged `0.3.0 -> 0.4.0` trials with the old app closed and running,
  plus disposable two-version restart/next-launch trials.
- The build checkpoint still lacks a static immutable `squirrelWindows.iconUrl`, hosted execution,
  final packaged icon inspection, and installed-app proof. Squirrel's `Update.exe` remains
  vendor-branded.

### Pairing and external companion

- The external companion source and release artifact were not available for verification. There
  is no combined proof that every `agent.json` writer uses the same cross-process lock or that the
  companion release implements the encrypted pairing/attempt-lifecycle contract.
- The public pairing helper is not a substitute for the separately maintained companion.

### Session, Kids mode, and process ownership

- Generic SSH termination and legacy tmux teardown remain best-effort outside the repaired
  standalone-session-host boundary. A missing node-pty `onExit` times out and leaves the generation
  claimed fail-closed.
- Kids-state watcher rearm/CAS behavior still has post-gap and external-writer races. Remote managed
  account deletion remains best-effort when the host is absent or disconnected. Core-conditional
  orphan-session killing and complete production delete-callsite inventory remain open.
- Session-host pipe ACLs have not received an independent security audit. Kids mode still lacks a
  real logged-in agent launch observation and child/adult usability validation.

### Server Edition and relay

- Server Edition canvas control is not wired.
- Server Edition context links are not initialized, and live session-title reads remain stubbed.
- Relay session-specific agent-status stores are not fed, so plain-shell lifecycle protection is
  incomplete.

### Agent and feature surfaces

- SSH worktrees and worktree-aware Explorer/command-palette indexing remain unsupported.
- Grok lacks context links, context metering, subagent activity, verified notification vocabulary,
  reliable remote naming, and verified canvas-control discovery.
- Gemini lacks transcript view support, Server context links/canvas control, remote title/meter
  support, and safe fallback for an invalid resume ID.
- Toy-lock node overlays, command-palette lock labels, and bulk creation remain unimplemented.
- Authenticator QR image/clipboard/camera import remains unimplemented.
- Bulk End sessions remains deliberately deferred.
- Ollama image attachments, exhaustive catalog metadata, regex search, copy-model UI, relay
  routing, and the stronger destructive gate remain incomplete.
- Site nested tab grouping remains unimplemented.
- Material 3 elevation roles and migration of existing components remain unstarted.
- Speech native ABI/device proof remains incomplete, and the cloud transcription endpoint is not
  built.
- Session-memory macOS per-row comparison and a real memory-pressure signal remain open.
- The completeness scan cannot detect a feature that disappears together with its documentation.

The only live numbered external defect found during the audit is
`microsoft/node-pty#950`. In-code references to upstream issues `#29`, `#47`, `#84`, `#86`, `#87`,
and `#126` all point to closed issues and must not be used as current tracking for the boundaries
above.

## Issue handoff status

The repository is public but has issues disabled. `gh issue list` fails for that reason, and the
REST API returned no historical non-pull-request issues for this repository. Therefore the required
issue copy of this handoff could not be posted. This file remains the handoff of record until issue
tracking is enabled. Upstream PR #276 carries the earlier main-side handoff summary in its
description, but it is not a replacement for the newer commit-bound record here.

## Next-owner checklist

1. Integrate the completed branches above without dropping either side of shared contracts.
2. Re-run the full Windows suite, typecheck, desktop build, Server build, contract checks, and
   exact built-app interaction harness at the final combined commit.
3. Keep the Release workflow disabled until the manual-main-only workflow and package provenance
   checks are on `main`.
4. Produce the missing installed-package, update, restart, uninstall, and icon evidence before
   claiming release readiness.
5. Resolve or explicitly retain the external-companion blocker.
6. Refresh this document again after integration and verification; remeasure every worktree,
   branch, and ancestry claim before any cleanup.

---

## Post-convergence session (main `51bd89c5`)

Everything below was measured at that commit, after the branch convergence recorded above. `main`
is clean, identical to the remote, and typechecks on both `tsconfig.web.json` and
`tsconfig.node.json`.

### The convergence dropped working code — three shapes, all found after it landed

A bulk merge of long-diverged branches produced commits that are textually clean and had silently
discarded code. It is worth knowing the shapes, because each looked like success:

1. **Dropped symbols.** `transport`, `claudeLaunchCommand`, `liveCanvasOwnsProject`,
   `gitRemovalFingerprint` and others existed in parent commits and were simply gone. `main` failed
   `tsc` with **77 errors**. Each was recovered from history with `git log -S`, not reinvented.
2. **Duplicate same-named interfaces.** Two branches each added a `GitWorktreeRemovalProof`.
   TypeScript *merges* same-named interfaces rather than rejecting them, so the effective type
   became the union of both and every producer of either shape failed at once — with errors pointing
   at the producers, not the duplicate. They were different facts and are now
   `GitWorktreeRemovalMeasurement` (a measurement) and `GitWorktreeRemovalProof` (an authorization).
   `AuthenticatorEntry.revision` had the identical collision.
3. **A destructive safety barrier, gutted.** `beginApprovedRemove` (removing a Claude account) lost
   its `cancelWaitLogin` await and the `finalCommit` barrier that re-reads live state and re-checks
   Kids-mode policy **after** that await. Two branches rewrote it from one parent; the
   reconciliation kept the hardened version's outer scaffolding and the shallow version's inner
   body, so the guard read as present and was not. Its own tests were failing and had been dismissed
   once as environment noise. Restored from `11c2e5a7`; 9/9 pass.

**Typecheck passing is not evidence tests pass.** All three survived a green typecheck.

### Fixed this session

- Blank packaged window (`effb73a3`), Windows terminal typing + agent launch (`1c305ec2`).
- Kids **and** School mode could be ON with no PIN ever set and then never turned off — the mode
  record is shared across apps while the credential is a separate file, so "enabled with no
  credential" is reachable. Both now disable freely when no credential exists; an *unreadable*
  credential still keeps the mode locked, and now says it could not be checked rather than claiming
  the PIN was wrong.
- All formerly paid features are free; the remaining switch is a performance control with
  per-feature sub-switches. Master off → back on restores each feature's own choice.
- Client-side refusal of solicitation announcements (stars/donation/upgrade), which a server-side
  feed edit cannot undo. Security, breaking-change and mandatory-update messages are never filtered,
  including messages carrying both.
- Ollama's `not-installed` state was unreachable: the classifier text-matched `econnrefused` against
  an error message, but Node's fetch collapses these to `"fetch failed"` and the real code lives on
  `.cause.code`. Every "not running" case rendered "Ollama answered but reported a problem" when it
  had never answered.
- Tailscale sidecar behind its own compose profile, off by default, no published ports.
- Issue #128 (welcome screen could strand you) and #119 (lead-pane width, wired end to end).

### Upstream PR status

Already present via convergence or the concurrent session: **#112 #189 #113 #156 #175 #177 #275
#274 #273**. Integrated here: **#267** focus mode (`7fef4719`), and from **#111** only
`a60371d9` (PSReadLine Ctrl-C abort, `51bd89c5`).

Three deliberate exclusions, with reasons — do not "finish" these without revisiting the reasoning:

- **#111 psmux — skipped.** This fork already has its own Windows persistence backend (the session
  host: ~4,000 lines, protocol v2, ConPTY, process-tree termination; `sessionHost` appears 62 times
  in `pty-manager.ts`). psmux is a competing implementation of the same job. Its **NSIS packaging
  commit `daecb26e` is excluded permanently** — Squirrel is the only Windows installer path here.
- **#98 — skipped, superseded.** `main` has `send`/`reply`/`status` persistent inter-agent messaging
  with authenticated routes and safe-turn-boundary delivery; #98's `notify` is a weaker fixed-prompt
  predecessor of it.
- **#149 configurable shortcuts — NOT DONE.** A 9-file architectural change replacing the hardcoded
  shortcut rows with a registry driven from `settings.shortcuts`, colliding with the focus-mode
  binding added in `7fef4719`. Cherry-pick aborted cleanly rather than half-merged. This is the
  largest outstanding piece of work.

### Still outstanding

- **The full suite has not been run this session.** Typecheck is clean; that is all. Given what the
  convergence dropped, a real run belongs before any release.
- #149 above; issue #145 (annotation tools).
- Issue #42 needs an honest reply rather than a fix: `SUBAGENT_CAPABLE` is claude-only, so opencode
  subagent cards are unimplemented, not broken. #78 is a contributor's own roadmap — reply only.
- A design-comparison app for the Material Design overhaul was started at
  `C:/Users/cntow/Documents/GitHub/nodeterm-design-compare` and is incomplete.
