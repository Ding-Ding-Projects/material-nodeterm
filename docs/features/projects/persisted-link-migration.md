# Persisted link migration

The project file now has one persisted link collection, `links`, for the relationships owned by a
project. This article covers the bounded compatibility migration for projects written before that
collection existed.

## What migrates

On a project-file read, `migrateLinks` in `src/core/workspace-files.ts` lifts the legacy arrays into
the typed link shape:

| Legacy record | New record | Preserved details |
| --- | --- | --- |
| `bridges[]` | `kind: "context"` | `id`, source node id, and target node id |
| `ropes[]` | `kind: "lineage"` | `id`, source node id, target node id, and `meta.displayOnly: true` |

Both migrated endpoints are local node references. The migration does not resolve, create, or
delete nodes. In particular, the display-only meaning of a rope remains explicit, so a lineage
record cannot accidentally become a context relationship.

## Persistence and idempotence

`projectToFile` writes `links` and omits `bridges` and `ropes`. If a project still carries legacy
arrays in memory during an upgrade, the writer migrates them before serializing. If `links` is
already present, it wins over stale legacy arrays and is returned unchanged. A project with no
links keeps the optional field absent.

The same conversion is applied to all persisted project views that do not pass through the regular
file reader: inline projects in `workspace.json`, cached SSH project content, and the
`persistedCanvases()` snapshot used by the Server Edition context-link map. This keeps a legacy
project from losing its relationships merely because it was loaded through a different storage
path.

## Failure and security boundaries

The migration is pure and local. It performs no network request, process launch, repository
operation, node creation, navigation, endpoint binding, projection, or account lookup. It copies
only the legacy relationship ids and node ids into the new typed records. Endpoint resolution and
relationship authorization remain owned by the consumers of `Project.links`.

An absent or empty legacy collection produces no `links` field. An existing `links` collection is
not merged with legacy arrays, because merging stale records would duplicate relationships after a
newer writer has already published the unified shape. The existing project-file reader remains the
boundary for hostile or malformed project content; this compatibility helper does not claim to
validate endpoint existence.

## Verification status

The source integration is present in commit `24edc040d38366f9dbc7e85549d3adf38997b6bc` and was
reconciled with `origin/main` at `54164b84dce0b7e62787b1de2885405ff4ed821c`. This lane intentionally
did not run tests, lint, type checks, builds, packaging, runtime interaction, reviews, audits, or
captures. The parent integration lane owns those checks and the generated offline documentation
bundle.

## Suggested articles

- [Projects and tabs](./projects-and-tabs.md)
- [Portable project schema 3](./portable-schema3.md)
- [Portable canvas projection](./portable-canvas-projection.md)
- [Project history and archives](./project-history-and-archives.md)
