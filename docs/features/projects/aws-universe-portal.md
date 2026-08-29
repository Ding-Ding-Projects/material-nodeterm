# AWS Universe portal

Status: implemented as a portable, AWS-only portal surface. AWS Shop and service operations remain
interfaces for later lanes and are intentionally not executed here.

## What the portal does

An AWS Universe is a canvas portal that can be created any number of times in one project. Every
instance has its own stable universe id and a deterministic pair of matching doors:

- **Enter through matching door** opens the AWS-only canvas scope.
- **Return through matching door** leaves that scope.

The portal does not add a tab route. Selecting a tab or using ordinary tab navigation cannot enter
an AWS Universe or bypass its door pair. The core navigation contract returns `tabBypassAllowed: false`
and requires the entry and return door ids to match the instance.

The in-portal catalog is intentionally AWS-only. It exposes the AWS Universe, AWS Shop, AWS service,
and AWS operation interfaces. Later Shop and service rows remain visible with a precise disabled
reason, so an unavailable capability is not mistaken for a missing catalog entry. This lane does not
call AWS, run a command, deploy a resource, download a model, or launch a process.

## Portable metadata and local context

The safe portal metadata is part of the canvas node and schema 3 projection:

| Portable | Machine-local |
| --- | --- |
| universe id and display name | provider session |
| `aws-only` scope | credential-vault key |
| deterministic entry and return door ids | profile, account, and role binding |
| optional region and service intent | process state, cache, path, host id |

Machine-local context is read from the app's local storage namespace
`nodeterm.aws-universe.local-contexts`. It is never copied into `.nodeterm/project.json`, a schema 3
archive, peer mutations, or catalog entries. A missing context is an honest **Leave unbound** state.
Rebinding or adoption must be an explicit later action after the identity manager lane exists.

Import and relaunch are side-effect free. They validate metadata, plan `Configure`, `Rebind`, or
`Leave Unbound`, and preserve the existing project when validation fails. They never call AWS,
deploy, download, reconnect a provider session, start a process, or mutate the destination computer.

## Material Design 3 and accessibility

The portal uses the shared Material Design 3 tokens and surface anatomy, with a painted card,
visible focus, keyboard-reachable door and context controls, an anchored regex builder beside its
catalog search, a result count, bounded scrolling, and precise disabled-state text. It remains
usable when the node is narrow and respects reduced-motion preferences through the shared canvas
surface styles.

The catalog search is plain text by default. The adjacent `.*` control opens the full anchored
regex builder, and the same field owns its pattern, flags, validation, and filtered result set.

## Implementation map

- `src/core/aws-universe-portal.ts`: portable metadata, deterministic door pair, import plan,
  navigation checks, unlimited collection append, and AWS-only catalog filtering.
- `src/shared/types.ts`: `aws-universe` node kind and portable node fields.
- `src/renderer/state/workspace.ts`: portal factory, dimensions, and persistence conversion.
- `src/renderer/nodes/AwsUniverseNode.tsx`: interactive portal node and catalog interface.
- `src/renderer/canvas/Canvas.tsx`: pane menu, command palette, node registration, and FAB route.
- `src/core/portable-canvas-projection.ts`: safe schema 3 projection of portal metadata.

Server Edition shares the platform-free contract and renderer surface. Mobile has no canvas-node
transport in this lane, so it receives the safe metadata only when its shared protocol adopts the
new node kind.

## Verification boundary

The ultra-speed implementation lane did not run tests, type checks, lint, review, security checks,
accessibility checks, installer execution, runtime interaction checks, or UI captures. Build and
packaging evidence, when produced by the release orchestrator, proves artifact production only and
does not prove this portal's runtime behavior.

Suggested articles: [portable canvas projection](portable-canvas-projection.md),
[portable schema 3](portable-schema3.md), and [projects and tabs](projects-and-tabs.md).

