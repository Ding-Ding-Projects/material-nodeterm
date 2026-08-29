# Context-window progress on agent nodes

## Scope

Add one independently rendered context-window progress surface to every agent node family:
Claude Code, Codex, Gemini, Grok, OpenCode, custom agents, resumed sessions, and ephemeral
subagents. The surface stays at the top edge of the node and remains visible through collapse,
minimize, grouping, restore, and kanban views.

## Provider contract

Use only provider-owned local session telemetry. Claude Code uses its assistant transcript usage
and model-family context-window resolver. Codex uses `last_token_usage.input_tokens` with the
adjacent `model_context_window`. Gemini uses transcript `tokens.input` and its model-window
resolver. Grok and OpenCode have no verified per-session context pair in the current tree, and a
custom agent has no provider reader, so those surfaces report an explicit unavailable state.

## State and safety

Known values include exact used, total, remaining, and percentage text. Missing values use
`unknown`, `not reported`, `stale`, or `unavailable` as appropriate. Provider and source identities
compose the cache key. Producer epochs plus per-session generations
fence delayed reads, including fresh generation one after restart, and retired epoch history rejects
late readings from an earlier lifecycle. Values remain in the renderer's machine-local cache and are
excluded from portable files, exports, captures, logs, and provider prompts.

## Evidence boundary

Implementation is complete in the task branch. Tests, builds, runtime interaction, and captures are
deliberately unrun in this ultra-speed implementation lane. Integration must bind the documented
verification matrix to the exact landed commit before marking the roadmap item complete.
