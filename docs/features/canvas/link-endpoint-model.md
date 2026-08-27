# Typed link endpoint model

The canvas link model gives every relationship one typed record instead of asking consumers to
infer meaning from the array that happened to contain it or from an id prefix. The model is shared
by the desktop and Server Edition shells, and it is deliberately limited to data shape,
validation, ownership, and portability. Link migration and user-facing authoring are separate
follow-up features.

## Data shape

Each link has an id, one kind, and two discriminated endpoints:

| Field | Values | Meaning |
| --- | --- | --- |
| `kind` | `context` | A relationship that may feed the context-link route. |
| `kind` | `lineage` | A display-only relationship such as spawned-by lineage. |
| `kind` | `dependency` | A relationship that may connect a project node to a branch. |
| `source` or `target` | `ref: node` | A node in the project that owns the link. |
| `source` or `target` | `ref: xnode` | A node id in another project, referenced without copying its content. |
| `source` or `target` | `ref: branch` | A repository-relative branch reference. |

The TypeScript definitions live in `src/shared/types.ts`. `Project.links` is the project-owned
collection. The legacy `bridges` and `ropes` fields remain available as read-only migration input
until the migration feature is completed.

## Ownership and foreign references

Before a link is accepted for persistence, `validateLinkForProject` in
`src/shared/link-model.ts` checks that its source is a node currently owned by the project being
written. An `xnode` is therefore a foreign reference only, never a mutation source. A foreign
target must name a different project id, while a local node target must exist in the owning
project. A local node cannot link to itself.

The model does not copy, adopt, delete, move, or mutate a foreign project's node. Those operations
belong to the later cross-project projection and authoring features, which must call this boundary
before changing any relationship.

## Validation and bounds

`sanitizeEndpoint` and `sanitizeLink` reject arrays, missing discriminators, unknown fields,
control characters, empty values, oversized identifiers, unsupported kinds, malformed metadata,
and non-finite numbers. Metadata is JSON-shaped, limited to a small depth and key count, capped by
encoded size, and refuses names that commonly carry credentials, process state, host identity, or
machine paths. Invalid metadata is rejected as a whole, so a valid-looking link never receives a
partially trusted metadata object.

`validateProjectLinks` applies the same rules to a complete collection, enforces the maximum link
count, rejects duplicate ids, and rejects the entire collection when any item fails. This keeps
load and save callers from silently accepting only part of a relationship set.

## Portability

Branch endpoint repository references are repository-relative and use forward slashes. Absolute
drive paths, UNC paths, POSIX absolute paths, traversal segments, backslashes, and colon-bearing
values are rejected. The link model therefore carries a relocatable reference rather than a path
that identifies one computer. Credentials, executable values, process state, host details, and
machine-local paths do not belong in link metadata.

## Failure modes and recovery

An invalid endpoint, unsupported kind, foreign source, missing local target, local-looking foreign
target, branch target on a non-dependency link, duplicate id, oversized collection, or unsafe
metadata causes validation to fail closed. The caller should retain the last valid project state
and surface the precise recovery action. This module has no filesystem, network, process, or
foreign-project side effects, so validation cannot mutate the project that supplied a reference.

## Verification boundary

This source lane adds the shared model and direct documentation only. It intentionally does not
run tests, lint, type checks, builds, packaging, runtime interaction, reviews, security or
accessibility checks, or captures. The integration owner must wire the validator into every
project-file boundary, regenerate the offline documentation bundle, and verify the downstream
canvas and context-link consumers.

## Suggested articles

- [Canvas and node lifecycle](./canvas-and-lifecycle.md)
- [Multiverse child canvases](./multiverse-canvases.md)
- [Portal lifecycle and child-content preservation](./portal-lifecycle.md)
- [Project history and archives](../projects/project-history-and-archives.md)
