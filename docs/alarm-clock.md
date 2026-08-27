# Alarm Clock nodes

Alarm Clock nodes let a canvas carry a one-shot or recurring reminder. A reminder stores the
wall-clock intent, IANA timezone, recurrence rule, snooze preference, and occurrence history in the
project projection. Credentials, host paths, process state, and notification handles are never part
of that shared data.

## Creating and configuring a node

Choose **New Alarm Clock** from the canvas add menu, the empty-canvas menu, or the command palette.
The node starts paused with today's date, 09:00, and the computer's detected timezone. The guided
form provides one-shot, daily, weekday, weekly, and monthly recurrence choices, a native date/time
picker, a timezone picker, weekday selection, day-of-month selection, snooze minutes, sound, and
narrator controls. The Start button stays unavailable until the selected values are valid. The node
also includes local plain-text history search and an adjacent regex builder for deliberate regular
expression filtering.

Recurring alarms are evaluated as local wall-clock values, not by adding 24 hours to an epoch. This
means a 09:00 alarm remains at 09:00 across daylight-saving changes. A repeated fall-back time uses
the earlier instant; a skipped spring-forward time uses the first valid instant after the gap. The
selected timezone is displayed on the node so an imported project does not silently use a different
zone.

## Delivery and recovery

When the app is running, the planner records the occurrence and raises a non-blocking notification.
The notification offers Snooze and Dismiss actions. Snoozed occurrences return to the due state at
the requested interval. An occurrence observed more than one minute late is recorded as `missed` and
stays in history instead of being presented as a punctual alert. History is bounded to the newest
1,000 records.

Sound uses the existing notification sound setting and the narrator uses the existing serialized
English, Cantonese, or bilingual narrator queue. The node's two toggles are additional per-alarm
choices, so turning either one off does not change the app-wide preference.

The host owns a file-backed planner lifecycle in both the desktop and Server Edition processes. The
desktop node mirrors each validated schedule into that local planner, receives bounded due events,
and sends Snooze and Dismiss transitions back through the host bridge. The planner persists its
local snapshot after every mutation and stays alive after the renderer closes. It does not claim to
wake a powered-off computer. If the app or computer is off when an occurrence passes, the next
launch records the late occurrence as missed when it is outside the grace window. There is no
arbitrary shell command, remote wake request, or network service in this feature.

## Portability and privacy

Alarm intent and redacted occurrence history are safe project data. Importing or opening a project
does not send a network request, launch a process, deploy anything, or emit a notification. A new
computer recalculates the next occurrence from the stored wall-clock values and the user's explicit
timezone choice. Runtime notification handles and local service state stay outside the portable
projection.

## Verification boundary

The shared planner, file-backed host lifecycle, bridge, and canvas node are implemented in
`src/shared/alarm-clock.ts`, `src/core/alarm-planner.ts`, `src/preload/index.ts`, and
`src/renderer/nodes/AlarmClockNode.tsx`. The portable schema projection carries only the safe alarm
fields. Sound and narration call the existing `src/renderer/lib/sfx.ts` and
`src/renderer/lib/narrator.ts` seams. This lane's ultra-speed delivery boundary intentionally did
not run tests, type checks, lint, reviews, security checks, accessibility checks, installer
execution, runtime interaction checks, or UI captures. Build and package evidence, when supplied by
the delivery owner, proves artifact production only.

Suggested articles: [Scheduled settings](scheduled-settings.md), [Notifications](notifications.md),
[Narrator](narrator.md), [Language modes](language-modes.md), and [Local history](local-history.md).
