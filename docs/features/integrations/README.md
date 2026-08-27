# Integrations

Nodes that manage or host something outside this app. Each one is a canvas node — draggable,
editable and persisted like a terminal, not a separate window — so they all share the `NodeKind`
substrate described in CLAUDE.md rather than inventing a surface each.

| feature | status |
| --- | --- |
| [Service nodes](service-nodes.md) | implemented as canvas objects (Minecraft, Docker host, Proxmox, GitLab, Home Assistant, FreePBX); Home Assistant and Minecraft have live clients |
| [GitLab Server hosting](gitlab-hosting.md) | guided Community Edition or Enterprise Edition deployment with pinned official image, four managed volumes, readiness, credential handoff, backup, restore, update, rollback, and loopback-only binding |
| [Nextcloud AIO hosting](nextcloud-aio-hosting.md) | guided pinned official image profile with explicit Docker socket authority disclosure, no privileged mode, private binding, progress, health, update, backup, restore, and rollback |
| [Managed Nextcloud, no socket](nextcloud-managed.md) | guided PostgreSQL, Redis, and Nextcloud web stack with persistent local data, secret files, loopback binding, update, backup, restore, and rollback sequencing |
| [Home Assistant client](home-assistant-client.md) | multi-instance machine-local registration with bounded REST and WebSocket entity discovery |
| [Minecraft server](minecraft-server.md) | research only: cited constraints, not implemented |
| [Research findings](research-findings.md) | all seven subjects, adversarially checked |
| [Special-universe Shop nodes](aws-universe-shop.md) | implemented deterministic, scope-bound Shop coordinator and catalog surface; AWS executors remain visibly unavailable until their later lanes |
| [AWS CDK manager](cdk-manager.md) | local folder picker, trust review, synth, diff, and reviewed deploy implementation; focused verification remains unrun in the ultra-speed lane |
| [CloudFormation manager](cloudformation-manager.md) | guided local template inspection and AWS CloudFormation change-set preview; runtime evidence is intentionally unverified in the ultra-speed lane |
| [AWS CLI model documentation index](aws-cli-model-documentation.md) | platform-free bounded index for official service, command, option, paginator, waiter, input, output, and skeleton metadata; runtime verification remains unrun |
| [AWS identity manager](aws-identity.md) | guided local profile, IAM Identity Center, role, MFA, region, and service-endpoint controls with safe portable intent and machine-local bindings; host CLI actions remain visibly unavailable until the fixed operation runner is connected |
| [AWS managers](../aws/README.md) | Resource Explorer and Cloud Control manager nodes with local bindings, operation previews, bounded results, cancellation, and destructive confirmation |
| [AWS core-service managers](aws-core-services.md) | S3, EC2, IAM, STS, Lambda, CloudWatch, and CloudWatch Logs mounted on the shared AWS manager with typed actions and local bindings; integration Chuts remain pending |
| [AWS container, database, network, DNS, and cost managers](aws-container-database-cost-managers.md) | ECR, ECS, EKS, RDS, database, VPC, Route 53, and cost operations mounted on the shared AWS manager with typed previews, bounded inputs, and local bindings |
| [Torrent Downloader](../torrents/torrent-downloader.md) | local WebTorrent downloads with safe machine-local task state |
| [Linux ISO VM](linux-iso-vm.md) | implemented canvas node with bundled QEMU, WHPX preference, QMP lifecycle, loopback display, persistent/disposable modes, and network-off default |
| [Planner occurrences](planner-occurrences.md) | host-owned durable recurrence, timezone/DST handling, missed history, UI-closure continuity, and schema 3 definition transfer with explicit destination Configure |
| [Shared provider services](provider-services.md) | shared account metadata, sealed credentials, bounded OAuth PKCE callbacks, resource discovery, and local binding integration |
| [Shared hosted-resource backup and restore](backup-restore.md) | versioned, edition-aware, ownership-reviewed archives with bounded validation, progress, cancellation, atomic publication, and rollback contracts |
| [Home Assistant controls](home-assistant-controls.md) | implemented schema-driven entity controls with machine-local connections and portable selection intent; verification intentionally unrun |
| [Home Assistant sensor displays](home-assistant-sensor-display.md) | implemented portable entity/display intent with machine-local sealed binding, discovery, bounded observations, and typed value/state/gauge/trend/event/weather/calendar/attribute views |
| [Cloudflare core managers](cloudflare-core-managers.md) | typed account, zone, DNS, SSL/TLS, ruleset, redirect, cache, and analytics operations with local sealed credentials, bounded results, previews, cancellation, and portable safe intent |
| [GitHub CLI account selector](github-cli-accounts.md) | host-owned discovery, guided device-flow login, active-account switching, scope refresh, and per-account sign-out without exposing credentials |
| [Cloudflare Access, Zero Trust, Workers, Pages, R2, D1 and Queues](cloudflare-zero-trust-managers.md) | typed fixed-route API managers with local protected credentials, portable neutral intent, bounded responses, progress, cancellation, and destructive confirmation; verification intentionally unrun |
| [Guided GitHub API capabilities](github-api.md) | typed REST and GraphQL operation catalog with host-resolved credentials, approved-project scoping, bounded pagination, progress, cancellation, rate-limit state, and destructive confirmation; verification intentionally unrun |
| [GitHub work-item canvas nodes](github-work-items.md) | safe issue and pull-request projections with guided selection, factual status, shared Markdown rendering, explicit session attachment, and Desktop/Server Edition bridge parity; verification intentionally unrun |

Planned, not yet researched here:

- **Proxmox** — a MANAGER for an existing instance. It is a bare-metal hypervisor distribution, so
  there is nothing to host from a right-click; the node drives its API.
- **Docker** — the highest-value angle is exec-into-a-container as a real terminal node, since that
  is what this app already is.
- **GitLab client** — the API client half remains separate work and must reuse the existing Source
  Control panel rather than duplicate it.
- **FreePBX** — flagged as doubtful: containerising it is unofficial, and some modules are
  commercial, which collides with the rule that nothing is ever paid.
