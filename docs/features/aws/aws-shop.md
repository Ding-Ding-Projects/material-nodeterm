# AWS Shop and catalog

Status: implemented as the AWS Shop and catalog enforcement lane. AWS execution, identity
profiles, and AWS CLI v2 bundling remain later lanes.

## What the Shop does

An AWS Universe child canvas owns one deterministic `aws-shop` node. Its identity is derived from
the universe id, it is marked non-deletable, cannot be duplicated or grouped, and peers cannot
insert or remove it. The Shop opens a local Material Design 3 catalogue. Selecting an available
entry creates an `aws-service` blueprint node with the entry id and AWS Universe id.

The catalog is searchable with plain text by default. Its search field has an adjacent anchored
full regex builder using the renderer's JavaScript `RegExp` engine. Category tabs, result counts,
availability states, and disabled actions are keyboard-accessible and keep exact reasons beside
unavailable entries.

## AWS-only scope

An AWS Universe accepts only `aws-shop` and `aws-service` nodes. A service node must carry the
same AWS Universe id as the canvas. General terminal, editor, hosted-service, and other node kinds
are refused at creation and peer-ingest boundaries rather than silently reclassified.

The root canvas does not own a Shop. Multiverse and AWS Universe child canvases are repaired in
memory when imported: root Shops are removed, duplicate or malformed Shops are replaced with the
deterministic identity, non-AWS nodes are removed from AWS canvases, and a missing Shop is rebuilt.
The repair result includes visible records describing each action. Repair performs no network
request, deployment, provider mutation, process launch, credential lookup, or filesystem write.

## Portable and local state

Portable schema 3 keeps the Shop's safe presentation, AWS Universe id, catalog entry id, and
creation event id. Credentials, AWS profiles, account bindings, role sessions, SSO caches, CLI
paths, endpoints, and provider state remain outside the portable projection. The existing local
execution overlay is not used to grant AWS authority.

Legacy or hand-edited imported canvases are passed through `repairAwsUniverseImport` before a
caller stages them. The importer receives `sideEffects: []`, making the no-network/no-provider
boundary explicit. A repaired canvas is still subject to strict schema validation before it is
accepted.

## Availability and later execution

Each catalog row declares `available` or `unavailable`. Unavailable rows remain visible and name
the exact next action, such as refreshing the verified AWS CLI model inventory or registering a
detected CDK executable. This lane does not call AWS and does not claim that an executable or
credential exists. Later AWS lanes may add generated operations while retaining the same typed
entry shape and scope checks.

## Surfaces

- **Desktop:** AWS Shop node, local catalog panel, typed blueprint node, and shared scope guards.
- **Server Edition:** shared catalog and repair predicates are platform-free; provider execution
  is not implemented in this lane.
- **Mobile companion:** no AWS canvas transport is implemented here. A future companion should
  render a read-only Shop or blueprint summary and must not acquire AWS credentials from the
  portable file.

## Verification boundary

This lane intentionally did not run tests, type checking, linting, security checks, builds,
packaging, runtime interaction checks, or UI captures. The implementation must receive those
checks in the parent integration and release workflow. No AWS operation was performed.

## Suggested articles

- [Portable canvas projection](../projects/portable-canvas-projection.md)
- [Portable project schema 3](../projects/portable-schema3.md)
- [AWS and hosting program plan](../../plans/2026-08-26-portable-node-universes-and-hosting-program.md)
