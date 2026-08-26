# Planner occurrence service

The planner keeps schedules in the host process, so a closed nodeterm window does not stop a
reminder while the computer remains available. It is a local notification service, not a powered-off
wake mechanism: if the computer is shut down or asleep beyond the host's ability to run, overdue
occurrences are recorded as missed when the service starts again.

## Behaviour

Settings → Planner provides a guided schedule editor with native date/time controls, a populated
IANA timezone picker, recurrence choices (once, daily, weekdays, selected weekdays, and bounded
intervals), an optional end time, and notification copy. The list has its own plain-text search and
an adjacent anchored regex builder. Every save is validated again in the host process.

The host stores schedules and redacted occurrence history in `planner-schedules.json` under its
application-data directory. A bounded background sweep evaluates due occurrences, deduplicates by
schedule id and scheduled instant, and emits a non-blocking event. The Desktop shell shows an OS
notification when no focused window is available. Attached UIs receive the same event over IPC or
Server Edition WS-RPC and place it in the reviewable notification stream.

## Recurrence, timezone, and DST

Each schedule has one IANA timezone and a local wall-clock start. Repeated daylight-saving times
fire once at the earliest instant. A nonexistent spring-forward wall-clock time moves forward to the
first valid local minute, bounded to three hours. Date-based recurrences use the calendar in the
selected timezone. Interval recurrences use a fixed elapsed interval from the first resolved local
instant, which avoids silently changing an interval at a DST boundary.

An optional end time documents a planning window. When it is earlier than the start time, the window
crosses midnight into the next calendar date. The occurrence remains anchored to its start date, so
Friday at 22:00 through Saturday at 06:00 is a Friday occurrence. The editor displays this fact
before saving.

## Missed occurrences and lifecycle

The service starts with both Desktop and Server Edition boot, before any UI is attached. Closing a
window or browser tab therefore does not stop evaluation. Each sweep advances a durable last-tick
marker. A due instant older than two minutes is recorded as `missed`; a current due instant is
`fired` and is delivered to the notification seams. A clock moving backwards advances the marker to
the new time without replaying future entries. The bounded history keeps the newest 2,000 records.

The service stops during both shell shutdown paths. It never claims to wake a powered-off computer,
launch a process, or perform a network action. Alarm and timer nodes can consume the same typed
occurrence event through `IPC.plannerOccurrence`; their own action is deliberately outside this
lane.

## Storage, export, and recovery

The JSON file is written atomically with owner-only permissions. Corrupt or unreadable data leaves
the original evidence untouched, starts with a disabled in-memory fallback, and refuses saves until
the file is repaired and the host is restarted. JSON and CSV exports contain schedule occurrence
metadata and state, never credentials, private paths, process state, or host identifiers.

Import is not part of this service. A future portable project importer must carry safe planner intent
only and require an explicit local configure or rebind action; it must not start schedules or emit
notifications while importing.

## Surface boundaries

| Surface | Availability |
| --- | --- |
| Desktop | Full host-owned scheduler, OS notification fallback, IPC event stream, settings editor. |
| Server Edition | Full host-owned scheduler, WS-RPC event stream, browser notification stream. A headless server records occurrences but has no desktop notification provider. |
| Mobile companion | Not part of this lane. It may consume a later approved event bridge, but it cannot be treated as a scheduler or powered-off wake target. |

## Verification status

This ultra-speed lane did not run tests, type checks, lint, security checks, builds, packaging,
installer execution, runtime interaction, or screenshots. Those checks remain required before a release
claim. The implementation paths are `src/shared/planner-occurrences.ts`,
`src/core/planner-occurrence-service.ts`, `src/preload/index.ts`,
`src/renderer/bridge/ws-bridge.ts`, and `src/renderer/components/settings/sections/PlannerSection.tsx`.

## Suggested articles

- [Scheduled settings](../../../scheduled-settings.md) for the existing timezone-aware settings evaluator.
- [Notifications](../../../notifications.md) for the non-blocking notification centre.
- [Local history](../../../local-history.md) for the app's broader settings history contract.
- [Server Edition](../../../SERVER.md) for headless host lifecycle and browser transport.
