# Portable project binding wizard

Schema 3 project files carry safe intent, not a destination computer's authority. A portable
node blueprint may describe its feature, display label, requested capabilities, safe settings,
relationships, and content-addressed asset references. Credentials, provider sessions, process
state, host identity, absolute paths, executable values, caches, and local resource handles stay
in the destination's private application data.

## Import and staging

The schema 3 reader validates the complete archive before writing anything. It checks archive
framing, relative paths, duplicate and case-colliding entries, per-entry and aggregate byte
limits, manifest sizes, and the SHA-256 value recorded for every payload entry. A project snapshot
is validated as a strict canvas projection. Legacy project shapes are migrated in memory and
validated again; migration drops machine-local and credential-shaped fields rather than copying
them into the new projection.

When a destination is supplied, import writes a private staging directory beside it and publishes
the finished directory with one atomic rename. An existing destination is a collision, including
an empty directory, and is never cleared or overwritten. Cancellation before publication removes
only the import-owned staging directory. A failed import leaves the previous destination and
existing bindings unchanged.

Import has no network, provider, deployment, process-launch, download, or binding side effect. It
returns the project with an empty binding state and an omission report. The destination user must
choose a local route explicitly.

## Guided destination routes

The anchored binding wizard lists every route with its current availability and disabled reason:

- **Configure** creates a new local binding from a verified provider or host selection.
- **Rebind** changes an existing binding to a verified local resource.
- **Adopt** claims a matching existing resource after identity and ownership checks.
- **Deploy** remains visible but disabled until a provider-specific deployment flow is available.
- **Locate Asset** appears for unresolved portable assets and accepts a local file selection.
- **Leave Unbound** keeps the imported project usable without local integration.

The wizard uses plain-text search by default and an adjacent anchored full regex builder. It is
keyboard-operable, announces disabled reasons, reports progress, supports cancellation, and keeps
informational state non-blocking. Configure, Rebind, and Adopt use the shared provider service.
Connected accounts and verified resources are separate searchable pickers, each with its own
adjacent anchored regex builder. The binding stores only opaque account/resource references and
credential key names. Credential values, OAuth state, provider sessions, and callback payloads
never cross the renderer boundary.

The local binding store is `portable-node-bindings.json` under the application-data directory and
is written atomically. It is versioned and validates every key before use. Explicit action failure
restores the prior snapshot. The portable project file is never modified by a binding action.

## Desktop and Server Edition

Both shells register the same core provider and local-binding services against their own private
application-data directory. Desktop seals provider credentials through the operating-system vault.
Server Edition uses the established owner-only file fallback on the server host. A browser binds
the server's resources, never the viewing computer's resources. Both import paths leave the project
unbound until the user explicitly chooses a route.

## Verification status

This implementation lane intentionally did not run tests, type checking, linting, security checks,
builds, packaging, installer execution, runtime interaction, or captures. The generated offline
documentation bundle also needs regeneration in the next verification lane.

## Suggested articles

- [Portable project schema 3](./portable-schema3.md)
- [Portable canvas projection](./portable-canvas-projection.md)
- [Project history and archives](./project-history-and-archives.md)
- [Projects and tabs](./projects-and-tabs.md)
