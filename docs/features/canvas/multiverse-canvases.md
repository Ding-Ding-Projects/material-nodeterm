# Multiverse child canvases

Multiverse canvases let one project contain a rooted hierarchy of scoped canvases. The project
canvas remains the root at depth 0. Each child records its own viewport, nodes, bridges, ropes,
title, parent, order, and exact depth. The hierarchy stops at depth 8.

## Creating and navigating

The canvas app bar includes a hierarchy control showing the active path and depth. Opening it shows
the root and every child in a keyboard-operable hierarchy list. The list has local plain-text search
and an adjacent anchored regex builder.

Choose **New child canvas** to open the guided creator. Parent selection is a searchable list with
its own anchored regex builder, selected state, hierarchy context, and exact disabled reasons.
Naming a child is required. A parent at depth 8 remains visible but cannot be selected because a
child would exceed the boundary. The create preview states the resulting depth and parent before
the action runs.

Each created child starts with the deterministic scoped Shop produced by the shared special-universe
coordinator. The root has no Shop. Canvas switching commits the outgoing viewport and node state,
then reloads the selected scope without changing the active project.

## Persistence and portability

Ordinary project persistence stores every child canvas beside the root project. Machine-local
terminal execution settings are removed before serialization and restored only from the destination
computer's local overlay when a project is loaded.

Portable schema 3 export includes each Multiverse canvas record, its scoped nodes, and relationship
records tagged with the owning canvas identifier. Import validates parent order, exact depth,
bounded identifiers, titles, count, node lists, and viewports. It reconstructs the hierarchy without
launching a terminal, process, download, network request, or provider operation.

The active canvas identifier is runtime navigation state. It is not exported, so opening a copied
project starts from the root instead of carrying another computer's transient view.

## Failure modes and recovery

- A missing parent, duplicate identifier, out-of-order parent, malformed viewport, or incorrect
  depth is rejected from the child hierarchy.
- Creating beneath depth 8 is refused before mutation with an exact reason.
- An empty name is refused before mutation.
- Import repairs a missing deterministic Shop through the shared special-universe coordinator.
- A portable import never replays runtime state or trusts machine-local execution paths.

## Security and privacy

The hierarchy is project data only. It stores no credentials, provider sessions, machine-specific
runtime handles, process state, or local terminal executable configuration. Search evaluates locally
with the shared bounded regex engine. Import is data reconstruction only and has no external side
effect.

## Verification boundary

The issue #33 ultra-speed implementation lane intentionally did not run tests, type checks, lint,
builds, packaging, installer execution, reviews, audits, runtime interaction, accessibility checks,
security checks, or UI captures. Those checks remain unrun rather than being implied by the source
implementation.

## Suggested articles

- [Special-universe Shop nodes](../integrations/aws-universe-shop.md)
- [Unified Node Catalog](./node-catalog.md)
- [Portable schema 3](../projects/portable-schema3.md)
- [Canvas and node lifecycle](./canvas-and-lifecycle.md)
