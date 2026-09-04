# Planner, alarm, and timer occurrences

The desktop and Server Edition share one host-owned occurrence service. Renderers receive a
projection over the typed bridge; they do not evaluate schedules, claim notifications, or advance
timer clocks locally. This keeps a closed canvas, a second browser client, and a renderer reload
from creating duplicate delivery or losing a scheduled item.

## Durable contract

`src/shared/durable-occurrences.ts` defines version 1. Schedules and alarm nodes use IANA timezone
identifiers and an immutable `YYYY-MM-DDTHH:mm` local wall representation. The validator rejects
unknown keys, malformed dates, invalid timezones, duplicate ids, oversized text, excessive history,
and invalid timer data. Writes are serialized by the host and carry a generation compare-and-swap,
then use unique temporary files and retrying atomic publication.

An occurrence is recorded as intent before notification. The host persists a claim with a stable
idempotency key, invokes the single delivery owner, and persists the outcome. A claimed record whose
owner stopped before recording its outcome is retried only after its bounded claim lease expires.
With no connected Server Edition client, the outcome remains pending and is drained when a client
returns. Sound and narration preferences travel as intent; the client applies its global sound,
quiet-hours, School-mode, language, and narration policies without changing occurrence history.

## Time and recovery

Repeated fall-back wall times use the earliest instant. Nonexistent spring-forward wall times move
forward to the first valid local minute. Catch-up is bounded. When more occurrences exist than the
host cap, an explicit `catch-up-truncated` reconciliation record is retained instead of silently
advancing. Backward wall-clock movement is recorded as `clock-adjusted`; a powered-off machine is
not claimed to wake itself and records `power-off-not-supported` when the monotonic gap is observed.

Timers use host monotonic time for elapsed and remaining values, so sleep or a wall-clock change
cannot make a countdown run backward. Pause clears both anchors, resume creates fresh anchors, and
completion creates one tone-bearing occurrence. Laps, reset, cancel, repeat counts, and sequence
state are persisted in the canonical `timerData` field. Deleting the canvas projection does not
delete occurrence history until the user performs the normal confirmed history action.

## Export, history, and surfaces

Schedule export contains the complete validated schedule, alarm, timer intent, and occurrence
history. Import validates the complete byte payload before replacing intent and history and never partially applies it. Every mutation,
claim, outcome, reconciliation, timer transition, and restore is sent to the app's local history
recorder as redacted JSON metadata. No credential, source path, or private vocabulary data enters
the snapshot, export, history, or bridge payload.

The Planner and Alarm canvas cards are projections of the same host state. Desktop uses Electron IPC;
Server Edition uses its WebSocket RPC bridge; relay clients use the explicitly reviewed host route.
The service is started and stopped by both shells, and shutdown awaits its final flush. The built
artifact still needs the project's full runtime interaction and visual evidence pass; this lane
only proves source contracts.

Suggested articles: [Canvas and node lifecycle](../canvas/canvas-and-lifecycle.md), [Local history](../../local-history.md), and [Scheduled settings](../../scheduled-settings.md).
