# Special-universe Shop nodes

The Shop is the one catalog entry point owned by each Multiverse or AWS Universe child canvas.
The root canvas does not have a Shop. The node is deterministic, persistent, scope-bound, and
non-deletable, so reopening or sharing a project cannot create a second catalog surface or move an
AWS choice into a general Multiverse canvas.

## Behaviour

`src/core/universe-shop.ts` owns the scope and identity contract, including the live
`createSpecialUniverseCanvas` constructor, while the p05 unified Node Catalog
is supplied through `UniverseShopCatalogProvider`; descriptors carry localization keys rather than
duplicated labels. The schema-3 projection writer and parser call
the repair coordinator at their boundaries. A child canvas with id `canvas-7`
owns a deterministic Shop id, normally `shop-canvas-7`. If an ordinary node already occupies that
base id, the coordinator selects a stable hash suffix without overwriting the ordinary node. If
both stable candidates are occupied, creation is refused and the displaced ordinary ids are
preserved and reported. The same id is returned on every hydration, import retry, peer replay, and
undo pass. The coordinator repairs a missing Shop, removes duplicate or malformed Shop records,
normalizes its title, group, ownership metadata, and persisted depth, and records a visible repair
entry. A missing, cyclic, or inconsistent containing-canvas chain, or a missing persisted depth,
fails closed. A repair does not
open files, contact a provider, deploy anything, launch a process, or download a catalog.

The Shop's catalog is scope-bound:

| canvas scope | entries |
| --- | --- |
| `multiverse` | general terminal, sticky note, editor, browser, and authenticator entries, plus another portal while the depth is below 8 |
| `aws-universe` | AWS identity, Resource Explorer, S3, and EC2 entries; unavailable AWS executors remain visible with their reason until their implementation lane ships |
| `root` | no Shop and no Shop catalog |

Catalog search is local, bounded, plain text by default, and supports an explicit regular-expression
mode. Invalid patterns leave the scoped entries visible and expose the parser error instead of
silently hiding the catalog. If the unified catalog provider is unavailable, the Shop stays visible
but disables creation with an explicit dependency message; it does not carry a copied label registry.

## Refused actions

The Shop cannot be deleted, duplicated, moved across canvases, grouped, or removed or restored by
ordinary undo, and its title remains fixed. The renderer refuses these actions at the React Flow
boundary, while the project-store and shared peer mutation paths refuse them again. Recolouring and
appearance editing remain available, but they preserve the Shop identity and non-deletable marker.
A user can still arrange and delete nodes created from the Shop; only the catalog anchor itself is
fixed.

## Portable and local state

The Shop id, scope, safe title, geometry, top-level placement, and last safe catalog selection are
portable project intent. Credentials, provider sessions, account bindings, machine paths, process
state, caches, and runtime handles never enter the Shop node or the portable projection. A Shop
created from a peer event carries an immutable `creationEventId`; repeated peer or IPC deliveries
with that id are no-ops. Hydration and import only remember existing ids and never mint new ones.
The Shop is repaired through the same deterministic coordinator and cannot grant the peer a provider
binding.

## UI and accessibility

`src/renderer/nodes/ShopNode.tsx` renders the scoped catalog as an accessible region with a labelled
search field, result count, keyboard-operable list items and entry buttons, visible focus, and an
adjacent anchored full regex builder. The fixed-state explanation is present on the card, and all
Shop copy, including accessible names and descriptor labels, passes through the shared localization
catalog and personal-vocabulary mapper. The Shop card uses the project Material Design 3 tokens,
44px targets, appearance anchors for its root and controls, and a bounded scrolling surface at
narrow widths.

## Failure modes and recovery

- A missing Shop after import is rebuilt from the canvas id and reported as a repair.
- Duplicate Shops are reduced to the deterministic id, with the removed ids recorded in the repair
  result.
- A Shop in the root or another non-universe canvas is removed from that invalid scope; a valid
  child owner still receives its own Shop.
- A malformed or unavailable regex pattern keeps the full scoped list visible and reports the exact
  parser failure.
- An AWS catalog entry without an implemented executor stays visible as unavailable with an honest
  disabled state. It is not presented as a working provider operation.

## Verification status

This lane intentionally did not run tests, type checking, lint, security checks, builds, packaging,
runtime interaction, or captures. The implementation is present in the platform-free coordinator,
portable node metadata, renderer node registration, mutation boundaries, and offline documentation
bundle. Runtime and built-artifact evidence remain unverified under the lane's explicit verification
boundary.

## Suggested articles

- [Portable canvas projection](../projects/portable-canvas-projection.md)
- [Portable project schema 3](../projects/portable-schema3.md)
- [Service nodes](./service-nodes.md)
- [Portable Node Universes and Hosting Program](../../plans/2026-08-26-portable-node-universes-and-hosting-program.md)
