# Calendar nodes

Calendar nodes provide local, ICS, CalDAV, Google Calendar, and Microsoft 365 sources in one
guided canvas node.

## Behaviour

Use Agenda, Week, and Month views with previous, next, and today navigation, explicit IANA timezone
selection, recurrence display, event search, and a shared anchored regex builder. Local and ICS
sources are available immediately. Provider accounts and calendars remain visible but disabled until
a trusted adapter is available, with the exact missing adapter reason shown beside the control.

Create and edit forms validate title, description, all-day state, selected timezone wall time, and
time ranges before enabling save. Delete uses the existing two-key destructive confirmation. Event
selection supports select-all, inverse selection with Shift, copy, bulk delete preview, export, and
cancelable per-item progress. Bulk results distinguish removed, unchanged, cancelled, and failed
records.

The history disclosure lists recorded revisions and filters them with its own anchored regex
builder. Each revision has a restore action that appends a new restored revision rather than
rewriting history. A cache owner lock refuses a second calendar service process, preventing
cross-process read-modify-write races; a dead owner lock is recoverable on the next mutation.

Exports preserve the selected or visible records as JSON, ICS, CSV, or Markdown. ICS keeps all-day
date fields and escapes event text; JSON states that credentials, OAuth state, and source paths were
omitted. Export errors are reported without claiming a file was written.

## Portable and local state

`calendarConfig` stores only provider, opaque account and calendar references, view, timezone,
weekend visibility, and cache preference. Source paths, provider sessions, OAuth state, access and
refresh tokens, host identifiers, and cached events never enter project data or exports.

ICS import is read through the core service, bounded by UTF-8 bytes, event count, field lengths, and
recurrence expansion. It unfolds folded lines, honors `TZID`, and resolves a `VTIMEZONE` component
only when its `X-LIC-LOCATION` names a valid IANA zone; custom VTIMEZONE transition rules are
rejected rather than approximated. IANA wall-clock zones,
all-day exclusive ends, `DURATION`, `RRULE` for bounded DAILY/WEEKLY/MONTHLY forms, `EXDATE`, and
`RDATE`. Repeated wall times choose the earlier instant and nonexistent wall times advance through
the daylight-saving gap. Duplicate UIDs are skipped, while malformed or unsupported events are
reported individually in an import report and valid events remain usable. Cache identity includes
the selected source content, and source switching is generation-fenced by the node configuration.
Read-modify-write cache operations are serialized per node and published with unique temporary
files. Refresh reports an unavailable remote provider without presenting a different source's
records as if they belonged to it.

## Provider security

Remote provider rows are visible but unavailable until a real OAuth PKCE and vault-backed adapter is
installed. No account is treated as connected, no remote calendar is synthesized, and remote CRUD
is rejected by the core. Every mutation carries the validated node configuration and must match the
selected source, so a caller-supplied calendar id cannot redirect a write. CalDAV never accepts an
arbitrary endpoint in project state.

## Offline documentation

This article is bundled into the in-app documentation browser through `src/shared/docs-data.ts`.
Desktop and Server Edition use the same core registration. Relay tabs keep the explicit unsupported
provider state and do not perform provider calls on the viewing machine.

## Verification boundary

Focused source Chuts live in `src/shared/calendar.test.ts` and
`src/core/calendar/service.test.ts`: strict config keys and IANA zones, DST repeated/nonexistent
wall times, wall-time recurrence, duplicate-aware partial ICS import, recurrence and duration,
source-qualified cache reads, mutation source binding, serialized cache updates, local-history
recording and restore wiring, remote-adapter refusal, and corruption-versus-missing read behavior.
The lane did not run general Chuts, builds, packaging, runtime interaction, or captures; those
remain integration evidence rather than being claimed here.

## Suggested articles

- [Node kinds](../canvas/node-kinds.md)
- [Scheduled settings](../../scheduled-settings.md)
- [Local history](../../local-history.md)
- [Bulk actions](../../bulk-actions.md)
