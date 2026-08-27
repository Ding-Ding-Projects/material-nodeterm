# Integrations

Nodes that manage or host something outside this app. Each one is a canvas node — draggable,
editable and persisted like a terminal, not a separate window — so they all share the `NodeKind`
substrate described in CLAUDE.md rather than inventing a surface each.

| feature | status |
| --- | --- |
| [Service nodes](service-nodes.md) | implemented as canvas objects (Minecraft, Docker host, Proxmox, GitLab, Home Assistant, FreePBX); none of them dial anything yet |
| [Minecraft server](minecraft-server.md) | research only: cited constraints, not implemented |
| [Research findings](research-findings.md) | all seven subjects, adversarially checked |
| [Special-universe Shop nodes](aws-universe-shop.md) | implemented deterministic, scope-bound Shop coordinator and catalog surface; AWS executors remain visibly unavailable until their later lanes |
| [Torrent Downloader](../torrents/torrent-downloader.md) | local WebTorrent downloads with safe machine-local task state |
| [Linux ISO VM](linux-iso-vm.md) | implemented canvas node with bundled QEMU, WHPX preference, QMP lifecycle, loopback display, persistent/disposable modes, and network-off default |
| [Planner occurrences](planner-occurrences.md) | host-owned durable recurrence, timezone/DST handling, missed history, and UI-closure continuity |
| [Home Assistant sensor displays](home-assistant-sensor-display.md) | implemented portable entity/display intent with machine-local sealed binding, discovery, bounded observations, and typed value/state/gauge/trend/event/weather/calendar/attribute views |

Planned, not yet researched here:

- **Proxmox** — a MANAGER for an existing instance. It is a bare-metal hypervisor distribution, so
  there is nothing to host from a right-click; the node drives its API.
- **Home Assistant control**: schema-driven writes remain planned. Sensor display nodes reuse the
  existing bounded URL and host-owned network boundaries without exposing a raw request editor.
- **Docker** — the highest-value angle is exec-into-a-container as a real terminal node, since that
  is what this app already is.
- **GitLab** — two halves: self-hosting Community Edition, and a Material client over its API. The
  client half must reuse the existing Source Control panel rather than duplicate it.
- **FreePBX** — flagged as doubtful: containerising it is unofficial, and some modules are
  commercial, which collides with the rule that nothing is ever paid.
