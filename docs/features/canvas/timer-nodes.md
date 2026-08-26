# Timer nodes

Timer nodes are persistent canvas tools for countdowns, stopwatches, and repeatable work/rest sequences.

## Behaviour

Create **Timer** from the add-node menu, the canvas context menu, or the command palette. Countdown and interval modes count down from a bounded duration. Stopwatch mode counts upward. Every mode supports pause, resume, reset, and a non-blocking completion alarm. Stopwatch mode also records laps. Interval nodes keep an editable ordered sequence of work and rest steps and expose repeat counts.

Occurrence records use stable identifiers and retain scheduled, running, paused, completed, and missed states. The occurrence service persists records through the host store, reconciles overdue entries as missed, and consumes alarms once so a restart cannot replay an old notification.

## Configuration and export

Duration is bounded to one second through seven days. Repeat count is bounded and zero means no extra repetitions. Alarm tone may be chime, bell, or silent. Timer records export as versioned JSON, including occurrence state and lap values, through the normal canvas export route.

## Failure modes and security

Malformed persisted occurrence records are ignored rather than treated as valid schedules. Clock movement never creates negative elapsed time. Alarms are informational, corner-anchored notifications and never block the canvas. Timer data contains no credentials, host addresses, or network settings.

## Verification

The built-artifact verification owed for this lane covers creating each mode, editing duration and sequence, pause/resume, laps, repeat and missed states, restart persistence, one-shot alarms, keyboard focus, screen-reader output, narrow layouts, and JSON export. This implementation lane intentionally did not run tests, builds, or captures.

## Suggested articles

- [Canvas node kinds](./node-kinds.md)
- [Notifications](../../notifications.md)
- [Local version history](../../local-history.md)
