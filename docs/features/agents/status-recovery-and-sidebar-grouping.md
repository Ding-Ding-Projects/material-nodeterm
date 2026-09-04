# Agent status recovery and sidebar workflow grouping

**Category:** [Agents](./README.md)

The agent status mirror keeps a display-only last-known state across an application restart. The
sessions sidebar can also regroup sessions by workflow state, so work that needs attention is easy
to find without changing the project order or the canvas grouping.

## Behaviour

Live hook events remain the operational source of truth. On startup, the core exposes a snapshot of
the last-known state for each surviving node, then independently inspects supported local evidence:
Claude and Gemini transcript tails, or the Codex app-server thread status. A newer observation may
update the display state. Restored values are labelled as last known and never trigger notifications,
message delivery, hibernation, process control, or any other action.

The sidebar keeps Project grouping as its default. Status grouping flattens terminal sessions into
four workflow sections: Waiting for your response, Done, Unknown, and Running. Unread remains a
row-level notification indicator, so a finished unread session stays under Done and an unknown
unread session stays under Unknown. Rows include the owning project and the relative age of the
state when that evidence is available.

## Configuration and persistence

Use the Project and Status tabs at the top of the sessions sidebar. The choice is stored in the
global settings record as `sidebarGrouping`, and the existing project and canvas-group disclosure
choices remain persisted in `sidebarCollapsedItems`. Filtering applies to the same session search
field in either view. A status section is always expanded because collapsing it could hide a
workflow state the user deliberately selected.

The core mirror stores the display ledger as `lastKnown` in the local `agent-status.json` file. The
ledger is lifecycle-bound and is removed when its node is permanently removed. Existing mirror
files without the new field are migrated from their live node entries on the next read, while the
short-lived operational table keeps its existing freshness expiry.

## Failure modes and recovery

An unreadable transcript, unavailable app-server socket, malformed record, unsupported agent, or
remote session produces no recovery evidence. The row remains Unknown or retains its previous
display-only value. A failed read is never treated as proof that the agent is finished. A live hook
event arriving while recovery is in progress wins the race and clears the restored marker.

Remote project nodes are excluded from local transcript inspection because their evidence belongs on
the host that runs the session. Importantly, this feature only reads local evidence. It does not
launch a process, deploy anything, send a provider request, or alter an agent session.

## Security considerations

The display snapshot contains state, node identity, session identity, name, and a transition time,
but no credentials, tokens, approval tickets, or transcript contents. Operational verification is
not serialized into the snapshot. Recovery is best effort and display-only by design, so an old
`done` value cannot authorize a message delivery or an automatic action.

## Verification notes

The focused implementation files are `src/core/agent-status-recovery.ts`,
`src/core/agent-status-handlers.ts`, `src/core/agent-status-mirror.ts`,
`src/shared/agents/status-snapshot.ts`, `src/renderer/state/agentStatus.ts`,
`src/renderer/lib/sessionList.ts`, and `src/renderer/components/SessionsSidebar.tsx`.

This lane intentionally did not run tests, type checking, builds, packaging, runtime interaction,
accessibility checks, or captures. Those checks remain required before release evidence can call the
feature verified.

## Suggested articles

- [Agent support](./agent-support.md) — hook-driven lifecycle states and agent capabilities.
- [Session continuity](../terminals/session-continuity.md) — persistent terminal and CLI relaunch.
- [Projects and tabs](../projects/projects-and-tabs.md) — project order and disclosure persistence.
