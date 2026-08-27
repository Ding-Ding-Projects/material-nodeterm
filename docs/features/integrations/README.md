# Integrations

Nodes that manage or host something outside this app. Each one is a canvas node — draggable,
editable and persisted like a terminal, not a separate window — so they all share the `NodeKind`
substrate described in CLAUDE.md rather than inventing a surface each.

| feature | status |
| --- | --- |
| [Service nodes](service-nodes.md) | implemented as canvas objects (Minecraft, Docker host, Proxmox, GitLab, Home Assistant, FreePBX); Home Assistant and Minecraft have live clients |
| [GitLab Server hosting](gitlab-hosting.md) | guided Community Edition or Enterprise Edition deployment with pinned official image, four managed volumes, readiness, credential handoff, backup, restore, update, rollback, and loopback-only binding |
| [Home Assistant client](home-assistant-client.md) | multi-instance machine-local registration with bounded REST and WebSocket entity discovery |
| [Minecraft server](minecraft-server.md) | research only: cited constraints, not implemented |
| [Research findings](research-findings.md) | all seven subjects, adversarially checked |
| [Special-universe Shop nodes](aws-universe-shop.md) | implemented deterministic, scope-bound Shop coordinator and catalog surface; AWS executors remain visibly unavailable until their later lanes |
| [AWS CLI model documentation index](aws-cli-model-documentation.md) | platform-free bounded index for official service, command, option, paginator, waiter, input, output, and skeleton metadata; runtime verification remains unrun |
| [Torrent Downloader](../torrents/torrent-downloader.md) | local WebTorrent downloads with safe machine-local task state |
| [Linux ISO VM](linux-iso-vm.md) | implemented canvas node with bundled QEMU, WHPX preference, QMP lifecycle, loopback display, persistent/disposable modes, and network-off default |
| [Planner occurrences](planner-occurrences.md) | host-owned durable recurrence, timezone/DST handling, missed history, UI-closure continuity, and schema 3 definition transfer with explicit destination Configure |
| [Shared provider services](provider-services.md) | shared account metadata, sealed credentials, bounded OAuth PKCE callbacks, resource discovery, and local binding integration |
| [Shared hosted-resource backup and restore](backup-restore.md) | versioned, edition-aware, ownership-reviewed archives with bounded validation, progress, cancellation, atomic publication, and rollback contracts |
| [Home Assistant controls](home-assistant-controls.md) | implemented schema-driven entity controls with machine-local connections and portable selection intent; verification intentionally unrun |
| [Home Assistant sensor displays](home-assistant-sensor-display.md) | implemented portable entity/display intent with machine-local sealed binding, discovery, bounded observations, and typed value/state/gauge/trend/event/weather/calendar/attribute views |
| [Cloudflare core managers](cloudflare-core-managers.md) | typed account, zone, DNS, SSL/TLS, ruleset, redirect, cache, and analytics operations with local sealed credentials, bounded results, previews, cancellation, and portable safe intent |
| [Cloudflare Access, Zero Trust, Workers, Pages, R2, D1 and Queues](cloudflare-zero-trust-managers.md) | typed fixed-route API managers with local protected credentials, portable neutral intent, bounded responses, progress, cancellation, and destructive confirmation; verification intentionally unrun |
| [Guided GitHub API capabilities](github-api.md) | typed REST and GraphQL operation catalog with host-resolved credentials, approved-project scoping, bounded pagination, progress, cancellation, rate-limit state, and destructive confirmation; verification intentionally unrun |

Planned, not yet researched here:

- **Proxmox** — a MANAGER for an existing instance. It is a bare-metal hypervisor distribution, so
  there is nothing to host from a right-click; the node drives its API.
- **Docker** — the highest-value angle is exec-into-a-container as a real terminal node, since that
  is what this app already is.
- **GitLab client** — the API client half remains separate work and must reuse the existing Source
  Control panel rather than duplicate it.
- **FreePBX** — flagged as doubtful: containerising it is unofficial, and some modules are
  commercial, which collides with the rule that nothing is ever paid.
