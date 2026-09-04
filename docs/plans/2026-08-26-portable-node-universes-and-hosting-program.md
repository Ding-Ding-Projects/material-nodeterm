# Portable Node Universes and Hosting Program

Status: planned, not implemented

Source baseline: `27ecfa62e5b3180070abaa241f8bac6b1e079861`

This document is the decision-complete implementation plan for making project portability the
main product promise while expanding the canvas into a guided catalog of local, hosted, cloud, and
remote operations. It also defines the release, issue, documentation, and upstream contribution
work that must accompany implementation.

## Product outcomes

The program has five user-visible outcomes:

1. A project can be exported as one portable file, copied to another computer, imported, and
   reopened without depending on the original computer's paths, credentials, processes, or
   provider sessions.
2. Every node is discoverable through an interactive Node Catalog. Multiverse and AWS Universe
   canvases each contain one non-deletable Shop node that opens the catalog scoped to that universe.
3. Every visible control uses the project's Material Design 3 language, with real pickers, wizards,
   searchable menus, accessible keyboard paths, and no primary workflow that is only a text box.
4. AWS CLI and API operations, Cloudflare management, Docker-hosted services, media processing,
   torrent downloads, virtual machines, Home Assistant, and planning tools are guided, typed,
   reviewable, and portable by blueprint rather than by copied secrets or machine paths.
5. The work lands as independently traceable lanes with public documentation, GitHub issue records,
   reproducible release evidence, and a new upstream pull request based on verified facts.

## Scope and fixed decisions

- Windows desktop is the active delivery surface. The Server Edition and mobile companion receive a
  documented compatibility decision for every feature, with shared core logic where applicable.
- Project portability means one actual transferable save file, not a list of settings to recreate by
  hand.
- The portable file contains project-owned content and safe deployment intent. It never contains
  credentials, bearer tokens, refresh tokens, session tokens, passwords, MFA values, vault bytes,
  absolute local paths, process identifiers, provider caches, VM disks, torrent output, browser
  profiles, or host-specific resource identifiers.
- Import is atomic and never performs external mutations. It does not deploy services, invoke AWS,
  start a VM, download a torrent, open a tunnel, reconnect a provider, or sync a calendar.
- All external integrations use portable blueprints plus explicit local bindings. A matching display
  name is never sufficient proof for adoption of an external resource.
- The root canvas uses the Node Catalog. Each Multiverse and AWS Universe child canvas owns exactly
  one Shop node. Shops are persistent, non-deletable, non-duplicable, and scope-bound.
- Multiverse nesting is limited to depth 8. AWS Universes are unlimited per project.
- AWS operations are generated from the installed AWS CLI v2 models and official API documentation.
  Every operation is an interactive form or wizard. A command textbox, arbitrary shell, script field,
  or raw request editor is never the primary or fallback workflow.
- Hosted services bind privately first. Cloudflare Tunnel exposure is an explicit later action after
  local health checks pass.
- All external credentials remain local to the computer and are never included in a portable file.
- All visible surfaces use Material Design 3 primitives and project tokens. Functional data colors
  remain available where they encode status, media, chart series, or provider data.
- Every independent implementation lane has one isolated implementation worker, configured with
  the requested `gpt-5.6-luna` model. Coupled behavior remains one lane so the released result is
  complete and reviewable.

## Portable project file

### Schema and envelope

Add a versioned portable envelope without changing the meaning of existing project files:

```text
format: nodeterm-portable-project
schemaVersion: 3
```

Use the existing encrypted archive mechanism when the user elects archive encryption. The ordinary
portable archive is a ZIP with a manifest and relative entry names.

Required entries:

```text
mimetype
manifest.json
project/identity.json
project/canvases/root.json
project/canvases/<canvas-id>.json
project/nodes/<node-id>.json
project/relationships.json
project/appearance.json
project/blueprints.json
assets/media-manifest.json
assets/media/<asset-id>.<extension>
history/portable-events.jsonl
omissions.json
```

The manifest records the format, schema, minimum reader version, exporter version, export time,
portable project identifier, display name, root canvas, counts, raw and compressed sizes, entry
list, SHA-256 per entry, required versus optional entries, completeness, omissions, and migration
notes. Unknown required fields fail closed. Unknown optional fields are omitted and reported.

### Portable content

Persist the following in the portable projection:

- Project display name, icon, color, and safe appearance settings.
- Root canvas and all Multiverse and AWS Universe child canvases.
- Portal and Shop nodes, their geometry, scope, labels, tags, collapse state, and relationships.
- Node kinds, node-owned safe configuration, groups, bridges, ropes, dependencies, and ordering.
- Portal hierarchy and return-door relationships.
- Safe AWS operation templates, region intent, service intent, and reviewed defaults.
- Safe hosted-service deployment blueprints, image intent, storage intent, resource intent, and
  private-bind intent.
- Safe Home Assistant selector hints, planner definitions, calendar definitions, and local media.
- Project-owned Photo, Video, and Gallery media with content-based asset references.
- An omission report that explains what must be configured again on the destination computer.

Do not persist:

- Credentials, tokens, passwords, PINs, MFA values, passphrases, vault contents, or secret-derived
  fingerprints.
- Absolute paths, process IDs, host fingerprints, local ports, socket names, container IDs, volume
  IDs, browser profiles, cookies, or provider synchronization cursors.
- AWS profiles, account bindings, role sessions, SSO caches, CLI paths, credential-process commands,
  or local credential files.
- Cloudflare accounts, zones, tunnels, tunnel tokens, connector state, or provider credentials.
- Docker contexts, daemon identities, container state, image caches, volume contents, or socket data.
- VM disks, ISOs, snapshots, UUIDs, MAC addresses, display endpoints, QMP pipes, or process state.
- Torrent output, partial files, peers, active handles, or destination paths.
- Large service backups, raw logs, caches, temporary files, or unrelated application data.

### Portable blueprint and local binding

Represent external integrations in two explicit layers:

```ts
interface PortableNodeBlueprint {
  schemaVersion: number
  featureId: string
  displayLabel: string
  requestedCapabilities: string[]
  safeSettings: Record<string, unknown>
  relationships: PortableRelationship[]
}

interface LocalNodeBinding {
  nodeId: string
  bindingVersion: number
  providerOrHostIdentity: string
  localResourceReferences: Record<string, unknown>
  credentialKeys: string[]
  lastVerifiedAt?: number
}
```

Blueprints travel in the project file. Local bindings remain in private application data. Rebinding,
adoption, deployment, and credential selection are explicit user actions with identity and ownership
proof. A destination computer shows Configure, Rebind, Adopt, Deploy, Locate Asset, and Leave
Unbound actions as appropriate.

### Media and omission behavior

Project-owned media is included by default. Validate signatures, MIME type, extension, dimensions,
duration, frame count, byte size, and SHA-256. Reject symlinks, reparse points, special files,
traversal, oversized inputs, and malformed media. External media offers Include, Omit, or Locate
Later before export. Missing media remains represented as an unresolved asset, never as a silently
removed node.

Large service data, VM disks, torrent output, and provider backups have separate explicit export
flows. They are omitted from the ordinary project file and described in `omissions.json` without
revealing a secret, path, account, or machine identifier.

### Import and migration

Import must validate every archive entry and hash, migrate in memory, validate canvases and
relationships, validate media, prepare bindings, stage the result beside the destination, build the
local index, re-read the staged result, and publish both project and index atomically. A failed
import leaves the existing project unchanged.

Continue to support legacy V1 JSON and V2 archives. New exports use schema 3. Legacy secrets,
vault data, and machine-local execution fields are never copied into the new portable projection.

## Unified Node Catalog and universe Shops

Create one typed catalog registry with category, keywords, availability, documentation, safe
defaults, and a creation executor. The FAB, empty-canvas context menu, and command palette use this
registry. Existing keyboard shortcuts, file drops, and paste gestures remain fast paths into the
same executor.

The catalog provides:

- Category navigation and plain-text search by default.
- An anchored full regex builder beside the search field.
- Searchable dropdowns and context menus with local filtering.
- Keyboard navigation, focus restoration, result counts, and screen-reader state.
- Exact disabled-state reasons and the next action needed to enable an entry.
- Collision-free placement and immutable creation event identifiers.
- Direct documentation links and portable blueprint defaults.

Every Multiverse and AWS Universe child canvas creates one Shop node at universe creation. A Shop
cannot be deleted, duplicated, grouped, moved, or removed by ordinary undo. Its deterministic ID is
derived from the universe. A malformed imported universe receives a visible repair record and one
rebuilt Shop. A Multiverse Shop exposes allowed general nodes and another portal only below depth 8.
An AWS Shop exposes AWS nodes only. The root canvas has no Shop.

Runtime-created ordinary nodes receive immutable creation event IDs for user, automation, undo,
redo, and peer insertion. Workspace hydration does not create new events. This coordinator also
owns idempotence, peer convergence, placement, and the deterministic 1 percent wild Dim Sum
surprise. The surprise adds an extra node, never replaces the requested node, never triggers a
second draw, and is suppressed only by School mode.

## Material Design 3 and interaction contract

Apply the shared Material Design 3 language to every new and changed surface, including nodes,
catalogs, Shops, doors, recovery flows, wizards, logs, tables, media controls, status surfaces,
settings, notifications, and errors. Support light and dark themes, density, responsive layouts,
reduced motion, visible focus, screen-reader names and state, and the supported display scales.

Every menu, dropdown, picker, settings surface, properties panel, and search list gets its own
keyboard-accessible search field with an anchored full regex builder. Plain text remains the default.
Every rendered value uses a real control when it can be edited. Paths have native browse controls.
Long operations expose real progress at the surface that started them. Destructive actions use the
application's two-key confirmation flow. Notifications are non-blocking and remain reviewable in a
notification center.

Every app surface also records language mode, independent English and Cantonese funny levels,
emoji-dialog preference, accessibility behavior, appearance changes, local history, exports,
command palette routing, app rename, personal-vocabulary upload, and ADHD-mode behavior according
to the project's universal surface contract. Those additions are tracked as completeness rows,
not inferred from component discovery.

## Feature lanes and dependency order

Each lane below is independently traceable. A lane owns implementation, directly related public
documentation, changelog entry, focused tests, built-artifact interaction evidence, and release
metadata. Shared foundations land before dependent lanes.

### Wave A, portability and shared infrastructure

1. Portable schema 3 manifest, archive validation, omissions, and legacy migration.
2. Portable canvas projection for root, Multiverse, AWS Universe, portal, and Shop data.
3. Portable media assets and Include, Omit, Locate Later flow.
4. Atomic import and destination-computer binding wizard.
5. Automatic dependency installation foundation: manifest, verified cache, bounded lifecycle,
   user-scoped publication, repair, cancellation, and resume metadata. Dependent catalog and
   hosting lanes must not make their own downloader or PATH probe.
6. Unified Node Catalog registry and creation coordinator, including dependency identifiers and
   `Install and continue` resume wiring.
7. Special-universe Shop node and scope enforcement.
8. Shared provider account, credential-vault, OAuth callback, and local-binding services.
9. Docker host manager for local and SSH contexts, including typed container, image, volume,
   network, Compose profile, lifecycle, stats, logs, and typed exec controls.

### Wave B, media, files, torrents, and virtual machines

9. Photo node, Video node, and mixed-media Gallery.
10. Express File Converter with categorized adapter catalog, file browsing, progress, cancellation,
    atomic output, collision-safe names, and editor handoff.
11. Advanced media, archive, PDF, OCR, and structured-data pipelines with bounded resources.
12. Torrent Downloader using a bundled WebTorrent runtime, magnet and torrent intake, file selection,
    destination browsing, verified progress, pause, resume, cancel, retry, restart recovery, and
    per-task seeding policy.
13. Linux ISO VM node using bundled QEMU and `qemu-img`, WHPX, QMP, loopback display, persistent
    install mode, and disposable live mode. Network is off by default.
14. Wild Dim Sum node and public-catalog asset resolution.

### Wave C, Home Assistant and planning tools

15. Home Assistant multi-instance client with REST and WebSocket discovery.
16. Home Assistant Control nodes with rich domain controls and schema-driven fallback.
17. Home Assistant Sensor Display nodes with values, binary state, enums, gauges, trends, events,
    weather, calendars, attributes, and bounded history.
18. Planner occurrence service that survives UI closure while the computer remains available.
19. Calendar nodes for local calendars, ICS, CalDAV, Google Calendar, and Microsoft 365.
20. Timer nodes for countdowns, stopwatches, and repeatable work and rest sequences.
21. Alarm Clock nodes for one-shot and recurring alarms, timezones, snooze, dismiss, and missed
    occurrence history. The feature never claims to wake a powered-off computer.

### Wave D, Multiverse portals

22. Scoped Multiverse child canvases and hierarchy to depth 8.
23. Interactive door construction with frame, hinges, panel, handle, and activation core.
24. Numeric code and passphrase entry, separate from toy locks.
25. Top-down recovery game with three energy keys, hazards, and core activation.
26. Door-only entry and matching return-door exit, with no tab bypass.
27. Portal lifecycle, import repair, project deletion, and child-content preservation.

### Wave E, AWS Universe and complete interactive AWS GUI

28. AWS Universe portal with unlimited instances and AWS-only scope.
29. AWS Shop and catalog enforcement.
30. Bundled AWS CLI v2, verified fetch fallback, version display, and model inventory.
31. AWS CLI service, command, option, paginator, waiter, skeleton, input, and output documentation
    index based on official models and API documentation.
32. Interactive wizard generator that maps every model shape to typed controls:
    searchable enums, switches, bounded numeric controls, date and time controls, file pickers,
    repeatable list and map editors, nested structures, and synchronized advanced JSON or YAML views.
33. AWS identity manager for profiles, SSO, role assumption, MFA, endpoints, and regions.
34. Resource Explorer and Cloud Control managers.
35. S3, EC2, IAM, STS, Lambda, CloudWatch, and Logs managers.
36. CloudFormation manager with change-set preview.
37. CDK manager with folder picker, trust review, synth, diff, and reviewed deploy.
38. ECR, ECS, EKS, RDS, database, VPC, Route 53, and cost managers.
39. Generic all-service AWS GUI for newly installed services and commands without hand-maintained
    forms.

AWS execution previews show service, operation, profile, account, role, region, endpoint, generated
argument vector, pagination, waiter, retry, streaming, output mode, and risk. Destructive actions
require the full confirmation flow. Credentials remain local and never enter blueprints, archives,
logs, command arguments, exports, or public records.

### Wave F, one-click hosted services

40. GitLab Server hosting node with Community Edition or Enterprise Edition choice, pinned official
    image, four managed volumes, readiness probes, initial credential handoff, backup, restore,
    update, rollback, and private binding.
41. Nextcloud AIO profile with explicit Docker socket authority disclosure and no privileged mode.
42. Nextcloud managed no-socket profile with PostgreSQL, Redis, web service, secret files, update,
    backup, restore, and rollback sequencing.
43. Open WebUI hosting node with persistent data, existing Ollama reuse, OpenAI-compatible provider
    option, honest first-user setup, health state, backup, restore, update, and rollback.
44. Shared backup and restore framework with version, edition, resource, and ownership checks.
45. Hosted-service Cloudflare Tunnel handoff after local health verification.

No hosting node accepts arbitrary images, commands, entrypoints, environment editors, Compose text,
or shell input. Deployments are private first, labelled for ownership, capacity-checked, bounded,
and never automatic after import.

### Wave G, Cloudflare manager and tunnels

46. Cloudflare account, zone, DNS, SSL/TLS, ruleset, redirect, cache, and analytics managers.
47. Cloudflare Access, Zero Trust, Workers, Pages, R2, D1, and Queues managers.
48. Tunnel inventory, configuration, route preservation, hostname conflict handling, and DNS record
    adoption.
49. One-click Tunnel wizard with account, zone, hostname, host, discovered container, network, port,
    and origin selection.
50. Per-user process, Windows service, and Docker connector runtimes for `cloudflared`.
51. Tunnel state model that distinguishes API creation, DNS routing, connector health, Access policy,
    origin reachability, and external reachability.

Tunnel credentials are kept in protected local secret storage or a read-only secret volume and are
never passed in arguments or environment variables. The connector uses a token file, pinned image,
read-only root, dropped capabilities, no privileged mode, no host network, no Docker socket, and
bounded resources. Existing unmanaged routes are preserved.

### Wave H, clean-room WinForge-inspired features

52. Browser Portal with isolated profiles and safe lifecycle ownership.
53. Kiosk and PWA sessions.
54. Proxy and isolated debugging browser sessions.
55. Read-only Windows diagnostics for drives, storage, services, startup, scheduled tasks, updates,
    network state, and event summaries.
56. Advanced media, archive, and OCR pipelines where they are not already covered by Wave B.

These are clean-room implementations based on feature concepts only. Do not copy code, assets,
prose, schemas, layouts, operation IDs, screenshots, or implementation details from WinForge. Do not
add debloating, security weakening, activation, licensing, arbitrary shell, or reactor simulation
features.

### Wave I, upstream parity and PR #422 split

57. Linked-agent inbox notifications from PR #98.
58. Seamless agent messaging from PR #113, retaining the newer timeout ceiling.
59. Usage-popover default account selection from PR #189.
60. Per-account node color and binding from PRs #283 and #319.
61. Per-session emoji or picture icons from PR #293 and issue #291.
62. First-class Files node from PR #294.
63. Display-only agent-state recovery and sidebar workflow grouping from PR #421.
64. `psmux` discovery from PR #111, excluding NSIS packaging.
65. Annotation labels and line thickness from issue #145 — implemented in the #76 lane; focused
    verification remains for the next owner because this lane was explicitly no-tests/no-builds.
66. Named terminal profiles from issue #286.
67. Custom per-event alert sounds from issue #289.
68. Nested Git repository discovery from issue #290.
69. Remote OAuth localhost callbacks from issue #292.
70. Usage-threshold account rotation from issue #295.
71. Drag overlays, complete zones, and saved layouts from issue #394.
72. Complete Claude skill visibility from issue #438.
73. Node maximize and restore from issue #439.
74. ProjectSwitcher New Project reachability from issue #375, changing code only if the invariant is
    not already satisfied.
75. Split PR #422 into link and endpoint modeling, migration, cross-project links, foreign-node
    projections, project-aware navigation, grouping and drill-through, dependency operations,
    custom-agent harness, model switching, restart-on-subscription, and remaining account behavior.

Do not merge PR #422 wholesale and do not copy planning scratch files into product code. Already
satisfied upstream changes are recorded as checked during issue triage rather than duplicated.

## Documentation, issue records, and public progress

Before implementation begins, create one master GitHub issue and one child issue for each independent
lane not already represented by an exact existing issue. The master issue links the plan, lane order,
current source SHA, release baseline, acceptance criteria, and the explicit verification boundary.
Each child issue records behavior, portable-save rules, local versus shared state, documentation,
release assets, dependency constraints, and prerequisites. Issue comments use ordinary public technical
language and never expose credentials or private infrastructure.

For every project-changing lane:

- Add a categorized feature article with behavior, setup, failure modes, security, portability, and
  verification.
- Update the category index, `README.md`, `ROADMAP.md`, `HANDOFF.md`, and `CHANGELOG.md` in the same
  lane when their facts change.
- Update the in-app offline documentation bundle and the documentation site when a user-facing
  feature changes.
- Keep a hand-written per-surface completeness inventory linking implementation, docs, localized
  copy, persistence, tests, built-artifact interaction proof, and capture evidence.
- Re-scan open issues at start, milestone, integration, release, and finish. Actionable issues are
  either fixed in a separate bounded lane or left open with an exact external blocker.

## Release and integration contract

Each completed lane is committed in its isolated checkout, built and packaged against its exact
candidate SHA, integrated into `main` immediately, and pushed immediately. The integration record
names the source commit, destination commit, release tag, and assets. A slower sibling lane never
delays a ready lane.

Every successful release contains the genuine Windows Squirrel.Windows artifacts required by the
project, including `Setup.exe`, `RELEASES`, the full `.nupkg`, and a generated delta package when
available. The release is unsigned, and its notes state that the operating system may show an
unknown-publisher warning. Release notes include workflow start, completion, duration, line-count
evidence, source commit, asset hashes, and a public dim-sum photo link when the catalog is available.

The plan lane itself does not build, package, release, create tags, or mutate GitHub. Those actions
begin only in the implementation waves.

## Ultra-speed release boundary

The ultra-speed release path is intentionally narrow. It implements one bounded feature or fix,
updates only directly related public documentation and changelog content, builds and packages
through the existing route, integrates it, and verifies the unique non-draft release and expected
downloadable assets.

Under this path, do not run unit, integration, end-to-end, type, lint, accessibility, security,
adversarial, smoke, installer-execution, or UI interaction checks. Do not run capture workflows.
Release and issue records must state exactly that these checks and captures were not run. Build and
packaging output is evidence of artifact production only, not evidence of runtime correctness.

## Downstream-only contribution policy

The historical upstream pull request plan is superseded by the downstream-only policy recorded in
issue #11 and now mirrored in `AGENTS.md`. This repository may keep a factual comparison report and
track upstream source, but it must not open or comment on a pull request in the canonical upstream
repository. All implementation, review, release, and issue activity stays in this fork. The old report
branch name, upstream pull request title, milestone comments, and retention instructions are
historical data only and are not an action for this plan.

## Acceptance checklist

- [ ] Schema 3 portable export and import work atomically and preserve all project canvases.
- [ ] The omission report explains every machine-local or secret field left behind.
- [ ] Project-owned media survives transfer with validated content-addressed references.
- [ ] External nodes reopen with explicit Configure, Rebind, Adopt, Deploy, or Locate Asset actions.
- [ ] The root Node Catalog and every universe Shop use one typed creation registry.
- [ ] Multiverse depth 8 and unlimited AWS Universe scope are enforced.
- [ ] AWS operations are fully interactive, generated from CLI models, and never textbox-first.
- [ ] Docker, Cloudflare, hosting, media, torrent, VM, Home Assistant, calendar, timer, and alarm
      integrations expose guided controls and portable blueprints.
- [ ] All changed UI uses Material Design 3, accessible states, localized copy, and real controls.
- [ ] Documentation, issue records, roadmap, handoff, changelog, offline docs, and site content are
      current for each released lane.
- [ ] Every lane has exact commit, build, packaging, integration, release, and issue evidence.
- [x] The issue #11 downstream-only policy is recorded in public guidance, and no upstream pull
      request is opened or commented on by this plan.

## Explicitly not included in the plan lane

- Product source-code implementation.
- GitHub issue, discussion, project, pull request, release, tag, or branch mutation.
- Tests, type checking, linting, reviews, security checks, builds, packaging, or captures.
- Credential intake, provider sign-in, host deployment, tunnel creation, or external service mutation.
