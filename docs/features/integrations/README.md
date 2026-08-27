# Integrations

Nodes that manage or host something outside this app. Each one is a canvas node — draggable,
editable and persisted like a terminal, not a separate window — so they all share the `NodeKind`
substrate described in CLAUDE.md rather than inventing a surface each.

| feature | status |
| --- | --- |
| [Service nodes](service-nodes.md) | implemented as canvas objects (Minecraft, Docker host, Proxmox, GitLab, Home Assistant, FreePBX); Home Assistant and Minecraft have live clients |
| [Home Assistant client](home-assistant-client.md) | multi-instance machine-local registration with bounded REST and WebSocket entity discovery |
| [Minecraft server](minecraft-server.md) | research only: cited constraints, not implemented |
| [Research findings](research-findings.md) | all seven subjects, adversarially checked |
| [Special-universe Shop nodes](aws-universe-shop.md) | implemented deterministic, scope-bound Shop coordinator and catalog surface; AWS executors remain visibly unavailable until their later lanes |
| [Torrent Downloader](../torrents/torrent-downloader.md) | local WebTorrent downloads with safe machine-local task state |
| [Linux ISO VM](linux-iso-vm.md) | implemented canvas node with bundled QEMU, WHPX preference, QMP lifecycle, loopback display, persistent/disposable modes, and network-off default |
| [Planner occurrences](planner-occurrences.md) | host-owned durable recurrence, timezone/DST handling, missed history, and UI-closure continuity |

Planned, not yet researched here:

- **Proxmox** — a MANAGER for an existing instance. It is a bare-metal hypervisor distribution, so
  there is nothing to host from a right-click; the node drives its API.
- **Home Assistant controls and sensor displays** are separate Program 16 and Program 17 surfaces.
  They reuse the multi-instance client and discovery contract documented above.
- **Docker** — the highest-value angle is exec-into-a-container as a real terminal node, since that
  is what this app already is.
- **GitLab** — two halves: self-hosting Community Edition, and a Material client over its API. The
  client half must reuse the existing Source Control panel rather than duplicate it.
- **FreePBX** — flagged as doubtful: containerising it is unofficial, and some modules are
  commercial, which collides with the rule that nothing is ever paid.
