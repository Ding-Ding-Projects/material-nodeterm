# Cloudflare Tunnel state

## Behaviour

The tunnel state surface reports six independent observations instead of collapsing them into one
optimistic connection flag:

1. API creation, whether the provider has confirmed the tunnel object.
2. DNS routing, whether the selected hostname resolves to the intended tunnel route.
3. Connector health, whether the selected process, Windows service, or Docker connector is reporting
   a live connection.
4. Access policy, whether the route has the requested protected or public policy.
5. Origin reachability, whether the local origin responds from the connector's host.
6. External reachability, whether the public hostname can be reached from outside the origin host.

Each observation carries its own status, timestamp, source, evidence, bounded detail, and bounded
recovery reason.
The possible statuses are `unknown`, `pending`, `ready`, `failed`, and `blocked`. `unknown` means
there is no trustworthy observation yet. It is not a failed probe and it is not evidence that the
route is absent. The overall status is `failed` when any facet failed, `blocked` when no facet failed
but a facet is blocked, `pending` while an observation is running, `ready` only when all six facets
are ready, and `unknown` otherwise.

The model accepts one facet observation at a time. A delayed response with an older timestamp is
refused, and a facet cannot jump from `unknown` directly to `ready`. A failed or blocked observation
must return through a new bounded check before it can become ready. These transitions prevent a
late provider response from overwriting a newer local result.

The guided panel has one plain-text search for the six checks and a separate status filter. Both
fields have their own adjacent anchored full regex builder. Search is local, plain text is the
default, and invalid or unsafe patterns remain visible with an explanation rather than hiding rows.
Rows expose a keyboard-accessible retry action where a new check is meaningful, and disabled retry
states name the exact reason. The panel keeps unknown and failure explanations visible in the same
surface where the observation was requested.

## Configuration and portability

`TunnelPortableIntent` contains only safe intent: node id, display label, hostname, origin protocol
and port, connector mode, access-policy intent, and route mode. The origin host itself is deliberately
not recorded because it is a machine binding. A schema 3 project may carry this intent and can be
opened on another computer without contacting the provider.

Import performs no network request, provider mutation, process launch, download, or local probe. The
destination user must choose Configure or Rebind to select a local provider account, zone, origin
host, and connector. Until that happens, every facet remains `unknown`.

`TunnelLiveState` is local runtime data. Provider account and zone labels, provider tunnel and DNS
record ids, connector ids, process ids, local configuration paths, host labels, timestamps, sources,
evidence, and all observations stay outside the transferable project file. Credentials are not
represented by either the portable intent or the live state type.

## Failure modes and recovery

- `unknown`: no check has completed, the local binding is missing, or the caller cannot establish a
  trustworthy observation. Configure or Rebind, then retry the affected facet.
- `pending`: the selected check is running. The retry control is disabled until that check settles.
- `failed`: the check answered with a bounded failure reason. Resolve that reason and retry the same
  facet. No other facet is changed by this result.
- `blocked`: a required user choice or local capability is missing. The row names the missing choice
  and keeps the rest of the state intact.
- `ready`: the individual observation is current. It does not imply that another facet is ready.

The current Cloudflare core stack exposes the state route and the renderer/server bridge, but it does
not yet register tunnel-specific provider or connector probes. With a local Cloudflare binding, a
facet therefore remains `unknown` with source `unavailable` and evidence naming that the probe is not
registered. Without a local binding, it is `blocked` with source `local-binding` and a Configure
recovery action. This is deliberate: an existing account binding is not evidence that a tunnel was
created, routed, connected, protected, or externally reachable.

The surface never reports the route as ready because a provider object exists. It never replaces an
unreadable observation with a guessed success or an unrelated local host. An older response cannot
replace a newer one, and malformed status, timestamp, detail, reason, or retry-delay values are
refused at the shared model boundary.

## Security considerations

The model is platform-free and contains no provider request or shell execution. Callers must keep
provider credentials in the existing protected local secret store, never in a project file,
renderer state, command argument, environment variable, log, export, or capture. The connector
runtime remains responsible for its own token-file and process restrictions. This lane's state
model intentionally cannot authorize a provider mutation or launch a connector.

## Implementation and verification record

- Shared model and bounded transition contract: `src/shared/tunnel-state.ts`.
- Cloudflare core implementation and local generation fencing: `src/core/cloudflare-core-managers.ts`.
- Typed IPC and Desktop/Server Edition bridge: `src/shared/ipc.ts`, `src/preload/index.ts`,
  `src/renderer/bridge/ws-bridge.ts`, and `src/renderer/bridge/stubs.ts`.
- Guided display mounted in the current Cloudflare manager node:
  `src/renderer/components/tunnel/TunnelStatePanel.tsx` and
  `src/renderer/nodes/CloudflareCoreManagersNode.tsx`.
- The display's search and status filter each use an adjacent anchored full regex builder.
- Portable state is side-effect free. Live state is explicitly local and non-transferable.
- The ultra-speed implementation lane intentionally did not run tests, type checking, lint, review,
  security checks, accessibility checks, builds, packaging, installer execution, runtime interaction,
  or captures. Build and packaging evidence, when produced by the release lane, will prove only
  artifact production. Runtime behavior remains unverified until a later verification lane.

## Suggested articles

- [Remote and SSH features](./README.md)
- [Docker host manager](./docker-host.md)
- [Portable schema 3](../projects/portable-schema3.md)
- [Cloudflare and tunnel planning](../../plans/2026-08-26-portable-node-universes-and-hosting-program.md)
