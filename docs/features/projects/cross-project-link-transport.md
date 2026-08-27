# Cross-project link transport and storage

**Category:** [Projects](./README.md)

This feature keeps the unified `Project.links` collection consistent between the live Canvas, the
project store, shared project files, and the Server Edition context-link reader. It is the transport
and storage slice of issue #86 and upstream PR #422.

## Behavior

The Canvas is the live owner of link state. Link inspectors submit complete link collections through
the Canvas-owned commit funnel in `src/renderer/components/links/link-commit.ts`. A mounted Canvas
accepts the project id and link collection through `commitLinksThroughCanvas`; when no Canvas owns
the live collection, the funnel returns `false` rather than claiming that a write succeeded.

The project store commits the root project's nodes, viewport, and unified links together. A root
commit removes legacy `bridges` and `ropes` fields from the in-memory project before applying the
new collection, so one autosave cannot publish two competing link representations. Existing child
canvas node and viewport handling remains separate from this root link collection.

`WorkspaceStore.persistedCanvases()` exposes each loaded project's serialized nodes and links to
the Server Edition. Inline projects, cached projects, and the last safely written local project
file all use the same `{ id, nodes, links }` shape.

The shared context-link mapper applies a narrow transport filter through `contextNodeEdges`:

- only `context` links are eligible;
- both endpoints must be local `{ ref: 'node', nodeId }` references;
- `lineage` links, `dependency` links, branch endpoints, and cross-project `xnode` endpoints are
  excluded because they do not identify a local transcript pair;
- links whose node ids are absent from the serialized node list are dropped from the derived map.

Background projects are mapped together with the active project's live map so refreshing one
project cannot erase context links belonging to another project. The Server Edition uses the same
mapper over persisted projects when no Canvas is mounted.

## Persistence and portability

The link collection belongs to the project that owns the source endpoint. This lane does not copy a
foreign node into the source project and does not create a second runtime owner for a target node.
Legacy `bridges` and `ropes` conversion is handled by the separate link-migration lane. Endpoint
definitions are handled by the separate endpoint-model lane.

## Failure modes and recovery

- A link commit without a mounted Canvas returns `false`; callers can keep the inspector state
  unchanged and present their own recovery notification.
- A link with a branch or cross-project endpoint is ignored by context transcript transport, while
  remaining available to the link features that understand that endpoint.
- A link pointing to a missing node is omitted from the derived context map rather than creating a
  transcript entry with guessed metadata.
- A project that cannot be read remains outside the persisted-canvas result until a later successful
  load or save makes its content available. A failed read is not reported as an empty project.

## Security considerations

Only the link metadata needed by the context-link route is derived. Node execution fields remain
machine-local through the existing node sanitization boundary. This lane does not add credentials,
provider sessions, process state, or foreign node copies to project transport.

## Verification boundary

The source implementation was reconciled against `origin/main` at
`54164b84dce0b7e62787b1de2885405ff4ed821c`. The implementation lane intentionally did not run
tests, lint, type checks, builds, packaging, runtime interaction, reviews, audits, or captures.
The parent integration lane must run the repository's normal checks against its final integrated
commit. The generated offline documentation bundle was not regenerated in this no-build lane.

The following remain separate issue #86 lanes and are not implemented here: endpoint modeling,
legacy migration, foreign-node projections, project-aware navigation, grouping and drill-through,
dependency operations, custom-agent harness, model switching, restart-on-subscription, and account
behavior.

## Suggested articles

- [Projects and tabs](./projects-and-tabs.md) - project identity, folders, and shared persistence.
- [Portable canvas projection](./portable-canvas-projection.md) - safe project-owned canvas content.
- [Source control](../source-control/source-control-and-worktrees.md) - repository relationships and
  branch-local work.
