# Planner occurrence service

The planner keeps schedules in the host process, so a closed nodeterm window does not stop a
reminder while the computer remains available. It is a local notification service, not a powered-off
wake mechanism: if the computer is shut down or asleep beyond the host's ability to run, overdue
occurrences are recorded as missed when the service starts again.

## Behaviour

Settings → Planner provides a guided schedule editor with native date/time controls, a populated
IANA timezone picker, recurrence choices (once, daily, weekdays, selected weekdays, and bounded
intervals), an optional end time, and notification copy. The list has its own plain-text search and
an adjacent anchored regex builder. Every save is validated again in the host process. Failed saves
reload the durable host state and expose an explicit retry action. Schedule deletion uses the
two-key destructive confirmation surface before removing the selected definition.

The host stores schedules and redacted occurrence history in `planner-schedules.json` under its
application-data directory. A bounded background sweep evaluates due occurrences, deduplicates by
schedule id and scheduled instant, durably records the result, and only then emits a non-blocking
event. The Desktop shell shows an OS
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

The service starts with both Desktop and Server Edition boot, before any UI is attached. Closing the
last browser tab or the Desktop title-bar window keeps the host alive while enabled schedules exist,
so evaluation continues without an attached UI. On Windows this is the only title-bar-close
background-host exception; without an enabled schedule, the same close enters the complete bounded
application shutdown path and releases every auxiliary window and application-owned process.
Explicit application quit still stops the service.
On Windows and Linux, that retained host continues to own the application's single-instance lock.
A later launch is delivered to the retained host, which creates a replacement main window when the
tracked main window is absent. Helper windows such as the Notch HUD and canvas widgets do not count
as the main window and cannot block recreation. A launch request that arrives before desktop startup
has created its first window is queued until the initial window is ready.
Each sweep advances a durable last-tick
marker. A due instant older than two minutes is recorded as `missed`; a current due instant is
`fired` and is delivered to the notification seams. A clock moving backwards advances the marker to
the new time without replaying future entries. The bounded history keeps the newest 2,000 records.

The service stops during both shell shutdown paths. It never claims to wake a powered-off computer,
launch a process, or perform a network action. Alarm and timer nodes can consume the same typed
occurrence event through `IPC.plannerOccurrence`; their own action is deliberately outside this
lane.

## Storage, export, and recovery

The JSON file is written atomically with owner-only permissions. Host updates are ordered through a
single store queue. A UI save replaces only user-authored schedule definitions, so a stale renderer
snapshot cannot erase host-owned occurrence history or the last evaluation marker. Corrupt or
unreadable data leaves the original evidence untouched, starts with a disabled in-memory fallback,
and refuses saves until
the file is repaired and the host is restarted. JSON and CSV exports contain schedule occurrence
metadata and state, never credentials, private paths, process state, or host identifiers.

## Portable planner definitions

Schema 3 project export carries a bounded `planner` definition containing only the user's schedule
definitions. Occurrence history, the last evaluation marker, application-data locations, process
state, credentials, provider sessions, and machine paths remain local and are listed in the archive
omissions. The definition is validated again while the projection is written and while it is read;
unknown fields and invalid recurrence, timezone, notification, and size values are rejected.

Import stages the project without contacting a provider, starting a schedule, launching a process,
or emitting an occurrence notification. When imported planner definitions are present, the completed
open notification exposes an explicit **Configure imported planner schedules** action. That action
is the destination Configure route: it sends the validated definitions back through the host-owned
planner service, merges them with existing destination schedules without overwriting a conflicting
definition, and reports the result in the notification centre. Cancelling or ignoring the action
leaves the destination schedules unchanged, so import itself has no external side effect.

## Surface boundaries

| Surface | Availability |
| --- | --- |
| Desktop | Full host-owned scheduler, OS notification fallback, IPC event stream, settings editor. |
| Server Edition | Full host-owned scheduler, WS-RPC event stream, browser notification stream. A headless server records occurrences but has no desktop notification provider. |
| Mobile companion | Not part of this lane. It may consume a later approved event bridge, but it cannot be treated as a scheduler or powered-off wake target. |

## Verification status

Focused lifecycle coverage in `src/main/main-window.test.ts` passes 22 tests, including the
enabled-Planner retained-host path, an unrelated surviving helper window, queued pre-ready
activation, and existing-window restore/show/focus. A focused `tsc` compile of
`src/main/main-window.ts` passes, and `npm run build` completes the main, preload, renderer, and
session-host outputs. The full repository type check is still red in unrelated repository-graph
and VeraCrypt source that predates this repair. The implementation paths are
`src/main/main-window.ts`, `src/main/index.ts`, `src/shared/planner-occurrences.ts`,
`src/core/planner-occurrence-service.ts`, `src/core/portable-planner.ts`,
`src/core/portable-canvas-projection.ts`, `src/core/project-archive.ts`,
`src/preload/index.ts`, `src/renderer/bridge/ws-bridge.ts`, and
`src/renderer/components/settings/sections/PlannerSection.tsx`.
The offline documentation bundle is regenerated from this article by
`node scripts/build-docs-bundle.mjs`. Real built-application close, process disappearance, and
immediate relaunch interaction remains unverified because the approved hidden-desktop endpoint was
unavailable during issue #215 repair. No visible-desktop substitute was used.

## Suggested articles

- [Scheduled settings](../../../scheduled-settings.md) for the existing timezone-aware settings evaluator.
- [Notifications](../../../notifications.md) for the non-blocking notification centre.
- [Local history](../../../local-history.md) for the app's broader settings history contract.
- [Server Edition](../../../SERVER.md) for headless host lifecycle and browser transport.
