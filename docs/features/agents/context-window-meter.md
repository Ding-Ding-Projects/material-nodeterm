# Context-window meter

**Category:** [Agents](./README.md)

Every agent node displays a context-window progress bar at the top of its card. The bar remains
visible when the node is collapsed, minimized, grouped, restored, or reopened. It is also shown on
kanban card views and ephemeral subagent cards, so a user never has to infer context health from a
terminal transcript.

## Data sources and honest states

The meter never estimates a denominator from a provider name. Claude Code reads the latest
assistant input and cache token counts from its local transcript and resolves the model family's
known context window. Codex reads `last_token_usage.input_tokens` and the adjacent
`model_context_window` from its local rollout. Gemini reads its latest transcript `tokens.input`
and resolves the documented model window. These readers use the same local transcript path that
the corresponding lifecycle hook reported, with provider-specific path validation.

The authoritative availability matrix is exported as `CONTEXT_TELEMETRY_MATRIX` from
`src/shared/context-source.ts`: Claude Code is available locally and on a host, Codex and Gemini
are local-only, and Grok, OpenCode, and custom agents have no numeric context source yet.

Grok, OpenCode, custom agents, and ephemeral subagents do not currently expose a verified pair of
used tokens and total context units through a local session telemetry contract. Their cards still
show the progress track and an explicit state rather than borrowing another provider's numbers:

| State | Meaning |
| --- | --- |
| `reported` | Both used and total context units were read from the provider's own local telemetry. |
| `stale` | The last valid reading is older than the 45-second freshness window, so its figures remain visible but are marked stale. |
| `unknown` | A supported provider has a session id, but its first valid reading has not arrived. |
| `not reported` | The node has no provider session id yet, so there is no reading to display. |
| `unavailable` | This provider or node type has no verified context-window telemetry path. |

Known values show exact used, total, remaining, and percentage text. The percentage and warning
level use stable thresholds: below 60% is healthy, 60% through 85% is a warning, and above 85%
is critical. The colour is supplementary only, since the text and accessible progress value carry
the state as well.

## Updates and privacy

Transcript readers are rehydrated when a resumed node mounts in both the desktop and Server
Edition shells. Every accepted reading is tagged with a provider and source identity, with cache
keys composed from provider, source, and session, plus a producer epoch and monotonic per-session
generation. Lifecycle ordering uses producer identity and an explicit sequence, never wall-clock
equality or rollback. The renderer compares generations only within the same epoch while accepting a new
producer epoch after restart. It rejects an older generation or timestamp, so a delayed read cannot
overwrite newer usage. The Codex and Gemini locators use shared bounded root indexes with in-flight
deduplication rather than one full tree walk per node. The renderer retains the latest local reading in
its local browser store only. Context values are not part of portable project files, exports,
captures, logs, or provider prompts. Clearing local application data removes the retained display
cache; it does not alter the provider transcript.

Remote source identity includes the remote user, host, and port. The remote reader also compares
the ControlMaster path, transcript path, identity file, extra SSH arguments, and trusted-execution
provenance when retracking, so a reused session id cannot silently attach to another host or file.
Remote reads require a verified byte size before establishing the absolute cursor. Deltas are
base64-capped reads, and an unknown or oversized source is unavailable rather than an unbounded
compatibility read.

Epochs are ordered producer lifecycles (`producerId:lifecycle`), not random per-reading values.
The consumer persists the active producer and bounded retired producer/epoch history. A fresh
producer may start at generation 1 after restart, while an epoch or producer already retired is
rejected even when its wall-clock timestamp is newer. Bare session-id cache records are a legacy
migration shape only and are discarded, never used as a runtime fallback.

The collapsed subagent floor is derived from the actual context strip, header, task line, and
metadata line that are rendered. A card with both task and metadata therefore cannot resize below
the content it displays.

## Accessibility and layout

The top track is a semantic progressbar when values are known and carries an accessible value text
with the exact counts and percentage. Unknown states omit `aria-valuenow` and announce the state
instead. The visible summary remains readable without colour or animation, uses the Material
Design 3 surface and status roles, truncates only through an ellipsis at narrow widths, and keeps
the full figures available from the anchored detail surface. Reduced-motion preferences disable
fill transitions. All app-authored labels and state copy pass through the language and personal
vocabulary boundary; provider names, counts, percentages, and other telemetry facts remain exact.

## Verification notes

This implementation lane intentionally did not run tests, type checking, linting, builds, runtime
interaction, or captures. The next integration lane must verify the three transcript readers,
generation fencing, all five display states, collapsed and grouped node placement, narrow and
high-scale layouts, and the absence of context values from portable project data and exports.

## Suggested articles

- [Agent support](./agent-support.md) - lifecycle hooks, provider capabilities, and recovery states.
- [Node kinds](../canvas/node-kinds.md) - where agent and subagent cards appear.
- [Session continuity](../terminals/session-continuity.md) - resumed sessions and transcript rehydration.
- [Portable project files](../projects/portable-schema3.md) - the boundary that keeps machine-local telemetry out of shared data.
