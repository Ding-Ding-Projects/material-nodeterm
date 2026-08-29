# Projects

A project owns a root canvas and one project tab. Multiverse child canvases are nested content
scopes inside that project, never additional project tabs.

- [Projects & tabs](./projects-and-tabs.md) — how projects are created, switched, closed,
  reopened, and persisted to disk; how a project binds to a folder.
- [Project history and archives](./project-history-and-archives.md) — automatic save revisions and
  the one-file export/import format that carries the complete local history.
- [Portable project schema 3](./portable-schema3.md): bounded manifest metadata, safe entry
  inventory, deterministic hashes, omissions, and pure legacy migration boundaries.
- [Portable canvas projection](./portable-canvas-projection.md): deterministic schema 3 canvas
  payloads for root and future universe scopes, with machine-local state excluded.
- [Multiverse child canvases](./multiverse.md): persistent, scoped child content with stable
  root/parent identity and an enforced depth-eight hierarchy. Child canvases are not project tabs.

See also [Canvas](../canvas/README.md) for what lives inside a project, and
[Source control](../source-control/README.md) for how a project's working directory relates to
git worktrees.
