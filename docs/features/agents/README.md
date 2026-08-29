# Agents

nodeterm is a pluggable multi-agent system. Claude Code, Codex, Gemini, opencode, and Grok are
built in; any other CLI can be added as a custom agent.

- [Agent support](./agent-support.md) — the shared status model, hook-driven detection,
  permission modes, managed accounts, and the capability system that decides which agent gets
  which feature.
- [Claude account rotation](./claude-account-rotation.md): opt-in usage-threshold selection for
  new Claude sessions, multi-account evidence, hysteresis, cooldown, and honest fallback states.

See also [Canvas → Node kinds](../canvas/README.md) for the agent node itself,
[Kanban](../kanban/README.md) for how agent status renders on a board card, and
[Remote & SSH](../remote/README.md) for running an agent on a remote host.
