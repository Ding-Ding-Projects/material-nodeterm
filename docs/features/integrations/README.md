# Integrations

Nodes that manage or host something outside this app. Each one is a canvas node — draggable,
editable and persisted like a terminal, not a separate window — so they all share the `NodeKind`
substrate described in CLAUDE.md rather than inventing a surface each.

| feature | status |
| --- | --- |
| [Service nodes](service-nodes.md) | implemented as canvas objects, with Home Assistant now connected through the multi-instance client |
| [Home Assistant client](home-assistant-client.md) | implemented core REST/WebSocket discovery, local bindings, reconnect states, and sealed token storage |
| [Minecraft server](minecraft-server.md) | research only: cited constraints, not implemented |
| [Research findings](research-findings.md) | all seven subjects, adversarially checked |

Planned, not yet researched here:

- **Proxmox** — a MANAGER for an existing instance. It is a bare-metal hypervisor distribution, so
  there is nothing to host from a right-click; the node drives its API.
- **Home Assistant** — the service node extends the existing scheduled-settings URL and secret
  safety rules through one shared multi-instance client.
- **Docker** — the highest-value angle is exec-into-a-container as a real terminal node, since that
  is what this app already is.
- **GitLab** — two halves: self-hosting Community Edition, and a Material client over its API. The
  client half must reuse the existing Source Control panel rather than duplicate it.
- **FreePBX** — flagged as doubtful: containerising it is unofficial, and some modules are
  commercial, which collides with the rule that nothing is ever paid.
