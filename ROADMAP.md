# Roadmap

A checklist of where nodeterm actually stands, built from `git log`, `HANDOFF.md` (checked
against the tree rather than copied), `node scripts/check-app-contract.mjs`, and open GitHub
issues. A ticked item is implemented **and** verified — where it claims something visible, that
means captured from the real built artifact, not asserted from source. Anything unticked names
its real state next to it rather than being silently omitted.

Current package version: `0.4.3`. Suite at the current tip: 717 files / 8,852 tests, 0 failed
(per `HANDOFF.md`'s 2026-08-20 pass — re-verify with `npm test` before trusting this number on a
later commit, since this file will not be kept in lockstep with every merge).

---

## Shipped and verified

- [x] Three-process architecture (main / core / renderer) with the `CorePlatform` seam, so
      Server Edition (`src/server`) boots the same core services as Desktop.
- [x] Terminal session continuity via tmux (macOS/Linux) and the standalone Windows session host,
      surviving node remount, app restart, and machine reboot (scrollback replay + agent resume).
- [x] Multi-agent support (Claude, Codex, Gemini, opencode, Grok, custom) with per-agent
      capability lists, hook-based status detection, subagent visualization, canvas control,
      Context Link, and Branch conversation (Claude-only).
- [x] Managed Claude accounts (local + remote/SSH), permission-mode gating with a version-gated
      `auto` flag, and per-account usage indicators including remote-host usage over SSH.
- [x] Projects/tabs with `.nodeterm/project.json` as the git-shareable source of truth, SSH
      project mirroring with atomic writes and conflict reconciliation.
- [x] Kanban board view (session cards, card modal with live co-attached terminal, board log,
      member/due-date metadata) as a first-class second view of canvas nodes.
- [x] Worktrees bound to group frames, with reconciliation against `git worktree list` and
      destructive-action safety (`createdByApp` gating, dirty-file confirmation).
- [x] Docker-hosted remote relay access — free tier, E2EE handshake, mutual SAS approval,
      bounded least-privileged per-host containers, no paid quota gate (removed 2026-08-01).
- [x] LAN pairing (encrypted QR handshake, no plaintext-success path) and approved-device
      persistence with a single serialized mutation funnel.
- [x] Server Edition unlock ladder (dim sum → sums → whack-a-mole) for the lockout screen, with
      the five safety invariants (waiting-only clear, no attempt refund, budget cap, untouched
      escalation, single-use graded nonce) enforced and tested
      (`src/core/unlock-ladder.ts` + `src/core/unlock-ladder.test.ts` +
      `src/server/auth.test.ts` + `src/server/unlock-ladder-routes.test.ts`).
- [x] Material Design 3 chrome rebuild: top app bar, project switcher, left nav rail with FAB,
      replacing the old tab strip and bottom dock (contract-guarded: 46 M3 roles declared for
      both themes, no legacy `data-md-theme`, MD3 primitive component set present and wired).
- [x] Atomic writes everywhere persistence happens (`renameAtomic` / `writeFileAtomic`), enforced
      by a source-scanning guard (`src/core/fs-atomic.guard.test.ts`) across core, both shells,
      and the standalone session host — closed 2026-08-20 after finding four bare renames in the
      Windows installer script itself.
- [x] Speech/dictation (on-device Whisper) wired on both Desktop and Server Edition, tiny model
      free / larger models gated behind Pro licensing.
- [x] Docs bundle build pipeline (`scripts/build-docs-bundle.mjs` /
      `scripts/check-docs-bundle.mjs`) and the app-contract completeness guard
      (`scripts/check-app-contract.mjs`), 1,101 assertions across 59 features, run clean except
      for the one pending item below.
- [x] Windows packaging path: Squirrel.Windows via `scripts/windows-installer.mjs`, unsigned by
      permanent policy, with ICO regeneration/verification, nupkg/RELEASES agreement checks, and
      a manual-dispatch-only `main`-only release workflow.

## In progress / partially landed

- [ ] **Portable canvas projection**: schema 3 root and future universe canvas payloads now have
      a deterministic, bounded, platform-free projection and validator in
      `src/core/portable-canvas-projection.ts`; archive export/import wiring and verification
      remain outstanding.

- [ ] **ADHD modes** — Focus, Low stimulation, Time awareness, One thing at a time, and Momentum
      are all specced in `docs/adhd-modes.md`. Time awareness, Momentum, and the
      notification-filtering half of Low stimulation were wired 2026-08-20 (`d697f78f`). Still
      owed per `HANDOFF.md`: a packaged capture of the three states, and a visual check at narrow
      widths and 200% display scale — implemented but not yet visually verified.
- [ ] **Windows terminal profile capture evidence** — mechanism ships
      (`scripts/run-windows-profile-packaged-acceptance.mjs --execute` +
      `scripts/promote-packaged-captures.mjs`), but nobody has run it on a Windows box against a
      packaged build of the current commit. `node scripts/check-app-contract.mjs` fails this row
      honestly (1 failure, this exact item) rather than faking a pass. `npm run shots` covers the
      picker from the unpackaged build over plain CDP, which is filed under separate ids and
      deliberately does not satisfy the packaged-evidence requirement.
- [ ] **#75 psmux discovery** — Windows discovery now checks `PATH` with `PATHEXT`, prefers
      `tmux` then `psmux`, offers the verified `winget` package command when available, and keeps
      the session-host fallback honest when it is not. Build, runtime, and capture evidence remain
      intentionally unrun in the ultra-speed lane.
- [ ] **Terminal blur (device-pixel fit)** — the PHASE half of the fix (viewport-transform
      fractional offset) is on `main`; the pure module (`terminal/device-pixel-fit.ts`) exists and
      is unit-tested, but is **not wired to either consuming site** (the `Canvas.tsx` viewport
      transform, the renderer default) per `HANDOFF.md`. A device eyeball at 150% scaling is the
      stated gate before wiring either site.
- [ ] **Codex/Gemini agent parity** — usage meter, permission-mode mapping, title read/rename
      split, and in-place restart are implemented and tested per the CLAUDE.md agent-support
      section; subagent visualization and Context Link remain claude-only/unbuilt for Grok
      specifically (`SUBAGENT_CAPABLE`/`CONTEXT_LINK_CAPABLE` exclude Grok — its
      `updates.jsonl` parser is unbuilt).

## Known open defects (filed, unfixed)

- [ ] **#318** — `AgentsSection` capability toggles never persist (`setProjectCapability` writes
      no disk).
- [ ] **#301** — Project switch (⌘1/⌘2) remounts the canvas; sluggish, and browser nodes reload
      their page on switch.
- [ ] **#369** — macOS corrupted app icon.
- [ ] **#367** — Codex workspace sandbox blocks the local context-link and canvas-control shims.
- [ ] **#128** — New project blocks existing ones.
- [ ] **#313** — Limited account management while using the browser (Server Edition).
- [ ] Known guard weaknesses recorded in `HANDOFF.md`, not yet fixed in this pass:
  - `check-site-contract.mjs:252`'s `voiceschanged` needle points at a comment, not the real
    subscription (`site/app/main.js:440`).
  - `hook-identity-enforcement.test.ts:426`'s whole-file needles survive commenting out the
    wiring line they exist to guard.
  - The `KIDS_DISCLOSURE` needle is comment-satisfiable.
  - `agent-status-mirror.ts:507` still rolls its own cross-dialect basename instead of using the
    sanctioned `core/path-basename.ts`.

## Requested, not started

Feature requests open on GitHub with no landed implementation yet, newest first:

- [ ] **#349** — Expose xterm's word-separator config as a user setting (default closer to
      iTerm2's). *(Note: word-separator support for double-click landed 2026-08-20, `0b59782a`
      per HANDOFF.md — the underlying feature this issue asks for may already be resolved;
      re-check the issue before treating this as unstarted.)*
- [ ] **#347** — Cleanup/uninstall script or portable install.
- [ ] **#299** — High-DPI UI text scaling setting.
- [ ] **#295** — Auto-rotate Claude accounts when usage crosses a threshold (default 90%).
- [ ] **#292** — Auto-handle OAuth localhost callbacks for remote sessions (MCP auth on SSH /
      Server Edition).
- [ ] **#291** — Node type icons alongside color coding.
- [ ] **#290** — Source control for monorepos with multiple nested git repos.
- [ ] **#289** — Custom sounds for agent alerts.
- [ ] **#286** — Named terminal profiles (start directory).
- [ ] **#284** — Per-terminal independent "repo context".
- [ ] **#145** — Basic annotation tools (colored frame, lines, arrows) — note: an `annotation`
      node kind already exists in `NodeKind` per CLAUDE.md; verify against #145 before assuming
      this is unstarted.
- [ ] **#119** — Opt-in lead-pane-width preference (Claude Code agent teams squeeze the lead
      pane to ~30%).
- [ ] **#78** — Owner's own tracked roadmap of 4 bug fixes + 4 features (grouped meta-issue;
      contents not itemized here — see the issue directly).

## Portable Node Universes and Hosting Program, planned 2026-08-26

Implementation source baseline: `27ecfa62e5b3180070abaa241f8bac6b1e079861`. These items are
intentionally unchecked because this task publishes the plan only.

### Portability and shared foundations

- [ ] Ship schema 3 portable project export with manifest, hashes, omissions, and migration. Core
  platform-free validator and documentation landed, but export wiring and required verification
  remain outstanding.
- [ ] Import schema 3 archives atomically without external side effects.
- [ ] Preserve root, Multiverse, AWS Universe, portal, Shop, node, relationship, and appearance data.
- [ ] Bundle project-owned media and provide Include, Omit, and Locate Later decisions.
- [ ] Separate portable blueprints from machine-local bindings and credential references.
- [ ] Ship the unified Node Catalog and one creation coordinator.
- [ ] Add one non-deletable Shop node to every Multiverse and AWS Universe child canvas.
- [ ] Add shared account, credential-vault, OAuth callback, and provider-binding services.
- [ ] Add guided Docker host management for local and SSH contexts.

### Media, torrents, virtual machines, and planning

- [ ] Add Photo, Video, mixed-media Gallery, and wild Dim Sum nodes.
- [ ] Add the categorized local file-converter and advanced media, archive, PDF, and OCR pipelines.
- [ ] Add the bundled WebTorrent downloader with resumable per-task lifecycle.
- [ ] Add the bundled QEMU Linux ISO VM with persistent and disposable modes.
- [ ] Add Home Assistant multi-instance controls and sensor displays.
- [ ] Add Calendar, Timer, Alarm Clock, and planner occurrence services.

### Multiverse and AWS

- [ ] Add door-only Multiverse canvases to depth 8.
- [ ] Add interactive door construction, numeric or passphrase entry, and recovery game.
- [ ] Add unlimited AWS Universes with AWS-only scope and AWS Shop nodes.
- [ ] Bundle AWS CLI v2 and maintain verified model and documentation indexing.
- [ ] Generate interactive wizard forms for every AWS service, command, option, paginator, waiter,
      skeleton, input, and output described by the installed CLI models.
- [ ] Add AWS identity, SSO, role, MFA, Resource Explorer, Cloud Control, S3, EC2, IAM, STS,
      Lambda, CloudWatch, Logs, CloudFormation, CDK, container, database, networking, and cost tools.
- [ ] Add the generic all-service AWS GUI without a command textbox fallback.

### Hosting and Cloudflare

- [ ] Add GitLab Server CE and EE hosting profiles with backup and restore.
- [ ] Add Nextcloud AIO and managed no-socket hosting profiles.
- [ ] Add Open WebUI hosting with existing Ollama reuse and honest bootstrap states.
- [ ] Add Cloudflare account, zone, DNS, security, Workers, Pages, storage, queue, Access, and
      analytics managers.
- [ ] Add one-click Cloudflare Tunnel setup with private-first routing and connector choices.

### Clean-room features and upstream parity

- [ ] Add clean-room browser, kiosk, PWA, proxy, and read-only diagnostics nodes.
- [ ] Implement the outstanding upstream behavior from the planned issue and pull-request parity map.
- [ ] Split the PR #422 behavior into independent link, endpoint, navigation, grouping, agent, and
      account lanes.
- [ ] Publish the new upstream pull request based on the final default branch with verified evidence.

## Deliberately not doing

- Code signing for any installer or browser extension — permanent policy (`LICENSE`/CLAUDE.md);
  every Windows Squirrel artifact ships and stays unsigned.
- Standard Git LFS as a fallback for large files — the repo's Cheap LFS/cloud transfer path is
  the only sanctioned route; Git LFS itself is refused everywhere.
- A paid gate on phone/relay remote access — removed 2026-08-01 (the iOS app itself is the paid
  surface; gating the desktop side too was double-charging for one feature).

---

*This file is a snapshot, not a live feed. Re-derive it from `git log`, `HANDOFF.md`,
`node scripts/check-app-contract.mjs`, and `gh issue list` rather than trusting it silently once
enough commits have landed since it was last written.*
