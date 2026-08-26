# Portable canvas projection

The portable canvas projection is the platform-free `project.json` payload used by schema 3
export and import work. It preserves the project display metadata, root canvas, future Multiverse
and AWS Universe canvas scopes, node presentation, grouping, relationships, and ordering. It does
not open files, start processes, hydrate sessions, or contact a provider.

## Preserved data

The projection contains a stable schema identifier and version, project name, colour and safe icon,
canvas identifiers and scope, node geometry, kind, title, colour, group, collapse state, tags,
safe text and browser tab presentation, service labels, deterministic universe Shop metadata,
bridge and rope relationships, and an
optional bounded global appearance record. Per-element appearance is postponed until its typed
schema exists. Child canvases are represented now so later universe and portal
features can add their own records without changing the root contract. A universe scope is either
`multiverse` or `aws-universe`; the root scope is `root`.

## Excluded data

Working directories, machine and project identities, credentials, account bindings, service
endpoints, local execution settings, process or session state, SSH details, browser profiles and
partitions, capability acknowledgements, breadcrumbs, paths, ports, sockets, process identifiers,
provider caches, and other authority-bearing fields never enter the projection. Imported payloads
reject those fields rather than silently granting authority. Import validation only returns typed
data; archive publication, local bindings, and runtime hydration remain separate operations.

## Determinism and limits

`projectToPortableCanvasV3` selects only safe fields and sorts nodes, child canvases, tags, and
relationships. `serializePortableCanvasProjectionV3` recursively sorts object keys and emits
compact UTF-8 JSON bytes suitable for `project.json`. The validator bounds canvases, nodes,
relationships, nesting, strings, global appearance values, and total JSON bytes. Duplicate node or canvas
identifiers, dangling relationship endpoints, invalid geometry, unsafe keys, invalid scopes, and
malformed UTF-8 are refused. Imported objects use strict allowed-key sets at every level, including
the project, icon, canvas, viewport, node, geometry, browser-tab, relationship, and appearance
records. Canvas parent cycles, duplicate membership, duplicate relationship identifiers, and
out-of-range numeric values are rejected. HTTP and HTTPS URLs are normalized and accepted without
credentials; local-file, executable, credential-bearing, and control-character URLs are refused.
Universe Shop records are repaired after import through `src/core/universe-shop.ts`: each special
child canvas gets exactly one `shop-<canvas-id>` record, while root canvases receive none. The
repair is pure and records missing, duplicate, normalized, and invalid-scope cases without network
or provider side effects. Empty user content, such as a sticky note or browser-tab title, remains valid while required
identifiers and labels stay non-empty. Empty URLs are omitted, and per-element appearance records
are not accepted in this lane.

## Verification status

This implementation lane intentionally did not run tests, type checking, linting, security checks,
builds, packaging, UI interaction, or captures. Export archive writing, atomic import, media,
catalog, Shop creation, portals, provider adapters, and UI remain separate implementation lanes.

## Suggested articles

- [Portable project schema 3](./portable-schema3.md)
- [Project history and archives](./project-history-and-archives.md)
- [Projects and tabs](./projects-and-tabs.md)
