# Proxy and isolated debugging browser sessions

**Category:** [Remote & SSH](./README.md)

This feature provides a deliberately separate browser session for local debugging. A debugging
session has its own persistent or disposable profile partition, an explicitly chosen proxy, and a
certificate policy. It never silently reuses the ordinary browser session when its local binding
is missing or invalid.

## Behaviour

The guided session picker requires a named profile, an HTTP or SOCKS5 proxy choice (or an explicit
direct connection), a certificate policy, a session lifetime, and an HTTP or HTTPS target. Proxy
and profile lists are searchable with plain text by default. Each list has its own adjacent full
regular-expression builder, so a proxy filter cannot modify a profile filter.

Starting a session creates a dedicated partition derived from the project identity and debugging
profile id. The host applies the proxy and certificate policy before navigating to the target and
keeps the debugging protocol endpoint on the local machine. A session reports starting, running,
stopping, stopped, recovery, and error states with bounded redacted diagnostics and progress.

## Portable intent

Schema 3 project data carries only safe intent:

| Shared field | Meaning |
| --- | --- |
| Profile id and label | Which named debugging profile the user selected. |
| Proxy kind, host, port, bypass list | The connection shape, without a secret. |
| Certificate policy | System validation, reject invalid certificates, or a custom local certificate choice. |
| Isolation and target URL | Whether the profile is disposable or persistent and where it should open. |

Credentials, certificate paths, browser executable paths, application-data paths, process handles,
debugging ports, caches, cookies, storage, provider sessions, and diagnostic response bodies remain
on the local host. Import only stages this intent. It does not make a network request, start a
browser, deploy a proxy, mutate a provider, or download a certificate. After import, the user
must choose **Configure**, **Rebind**, **Locate certificate**, **Adopt**, or **Leave unbound** as
appropriate for the destination computer.

## Local bindings and recovery

The trusted host resolves a proxy credential by a vault reference and never sends the credential to
the renderer. A custom certificate is selected through the host's file picker and is never copied
into the project. A missing browser executable, missing proxy credential, or missing custom
certificate leaves the session in a recovery state with a specific next action. The recovery state
does not open the ordinary browser, use the default proxy, trust invalid certificates, or guess a
different executable.

Stopping a session is owned by the session manager that created it. Releasing its owner stops every
session owned by that owner, while application shutdown stops all remaining sessions. A failed stop
is retained as recovery until shutdown is independently confirmed, preventing a stale process from
being mistaken for a stopped session.

## Security considerations

- Proxy credentials are stored and resolved only by the operating-system credential service. They
  never appear in project files, renderer state, command arguments, logs, exports, history, or
  diagnostics.
- Certificate paths and browser executable paths are machine-local bindings. Shared project data
  cannot select a file or executable on another computer.
- Target URLs must be HTTP or HTTPS without embedded credentials or fragments. Invalid URLs and
  incomplete proxy records are rejected before a session is created.
- Debugging sessions use a partition prefix distinct from ordinary browser profiles. A debugging
  session therefore cannot inherit ordinary cookies or local storage by accident.
- Diagnostics are capped and redact local-only values. The host does not expose response bodies,
  filesystem paths, process identifiers, or debugging endpoint details through the portable model.

## Availability by surface

| Surface | Availability |
| --- | --- |
| Desktop | Host-owned isolated browser lifecycle, proxy configuration, certificate policy, and local debugging endpoint. |
| Server Edition | Safe portable intent and an explicit unbound/recovery state until a host-side browser manager is available. It does not point a browser at the server's loopback address by assumption. |
| Mobile companion | Portable profile and proxy intent can be viewed, but the companion does not create a local debugging process or receive local credentials. |

## Verification boundary

The ultra-speed implementation lane intentionally did not run tests, type checks, lint, reviews,
security checks, accessibility checks, builds, packaging, installer execution, runtime interaction,
or UI captures. Build and packaging evidence, when produced by the release owner, proves artifact
production only and does not prove runtime correctness. The implementation paths are
`src/shared/browser-debug-sessions.ts`, `src/main/browser-debug-session.ts`,
`src/renderer/nodes/BrowserDebugSessionPicker.tsx`, `src/shared/types.ts`,
`src/core/workspace-files.ts`, and `src/core/portable-canvas-projection.ts`.

## Suggested articles

- [Node kinds](../canvas/node-kinds.md) for ordinary browser nodes and their profile partitions.
- [Browser partition probe](../../superpowers/probes/2026-08-browser-partition.md) for the measured
  session-isolation behavior.
- [Server Edition](./server-edition.md) for the browser-hosted surface and its host boundary.
- [Local history](../local-history.md) for redacted local mutation records.
