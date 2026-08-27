# Portal lifecycle and child-content preservation

Portals provide a safe lifecycle for nested Multiverse canvases. A portal carries only schema 3
intent: a bounded identifier, its containing and child canvas ids, a title, depth, status, and a
reciprocal entry and return door pair. It never carries credentials, host paths, process ids,
provider sessions, browser profiles, caches, or deployment authority.

## Create, open, close, and delete

Creation is guided by the containing canvas and a new child-canvas identifier. Only the root and
Multiverse canvases can contain a portal, and Multiverse depth is capped at 8. A new portal starts
closed, receives deterministic door identifiers, and has an empty child canvas ready for real user
content. Opening is allowed only from the containing canvas after the portal is explicitly opened.
The return door points to the exact containing canvas. Closing a portal changes only its status and
never changes child content.

Deleting a portal is a destructive action and must be confirmed through the existing two-key native
confirmation surface. The lifecycle core removes the portal, its doors, and the descendant canvas
records, then moves every descendant node id into the containing canvas. Node ids, content,
relationships, and media references remain intact, so deletion cannot silently destroy child work.

## Import repair

Schema 3 import validates every entry before staging. When a portal has valid safe intent but its
reciprocal door records are absent or stale, the importer rebuilds the pair from the portal record,
records a repair result, and keeps every child canvas and node id. An orphan child canvas remains
represented with its content and an explicit repair record so a later guided action can reconnect
it. Malformed identifiers, unsafe fields, invalid hierarchy, and invalid content remain fail-closed.

Import does not call a provider, deploy a service, start a process, download an asset, or mutate a
binding. It stages the complete local projection and publishes it atomically. The imported runtime
project retains child canvases and portal intent, while destination bindings remain unconfigured.

## Guided interface

`PortalLifecycleDialog` provides a real containing-canvas picker, bounded title and child-id fields,
explicit disabled reasons, keyboard-operable actions, and a local portal list. The list search is
plain text by default and has its own adjacent anchored full regex builder. Opening a child requires
the containing canvas and an open portal. Delete delegates to the app's two-key confirmation flow.
Status and error copy remains non-blocking and the dialog uses the shared Material Design 3 dialog,
field, and button primitives.

## Persistence and portability

Runtime projects keep `childCanvases` and `portals` in the project model. The shared project file
stores safe child content and portal intent only. The portable schema 3 projection stores child
canvas node membership, hierarchy, and portal records. Local bindings remain in the application
data directory and are never added to the portable file.

## Verification boundary

This lane intentionally did not run tests, type checking, linting, builds, packaging, installer
execution, runtime interaction, accessibility review, security review, or UI captures. The source
changes are implementation only. Those checks remain for the verification lane.

## Suggested articles

- [Door-only universe navigation](./door-only-universe-navigation.md)
- [Portable canvas projection](../projects/portable-canvas-projection.md)
- [Portable project binding wizard](../projects/portable-bindings.md)
- [Node Catalog](./node-catalog.md)
