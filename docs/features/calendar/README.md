# Calendar nodes

Calendar nodes provide local, ICS, CalDAV, Google Calendar, and Microsoft 365 sources in one
guided canvas node.

## Behaviour

Use Agenda, Week, and Month views with previous and next navigation, explicit timezone selection,
recurrence display, event search, and a shared anchored regex builder. Local and ICS sources are
available immediately. CalDAV accounts use a guided HTTPS endpoint form. Google and Microsoft 365
use provider consent through a loopback PKCE callback when this computer has the corresponding
public OAuth client registration. Account and calendar pickers expose only real provider results.

Create and edit forms validate title and time ranges before enabling save. Delete uses the existing
two-key destructive confirmation. Event selection supports export of selected or visible records,
and local changes have an undo path.

## Portable and local state

`calendarConfig` stores only provider, opaque account and calendar references, view, timezone,
weekend visibility, and cache preference. Source paths, provider sessions, OAuth state, access and
refresh tokens, host identifiers, and cached events never enter project data or exports.

ICS import is read through the core service, bounded by UTF-8 bytes and event count, and cached in
the app's local data directory. Remote refresh is bounded by response bytes, page count, event
count, request timeout, provider host allowlists, and HTTPS. Cache identity includes the selected
source and account, plus provider revision or ETag validators, completeness, partial-result state,
and exponential retry timing. Refresh preserves the last valid cache and reports stale or offline
state rather than claiming a provider result.

## Provider security

Provider credentials are held by the machine-local calendar credential vault. Desktop seals them
through the shell's encryption hooks; a headless Server Edition installation uses a restricted local
file and reports that storage boundary. Google and Microsoft refresh tokens are exchanged only at
fixed provider hosts. CalDAV endpoints must use HTTPS, cannot embed credentials, and never enter
project state. A failed account lookup, credential read, provider response, validator, or write is
reported as a failure and never converted into an empty connected account or a confirmed mutation.

Google and Microsoft public client registrations live in
`<application-data>/calendar-oauth-clients.json`, a machine-local versioned file containing only
the provider client id and optional Microsoft tenant. OAuth verifier, state, authorization code,
access token, refresh token, CalDAV username, and CalDAV password are never written there.

## Offline documentation

This article is bundled into the in-app documentation browser through `src/shared/docs-data.ts`.
Desktop and Server Edition use the same core registration. Provider network calls execute on the
host that owns the application-data directory. Relay tabs keep calendar provider calls unavailable
on the viewing machine.

## Verification boundary

The provider continuation changed `src/shared/calendar.ts`, `src/core/calendar/`,
`src/renderer/nodes/CalendarNode.tsx`, and the preload and WebSocket bridges. Tests, type checking,
lint, builds, packaging, installer execution, runtime interaction, accessibility and security
reviews, audits, and captures were not run in this ultra-speed continuation.

## Suggested articles

- [Node kinds](../canvas/node-kinds.md)
- [Scheduled settings](../../scheduled-settings.md)
- [Local history](../../local-history.md)
- [Bulk actions](../../bulk-actions.md)
