# Agents

nodeterm is a pluggable multi-agent system. Claude Code, Codex, Gemini, opencode, Grok, and
Cognition Devin are built in; any other CLI can be added as a custom agent.

- [Agent support](./agent-support.md) — the shared status model, hook-driven detection,
  restart-safe display continuity, workflow-state sidebar grouping, permission modes, managed
  accounts, and the capability system that decides which agent gets which feature.
- [Usage-threshold account rotation](./usage-account-rotation.md) - opt-in account selection for
  new default Claude sessions when the active account reaches a configured usage threshold.
- [Custom agent harnesses](./custom-agent-harness.md) — builtin capability inheritance, persisted
  harness identity, launch previews, environment expansion, and host-owned execution boundaries.
- [Devin CLI](./devin-cli.md) — measured Cognition Devin CLI 3000.4.25 launch forms, lifecycle
  hooks, status mapping, notification fallback, and capability boundaries.
- [Linked-agent inbox notifications](./linked-agent-inbox-notifications.md) — the fixed,
  app-authored `notify --node <id>` prompt, project consent, runtime ownership checks, and
  bounded deliver-on-idle queue.
- [Seamless agent messaging](./agent-messaging.md): bounded send/reply delivery, confirmation
  control, project capability consent, idle queuing, and the portable versus local boundary.
- [Agent-to-agent drag collaboration](./agent-drag-collaboration.md) — the bounded drag, keyboard,
  and touch route to the existing context-link behavior.
- [Context-window progress](./context-window-progress.md) — provider telemetry sources, honest
  unknown and stale states, generation fencing, and the shared meter across node and board views.

See also [Canvas → Node kinds](../canvas/README.md) for the agent node itself,
[Kanban](../kanban/README.md) for how agent status renders on a board card, and
[Remote & SSH](../remote/README.md) for running an agent on a remote host.
