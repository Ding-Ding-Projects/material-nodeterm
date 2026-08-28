# Projects

A project is one canvas — one page of nodes, with its own working directory and its own tab.

- [Projects & tabs](./projects-and-tabs.md) — how projects are created, switched, closed,
  reopened, and persisted to disk; how a project binds to a folder.
- [Project history and archives](./project-history-and-archives.md) — automatic save revisions and
  the one-file export/import format that carries the complete local history.
- [Portable project schema 3](./portable-schema3.md): bounded manifest metadata, safe entry
  inventory, deterministic hashes, omissions, and pure legacy migration boundaries.
- [Persisted link migration](./persisted-link-migration.md): bounded migration of legacy
  `bridges` and `ropes` into typed `links`, with id preservation and display-only lineage.
- [Portable canvas projection](./portable-canvas-projection.md): deterministic schema 3 canvas
  payloads for root and future universe scopes, with machine-local state excluded.
- [Portable media assets](./portable-media-assets.md): content-addressed media, signature
  validation, and the Include, Omit, Locate Later decision flow.
- [Portable project binding wizard](./portable-bindings.md): atomic staging, hash validation,
  legacy migration, collision refusal, and explicit destination binding routes.
- [Cross-project link transport and storage](./cross-project-link-transport.md): Canvas-owned link
  commits, persisted `Project.links`, background-project context transport, and endpoint filtering.
- [Alarm Clock nodes](../../alarm-clock.md): one-shot and recurring wall-clock reminders with
  timezone and DST handling, snooze, dismiss, and missed-occurrence history.
- [Repository graph universe](./repository-graph-universe.md): project-scoped semantic code and
  dependency graphs with bounded host-owned snapshots and provenance.

See also [Canvas](../canvas/README.md) for what lives inside a project, and
[Source control](../source-control/README.md) for how a project's working directory relates to
git worktrees.
