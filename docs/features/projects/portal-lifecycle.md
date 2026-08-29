# Portal lifecycle and child-content recovery

Portal state is portable intent, not a host binding. The lifecycle model lives in
`src/shared/portal-lifecycle.ts` so Desktop, Server Edition, archive import, peer replay, and
future child-canvas surfaces use one decision path.

## What travels

`Project.portalHierarchy` carries child canvases, their safe node identities and geometry, portal
targets, return-door relationships, and the deterministic Shop belonging to each Multiverse or AWS
Universe canvas. Credentials, provider sessions, host paths, process state, sockets, and other
machine authority remain outside this shape. The existing schema 3 projection accepts the hierarchy
through `projectToPortableCanvasV3({ portalHierarchy })`, and the project file uses the same
validated shape.

The root canvas is the only `root` scope and is parentless. Child scopes name their parent, may not
form a cycle, and cannot exceed depth 8. A node belongs to exactly one canvas. A universe has one
Shop, while the root has none. Shop ids are derived from the canvas id, so importing the same
universe twice cannot create two structural Shops.

## Door lifecycle

`createPortalRecords()` creates one portal node and two stable relationships:
`door-<portal-id>` enters the child, and `return-<portal-id>` returns from it. Both relationships
are marked `nonDeletable: true`. Ordinary delete, duplicate, and undo paths must call
`canDeletePortalRelationship()` and refuse these records. A portal deletion is therefore a
destructive decision and routes through the app's existing two-key confirmation flow; cancellation
leaves the pair unchanged.

The return relationship is structural rather than a tab shortcut. Entry and exit are resolved from
the owning portal and its target canvas, so a user cannot bypass the door by selecting a child tab
directly. This module does not start a process, deploy a provider, or bind a host. Those actions
remain explicit Configure, Rebind, Adopt, Deploy, Locate Asset, or Leave Unbound routes.

## Import repair

`repairPortablePortalHierarchy()` repairs only bounded structural damage that has an unambiguous
safe result:

- a universe with no Shop receives its deterministic non-deletable Shop;
- duplicate Shops collapse to one deterministic record without dropping ordinary child nodes;
- a missing-parent or cyclic child is detached and retained as an orphan instead of being dropped;
- repair rows carry a stable id and a plain explanation for the user.

Unknown or unsafe data is rejected. `fileToProject()` catches an unrecoverable hierarchy, leaves the
ordinary project canvas available, and retains a non-secret repair notice rather than hydrating
untrusted child state. No import repair makes a network call, launches a process, writes a provider,
or silently overwrites an existing destination.

## Project deletion and recovery

`deleteProjectPreservingChildren()` removes the deleted root's own nodes but keeps every child
canvas and its nodes. Direct children become orphaned records with their original content and an
`orphanedFromCanvasId` marker. Door relationships are kept as orphaned structural records so the
return path is not silently erased along with the parent. `detectPortalOrphans()` reports the exact
reason (`missing-parent`, `cycle`, `deleted-parent`, or `missing-door-target`) and the preserved node
ids. `recoverPortalOrphan()` requires an existing, different parent, clears the orphan marker, and
re-runs the complete hierarchy validator before returning the recovered state.

Deleting a project or child canvas is still irreversible for the removed root content, so the UI
uses the existing destructive confirmation gate and names the exact affected project or canvas.
Import failure cleans only the staged import domain and leaves the existing project unchanged.

## History and peers

Portal events carry immutable ids. `applyPortalLifecycleEvent()` ignores a repeated id, making
retries, restart replay, and peer delivery idempotent. A node or relationship upsert replaces only
the matching id; a structural Shop cannot be replaced by a non-Shop event. `undoPortalLifecycleEvent`
never edits or removes history. It emits a new recovery event for a deleted canvas, while refusing
to undo a non-deletable door relationship. This gives local history and peer convergence the same
append-only semantics: replay is safe, and restoring is itself recoverable.

## Surface notes

- Desktop and Server Edition share the platform-free validator and repair rules.
- The archive boundary reuses the same validated project shape and continues to support legacy V1
  and V2 saves.
- A future mobile companion must treat portal hierarchy as safe presentation data and keep local
  bindings on its own side of the protocol.
- The portal lifecycle records are currently a core/shared foundation. Full interactive door
  construction and universe-specific catalogs belong to their separate Wave D lanes.

## Verification boundary

This lane was intentionally delivered without running tests, type checks, lint, builds, packaging,
runtime interaction, or screen captures. The implementation and docs name that boundary rather than
claiming built-artifact verification.

Suggested articles: [Portable canvas projection](./portable-canvas-projection.md), [Portable project
schema 3](./portable-schema3.md), and [Project history and archives](./project-history-and-archives.md).
