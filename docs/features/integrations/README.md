# Integrations

Nodes that manage or host something outside this app. Each one is a canvas node — draggable,
editable and persisted like a terminal, not a separate window — so they all share the `NodeKind`
substrate described in CLAUDE.md rather than inventing a surface each.

| feature | status |
| --- | --- |
| [Service nodes](service-nodes.md) | canvas objects for six manager kinds, with a schema-driven Home Assistant control surface and explicit host-bridge fallback |
| [Home Assistant Control nodes](home-assistant-controls.md) | guided multi-instance discovery, typed service controls, live state and review-before-call confirmation |
| [Minecraft server](minecraft-server.md) | research only: cited constraints, not implemented |
| [Research findings](research-findings.md) | all seven subjects, adversarially checked |

Planned, not yet researched here:

- **Proxmox** — a MANAGER for an existing instance. It is a bare-metal hypervisor distribution, so
  there is nothing to host from a right-click; the node drives its API.
- **Home Assistant** — the Control node reuses the shared host boundary and catalog contract; its
  endpoint, vault key, instance binding and entity state remain local while safe domain/service
  intent travels in schema 3.
- **Docker** — the highest-value angle is exec-into-a-container as a real terminal node, since that
  is what this app already is.
- **GitLab** — two halves: self-hosting Community Edition, and a Material client over its API. The
  client half must reuse the existing Source Control panel rather than duplicate it.
- **FreePBX** — flagged as doubtful: containerising it is unofficial, and some modules are
  commercial, which collides with the rule that nothing is ever paid.
