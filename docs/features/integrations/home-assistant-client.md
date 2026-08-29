# Home Assistant multi-instance client

Status: implemented in the core service client and exposed through both the desktop and Server
Edition shells. The Home Assistant service node can manage several independently configured
instances on the local machine, read their registries, and subscribe to state changes.

## Behaviour

The Home Assistant panel starts with a truthful empty state. A person supplies a label, a base URL,
and a long-lived access token through the guided form. After the first successful connection, the
panel shows the configured instances, connection state, registry counts, and separate searchable
entity, service, device, and area lists. Each list owns its own plain-text-first search and anchored
regex builder. Selecting an entity binds it to the current canvas node. A binding is local machine
state and does not become part of the portable project projection. Existing instances can be edited,
removed, disconnected, and have their access token replaced or cleared from this surface.

Each enabled instance uses the documented REST endpoints for state and entity registries, services,
devices, and areas.
It also opens `/api/websocket`, authenticates, subscribes to `state_changed`, and updates the entity
list when an event arrives. Refresh and disconnect are explicit actions. An instance that is offline,
disabled, unauthorized, invalid, or reconnecting keeps that state visible instead of becoming an
empty list.

## Configuration and persistence

Machine-local instance records and bindings are stored in `home-assistant.json` inside the
application data directory. The file contains labels, validated endpoint URLs, enabled state,
stable ids, and binding metadata only. Tokens are stored separately in
`home-assistant-secrets.json` through the existing sealed-secret store. On a desktop with an
operating-system credential vault, the token payload is sealed before persistence. The headless
Server Edition uses its documented owner-only local fallback when no vault is available.

There is no token getter in the renderer API. The write-only token method accepts a replacement or
clear request, and token status returns only a boolean per instance. Removing an instance clears its
binding records and its stored credential record.

## Endpoint safety

Only HTTPS endpoints are accepted for real Home Assistant installations. Plain HTTP is allowed for
`localhost`, `127.0.0.1`, or `::1` as an explicitly bounded development route. URLs with userinfo,
unsupported schemes, fragments, or control characters are rejected before any request. Requests
use manual redirect handling, a bounded response body, an eight-second deadline, and static error
messages that never echo response content or an access token. The configured URL has no query or fragment,
and its hostname is resolved before REST or WebSocket access. Link-local and cloud metadata
addresses are rejected; private network addresses remain possible only through the explicitly
entered endpoint and are never reached through a redirect.

## Reconnect and stale-response handling

Every instance owns a monotonically increasing generation. Updating an endpoint, disabling an
instance, changing its token, disconnecting, or removing it invalidates the previous generation and
closes its socket. A REST response or WebSocket event from an older generation is ignored. Failed
connections retry with bounded exponential backoff while the instance remains enabled. A successful
REST refresh is retained while a later reconnect attempt is reported as reconnecting or failed.
The client does not report a live connection until Home Assistant acknowledges the
`subscribe_events` request. HTTP 401/403 and WebSocket `auth_invalid` enter `auth-error` and stop
automatic retries until the access token is replaced. Replacing the access token clears the old
snapshot and starts a fresh connection generation; clearing the access token leaves the instance unconfigured.

## Registry limits and failure modes

Response bodies are bounded to 8 MiB and WebSocket frames to 512 KiB. The client caps entities at
20,000, devices at 10,000, areas at 2,000, and services at 2,000. Entity attributes, service fields,
metadata strings, and event payload growth are bounded and parsed into null-prototype records.
Malformed or oversized registries are rejected as an error rather than partially applied. The panel
distinguishes no configured instance, disabled instance, missing access token, invalid endpoint,
rejected access token, timeout, HTTP error, stale snapshot, and a live reconnect. Entity removal events with
`new_state: null` remove only that entity. A socket close preserves the latest valid snapshot while
the status is stale or reconnecting; changing the instance endpoint or access token explicitly clears it.

## Accessibility and search

The panel uses real buttons, password and text fields, visible focus, live status announcements,
and bounded scrolling lists. Entity, service, device, and area searches are plain text by default
and each has its own adjacent anchored full regex builder. A builder is bound to one list only, so
its pattern and flags cannot leak into another search surface. Empty results name the no-match
condition. New user-authored labels remain localizable through the app's existing copy boundary;
provider ids, units, state values and access tokens remain exact facts.

## Portable project boundary

Portable schema 3 keeps the node kind, display label, layout, relationships, and safe intent. It
does not include Home Assistant URLs, tokens, binding records, registry caches, connection state,
or machine identity. Reopening a project on another computer leaves the service node unbound until
the person chooses Configure, Rebind, Adopt, or Leave Unbound in the local panel.

## Verification status

This implementation lane was intentionally delivered without tests, type checks, builds, runtime
interaction, or screen captures. Those checks remain required before a release claims a verified
Home Assistant integration. In particular, release verification still needs an isolated local
instance or fixture that exercises REST discovery, WebSocket reconnect, credential rejection,
generation cancellation, and both Desktop and Server Edition boundaries.

## Suggested articles

- [Service nodes](service-nodes.md)
- [Scheduled settings](../../scheduled-settings.md)
- [Portable project files](../../protected-project-files.md)
- [Server Edition](../../SERVER.md)
