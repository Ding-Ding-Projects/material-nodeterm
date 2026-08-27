# Agents

nodeterm is a pluggable multi-agent system. Claude Code, Codex, Gemini, opencode, and Grok are
built in; any other CLI can be added as a custom agent.

- [Agent support](./agent-support.md) — the shared status model, hook-driven detection,
  permission modes, managed accounts, and the capability system that decides which agent gets
  which feature.
- [Seamless agent messaging](./agent-messaging.md): bounded send/reply delivery, confirmation
  control, project capability consent, idle queuing, and the portable versus local boundary.

See also [Canvas → Node kinds](../canvas/README.md) for the agent node itself,
[Kanban](../kanban/README.md) for how agent status renders on a board card, and
[Remote & SSH](../remote/README.md) for running an agent on a remote host.
