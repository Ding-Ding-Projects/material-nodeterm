# Calendar nodes

Calendar nodes provide local, ICS, CalDAV, Google Calendar, and Microsoft 365 sources in one
guided canvas node.

## Behaviour

Use Agenda, Week, and Month views with previous and next navigation, explicit timezone selection,
recurrence display, event search, and a shared anchored regex builder. Local and ICS sources are
available immediately. Provider accounts and calendars remain disabled until a trusted adapter is
available, with the exact reason shown beside the control.

Create and edit forms validate title and time ranges before enabling save. Delete uses the existing
two-key destructive confirmation. Event selection supports export of selected or visible records,
and local changes have an undo path.

## Portable and local state

`calendarConfig` stores only provider, opaque account and calendar references, view, timezone,
weekend visibility, and cache preference. Source paths, provider sessions, OAuth state, access and
refresh tokens, host identifiers, and cached events never enter project data or exports.

ICS import is read through the core service, bounded by UTF-8 bytes and event count, and cached in
the app's local data directory. Cache identity includes the selected source. Refresh preserves the
last valid cache and reports stale or offline state rather than claiming a provider result.

## Provider security

Remote provider rows are visible but unavailable until a real OAuth PKCE and vault-backed adapter is
installed. No account is treated as connected, no remote calendar is synthesized, and remote CRUD
is rejected by the core. CalDAV never accepts an arbitrary endpoint in project state.

## Offline documentation

This article is bundled into the in-app documentation browser through `src/shared/docs-data.ts`.
Desktop and Server Edition use the same core registration. Relay tabs keep the explicit unsupported
provider state and do not perform provider calls on the viewing machine.

## Verification boundary

The Calendar lane changed `src/shared/calendar.ts`, `src/core/calendar/`,
`src/renderer/nodes/CalendarNode.tsx`, Canvas registration, the preload and WebSocket bridges, and
the node persistence tables. Tests, builds, packaging, runtime interaction, and captures were not
run in the ultra-speed lane.

## Suggested articles

- [Node kinds](../canvas/node-kinds.md)
- [Scheduled settings](../../scheduled-settings.md)
- [Local history](../../local-history.md)
- [Bulk actions](../../bulk-actions.md)
