# Upstream sync and the port ledger

This fork tracks the canonical [`eneskirca/nodeterm`](https://github.com/eneskirca/nodeterm)
repository through the `upstream/nodeterm` submodule. It is a true fork: the two histories share
the merge base `215857e2b58a8de38acda45befbbb913770481e3` (upstream PR #434, 2026-08-26), after
which the fork carries 2,621 commits of its own and upstream carries 2,021. A single native
`git merge upstream/main` is therefore possible but would resolve roughly three hundred
content conflicts in one commit; `scripts/port-upstream.mjs` exists so the same three-way merge
can land path by path, in themed tranches, each verified on its own. A shallow clone hides the
shared root (the clone depth used by hosted sessions shows only the newest commits), so run
`git fetch --unshallow origin` and `git merge-base HEAD upstream/main` before reasoning about
lineage.

## Behavior

A port is a per-file three-way merge:

| Side | Source |
| --- | --- |
| base | the path at the upstream commit the fork last absorbed (from the ledger, seeded at the merge base, or `--from`) |
| theirs | the path at the target upstream commit (`--to`, default: the reviewed submodule pin) |
| ours | the fork's working-tree file |

Upstream objects are read only from the initialized submodule checkout
(`git -C upstream/nodeterm show <sha>:<path>`); the tool never writes there. Conflicts are written
**with** `diff3` markers so the resolution stays reviewable, and `apply` exits with status 2 while
any conflict remains.

### Subcommands

```bash
node scripts/port-upstream.mjs classify --from <sha> --to <sha> [--json] [--out <file>]
node scripts/port-upstream.mjs apply --paths <file> [--from <sha>] [--to <sha>] [--write] [--force]
node scripts/port-upstream.mjs apply --commit <sha> [--write] [--force] [--advance]
node scripts/port-upstream.mjs ledger init --at <sha>
node scripts/port-upstream.mjs ledger update --to <sha> --paths <file> [--declined] [--accept-delete]
node scripts/port-upstream.mjs check
```

- `classify` buckets every path that differs between two upstream commits against the fork tree
  without downloading blobs for anything but the diverged files: `new` (absent in the fork),
  `fast-forward` (fork equals the old upstream version), `current` (fork already equals the new
  version), `merge-clean`, `conflict`, `binary-manual` and `deleted-upstream`.
- `apply` is a dry run unless `--write` is given, refuses a path with uncommitted changes unless
  `--force` is given (without shared history, Git is the only undo), copies new files, reports an
  upstream deletion without applying it, and keeps conflict markers.
- `apply --commit <sha>` is the cherry-pick: base is `<sha>^`, theirs is `<sha>`. It does not
  advance the ledger unless `--advance` is given and the ledger base equals `<sha>^`, because
  intermediate upstream commits touching the same path have not been absorbed.
- `ledger update` records that a path now carries a given upstream commit. It refuses a path that
  still carries markers and writes nothing on failure. `--declined` records a path deliberately not
  taken so it is never proposed again.
- `check` is offline and runs in the `build` chain (`npm run check:upstream-port`): it fails on
  conflict markers in any tracked text file, a ledger path missing from the tree, a malformed
  commit id, unsorted keys, or a wrong ledger version.

## Configuration

The ledger is `scripts/upstream-port-ledger.json`: sorted keys, one entry per line, with
`version`, `upstream`, `baseline`, `paths` (fork path to the upstream commit last absorbed) and
`declined` (paths deliberately not taken). It was seeded at the merge base
`215857e2b58a8de38acda45befbbb913770481e3` for every path the fork shares with that commit, which
is the same base `git merge` would use.

The submodule pin is refreshed only through the reviewed workflow in `CONTRIBUTING.md`, and
`CANONICAL_COMMIT` in `scripts/check-canonical-upstream.mjs` moves with it. The port tool defaults
its target to that constant.

## The v0.4.1 port

Measured on 2026-10-03 between the merge base `215857e2…` (2026-08-26) and the reviewed pin
`9d5572e2…` (2026-10-04, `v0.4.1-12`); the previous pin `abb351bf…` sat 32 upstream commits past
the merge base:

| Bucket | Files |
| --- | --- |
| new upstream files absent in the fork | 1,494 |
| fast-forward (fork byte-identical to the merge base) | 208 |
| diverged, three-way merge clean | 177 |
| diverged, three-way conflict | 331 |
| already at the new upstream version | 12 |
| deleted upstream | 7 |

The range holds 2,021 upstream commits. A `git merge-tree --write-tree HEAD upstream/main` dry run
agrees: about three hundred content conflicts plus 29 add/add conflicts, while merging only the
previous pin would conflict in 81 paths. Each tranche ends by recording its waypoint as a real
merge commit once the ported tree matches the resolution, so Git's own merge base advances with
the port and a later sync stays incremental. Eleven shared files take nearly every upstream theme
(`Canvas.tsx`, `styles.css`, `types.ts`, `TerminalNode.tsx`, `main/index.ts`, `preload/index.ts`,
`server/index.ts`, `pty-manager.ts`, `ipc.ts`, `workspace-store.ts`, `ws-bridge.ts`); they are
merged once per tranche against a waypoint commit, never against the final tip, and `styles.css`
is never merged wholesale.

The port lands in themed tranches, tracked in `ROADMAP.md` and in issue #225: security fixes
first, then the families measured as least entangled (github, usage, native SSH transport, and
the protocol half of watch-link live links), then the entangled ones. Watch-link was first listed
here as self-contained; porting it showed that its link host, service, watcher policy and every
renderer surface depend on upstream's core relay stack (`src/core/relay`, 28 files), which this
fork still carries under `src/main/remote` without hooks, so only the protocol foundation landed
(see `docs/features/remote/live-links.md`) and the rest waits for the relay tranche. Every ported user-facing surface is re-expressed on this
fork's Material 3 primitives and tokens, gets a row in the Material 3 audit, a feature article, a
changelog entry and localized copy. Fork-only features are preserved by three-way merging, never
replaced.

### Tranche 1 record (2026-10-03)

Landed on `main` as `faa6a90b9` (lanes 1 and 2) and `8ad74dd47` (lane 3). Ported: upstream
`1bf6fadb`, `60714074`, `fee5b244`, `23a7282b`, `9fa879d0` and the applicable part of `2d3e54cb`.
Examined and skipped because the feature they guard does not exist in this fork: `498a79b3`
(closed-session history), `8dadacdf` (gemini long-header fallback; the fork already reads one
descriptor), `92a31309` (pending structured answers), `7f6beebb` (`adoptFolder`), `c4124767` (chat
tool-body view), `1546a087` / `3cae489a` / `e8e7bc80` (on-disk alert sounds; the fork keeps them
as data URLs in settings). Skipped because they are follow-ups to upstream chains not yet absorbed,
to be ported as their own lanes in this order:

- markdown navigation guard: `46a13215` → `da1a207d` → `e514b595`
- hook-endpoint failover and owner token: `bd895ba1` → `bbb3a291` → `8b0009ec` → `9fad4769` → `ba1d8731`
- hook settings-file preservation and guarded SSH symlink updates: `54fc5ca2` → `8cc40414` → `9f4e3410` → `b0d00189`
- Windows cmd shim argv/stdin and PATHEXT: `0c3268d3` → `4718d5d9` → `34e4826d` → `fafb9b79`
  (the grok-cli pieces also need `877d1e5e`, `80f2181d`, `3753f10a`, `cfd26d01`)

A separate fork gap found while porting: `armForColdOpen` into a background project still emits
the legacy launch shape that the typed `pendingLaunch` boundary rejects, so cold-open arming is
not functional there.

### Tranche 2 record (2026-10-04)

Landed on `main` as `b1711431d` (watch-link, protocol foundation only), `0229467d7` (usage),
`4cd61252e` (github) and `6364df8bb` (ssh), each lane merged `--no-ff` after its own gates and
again on the merged tree. Every ported surface is on this fork's Material 3 primitives with audit
rows, localized copy and an article: `docs/features/remote/live-links.md`,
`docs/features/agents/usage-indicator-reliability.md`,
`docs/features/kanban/github-issues-and-pull-requests.md`, `docs/features/remote/ssh-projects.md`.
Deferred with the reason recorded on issue #225: the live-link host, service and renderer (need
upstream `src/core/relay`); the account-session move and the dock-space layout test (usage; need
the accounts lane and a nav-rail equivalent); `report-issue` wiring (needs the capability-default
system); the native `ssh2` transport, codex context probes, remote-file paging, pty spawn gate and
cold self-heal, share-team and port-forward (ssh; dependencies or other families). The ledger
records only byte-identical absorptions, so three-way merged files surface as conflicts again on
the next port; a "merged but adapted" state is a known gap of the tool.

### Tranche 3 record, wave 1A (2026-10-04)

The four follow-up chains tranche 1 deferred, plus the context-meter rehydration fix, landed on
`main` as five lane merges from `00797a2c2`: settings-file preservation, local half
(`169699c11`; `docs/features/agents/hook-settings-preservation.md`), context-meter rehydration at
mount (`7d5c78d33`; `docs/features/agents/context-meter-rehydration.md`), the markdown navigation
guard (`fb544762f`; `docs/features/files/markdown-link-navigation-guard.md`), hook endpoint
ownership and the owner-bound endpoint walk (`8ff05afc7`;
`docs/features/agents/hook-endpoint-ownership.md`) and the exec-path chain (`0de6b6868`;
`docs/features/agents/grok-session-ids-and-models.md`,
`docs/features/windows/cli-shim-execution.md`). Each lane was implemented and reviewed by separate
agents in its own worktree, and merged `--no-ff` only after its own gates and an adversarial
review; the merges keep both sides of every additive conflict (changelog, app-contract rows, port
ledger union) and regenerate the docs and changelog bundles. On the merged tree: typecheck green,
focused vitest over the 45 touched test files 786 passed and 1 environment-bound failure
(`canvas-control-shim.test.ts`, Darwin remedy case, red on the pre-merge base too), every source
check green except the one known design-parity row. Deferred with the reason on issue #225: the
remote half of settings-file preservation (needs the ssh lane's remote hooks), routing the grok
probe and taken-id read through an SSH project's connection, and the relay-tab consumers of the
grok and claude CLI capability reads. The session-host/updater and terminal/pty families (wave 1B)
follow in their own record.

### Tranche 3 record, wave 1B (2026-10-04)

The two tranche-3 families landed on `main` as `af608d5be` (Windows session host and updater:
session-host hardening, agent messaging backends for Windows panes, updater fixes, shared-session
sizing, co-attach alternate screen and resync, the staged runtime outside the install directory
with the host shutdown command, Prepare for update; articles
`docs/features/terminals/windows-session-host-runtime.md` and `docs/windows-session-host.md`) and
`ed63353d8` (terminal, pty, launch and dev ports: in-place restart quit and late-exit window, the
park window and cap as settings with the memory levers, key and rendering fixes, the stale working
directory banner, snapshot pacing and co-attach screen modes, dev-server port discovery with SSH
forwarding; article `docs/features/terminals/dev-server-ports.md`). The reviewer step did not run
for these two lanes (the implementing agents ended at their session limit after their last commit),
so the merge was reviewed by hand against the fork's terminal invariants, the eight terminal-lane
conflicts were resolved by shape, and the update-exit registry both lanes had ported was
deduplicated (the deduplicated file missed the merge commit and landed as the next commit). Gates
on the merged tree: typecheck green, 892 focused tests passed with the two session-host client
rollback cases red on the pre-merge base as well, every source check green but the known
design-parity row. Parked for a later lane: the file-link hover, menu and token port
(`port/upstream-w1-terminal-filelinks-wip`, does not typecheck yet). Upstream `main` moved 29
live-links commits past the pin during this wave; the pin follows in its own commit and those
commits join the watch-link backlog.

Tranche 1 was a set of cherry-picks scattered across upstream history, so it records no single
waypoint merge; the first waypoint merge is owed by the tranche that first absorbs a contiguous
upstream range.

Deliberate exclusions, recorded in the ledger's `declined` map as they are reached: the upstream
Liquid Glass theme as a visual language (this fork's Material 3 contract wins; non-visual fixes
are evaluated individually), `.github/workflows` changes (this fork's release lane is its own),
and wholesale `CLAUDE.md` / `CONTRIBUTING.md` merges.

## Failure modes

- A port against a target commit that is not in the submodule checkout fails before touching
  anything, naming the fetch to run.
- A path with no ledger entry and no `--from` is reported as `no-base` and left alone.
- A binary file on any side is reported as `binary-manual` and left alone.
- `ledger update` on a path with markers writes nothing, so the ledger can never point past a
  half-resolved merge.

## Security considerations

The tool reads the submodule checkout and the fork tree only; it runs no upstream code and
fetches nothing on its own. Upstream content is ordinary source under review, never executed by
the port. Writes go through a temporary file and an atomic rename.

## Verification

- `scripts/port-upstream.test.mjs` builds two throwaway Git repositories and proves bucket
  placement, `--write` merge, new-file copy, deletion reported untouched, conflict markers with
  three labels and exit 2, a dry run that writes nothing, a cherry-pick that takes only its hunk,
  `ledger update` refusing markers and leaving bytes identical, and `check` turning red for a
  missing ledger path and for a marker-bearing tracked file.
- `node scripts/check-canonical-upstream.mjs` must report `verified` after every pin refresh.
- `node scripts/port-upstream.mjs check` runs in `npm run build`.
