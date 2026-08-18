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

### Full suite — RUN, and it is not green

Run at `7fc7ab9b`, serially (`npm test -- --no-file-parallelism`), 597 s:

| | |
|---|---|
| Test files | **42 failed**, 595 passed, 6 skipped (643) |
| Tests | **141 failed**, 7,842 passed, 182 skipped (8,165) |

This is the run that had been missing all session. Typecheck was clean throughout; it proved
nothing about these.

**Two causes account for most of it, and only one is a code defect.**

1. **A missing build artifact, not a regression.** Many failures were simply
   `session-host bundle not found (out/session-host/host.cjs is missing)`. Running
   `npm run host:build` produces it in 20 ms. Anyone reading a red suite here should build first
   and re-measure before diagnosing — but note this did NOT clear them all.

2. **A real protocol-compatibility defect, ~58 failures across five session-host files.**
   `session-host-client.ts` rejects a handshake with
   `session-host protocol publication disagrees with hello: state=2, hello=1`.

   The check is `identity.state.protocolVersion !== negotiated`, and those two values are not the
   same kind of thing:
   - `identity.state.protocolVersion` is what the HOST SUPPORTS — the host always publishes
     `currentProtocolVersion()` (2) into its state file.
   - `negotiated` is what THIS CONNECTION settled on — 1 whenever the hello reply omits
     `result.protocolVersion`, which is precisely the host's deliberate legacy path
     (`clientProtocolVersion === 1` for a client that requested 1 or nothing).

   So a current client meeting a host behaving as v1 legitimately yields `state=2, hello=1`, and
   strict equality refuses a combination the design explicitly supports. The failing tests assert
   that backward-compatibility path works. Comparing compatibility (state must be >= negotiated)
   rather than equality is the likely correct fix, but it was NOT applied here: changing handshake
   logic in the Windows persistence path deserves a careful, verified change rather than a
   plausible-looking one, and this session had no capacity left to verify it properly.

   `src/core/session-host-client.ts` was last touched by the convergence merge (`ba819a66`) and by
   the type-error repair (`3730b49f`); the convergence is the prime suspect, since it merged two
   protocol lineages.

**Do not treat 141 as 141 broken behaviours.** Failures cluster hard: 34 in
`session-host-client.test.ts` alone, and the counts above are per-assertion, not per-defect.

---

# Handoff — 2026-08-18, release candidate 0.4.3

Everything above this line is a **dated snapshot of the 2026-08-16 convergence** and several of its
figures are now stale — the 141-failure count in particular. It is kept because its *reasoning*
still holds (especially the blank-window mechanism), not because its numbers do. This section
supersedes its counts.

## The full suite has now actually been run

It had never been run in the convergence session. Serialized, on Windows, at `bfb0ba0f`:

```
EXIT=1    Test Files  30 failed | 614 passed | 6 skipped (650)
          Tests       56 failed | 8022 passed | 193 skipped (8271)
```

Two things about that run are worth carrying forward:

- **The wrapper reported exit 0 while vitest exited 1.** Capture `EXIT=$?` *inside* the log; a
  wrapper's status is the status of whatever ran last, which is usually `tail`.
- A concurrent lane mutated `workspace.test.ts` mid-run, so that file's verdict in this run is
  about a tree that no longer exists. It was re-run alone afterwards: 166/166.

## Blank window: measured, not inferred

`check:wired` passes **6/6 against the real packaged output** at `9facfc5f` — including "the canvas
renders real nodes, not a picture of nodes", "a terminal actually spawns" (`pty.create`
round-tripped), and 70 bridge namespaces answering a live main-process call. `out/main/` is flat
(`index.js` + one hashed chunk, no `chunks/` directory), so the mechanism described above is intact
in the artifact and not merely in the config.

Getting there needed two unrelated repairs, both worth knowing:

- The gate's "did boot create its managed artefacts?" list was derived from `managedConfigTargets`,
  which answers a **different question** — it is an allowlist of files bootstrap is *allowed* to
  touch, fingerprinted elsewhere to prove the real home came back unchanged, where `absent` is a
  fine answer. `ad3354e0` added the four shared School/Kids records to it for the capture harness;
  boot does not write those by design (`shared-record-watch.ts` exists precisely because that
  directory may be absent). Correct for one question, silently wrong for the other. Now split:
  `bootCreatedConfigTargets`.
- `node_modules/electron/dist` was empty with no `path.txt`. CLAUDE.md records `install.js` as a
  dead end that exits 0 having extracted nothing — that was measured on **Node 26.5**. On Node 24 it
  works. The dead end is version-specific, not absolute.

## Three coupled Codex identity defects, fixed in `7207a9e9`

Found by a seven-lane review, each verified from source before being believed. All three are the
same drift: the capability moved to the canonical `kid.mac` shape and three consumers stayed on the
old bare MAC.

1. `hook-server` minted and verified with `HMAC(secret, nodeId)` — no kid, no domain separation —
   while the only token a client can obtain is the `kid.mac` one in its token file. **Every
   `/codex-thread/*` route answered 403 to a correctly-tokened caller.** The secret was identical
   throughout: `setNodeAuthSecret` and `setCodexNodeAuthSecret` write one field.
2. The relay daemon's `register()` read `$NODETERM_CODEX_NODE_TOKEN`, which the launcher
   deliberately never sets (it pipes the capability on **stdin** and says so in a comment directly
   above the call). Now reads stdin, bounded.
3. `SAFE_NODE_TOKEN` pinned the old 43-char bare MAC with no dot, so even an arriving token failed.

The test that should have caught this asserted a **regex on the shape**, which is exactly how the
drift survived. It now asserts that what the server mints must verify; reintroducing the old
derivation turns three tests red, checked rather than assumed.

## Corrections to earlier claims

- **CLAUDE.md was wrong about the session reaper.** It promised only *detached* sessions are reaped.
  `session-budget.ts` removed that rule on purpose — 54 of 54 sessions on a real host reported
  attached, so the reaper had never fired — and activity staleness now carries the protection alone
  (grace defaults to a day). An idle session **is** reaped while attached. Corrected in place.
- **`package-lock.json` was briefly damaged and reverted.** An `npm install --no-save` dropped
  monaco's exact-pinned `dompurify@3.4.8`, leaving the hoisted `3.4.13` to satisfy it — silently, in
  a sanitizer, on every clean `npm ci`. Re-verify the lock after any ad-hoc install, not only at the
  moment you run one.

## Remaining known failures

Reduced but not zero. The residue is overwhelmingly **fixtures asserting the platform they run on**,
not application code the packaged app reaches. Each surviving skip names its exact environment
limitation and cites precedent `99dfb2db`; none is a blanket platform skip.

Two deliberate non-fixes, both recorded rather than papered over:

- Six `codex-identity-proxy` tests set `$NODETERM_CODEX_NODE_TOKEN` directly, which
  `codex-identity-proxy.ts` says explicitly does not exist as a fallback — search its launcher
  script for "deliberately NO". They test removed behaviour and are platform-independent.
- The `state=2, hello=1` handshake question raised above is **closed, and the fix it proposed was
  wrong.** That entry suggested comparing compatibility (`state >= negotiated`) rather than
  equality, on the theory that "a current client meeting a host behaving as v1 legitimately yields
  state=2, hello=1, and strict equality refuses a combination the design explicitly supports."

  The premise does not hold. Read in the source rather than reasoned about:

  - **The host writes its own state file**, with its own pid and
    `protocolVersion: currentProtocolVersion()` (`session-host/host.ts`, the publication just after
    the token file is written). State and behaviour therefore come from one process and cannot
    disagree for a host that is actually alive.
  - **The host omits `protocolVersion` from its hello reply only when the CLIENT asked for v1** —
    its branch is `clientProtocolVersion === 1`, set when the request carries version 1 or none.
  - **The client always asks for v2**: it sends `protocolVersion: SESSION_HOST_PROTOCOL_VERSION`,
    which is 2.

  So a current client reaching a live v2 host always negotiates 2 against a state that says 2. The
  only way to reach `state=2, hello=1` is a **stale state file** describing a dead v2 host while the
  socket is answered by something behaving as v1 — which is precisely an inconsistent host, and is
  what `session-host-client.test.ts` already says the refusal is for in as many words.

  Relaxing the comparison would accept that state and then run v1 semantics while trusting a state
  file the client reads v2 facts from, including the generation bookkeeping. The strict equality
  stays. **No change was needed; what was needed was reading the host's own publication path.**

## Solved: the fixture directory that outlived the Server Edition shutdown test

`test/server/server-e2e.test.ts` intermittently could not remove its own temp directory on Windows,
failing with `EPERM` on the directory itself — in teardown, after every assertion about shutdown
ordering had already passed. The measurements taken at the time are still the interesting part,
because they ruled out the obvious fix:

| bounded retry | failure rate |
|---|---|
| 1 s (20 x 50 ms) — what was there | ~1 run in 4 |
| 5 s | ~1 run in 6 |

The conclusion drawn from that was right — a holder surviving five seconds is not transient lag, so
buying more time is the wrong fix — and the longer wait was reverted, with the failure downgraded to
a warning so teardown could not decide a passing test's verdict.

**The missing step was WHY more time could never work.** `fs.rmSync`'s retries are SYNCHRONOUS:
they block the event loop, so they cannot let in-flight async work in the same process finish and
release what it holds. The retry loop was waiting for the thing it was itself preventing. The
holder is a mirror publication that opens `agent-status.json.publication.sqlite3` under this very
dataDir inside a `BEGIN IMMEDIATE` transaction, with nothing awaiting the flush.

Same options, same retry count, one keyword — `await fs.promises.rm`. Four consecutive runs, four
fixtures created and all four removed, zero warnings, and the leftover count in TEMP flat rather
than climbing. The warning stays as a net; it should now be silent.

Two further leaks in the same file's neighbourhood turned out to be production bugs and are written
up under the temp-directory leak section below.

## Open: eight commits on `main` carry a placeholder identity

`4ff914b1`, `5802bf16`, `e28e4321`, `fadb0843`, then `a3d28e75`, `1693b82a`, `69d2db23` and
`4a5596f6` (2026-08-17) are authored **and** committed by `Smoke User <smoke@example.invalid>`
with no `Co-Authored-By` trailer. A harness left an identity configured and pushed real work under
it, including `src/renderer/state/workspace.ts`, `src/core/speech/speech-service.ts`,
`src/renderer/components/ContextMenu.tsx`, `.github/workflows/release.yml`, `CLAUDE.md`,
`CONTRIBUTING.md` and `AGENTS.md`.

It is not cosmetic, and the size is measured rather than estimated: at `4a5596f6`, **1,256
surviving lines** were being credited to a person who does not exist. `scripts/count-lines.mjs`
attributed a line to an agent when the author matched a known automation identity **or** the body
carried such a trailer, and to a **person** otherwise — and a placeholder matches neither. `git
blame` also answers with an address that by definition cannot receive mail.

**The miscount is fixed; the history is not.** The counter now routes a line whose author sits on
a reserved, un-routable domain to `unknown` — the bucket that already means "nobody can be
credited for this" — instead of to a person. Proved by an A/B at one ref rather than asserted:
person 57,297 -> 56,041, unknown 0 -> 1,256, agent unchanged at 339,078. The arithmetic agrees
with itself. The published `rule:` sentence was updated in the same change, because a rule that
describes behaviour the code no longer has is worse than no rule.

Correcting the commits themselves means rewriting published history, which is a force-push, which
needs the branch owner’s explicit say-so and is never an agent’s call — least of all to tidy
something up.

**Recurrence is reduced, NOT blocked — do not read the guard as more than it is.**
`scripts/check-commit-identity.mjs` is wired into `.githooks/pre-push` and refuses a push carrying
an author or committer at a domain RFC 2606 / RFC 6761 reserve so it can never resolve. It checks
only the commits actually being sent, so what is already published is not its business, and it
deliberately does not enforce "one identity" — this history legitimately carries several real
people, and a check demanding a single name would refuse their work.

What it cannot do was demonstrated 31 seconds after it landed: four more placeholder commits
reached `main` from a parallel session, rebased onto the guard commit itself. A pre-push hook
binds one checkout that has opted into `core.hooksPath`; it binds no separate clone, and
`--no-verify` walks past it. The enforcement point that would actually hold is a server-side
check, and this project deliberately runs no gating checks in Actions (see
`docs/ci-and-releases.md`), so that is a decision for the repository owner rather than something
to quietly add. Until then the guard is a good local habit, not a boundary.

Verified in both directions rather than assumed: it flags exactly those eight and nothing else
across 300 commits containing five real contributors’ addresses, it refuses a simulated push that
would carry them, an ordinary push with nothing new to send passes, and breaking the matcher turns
`scripts/reserved-identity.test.mjs` red (3 of 7) before restoring it turns it green.

## Open: stranded draft releases, and what they cost

`v0.4.4` and `v0.4.5` are drafts left behind by failed release runs on 2026-08-18. `v0.4.6` and
`v0.4.7` published normally, so nothing is broken — but each stranded draft permanently occupies a
version number, because the planner reads `repos/:owner/:repo/releases`, which includes drafts, and
a number a draft holds cannot be reused without colliding.

**A re-run no longer strands another one.** `planReleaseVersion` always had a `retry` outcome for
exactly this ("bumping would strand the half-staged draft under a number nobody can find"), but it
required `packageVersion === highest.version` — and the every-push-releases design writes the
computed version into the working tree and deliberately never commits it, so `package.json`
permanently lags whatever shipped. The branch was unreachable by construction: measured at
`4a5596f6`, a re-run **at the same commit** planned `0.4.6` rather than resuming the `0.4.5` draft
sitting right there. It now also retries when the highest version exists ONLY as a draft targeting
this exact commit, which is the same claim the original condition was trying to make.

Four cases pinned, because the failure modes point opposite ways: same commit resumes its own
draft; a draft belonging to ANOTHER commit is refused and bumped past; no drafts bumps normally; a
hand-bumped `package.json` is still respected. Anything that cannot be PROVEN to be a draft counts
as published — the conservative direction mints a new number, the careless one would resume
something already shipped.

**The two existing drafts are not cleaned up here.** Deleting a release is outward-facing and
irreversible, and these are not obviously disposable: they are the only record of what those runs
staged. Removing them would also free their numbers for reuse, which is the one thing the version
rules exist to prevent. That is a call for whoever owns the repository, and either answer is
defensible — the reason to raise it at all is that nothing else will, and a draft list that only
grows eventually makes the release page unreadable.

## The full suite is green; a full run under load is not, and the difference is measurable

Run on 2026-08-18 while release builds, a parallel session and an agent fleet were all active:
**13 failures across 7 files** out of 8,405 tests. Re-run one file at a time, sequentially, on the
same tree at the same commit: **106 tests, 0 failures** — every one of the seven passed completely.

That alone would be suggestive. What settles it is that **not one of the thirteen computed a wrong
answer.** Five were vitest timeouts (four at 30,000 ms, one at a per-test 15,000 ms). The rest look
like assertion failures and are not: `expected Error: spawnSync C:\WINDOWS\system32\cmd.exe
ETIMEDOUT to be undefined`, and `expected { status: null } to deeply equal { status: 0 }` — a
`null` exit status is a process that was killed rather than one that returned the wrong code. Every
failure is "this took too long", none is "this is wrong".

That also rules out the other candidate. Cross-file interference through shared state is a real bug
class and running a file alone hides it too — but it produces wrong VALUES, not timeouts. Nothing
here produced a wrong value.

The run's own numbers say the same: 505 s wall clock against 2,613 s of test time and 898 s of
`import`, i.e. heavy worker parallelism on a machine that had none to spare.

**Do not respond to this by raising timeouts.** The 30 s ceiling was set from this repository's own
recorded guidance and is already six times the previous default; four tests exceeded even that, and
inflating it further would only hide the next genuine hang. The right responses are to run the full
suite when the machine is quiet, and — when a suite must run during a busy session — to re-run any
timeout-shaped failure in isolation before attributing it to anything. A verdict from a contended
run is a verdict about the machine, not about the code.

## Solved: the handlers-test flake was a synchronous retry waiting on async work

`src/server/handlers/index.test.ts` failed intermittently — between 1-in-4 and 4-in-6 on one tree
within an hour — always `EPERM` on removing its temp directory. It is fixed, and the cause
generalises well beyond this file.

**A mirror publication holds a SQLite lock inside the directory, and nothing awaits it.** The test
points `userDataDir` at the same temp repo it deletes. `withPublicationLock` opens
`agent-status.json.publication.sqlite3` under that directory inside a `BEGIN IMMEDIATE`
transaction; the flush is not awaited by the test, so it can still be in flight when `afterEach`
removes the directory. The `-journal` file sitting beside the database at failure time is what
proves the transaction was open, not merely that the file existed.

**`fs.rmSync`'s retries cannot help here, and that is the transferable part.** They are
SYNCHRONOUS: they block the event loop, so they can never let in-flight async work in the same
process finish and release what it holds. A synchronous retry loop waits for something it is itself
preventing. Switching that one cleanup to an awaited `fs.promises.rm` — same options, same retry
count — took it from 2-to-4 failures per 6 runs to 8 of 8, then 6 of 6 for the whole file.

**Two earlier published claims were measurement artifacts, and both are corrected.**

- "No individual file is locked, so the directory handle is busy" was a FALSE NEGATIVE. The scan
  opened each file for append, and SQLite's byte-range locks do not block that open, so the one
  file that mattered reported clean.
- "Never released, even after 60 seconds" was caused by the probe. The wait was a busy spin, which
  blocks the event loop — the same mistake as the retries, made while investigating the retries.

Five hypotheses were eliminated before the right question got asked, and the question that finally
answered it was cheap: *what is still in the directory after the removal fails?* Two filenames.
Ask what remains before asking who is to blame.

### Not swept: the 209 synchronous retries added the same day

The retry sweep added `maxRetries` to synchronous `rmSync` calls across 141 files. That is still
correct for the case it targets — a handle held by ANOTHER process, such as the virus scanner —
because the event loop is irrelevant there. It cannot fix a hold owned by pending async work in the
same process, which is what this file had. Converting those call sites to awaited `fs.promises.rm`
would require making each `afterEach` async and is a larger, separate change; the ones that matter
are the tests whose subject writes under a directory the test then deletes.

## Solved: the temp-directory leak, and the bug class behind it

A full suite run used to leave dozens of `nt-*` directories in TEMP — 387 had accumulated. A full
run now leaks **one**, and that one is `nt-tui-`, which is out of scope by standing instruction.

The leak was not untidy tests. It was two production paths caching a PER-RUN directory in a module
singleton and never clearing it, so a server started after a close wrote its files into the
PREVIOUS run's data directory — recreating a directory the test had correctly deleted:

- `hook-server.ts` — `endpointPath` is resolved lazily from `platform().userDataDir` and memoized.
  `stop()` cleared `server`, `port` and `token`, every other per-run field, and missed this one. A
  restarted server advertised its live endpoint and token into a stale path, while the directory
  that should have held them had none.
- `context-link.ts` — `contextLinkDir()` memoized the same way, so a second server's link files
  landed in the first server's directory. The cache is removed rather than cleared on stop: it
  saved one `path.join` across five call sites, none hot, and a value that must be invalidated is a
  value better not stored.

Benign on the desktop, which runs one of each for the life of the process. Not benign for the
Server Edition, whose `close()` is a real repeated operation.

**A third candidate was checked and is fine.** `agent-status-mirror.ts` has the same lazy shape in
`resolveFile()`, but `initAgentStatusMirror()` is called from each shell on start and assigns
unconditionally, so a second server re-points it correctly. Written down because the pattern looks
identical and the next person will find it and want to "fix" it too.

### How it was found, which is the reusable part

Not by reading. The test leaked exactly one directory per run, and the first test's `dataDir` was
deleted correctly — `existsSync` said false — and then reappeared. From there it was subtraction:
fix one writer, look at what the survivor still contains. `hook-endpoint.env` disappeared and
`context-links/context.sh` remained, which named the second cache without any guessing.

Ask what is IN the leftover, then remove writers one at a time. Both of tonight's directory
mysteries — this one and the EPERM flake — gave themselves up to that same question, after five
hypotheses between them had failed.
