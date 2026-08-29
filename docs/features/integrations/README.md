# Integrations

Nodes that manage or host something outside this app. Each one is a canvas node — draggable,
editable and persisted like a terminal, not a separate window — so they all share the `NodeKind`
substrate described in CLAUDE.md rather than inventing a surface each.

| feature | status |
| --- | --- |
| [Service nodes](service-nodes.md) | implemented as canvas objects (Minecraft, Docker host, Proxmox, GitLab, Home Assistant, FreePBX); none of them dial anything yet |
| [Home Assistant sensor displays](home-assistant-sensors.md) | live numeric, binary, enum, gauge, trend, event, weather, calendar, and attributes nodes with bounded history |
| [Minecraft server](minecraft-server.md) | research only: cited constraints, not implemented |
| [Research findings](research-findings.md) | all seven subjects, adversarially checked |

Planned, not yet researched here:

- **Proxmox** — a MANAGER for an existing instance. It is a bare-metal hypervisor distribution, so
  there is nothing to host from a right-click; the node drives its API.
- **Home Assistant multi-instance controls** — the sensor display lane now owns the shared
  Home Assistant client and WebSocket path; multi-instance management remains future work.
- **Docker** — the highest-value angle is exec-into-a-container as a real terminal node, since that
  is what this app already is.
- **GitLab** — two halves: self-hosting Community Edition, and a Material client over its API. The
  client half must reuse the existing Source Control panel rather than duplicate it.
- **FreePBX** — flagged as doubtful: containerising it is unofficial, and some modules are
  commercial, which collides with the rule that nothing is ever paid.
