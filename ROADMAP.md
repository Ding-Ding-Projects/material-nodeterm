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

- [ ] **Desktop trackpad gesture facts, issue #108**: main-process scroll and pinch edges now feed
      a depth-safe typed bridge so macOS desktop wheel routing distinguishes a precise-pixel mouse
      from a trackpad, including the bounded momentum-gap linger. Server Edition keeps its browser
      heuristic and mobile is not applicable. This implementation lane intentionally has no tests,
      lint, type checks, builds, packaging, runtime interaction, reviews, audits, or captures yet.

- [ ] **Shared provider services, issue #18**: provider catalog, account metadata, sealed
      credential payloads, bounded one-time OAuth PKCE callbacks, adapter-owned resource discovery,
      and shared Desktop/Server local bindings are implemented in source. Individual provider
      adapters, build/package evidence, runtime interaction, and captures remain pending under the
      stated ultra-speed no-check boundary.

- [ ] Desktop Material Design 3 and personal vocabulary reconciliation: the source audit and focused
  Material Design 3 fixes are present in the audit scripts and shared primitives. The Material Design 3 audit is green
  with deliberate negative regressions. Personal-vocabulary coverage is intentionally red with
  31 listed production surfaces still requiring direct mapper call-site wiring. Built-artifact
  verification, general tests, and captures remain pending.

- [ ] **Desktop layout safety sweep** — viewport-bounded menus, flyouts, anchored popovers, dialogs,
      settings, onboarding, command palette, and documentation surfaces are repaired in
      `src/renderer/styles.clipping.css`, `src/renderer/ui/AnchoredPopover.tsx`, and
      `src/renderer/components/ContextMenu.tsx`. Source implementation is present; packaged
      Windows captures at narrow widths and 100/125/150/200% display scale remain pending.
- [ ] **WSL instance creator repair**: the guided Material Design 3 surface now has staged,
      cancellable operation plumbing and duplicate-submit protection in `src/core/wsl/`,
      `src/shared/wsl.ts`, the bridges, and `src/renderer/wsl/WslCreateDialog.tsx`. Focused
      verification and real built-artifact interaction remain pending.
- [ ] **Full Material Design 3 surface audit (#91)**: source-level inventory and remediation are
      recorded in `docs/features/appearance/material-3-audit.md` and checked by
      `scripts/check-material-audit.mjs` (201 rows, including every desktop shell, node,
      destination, settings section, overlay, status state, empty/error state, and checked-in
      documentation page). Shared numeric, radio, progress, tooltip, and one-off shape defects were
      repaired. Built-artifact clipping and pixel verification remain pending. The Comments &
      Activity panel is retained for p80, the existing-worktree picker for p81, and the WSL creator
      clipping finding for p79.

- [ ] **Portable canvas projection**: schema 3 root and future universe canvas payloads now have
      a deterministic, bounded, platform-free projection and validator in
      `src/core/portable-canvas-projection.ts`; archive export/import wiring and verification
      remain outstanding.
- [ ] **Portable project import and destination binding**: schema 3 export/import now validates
      complete entry hashes, migrates legacy payloads in memory, stages collision-free destinations
      atomically, and keeps bindings in `portable-node-bindings.json`. The guided
      Configure/Rebind/Adopt/Deploy/Locate Asset/Leave Unbound surface is wired for Desktop with
      an honest Server Edition boundary. Tests, build/package evidence, generated docs bundle,
      runtime interaction, and captures remain outstanding.

- [ ] **Cloudflare core managers, issue #57**: typed account, zone, DNS, SSL/TLS, ruleset, redirect,
      cache, and analytics operations are implemented in the shared contract, host service, Desktop
      and Server Edition bridges, and canvas node. Local sealed credentials, bounded output,
      cancellation, safe previews, destructive confirmation, explicit unavailable states, and safe
      schema 3 intent are present. Tests, type checks, lint, reviews, security or accessibility
      checks, builds, packaging, installer execution, runtime interaction, and captures remain
      unverified under the ultra-speed lane.

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
- [ ] **Existing-worktree picker viewport containment** — the adoption list now has a bounded,
      internally scrollable region, a plain-text-first branch/path search with an adjacent full
      regex builder, full wrapping branch/path values, and clipped row overflow inside a responsive
      Material surface. Built-artifact interaction at long-list, narrow-width, and high-display-
      scale states remains unverified.

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
- [ ] Automatic node dependency installation foundation: the typed manifest, verified cache,
  bounded lifecycle, user-scoped publication, cancellation, repair, and restart reconciliation are
  implemented in `src/core/node-dependencies/`; focused verification and Node Catalog resume wiring
  remain outstanding.
- [ ] Import schema 3 archives atomically without external side effects.
- [ ] Preserve root, Multiverse, AWS Universe, portal, Shop, node, relationship, and appearance data.
- [ ] Bundle project-owned media and provide Include, Omit, and Locate Later decisions. Core
  content-addressing, typed desktop preparation, explicit decisions, parser proof, real
  `assets/media/` container entries, repeated import validation, and atomic destination staging are
  implemented. The item remains unchecked because all tests, builds, packaging, runtime
  interaction, accessibility checks, and captures are intentionally unrun.
- [ ] Separate portable blueprints from machine-local bindings and credential references.
- [ ] Ship the unified Node Catalog and one creation coordinator. The typed registry,
      availability-aware dialog, immutable creation-event coordinator, collision-free placement,
      FAB, pane context menu, and command-palette routes landed in this implementation pass; the
      row remains unchecked until the required verification and packaged interaction evidence run.
- [ ] Add one non-deletable Shop node to every Multiverse and AWS Universe child canvas.
- [ ] Ship the unified Node Catalog and one creation coordinator.
- [ ] Add one non-deletable Shop node to every Multiverse and AWS Universe child canvas. The
      deterministic coordinator, collision-safe identity, provider-bound catalog callback, import
      repair, immutable creation-event handling, and renderer refusal paths are now implemented;
      runtime and built-artifact verification remain pending under issue #17's explicit
      no-tests/no-builds/no-captures boundary.
- [ ] Add shared account, credential-vault, OAuth callback, and provider-binding services.
- [ ] Add guided Docker host management for local and SSH contexts. The typed manager, local and
      saved SSH context discovery, guided resource operations, safe portable blueprint, progress,
      cancellation, destructive confirmation, documentation, offline article, and site article are
      implemented on issue #19's feature branch. Tests, type checks, lint, reviews, security and
      accessibility checks, builds, packaging, runtime interaction, and captures remain unrun under
      the ultra-speed boundary, so this roadmap claim remains unchecked.

### Media, torrents, virtual machines, and planning

- [ ] Add Photo, Video, mixed-media Gallery, and wild Dim Sum nodes. Photo, Video, and Gallery
      source implementation, machine-local path round-trip, schema 3 node references, validated
      content-addressed archive bytes, atomic import staging, and explicit missing-asset states are
      present for issue #20. Wild Dim Sum source implementation is present for issue #25 with
      public-catalog selection and portable schema 3 state. Tests, builds, packaging, release
      evidence, and packaged captures remain pending in the parent integration lane, so the
      combined row stays unticked.
- [ ] Verify the categorized local file converter delivered for issue #21. The source now includes
      collision-safe destination reservations, atomic publication, resumable progress, cancellation,
      partial outcomes, per-category regex builders, and completed-output editor handoff; this
      ultra-speed lane intentionally left tests, builds, runtime interaction, and captures unrun.
- [ ] Add advanced media, archive, PDF, OCR, and
      structured-data pipelines. Issue #22 source implementation now provides packaged PDF,
      supported image, local English OCR, bounded ZIP inventory, deterministic JSON, portable
      unbound intent, queue progress, cancellation, retry, and recovery. The item remains unticked
      until the required tests, built-artifact interaction, packaging, and capture evidence run.
- [ ] Add the bundled WebTorrent downloader with resumable per-task lifecycle. The implementation
      lane now contains ESM-compatible local runtime loading, guided inspect-then-start intake,
      searchable metadata and seeding controls, progress controls, restart reconciliation,
      completion-based bounded seeding, and machine-local state; focused verification and release
      evidence remain pending.
- [ ] Add the bundled QEMU Linux ISO VM with persistent and disposable modes. Source implementation landed in `src/core/virtual-machine/` and `src/renderer/nodes/VirtualMachineNode.tsx`; automated checks, build, packaging, runtime interaction, and captures remain intentionally unrun in the ultra-speed lane.
- [x] Add the Home Assistant multi-instance client with REST and WebSocket discovery. Dedicated
      control and sensor display nodes remain Program 16 and Program 17.
- [ ] Add Home Assistant multi-instance controls and sensor displays.
  - [x] Add schema-driven Home Assistant control nodes with local connection binding.
  - [x] Add Home Assistant sensor display nodes with portable entity and presentation intent,
        machine-local sealed binding, typed values, binary state, enums, gauges, bounded trends,
        events, weather, calendars, and selected attributes. Verification remains unrun.
- [ ] Add Calendar, Timer, and Alarm Clock nodes. Planner occurrence service is implemented in the
       current lane, including UI-close continuity, ordered durable occurrence delivery, schema 3
       planner-definition transfer, and the destination Configure action. It remains unticked until
       required checks and packaged interaction evidence land.
- [ ] Add Calendar nodes for local calendars and ICS, with guided CalDAV, Google Calendar, and
      Microsoft 365 provider bindings, recurrence/timezone views, offline cache, and create/edit/
      delete flows. Host-owned provider adapters, credential storage, loopback OAuth PKCE, bounded
      pagination, validators, retry backoff, and remote writes are implemented but remain unticked
      because the ultra-speed lane intentionally skipped tests, type checking, lint, builds,
      packaging, runtime interaction, reviews, audits, and captures.
- [ ] Add Timer, Alarm Clock, and planner occurrence services.
- [x] Add Timer nodes and persistent planner occurrence service. Calendar and Alarm Clock remain
  separate follow-up surfaces.
- [ ] Add Calendar and Timer occurrence services.
- [x] Add Alarm Clock nodes, the host-owned file planner lifecycle and desktop bridge, active Node
      Catalog creation, and occurrence history with timezone and DST-safe recurrence.

### Multiverse and AWS

- [x] Add scoped Multiverse child canvases with guided hierarchy navigation and a depth-8 boundary.
      Source implementation and delivery records are present; tests, type checks, builds, packaging,
      runtime interaction, and captures remain explicitly unrun under issue #33's delivery boundary.
- [ ] Add door-only Multiverse canvases to depth 8.
- [ ] Wire the implemented paired-door navigation policy into the pending Multiverse canvas and
      door-rendering lanes; tab, palette, history, and direct-selection bypasses are refused in core.
- [ ] Add interactive door construction and numeric or passphrase entry. Source components and
      portable intent are present; live navigator wiring remains pending.
- [x] Add the top-down recovery game with three energy keys, hazards, core activation, and portable state. Source implementation is complete; built-artifact verification remains for integration.
- [x] Add unlimited AWS Universes with AWS-only scope, guided navigation, and AWS Shop nodes.
      Source implementation and delivery records are present; tests, type checks, builds,
      packaging, runtime interaction, and captures remain explicitly unrun under issue #39's
      ultra-speed boundary.
- [ ] Bundle AWS CLI v2 and maintain verified model and documentation indexing. The pinned MSI,
      verified fallback, version details route, bounded installed-model inventory, feature article,
      and offline documentation entry are present on the issue #41 jer. Tests, builds, packaging,
      installer execution, runtime interaction, and HuiShots remain pending, so this item stays
      unticked.
- [x] Add the platform-free AWS CLI model documentation index for services, commands, options,
      paginators, waiters, input and output shapes, and input skeletons. Tests, builds, runtime
      interaction, and packaged verification remain unrun under issue #42's lane boundary.
- [ ] Generate interactive wizard forms for every AWS service, command, option, paginator, waiter,
      skeleton, input, and output described by the installed CLI models.
- [ ] Add AWS identity, SSO, role, MFA, Resource Explorer, Cloud Control, S3, EC2, IAM, STS,
      Lambda, CloudWatch, Logs, CloudFormation, CDK, container, database, networking, and cost tools.
- [ ] Add the generic all-service AWS GUI without a command textbox fallback.

### Hosting and Cloudflare

- [x] Add the shared hosted-resource backup and restore framework with version, edition, resource,
      ownership, archive-safety, progress, cancellation, atomic publication, restore-review, and
      rollback contracts. Source and direct documentation are present; tests, builds, packaging,
      runtime interaction, and captures remain explicitly unrun under issue #55's ultra-speed boundary.
- [ ] Add GitLab Server CE and EE hosting profiles with backup, restore, readiness, credential
      handoff, update, rollback, four managed volumes, and private binding. Source and docs are
      present in issue #51; tests, builds, packaging, runtime interaction, and captures remain
      unrun under the ultra-speed boundary.
- [ ] Add Nextcloud AIO and managed no-socket hosting profiles.
- [ ] Add Open WebUI hosting with existing Ollama reuse and honest bootstrap states.
- [ ] Add Cloudflare account, zone, DNS, security, Workers, Pages, storage, queue, Access, and
      analytics managers.
- [x] Add typed Cloudflare Access, Zero Trust, Workers, Pages, R2, D1, and Queues managers with
      local protected credentials, portable neutral intent, bounded fixed-route API calls,
      progress/cancellation, per-field regex builders, and destructive confirmation. Verification
      remains intentionally unrun in the ultra-speed lane.
- [ ] Add one-click Cloudflare Tunnel setup with private-first routing and connector choices.

### Clean-room features and upstream parity

- [ ] Add clean-room browser, kiosk, PWA, proxy, and read-only diagnostics nodes.
- [ ] **Program 57 / #68, linked-agent inbox notifications.** The source path already carries the
      upstream PR #98 intent through the authenticated `notify --node <id>` route, project-local
      consent, runtime ownership checks, fixed application-authored text, and the bounded
      deliver-on-idle queue. Feature documentation, the offline bundle, the documentation site,
      and the completeness inventory are recorded in this lane. Tests, builds, packaging, runtime
      interaction, and UI captures remain pending under the explicit ultra-speed boundary.
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
