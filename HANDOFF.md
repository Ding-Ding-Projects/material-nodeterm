# Handoff

## 2026-08-26, lane 68 nested repository discovery

Implemented issue #79, reimplementing upstream issue #290. Source Control now discovers independent
nested Git repositories below a project folder through a bounded local scanner, adds them to its
repository scope picker, and routes status, history, diffs, staging, commits, branches, and remote
actions through the selected checkout. Discovery visits at most four directory levels and 512
folders, respects built-in and simple `.gitignore` directory exclusions, never follows symlinks,
and verifies each `.git` marker with `git rev-parse --show-toplevel`. The result distinguishes a
complete scan from a partial, bounded, unreadable, or SSH-unavailable scan.

The portable scope identity is a forward-slash project-relative path. Absolute checkout paths remain
machine-local runtime data and are not written to project metadata, exports, synchronization payloads,
logs, history, or generated records. The repository picker has its own plain-text search and anchored
full regex builder, with keyboard navigation and an honest no-match state.

Changed files: `src/core/git-repository-discovery.ts`, `src/core/git-service.ts`,
`src/shared/types.ts`, `src/shared/ipc.ts`, `src/shared/scm-scope.ts`, `src/preload/index.ts`,
`src/renderer/bridge/ws-bridge.ts`, `src/main/relay-rpc-policy.ts`, `src/main/remote/host-service.ts`,
`src/renderer/components/SourceControlPanel.tsx`, `scripts/check-app-contract.mjs`,
`docs/features/source-control/README.md`, `docs/features/source-control/source-control-and-worktrees.md`,
`docs/features/source-control/nested-repositories.md`, `CHANGELOG.md`, and `ROADMAP.md`.

This ultra-speed lane intentionally ran no tests, type checks, lint, security checks, builds,
packaging, installer execution, runtime interaction, or UI captures. The offline documentation
bundle still needs regeneration from the new article before a build can be considered current.
No commit or dew was made by this lane.

## 2026-08-26, portable canvas projection implementation

Implemented `src/core/portable-canvas-projection.ts`, re-exported through
`src/core/project-archive.ts`. The module projects safe root canvas content and future Multiverse
and AWS Universe scopes into deterministic schema 3 JSON, preserving display metadata, geometry,
node presentation, grouping, relationships, ordering, and bounded appearance values. It excludes
machine-local, credential, process, provider, browser-profile, path, endpoint, and other
authority-bearing state, and rejects those fields on imported payloads. Serialization emits stable
UTF-8 bytes and validation enforces bounded counts, depth, strings, references, and bytes without
hydrating or starting anything.

This lane deliberately did not run tests, type checking, linting, security checks, builds,
packaging, installer execution, UI interaction, or captures. Archive writing, atomic import,
media, catalog, Shop, portals, providers, and UI remain unimplemented risks for later lanes. No
commit or dew was made by this lane.

## 2026-08-26, projection validation tightening

The projection validator was tightened after review. Numeric bounds now apply to every finite
number, future canvas input is reconstructed from allowed fields rather than spread, and imported
objects use strict allowed-key sets at every schema level. Canvas hierarchy validation now enforces
one root, parent existence, child-parent requirements, no self-parent or cycle, and depth eight.
Node membership is unique and complete, node parents are validated, and relationship identifiers
are unique without case collisions. HTTP(S) URLs are normalized without embedded credentials or
control characters, while empty content remains valid and required labels remain non-empty. Tag
and browser-tab counts are bounded. No tests, type checks, lint, builds, packaging, UI interaction,
or captures were run, and no commit or dew was made by this lane.

## 2026-08-26, normalized projection boundary

Validation now reconstructs and returns an allowed normalized copy, including canonical HTTP(S)
URLs and omitted empty URLs. It explicitly validates every optional field and nested shape, icon
allowlists, numeric and collection bounds, canvas hierarchy and membership invariants, and converts
malformed input into `PortableProjectV3Error`. This lane keeps only strict global appearance fields;
per-element appearance is postponed until a typed schema exists. No tests, type checks, lint, builds,
packaging, UI interaction, or captures were run, and no commit or dew was made by this lane.

## 2026-08-26, portable schema 3 envelope implementation

Follow-up repair keeps `manifest.json` as required archive framing outside the hashed payload
inventory, removes vault material from optional entries, validates recorded raw and compressed
sizes, applies all count and byte limits during manifest creation, validates user omissions, and
uses fatal UTF-8 decoding. V1/V2 migration is now bounded and recursively strips nested credential,
token, password, path, account, session, SSH, machine-local, and exact identity keys such as `id`
while preserving unrelated keys that merely contain those letters. It rejects unsafe object keys
and values. Project colours, non-empty bounded names, omission counts, duplicate omission paths,
case collisions, and omission contradictions are validated as well. Parsed manifest metadata is
checked against per-entry and aggregate byte ceilings before payload handling.

Implemented `src/core/portable-project-v3.ts`, a platform-free schema 3 contract and validator,
and re-exported it from `src/core/project-archive.ts`. The module provides the
`nodeterm-portable-project` identifier, schema version 3, canonical required and optional entry
inventory, bounded manifest and omission types, safe relative path validation, duplicate and
case-collision refusal, SHA-256 payload metadata that excludes the required manifest framing,
raw and compressed byte ceilings, and bounded recursive V1/V2 migration filtering that excludes
machine-local and credential material. Vault material is not an optional entry. Added the feature
article and projects documentation index entry.

This lane deliberately did not run tests, type checking, linting, reviews, security checks, builds,
packaging, installer execution, UI interaction, or captures. The roadmap item remains unchecked
until archive production/import wiring and those verification activities land. No commit or dew was
made by this lane.

## 2026-08-26, portable Node Universes and hosting program plan

Plan-only lane status. The public implementation plan is recorded in
[`docs/plans/2026-08-26-portable-node-universes-and-hosting-program.md`](docs/plans/2026-08-26-portable-node-universes-and-hosting-program.md)
and indexed by [`docs/plans/README.md`](docs/plans/README.md).

The plan source baseline is `27ecfa62e5b3180070abaa241f8bac6b1e079861`, which was an ancestor of
`origin/main` when this lane started. It covers schema 3 portable project saves, portable
blueprints and local bindings, the unified Node Catalog, universe Shop nodes, Material Design 3
surfaces, media and file conversion, torrents, Linux ISO virtual machines, Home Assistant,
calendar, timer and alarm tools, Multiverse portals, a complete interactive AWS CLI GUI, Docker
host management, GitLab, Nextcloud, Open WebUI, Cloudflare managers and tunnels, clean-room
WinForge-inspired nodes, upstream parity, public issue records, and the new upstream pull request.

No product code was changed. No GitHub issue, discussion, project, pull request, release, tag,
branch, or worktree was mutated. Tests, type checking, linting, reviews, security checks, builds,
packaging, and captures were not run in this plan-only lane. The ultra-speed release boundary is
retained for future implementation work: it intentionally skips those checks and captures while
requiring exact artifact and release evidence.

## 2026-08-22 — vendored paste-frame duplicate + drift guard

`src/core/paste-injection.ts` is a deliberate vendored duplicate of `agent-whip/packages/paste-frame/src/index.ts` (sibling repo, not a dependency — material-nodeterm is public, that package is unpublished, a `file:` dependency would dangle for anyone cloning this repo alone). `scripts/check-paste-frame-parity.mjs`, wired into `npm run typecheck`, fails loudly if the two drift and skips cleanly when the sibling checkout is absent. Full writeup: `docs/paste-frame-vendoring.md`. This is a mitigation, not the fix — the fix is publishing the package once registry rights exist.

## 2026-08-20, second pass — a hunt that found real defects, and the fixes that landed

`main` moved `f5caf128 -> f0a0453e`. Suite fully green at the tip: **717 files, 8,852 tests,
0 failed**. Three read-only hunters swept the repository's own documented failure families;
everything below was verified by command before being believed, and fixed in four isolated
lanes, each proven red-then-green and re-proven here independently before merging.

### Shipped

- **Word separators** (`0b59782a`, upstream #349) — double-click now keeps identifiers, paths
  and package names whole. One setting reaches THREE writers (xterm, local tmux conf, remote
  tmux conf) because tmux owns the mouse and an xterm-only change is a no-op; the value is
  re-validated at the interpolation site since it lands in a config written onto SSH hosts.
  Bonus fix: SSH projects had ignored `tmuxScrollback` forever (hardcoded 50000) — the new
  settings seam in `SshProjectManager` closes that too.
- **Three dead ADHD modes wired** (`d697f78f`). Time awareness renders an elapsed chip in the
  node header and the kanban card modal (ONE module-level ticker, started by the first
  subscriber); Momentum floats its dismissible note over the terminal top (never resizing the
  body — a resize is a SIGWINCH); Low stimulation's notification half now actually filters,
  with needs-you provably never silenced and quieted items landing pre-dismissed in the centre
  rather than vanishing. Worth reading in that lane's history: its first gate break stayed
  GREEN because two independent gates covered the same render — the duplicate was removed so
  the gate has one owner.
- **Server Edition transcript search** (`82bc8b19`) — `transcript:search` moved from an inline
  main-only registration into `core/transcript-ipc.ts`, which both shells call; the browser
  palette's transcript results now exist. The textbook 'logic left in src/main silently does
  not exist on the server' case, in a file that otherwise did it right.
- **Server Edition transfer menu** (`15d6cb6e`) — was visible, enabled, and threw into a
  voided promise. Now follows the house `supported`-bit pattern (the PairingApi precedent):
  hidden where absent, caught with an honest toast as the second boundary, documented in
  SERVER.md.
- **Four bare Windows renames fixed and the guard taught to see them** (`63407c1a`).
  `windows-installer.mjs` published metadata with a bare rename on the `dist:win` path — the
  exact Defender-EPERM case `renameAtomic` exists for, in the Windows installer itself. A
  shared bounded-retry helper now lives at `scripts/lib/rename-atomic.mjs`; the fs-atomic
  guard scans `scripts/` and non-.ts files (it could not see any of this before); its lazy
  import-strip hole is closed with the arming input pinned as a fixture; both `no-electron`
  guards now catch dynamic `await import('electron')` and carry non-empty floors; and the
  theme test's `s`-collapsed-to-`s` regex is repaired.

### Corrected guard needles, each watched failing

`check-app-contract.mjs`'s session-memory needle was the two-letter string `ok` (satisfied by
'looking'); the AnchoredRegexBuilder row's needle was the bare keyword `export` and its
`wiredInAny` counted import lines and comments; the docs inventory sweep read `docs/`
non-recursively — 58 of 94 docs, none of `docs/features/`. All fixed and independently
re-broken here before being believed: collapsing the session-memory discriminator now goes
red on a line-anchored return-shape regex; planting a bare rename in `scripts/` goes red;
planting a dynamic electron import in core goes red.

### Still open from the hunt

- `check-site-contract.mjs:252`'s `voiceschanged` needle points at a file whose only match is
  a comment; the real subscription is `site/app/main.js:440`. Site guard — not fixed in this
  pass, which took only app-side lanes.
- `hook-identity-enforcement.test.ts:426`'s whole-file needles survive commenting out the one
  wiring line.
- The `KIDS_DISCLOSURE` needle is comment-satisfiable.
- `agent-status-mirror.ts:507` still rolls its own cross-dialect basename against the
  sanctioned `core/path-basename.ts` verdict.
- The ADHD surfaces owe a packaged capture (three states named in `docs/adhd-modes.md`), and a
  visual check at narrow widths / 200% scale.
- **The blur verdict, for whoever picks this up**: PHASE is fixed on `main`; the SCALE branch
  helps only zoomed IN (0% at zoom 1.0 and out). Correction to an earlier version of this line:
  the zoom-out case is NOT "needs supersampling" — at zoom < 1 the raster is already denser than
  the display needs (built at `dpr`, display needs `dpr × zoom < dpr`), so the loss is
  RESAMPLING (the compositor bilinearly shrinking an already-big-enough raster), not a resolution
  shortfall a denser raster would fix. What `RASTER_SCALE_MIN_FACTOR = 1` actually forbids is the
  raster getting COARSER to match the display exactly, i.e. letting the font rasterizer draw the
  smaller glyphs directly with real hinting/AA instead of the GPU downsampling. One of its two
  stated reasons for the floor is disproven (measured: the mip chain engages zero levels above a
  0.5 ratio); the other (a rebuild on every zoom OUT, not just in) stands, and the column-reflow
  proof (`cellWidthIsStable`) has only ever been derived for the zoom-IN direction — going
  coarser is unproven, not merely un-shipped. A device eyeball at 150% remains the gate for both.


## 2026-08-20 — six branches integrated, and the stale-failure list retracted

`main` moved `289fcb47 -> baf67860`. Six of the eight open branches are merged and **proven
ancestors of the dewed `main`** with `git merge-base --is-ancestor`, not assumed:
`feat/suites-a`, `feat/suites-b`, `feat/openrows`, `feat/uh-feature-inventory`,
`fix/pairing-no-qr-dead-end`, `feat/project-single-file`. All six merged with zero conflicts.

### Retraction: the seven failing test files are all green, and were before this pass started

The section below headed "The seven failing test files, with cause" is **stale**, and it is worth
saying plainly because the next reader would otherwise spend an afternoon re-diagnosing fixed bugs.
Every one of those seven files passes at `main`, measured by running them rather than by reading:

| File the addendum listed as failing | Measured now |
|---|---|
| `src/renderer/styles.theme.test.ts` | passes |
| `src/core/fs-atomic.guard.test.ts` | passes |
| `src/renderer/state/permissionMode.funnel.test.ts` | passes |
| `src/renderer/nodes/ServiceNode.test.tsx` | passes |
| `src/renderer/terminal/webgl-addon-pair.test.ts` | passes |
| `src/core/build-bat.test.ts` | passes |
| `src/main/remote/relay-host-service.test.ts` | passes |

147 tests across those seven files, 0 failures. The 51 commits that landed between `38280b0b`
and `289fcb47` fixed them; the document was simply never updated. The named `.mc-console`,
`--mono`, bare-`fs.rename` and Kids-mode funnel defects are all closed.

### Verified at the integration tip

| Check | Command | Result |
|---|---|---|
| Full suite | `npx vitest run` (alone, uncontended) | **706 files: 700 passed, 6 skipped. 8,912 tests: 8,720 passed, 192 skipped, 0 failed.** 121.24 s, exit 0. Measured at `2cb5882d`, the merge tip. |
| Type checking | `npm run typecheck` | Clean on both projects, exit 0. |
| Production build | `npm run build` | exit 0. |
| Feature inventory | `node scripts/check-uh-inventory.mjs` | 37 shipped, 2 not-applicable, 5 open; all 44 required features present, every shipped path exists. |
| App contract | `node scripts/check-app-contract.mjs` | 835 assertions across 49 features, **1 failure** — the pre-existing Windows terminal-profile row still owing packaged headless capture evidence. |
| Site contract | `node scripts/check-site-contract.mjs` | 366 assertions, all clear. |
| Instruction mirror | `node scripts/check-instruction-mirror.mjs` | OK, 8 markers in each of README.md and AGENTS.md, no leak pattern matched. |
| Vocabulary lock | `node scripts/check-vocabulary.mjs` | Passed (re-locked at the start of this pass — the dictionary had changed and the build correctly refused until it was re-read). |

### Three defects the integration itself surfaced, all fixed here

1. **A shipped article that never entered the docs bundle.** `feat/uh-feature-inventory` added
   `docs/uh-feature-inventory.md` and never regenerated `src/shared/docs-data.ts`, so the in-app
   documentation browser had 89 articles and no route to the 90th. The docs-bundle guard failed
   the first build after integration — exactly the job it exists for. Regenerated to 90 articles.
2. **A fail-closed guard with nothing to run it.** `scripts/check-uh-inventory.mjs` arrived on the
   same branch as the guard over all 44 canonical features, and nothing called it: no npm script,
   no build step, no workflow. Its only two references in the whole tree were its own header
   comment and the document describing it. It is now wired into `build` beside the vocabulary,
   changelog and docs-bundle checks, and `check:uh-inventory` / `check:site-contract` exist as
   runnable scripts. Both passed at the time of wiring, so this costs nothing today and catches
   the next drift.
3. **The new inventory document had no contract row.** The app contract's completeness sweep asked
   where its feature row was; the honest answer is that it is the register OF the contracts rather
   than a forty-fifth one, so it is now exempted in `NON_FEATURE_DOCS` **with that reason stated**.

### Three delegated lanes, landed

Run as isolated workers in their own Gerk Tong Huis, each reviewed and independently re-verified
here rather than accepted on its own report.

**Converter defects** (`913bffe9`). `README.md` was detected as `xml` because the file opens with
an embedded HTML block and the generic leading-tag heuristic ran *before* the Markdown extension
check. Fixed in the producer, with no filename special case: an explicit `<?xml` declaration stays
authoritative, a known Markdown extension now outranks a merely generic tag, and the broad
XML/HTML heuristic moved below both. Separately, `ConverterService.detect()` called `stat()` and
never asked `isFile()`, so a directory opened to an empty sample and came back as
`detectedKind: text, sizeBytes: 0`; every non-regular entry is now refused before it is opened.
Proven red-then-green by reverting the two producers with the tests in place: 2 failed, then 2
passed on restore.

**Release documentation** (`d4fbc627`). `docs/ci-and-releases.md` claimed the workflow was
manual-dispatch-only with automatic publication disabled; `release.yml` actually declares both
`push: branches: [main]` and `workflow_dispatch`, and its own header says every push to `main`
releases. Corrected, with the 2026-08-15 tag-loop incident and its counts preserved as history
and the restoration recorded rather than the lesson deleted.

  The same lane **refused** the other half of its brief, correctly. This document had claimed
  `CLAUDE.md` still described `TabBar.tsx` as the drag region; `CLAUDE.md:2104` already says that
  file is deleted and that its job moved to `ProjectSwitcher`/`TopAppBar`. That claim was stale
  too, and is retracted here rather than acted on.

**Explorer drag and drop** (`d1b7da3a`) — a new feature, not a repair. Dropping an agent node on
an Explorer folder row opens a NEW agent of the same kind rooted there, leaving the dragged
session untouched; dragging a folder the other way onto empty canvas opens a terminal at the drop
point. A terminal's cwd is fixed at spawn, so spawning a sibling is the only honest way to open
in a folder without killing a session mid-turn, and the reverse direction is deliberately a
terminal because a folder drag carries no agent identity. Each direction uses its own namespaced
MIME type so neither collides with an OS file drop or the sessions-sidebar reorder drag. The agent
path goes through the branded launch-plan funnel under a new `explorer-drop-agent` row in
`AGENT_LAUNCH_SURFACES`, so `permissionMode.funnel.test.ts` now exercises it. SSH projects stamp
the remote cwd. Keyboard and context-menu equivalents ship with it.

### One guard corrected, and watched failing first

The new drop indicator is the first rule in `styles.css` to reference `var(--font-ui)`, and
`styles.theme.test.ts` went red. The guard was right by its own logic and wrong about the world:
that token is defined in `fonts.css`, which `boot.tsx` imports immediately *before* `styles.css`,
and `styles.md3.css` already uses it about seventy-five times. Its corpus was a single file.
`fonts.css`'s **definitions** are now merged in and nothing else — it carries no colours and no
theme blocks, so adding it to the literal-colour or theme-block corpora would have cost teeth for
nothing, and it does not define `--mono`, so the historical `.mc-console` defect stays catchable.
Verified by appending a genuinely undefined token: red, naming it; green again on removal.

### Suite state, stated honestly

Two full runs at effectively the same tree each reported **one** failure, and **a different one
each time** — `styles.theme.test.ts` in the first, `src/core/ollama/catalog-store.test.ts` in the
second. The Ollama file passes in isolation twice. Two different single failures across two runs
is nondeterminism under load rather than a deterministic regression, which is exactly the
contention shape this document already records elsewhere. Final measured figures: **709 files,
702 passed, 6 skipped; 8,925 tests, 8,732 passed, 192 skipped**, with the one contended failure
above. Typecheck clean, build exit 0.

### The status surface, and the capture it owed

`feat/status-hub-surface` was held out of `main` for one reason: no packaged capture of its own
screen. It has one now — `docs/assets/shots/app-status-surface.png`, taken from the real built
artifact driven over CDP **on an off-screen Win32 desktop**, so nothing appeared on anyone's
display while it ran. The manifest binds it to the exact commit rather than to "recently".
19 surfaces captured, 3 skipped for stated reasons, 0 failed.

**Three conflicts, and the third is the one worth reading.** `closeAllDrawers` existed twice —
`main` had grown a `useCallback` while the branch added an inline copy that shadowed it for every
call site below; collapsed to one definition now closing all eight drawers. `anyDrawerOpen` had to
become the union of both lists rather than either one. And the stylesheet conflict was git
mis-aligning two disjoint blocks (`.md3-docs*` against `.md3-status*`); resolving it by
concatenation broke brace balance because one hunk cut a rule in half, so it was redone by taking
`main`'s file whole and appending the branch's self-balanced 340-line block.

**Then the one that matters: the merge dropped `<StatusSurface />` entirely.** The import survived,
the rail destination survived, the `useState` survived, and **`tsc` passed** — a whole screen
reachable by a button that rendered nothing. It was found by grepping for the render site rather
than by trusting the green typecheck, and recovered from the branch rather than reinvented. This
is the identical shape this document already records under “the convergence dropped working
code”, and the identical warning that a clean typecheck is not evidence. It happened again, in
the same repository, to an agent that had just finished reading the warning.

The capture row is therefore **required**, not optional, and verifies `.md3-status-screen` — a
selector that exists only inside the component. The host div would not do: `Canvas` renders that
even when the component draws nothing, which is exactly the broken state that has to stay
catchable.

### Suite, re-measured clean

After the status surface merged, a full run came back **entirely green**: **711 files, 705 passed,
6 skipped; 8,959 tests, 8,767 passed, 192 skipped, 0 failed**, exit 0. That settles the two
single-failure runs recorded above as contention rather than regression — they are left in the
record anyway, because the honest version of “it passes now” includes the runs where it did not.

### The Windows packaged-capture row is blocked on a MISSING PROMOTION PATH, not on the capture

This was investigated properly rather than guessed at, and the answer is more useful than
“still pending”. Everything upstream of the last step is ready, verified by running commands:
the tree is clean, `HEAD` is byte-identical to the hui's `main` tip, the immutable icon is
publicly fetchable at that SHA (HTTP 200, 15633 bytes matching the committed blob), the
Spectre-mitigated MSVC libraries are installed, no process from this checkout holds a native
addon, and the cheap headless executable is exactly where the orchestrator demands it. A
purpose-built harness for precisely these four capture ids
(`windows-terminal-profile-picker` / `-terminal` / `-unavailable` / `-reattached`) has been
sitting unrun since `a4e3b13d`.

**The blocker is that the harness writes its evidence where the contract does not read.**
`run-windows-profile-packaged-acceptance.mjs` emits its manifest to the TASK ROOT, and it is the
only place in the tree carrying the required `cheap Lowlevel MCP headless` needle. The contract
reads `docs/assets/shots/capture-manifest.json` — a file `capture-shots.mjs` **regenerates
wholesale** on every run with a hard-coded `method: 'Electron + CDP ... out/ artifact'` and
`app-*` ids only. So a hand-merge is both unearned and self-erasing: the next `npm run shots`
deletes it. The generic promotion tooling the `promote-ui-evidence` skill assumes
(`scripts/stage-evidence.mjs`, `scripts/verify-evidence-receipt.mjs`) **does not exist in this
repository**.

That missing promotion path is the actual defect, and it is the thing to build. Either teach
`capture-shots.mjs` to MERGE a packaged-acceptance block rather than overwrite, or add a
promotion script that copies the PNGs in, verifies each against the SHA-256 the driver recorded,
and writes a manifest whose `method` names the cheap route. Whichever way, **`npm run shots` must
stop being able to erase it** — without that, the row can be made green once and will go red
again for reasons nobody will connect to the capture run.

Two further traps worth carrying, both found by reading the code rather than by running it:

- **Existing `dist/` artifacts can never be reused.** `createBuildProvenance` fails any artifact
  whose mtime predates the frozen source snapshot, so `npm run dist:win` must run AFTER the
  snapshot step, not before. `REQUIRED_ARTIFACT_ROLES` also demands the full Squirrel set exist
  and be hashed even though the run only ever launches `win-unpacked/nodeterm.exe`.
- **Flipping the status is a three-file change, not a one-liner.** The same feature row requires
  a docs needle matching `does not claim that the pending capture`, which is a real sentence in
  `windows-shell-profiles.md`. Marking captures verified while that sentence stands would be
  self-contradictory, so the article, the needle and the status must move together — and the
  acceptance manifest self-declares `acceptanceComplete: false` with `installer: blocked`, so
  closing the capture row must not be described as installed-artifact proof.

### An adversarial audit of this session's own merges found nothing

Two independent auditors were pointed at `289fcb47..HEAD` and told to assume it was broken —
one hunting code wired at one end and consumed at neither, the other hunting the merge-semantic
shapes this document already records (dropped symbols, silently merged same-named interfaces, a
guard whose scaffolding survived while its body did not). They raised **eleven** candidates.
Each faced two independent judges, one trying to refute it and one asking whether it would
matter even if real, with a finding surviving only if both agreed. **Zero survived.**

That is recorded as a result rather than skipped as a non-event. The `<StatusSurface />` drop
earlier the same day proved this repository can ship a clean typecheck over a missing screen, so
“we looked hard and found nothing” is worth exactly as much as a finding would have been — and
it is now the difference between an integration nobody re-checked and one that survived being
attacked.

### Still open

- **`fix/blur-scale-wiring`** (`f003a05d`) — the ONLY branch still out, and it is blocked on a
  person rather than on work. `CLAUDE.md` forbids shipping it without a device eyeball at zoom 1
  and at a fractional zoom, on each renderer, and no agent can supply that. It already contains
  all of `main`.
- **`feat/status-hub-surface` is now merged** (`05df0a4f`) — see below.
- The Windows terminal-profile contract row still owes packaged, cheap-headless capture evidence.
  `npm run shots` photographs the picker from the unpackaged `out/` build over plain CDP, which is
  deliberately filed under different ids and cannot half-satisfy the packaged row.
- **The addendum's "nobody has launched the built app and looked at it" is also retracted.**
  `docs/md3-render-verification.md` records exactly that work, done at `38280b0b` by launching the
  real built `out/` artifact in a real Electron process and driving it over CDP: `check:wired`
  reached 6/6, `npm run shots -- --launch` ran, and it found and fixed a real light-mode scrim
  defect. What that document itself still lists as unverified is the narrower set: OS-level window
  frame capture against a live HWND (CDP only sees an emulated viewport), the two surfaces needing
  a live agent CLI or a reachable SSH host, Roboto Mono's glyphs with a terminal actually open,
  and a light-theme sweep of every remaining dialog beyond the six selectors named. Neither
  `check:wired` nor `shots` was re-run in THIS pass, so those results bind to `38280b0b`, not to
  `main`.

---


## Release timing, dim-sum link, and Pages trigger repair

The release workflow now requires GitHub's run start time, records a post-publication completion
boundary, regenerates the same release body with exact start/completion/duration fields, and reads
the published body back for byte-equivalent text verification. Already-published retries validate
those fields and mutate nothing. Dim-sum prose links the catalog's published photo and explicitly
says it is not a consumer-release attachment. Pages now runs on every `main` push and manual
dispatch. Local build evidence does not prove the remote publication/deployment transaction; use
the exact workflow and Pages run links recorded for the final commit.

## Project-aware shell detection persistence repair

`ShellSection.refreshDetection` no longer writes `useSettings.getState().base` directly before
refreshing Windows terminal profiles. It passes the bounded effective active-project custom
executable to a read-only detector path instead, so sparse `defaultShell` and
`defaultTerminalProfileId` overrides remain project-owned and global `settings.json` is untouched.
`TerminalPreview` now reads effective Settings as well. The production Settings-source sweep found
no second direct `settings.save(base)` bypass. Build/package evidence belongs to the commit reported
for this section; no tests, lint, type checking, runtime interaction, installer execution, or
screenshots were performed in the ultra-speed lane.

The same lane repaired the pre-push identity checker to forward every revision argument supplied
by the hook. New-branch ranges now retain `--not --remotes`, so already-published placeholder
history is excluded without bypassing the hook or rewriting history; newly introduced reserved
addresses remain refused.

## 2026-08-19 runtime, project history, deployment and device-access pass

Three milestones were implemented and pushed to `main` during this session:

- `66163ba0` — automatic verified Temurin Java provisioning for managed Minecraft servers;
  mouse-wheel canvas zoom and empty-background drag panning defaults; per-project app-data Git
  history on successful saves; one-file `.nodeterm-project` export/import containing a Git bundle;
  and personal-vocabulary coverage for the worktree dialog while preserving paths, refs, typed
  values and raw Git errors.
- `d475bdee` — the top-right device shortcut now invokes the Server Edition deployment path,
  automatically obtains/starts Docker Desktop where possible, runs the validated host wrapper,
  builds the local image when absent, waits for health and offers the local site.
- `fd752f51` — rotating deployment TOTP login with persisted replay prevention; no payment checkout
  at the core IPC boundary; paid License/seat and upgrade surfaces removed; Remote Access presented
  as free; and phone-sized Server Edition layouts forced to the sessions/board experience with the
  Canvas destination omitted.

While the third milestone was being pushed, `origin/main` advanced through `976bc0a6`, including
project-wide settings and a bounded Docker-host runtime. A normal merge was started and the three
overlapping renderer conflicts were resolved in favor of the newer Docker-host/settings
implementation. Before finalizing the merge, rerun `npm run typecheck` and the focused suites below;
the pre-merge third-milestone verdict was green, but a verdict never transfers across a merge.

Focused evidence before that reconciliation:

- `npm run typecheck` — passed.
- Project/Java/canvas/settings/history/vocabulary suites — 150 tests passed.
- Deployment production build (`npm run build`) — passed at `d475bdee`.
- Server TOTP/auth/HTTP/license/mobile-view suites — 58 tests passed at `fd752f51`.

Important remaining boundaries:

- The deployed site is still advertised at loopback HTTP. Do not expose the application port on
  `0.0.0.0`; mobile reach needs the existing TLS/private-network route completed and verified.
- The TOTP secret is stored in `.nodeterm-server-totp`, excluded from Git, ACL-restricted by the
  deployment service and mounted read-only into the container. Verify the ACL and real container
  login in a fresh deployment before calling mobile pairing complete.
- `src/renderer/styles.css` contains an unrelated unstaged user/other-session change (monospace
  token alias and terminal background token). It was deliberately excluded from this session's
  commits and must be preserved.
- No real built-app UI capture or real Docker container interaction was completed for the third
  milestone after the concurrent merge.

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
- ~~Material 3 elevation roles and migration of existing components remain unstarted.~~ **Stale
  as of 2026-08-19 — this line was wrong the moment it was written into this section and nobody
  caught it for three days.** The migration happened in full: the tab strip and dock were torn out
  and replaced with an M3 nav shell, both stylesheets were re-seeded to the M3 baseline, and the
  app now declares 46 M3 roles in both themes. See "Handoff addendum — the Material Design 3
  rewrite this file never recorded" at the end of this document for what shipped, what was
  verified, and what is still open.
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
---

## Handoff addendum — the Material Design 3 rewrite this file never recorded (2026-08-19)

### Why this section exists

`HANDOFF.md` is the handoff of record for this repository, and until this section was added it
contained **zero** occurrences of "Material Design 3", "MD3", "NavRail", "TopAppBar",
"styles.md3", or "TabBar.tsx" — confirmed with a plain `grep`, not assumed. The largest change to
this app's UI in its history — every stock chrome surface torn out and replaced — happened
entirely underneath a document that kept describing an app whose tab strip and dock still existed.
A handoff that is confidently wrong about the biggest recent change is worse than no handoff at
all, because the next reader trusts it. Every claim below was checked against the tree at commit
`38280b0b7d3d7a22641464984225c07c4df833f8` (this worktree's `HEAD`, and `origin/main`'s tip at
write time) before being written down; none of it is restated from the brief that asked for this
correction.

### What actually shipped

The rewrite spans roughly twenty commits landing 2026-08-18 (`git log --oneline -- design/v2/`
and `-- src/renderer/styles.md3.css` both bottom out that day), starting from
`84ef6d14 feat(design): apply the M3 roles to the low-risk surfaces` and running through
`41a593eb feat(tools): Ollama, converter, authenticator and toy locks get the M3 seed`. It is
fully merged into `main` — not stranded on a branch — via `main`'s own first-parent chain
(`db0c00ed Merge branch 'feat/minecraft-server-manage'` and `7c922e70 fix(md3): rebuild the M3
sheet from its lanes, and let the bar be 64` both sit on that chain, ahead of the
Docker-hosted-deployment commits `d475bdee`/`fd752f51` at the very tip).

**The tab strip and bottom dock are gone.** `src/renderer/components/TabBar.tsx` and `Dock.tsx`
were deleted outright in `b4061448 feat(shell): wire the app to the nav shell; retire the tab
strip and dock`. In their place: `TopAppBar.tsx` (51 lines — a flat 64px surface-container bar
that is also the window drag region), `ProjectSwitcher.tsx` (799 lines — a menu button replacing
the project tab strip: one dropdown lists every project, drag-reorders them, and expands a
per-project actions panel carrying everything the old tab caret menu did, including the
session-duration toy-lock relock effect, which moved here so it could never go missing), `NavRail`
(81 lines — an 88px rail that is a real flex sibling of the canvas, not a floating overlay, with
Canvas/Board/Files/Tools/Alerts/Settings destinations and Kids pinned to the bottom), and
`FabMenu.tsx` (350 lines — the "add a node" dropdown, the old dock menu moved here verbatim). The
floating `.controls-cluster` is gone entirely too: search, the presence facepile, notifications,
phone pairing and help moved into the app bar; Explorer/Source Control/the file converter/the
Ollama manager are now reached through the rail's Files/Tools destinations. **`CLAUDE.md` itself
was not fully updated for this** — as of this writing it still says, in its own "Window chrome"
section, that "the tab bar (`TabBar.tsx`) is the drag region" (`CLAUDE.md:2060`), a file that no
longer exists. That correction belongs to whoever next touches that file; it is out of scope for
this pass, which only writes `HANDOFF.md`.

**The app bar is 64px, the rail is 88px.** `--app-bar-h: 64px` and `--nav-rail-w: 88px` are
declared at `src/renderer/styles.css:100-101`; every floating panel/overlay that positions itself
below the bar does so via `calc(var(--app-bar-h) + …)`. `src/shared/layout.ts` exports
`APP_BAR_HEIGHT = 64` as main's independent copy of the same number (the file's own doc comment
says outright that the two have no shared build-time link and must be changed together), consumed
by `src/main/index.ts:569` for the Windows `titleBarOverlay` height so the native caption-button
overlay lines up with the app bar instead of floating over the canvas below it.

**There are now two stylesheets.** `src/renderer/styles.css` (14,569 lines — the pre-existing
token layer plus legacy rules) and `src/renderer/styles.md3.css` (8,414 lines — the new chrome),
the second imported immediately after the first in `src/renderer/boot.tsx` (`import
'./styles.css'` then `import './styles.md3.css'`) so it wins on source order wherever the two
declare the same selector.

**Three font families ship as committed, subsetted `.woff2` under
`src/renderer/assets/fonts/`** — `material-symbols/material-symbols-rounded-subset.woff2` (one
file), `outfit/` (two variable-weight files, latin and latin-ext), `roboto-mono/` (four files:
400/700 × normal/italic) — seven files total, all tracked in Git (`git ls-files` confirms none are
gitignored). `scripts/build-fonts.mjs` regenerates them and also emits
`src/renderer/components/materialSymbols.generated.ts`, a generated name union consumed by
`MaterialSymbol.tsx`. Material Symbols is subset **by codepoint, not by ligature name**: the
component renders the glyph's raw private-use-area character directly, never the ligature text,
because the subset was built with GSUB/ligature substitutions stripped — confirmed by reading both
`build-fonts.mjs`'s own comments and `MaterialSymbol.tsx`'s doc comment, which say this in nearly
identical words.

**The token layer was re-seeded to the M3 baseline, and the default accent changed.**
`DEFAULT_ACCENT = '#6750a4'` (`src/shared/types.ts:1655`) replaced the prior default of systemBlue
`#0a84ff`. This is a real, user-visible appearance change for every existing install, and
`src/core/settings-store.ts` carries an explicit one-time migration for it (its own comment and
guard, lines 53-63): because the app always persists the full settings object including untouched
defaults,
every existing `settings.json` has `#0a84ff` written in byte-for-byte — indistinguishable from a
user who deliberately chose systemBlue — so the migration treats the old literal default as "never
touched" and carries it forward to the new default once. A user who genuinely wanted systemBlue
loses that choice on first launch after upgrade and has to re-pick it from the swatch row. The
same migration also flips two canvas interaction defaults (`wheelZoom`/`canvasDragMode`) forward
for anyone still on the old literal defaults.

**New surfaces that did not exist before this window, confirmed present:** a changelog viewer
(`src/renderer/components/changelog/ChangelogPanel.tsx`), Kids Mode as a set of dedicated screens
distinct from the pre-existing School mode (`src/renderer/components/kids/`:
`EnableKidsModeDialog.tsx`, `KidsActivityCanvas.tsx`, `KidsGate.tsx`, `KidsHome.tsx`,
`KidsParent.tsx`, `KidsShell.tsx`, `KidsStickers.tsx`, plus its own settings section and state
store), and a Minecraft server create/manage panel
(`src/renderer/components/minecraft/MinecraftServerPanel.tsx`) wired to
`src/core/minecraft/{java.ts,register-ipc.ts,server-manager.ts,version-resolve.ts}`. All four are
present in `check-app-contract.mjs`'s feature inventory with passing existence/content checks (see
Verification below).

**The design bundle lives at `design/v2/`.** Ten `.dc.html` handoff artifacts (Board, Canvas,
Files, History, Kids Mode, Overlays, Regex Builder, Settings, Tools, Welcome), a `support.js`, a
`HANDOFF-README.md`, and `design/v2/md3/tokens.css` (102 lines, 3,665 bytes) — the token contract
the rewrite drew from.

### Verification actually performed at `38280b0b` (this HEAD)

Every number below was observed by running the command, not assumed from a prior session's
report.

| Check | Command | Result |
|---|---|---|
| Type checking | `npm run typecheck` | **Clean.** Zero errors on both `tsconfig.node.json` and `tsconfig.web.json`. |
| Vocabulary lock | `node scripts/check-vocabulary.mjs` | Passed. |
| App contract | `node scripts/check-app-contract.mjs` | 725 assertions across 47 features. **3 failures**, all under "First-class Windows terminal profiles" (a suite-boundary string match, a pending built-artifact-interaction assertion, and a pending real-capture-evidence assertion) — none related to the M3 rewrite. The same run's "M3 foundation" checks passed: no CDN font/icon link across 748 scanned renderer files, all 46 M3 roles declared in the dark `:root` block, all 46 roles defined for both themes, and the app's `data-theme` attribute (not a stray `data-md-theme`) is what's actually used. |
| Site contract | `node scripts/check-site-contract.mjs` | 340 assertions, all clear. |
| Full test suite | `npx vitest run` (default parallel workers) | **691 test files: 677 passed, 7 failed, 7 skipped. 8,730 tests: 8,477 passed, 55 failed, 198 skipped.** Wall time 213.19 s. Full breakdown below. |
| Production build | `npm run build` (vocabulary + changelog checks, `electron-vite build`, `host:build`) | **Succeeded, exit 0.** Produces `out/main`, `out/preload`, `out/renderer` (including the ~7.6 MB `monaco-setup` chunk and the ~2.8 MB `boot` chunk) and `out/session-host/host.cjs`. |

**The redesign has never been visually verified. Nobody has launched the built app and looked at
it.** This pass ran `npm run build` and confirmed it exits 0 and produces the expected output
files; it did not run `npm run check:wired`, did not launch the packaged app on a headless
desktop, and took no screenshots of the new app bar, nav rail, project switcher, or FAB menu. A
clean typecheck and a clean production build are evidence the code compiles and bundles — they are
**not** evidence that the 64px bar actually renders at 64px, that the rail's destinations actually
open the right panels, that the re-seeded accent doesn't clash with something, or that the two
stylesheets' cascade order produces the intended result on screen. That gap is exactly the kind of
thing this document exists to be honest about rather than paper over.

### The seven failing test files, with cause

None of the 55 failing tests are new MD3 *layout* regressions beyond the one CSS defect below;
most belong to other work that landed at the same tip. Recorded here because they were found
while doing the verification this section reports, and leaving them undiagnosed would just mean
the next reader re-does this work.

1. **`src/renderer/styles.theme.test.ts` (2 failures) — real, and MD3-adjacent.** The Minecraft
   panel's `.mc-console` rule (`src/renderer/styles.css:14543-14554`) hardcodes
   `background: #000000` instead of a theme token, and both `.mc-console` and `.mc-path`
   (`styles.css:14453`, `14552`) reference an undefined `--mono` custom property — only
   `--mono-font` is actually defined anywhere in either stylesheet. This is very likely the exact
   drift this document's own earlier section already flagged in passing ("`src/renderer/styles.css`
   contains an unrelated unstaged user/other-session change (monospace token alias and terminal
   background token)... deliberately excluded from this session's commits") that never got
   finished. Not fixed here — out of scope for a document-only pass — but the cause is confirmed,
   not guessed.
2. **`src/core/build-bat.test.ts` (~19 failures)** — Windows batch installer-build tests
   (Authenticode probing, `cmd.exe` orchestration). Not MD3-related on its face; needs an isolated
   re-run per this repo's own documented contention guidance before attributing it to a real
   regression versus environment noise, which this pass did not have time to do.
3. **`src/core/fs-atomic.guard.test.ts` (1 failure) — real, and worth flagging loudly given how
   much this repo's own documentation (see "Atomic writes" above) cares about this exact
   invariant.** `core/local-history.ts` and `core/minecraft/java.ts` both publish through a bare
   `fs.rename`/`rename(` instead of the required `renameAtomic` helper. `core/minecraft/java.ts` is
   new code from this cycle (the automatic Java provisioning for managed Minecraft servers) and
   never got the atomic-write treatment this repo dedicates an entire section of `CLAUDE.md` to.
4. **`src/main/remote/relay-host-service.test.ts` (~28 failures) — not MD3-related.** These come
   from the Docker-hosted-remote-access work merged at the very tip (`fd752f51`/`d475bdee`); tests
   throw `Choose a local project before starting Docker host.` / `The selected project has no local
   Docker workspace.` — the test harness was not updated after `addSeat` grew a new required
   Docker-project precondition.
5. **`src/renderer/nodes/ServiceNode.test.tsx` (3 failures) — a test-harness gap from the new
   Minecraft surface.** The new `minecraft` kind renders `MinecraftServerPanel`, which calls
   `useSession()`; the shared `ServiceNode.test.tsx` harness (`render(...)` → `Harness`) never
   wraps in a `SessionProvider` for any kind, so the three Minecraft-specific cases throw `[session]
   useSession() outside a SessionProvider`.
6. **`src/renderer/terminal/webgl-addon-pair.test.ts` (1 failure) — an install artifact in this
   environment, not a source defect.** `node_modules/@xterm/addon-webgl/lib/` does not exist at all
   in this checkout (confirmed with `ls`), so the test's `fs.readFileSync` on
   `lib/addon-webgl.js` fails with `ENOENT` before it ever gets to compare version guards.
7. **`src/renderer/state/permissionMode.funnel.test.ts` (1 failure) — real, and in the new Kids
   Mode surface.** `components/kids/KidsParent.tsx` reads `settings.claudePermissionMode` directly
   instead of through `activePermissionMode()`, which is exactly the funnel-bypass class of bug
   this test exists to catch (it names the Kids-mode gate specifically).

### Corrections to other claims already in this file

Checked because the brief asked whether the file's existing draft-release text was still accurate
— it was not, and neither were two adjacent claims found along the way.

- **The two stranded drafts this file described (`v0.4.4`, `v0.4.5`) no longer exist.**
  `gh release view v0.4.4` / `v0.4.5` both return "release not found." Whether they were deleted by
  the repository owner or superseded some other way is not recorded anywhere this pass could find;
  either way, the "two drafts sitting there" state this document described is gone. In its place,
  as of this write, there is exactly **one** draft release across the entire repository (checked
  via `gh api repos/.../releases --paginate`, 100+ releases scanned): `v0.4.41`, whose
  `targetCommitish` is `38280b0b` — **this exact commit**. The pattern this document already
  documents (a failed run strands a version number nobody can reuse) is continuing under new
  numbers; it was not a one-time event that got cleaned up.
- **"`.github/workflows/release.yml` is a manual-only `workflow_dispatch` pipeline" and "Automatic
  publication is disabled because the workflow has no push trigger" are both false as of this
  commit.** Read directly from the file (`.github/workflows/release.yml:31-34`):
  ```yaml
  on:
    push:
      branches: [main]
    workflow_dispatch:
  ```
  The workflow's own header comment says plainly: "EVERY PUSH TO MAIN RELEASES. There is no manual
  bump step." `gh workflow list` confirms the Release workflow's status as `active`, and `gh run
  list --workflow=Release` shows it firing on essentially every push to `main` throughout
  2026-08-18/19, publishing a new version each time (`v0.4.27` through `v0.4.40` published, in
  order, over the course of the day this rewrite landed). `docs/ci-and-releases.md` describes the
  same old push-triggers-an-infinite-tag-loop incident and the resulting "no push trigger, ever"
  fix — that document is now **also** stale in the same direction as this one was; it is not
  touched by this pass (out of scope), but a future pass should reconcile it with the workflow file
  it is supposed to describe.
- **"The repository is public but has issues disabled... `gh issue list` fails for that reason" is
  false as of this commit.** `gh api repos/.../material-nodeterm --jq .has_issues` returns `true`,
  and `gh issue list --state open` returns two open issues (`#2` "Session handoff: test-suite
  reliability, two server leaks, integration research", `#3` "Add global defaults, full project
  settings, and Docker-hosted remote access") — neither is about the MD3 rewrite; `#2` is an
  earlier handoff largely covering ground this file's own later sections already describe (the
  temp-directory leaks, the contention-timeout run), and `#3`'s timing lines up with the
  Docker-hosted-deployment commits at this file's very first section. This pass did not post
  anything to either issue or open a new one; posting a handoff copy to GitHub Issues, now that
  they're enabled, is a reasonable next step for whoever picks this up, but it was not part of what
  was asked here.

### Published baseline, re-verified

- **Latest non-draft release: `v0.4.40`**, published `2026-08-19T04:03:10Z`, targeting commit
  `d475bdee6e60612722f62981c9a67c4f11f4e7e1`. Verified via `gh release view v0.4.40 --json
tagName,targetCommitish,publishedAt,isDraft,isPrerelease,assets`: `isDraft: false`,
  `isPrerelease: false`, three assets uploaded
  (`node-terminal-0.4.40-full.nupkg` 218,055,235 bytes, `nodeterm-Setup-0.4.40.exe`
  218,183,168 bytes, `RELEASES` 85 bytes).
- **Ancestry confirmed, not assumed**: `git merge-base --is-ancestor d475bdee HEAD` succeeds (the
  published target is an ancestor of this worktree's `HEAD`), and `git merge-base --is-ancestor
b4061448 d475bdee` also succeeds — the commit that deleted `TabBar.tsx`/`Dock.tsx` and wired in
  the nav shell is itself an ancestor of what `v0.4.40` shipped. **The published `v0.4.40` build
  does carry the Material Design 3 rewrite.** It does not carry the two Docker-hosted-deployment
  commits at this file's tip (`fd752f51`, `d475bdee`'s sibling `38280b0b` merge) — those are one
  and two commits ahead of what's published, respectively, and are what the draft `v0.4.41` (see
  above) is attempting and has not yet succeeded at publishing cleanly.
- Package version in the tree remains `"0.4.3"` (`package.json`), consistent with this release
  pipeline's documented design: the computed release version is applied to the working tree at
  build time and deliberately never committed back to `main`, so the Git tag (`v0.4.40`) is the
  source of truth for what shipped, not `package.json`.

### Open boundaries found or reconfirmed during this pass

- No built-artifact interaction proof (`check:wired`) or real screenshot capture exists for the
  Material Design 3 rewrite. This is the single biggest gap this addendum exists to name plainly.
- No dedicated documentation file exists for the M3 rewrite under a categorized `docs/` subfolder,
  unlike Kids Mode (`docs/kids-mode.md`) and the Minecraft server manager
  (`docs/minecraft-server-manager.md`), both of which ship one and both of which are checked for by
  `check-app-contract.mjs`. The "M3 foundation" contract check is narrower (four structural CSS
  assertions) and does not require or check for a feature write-up.
- `.mc-console`'s hardcoded black background and the dangling `--mono` token reference
  (`src/renderer/styles.theme.test.ts`, both failing) are unfixed.
- `core/local-history.ts` and `core/minecraft/java.ts` publish via bare renames instead of
  `renameAtomic` (`src/core/fs-atomic.guard.test.ts`, failing) — a real Windows data-loss risk per
  this repository's own extensively documented reasoning for why that helper exists.
- `components/kids/KidsParent.tsx` bypasses the permission-mode funnel
  (`src/renderer/state/permissionMode.funnel.test.ts`, failing).
- `ServiceNode.test.tsx`'s shared test harness has no `SessionProvider`, so all three
  Minecraft-kind test cases fail on mount.
- `src/core/build-bat.test.ts`'s ~19 failures and the `relay-host-service.test.ts` failures (Docker
  precondition, unrelated to MD3) were observed but not root-caused to the same depth as the items
  above in the time available for this pass; both deserve an isolated re-run.
- `CLAUDE.md`'s own "Window chrome" section still describes `TabBar.tsx` as the drag region
  (`CLAUDE.md:2060`); that file was not touched by this pass.
- `docs/ci-and-releases.md` still describes the release workflow as manual-`workflow_dispatch`-only
  with no push trigger, which the workflow file itself now contradicts; also not touched by this
  pass.
- The stranded-draft pattern this document already flagged is recurring under new numbers
  (`v0.4.41`, targeting this exact commit) rather than resolved.

### Next-owner note

Before claiming the Material Design 3 rewrite is release-ready: launch the packaged build (or run
`npm run build && npm run check:wired`) and actually look at the new app bar, nav rail, project
switcher and FAB menu on a real screen — nothing above substitutes for that. Then decide whether
the `.mc-console` styling defect and the two atomic-write violations found above are worth a
one-line fix before the next release, since both are small, both are diagnosed, and neither
requires touching anything MD3-specific to correct.
