# Hosted tunnel state

**Category:** [Remote & SSH](./README.md)

The Tunnel state settings surface gives a hosted tunnel one honest, provider-neutral status model.
It does not create a provider resource or start a connector. Provider lanes can implement the
typed connector interface later without changing the renderer's state vocabulary.

## Behaviour

Each tunnel has eight independently observed milestones:

| Phase | Meaning |
| --- | --- |
| API-created | The provider resource was created and identified. |
| Token sealed | The connector token was sealed in protected local storage. The token itself is never in the model. |
| Process running | The selected connector process is running. |
| Connector healthy | The connector reports a healthy connection to the provider. |
| DNS routed | The configured hostname resolves to the tunnel route. |
| Access protected | The configured Access policy is present and active. |
| Origin reachable | The connector can reach the selected local origin. |
| External reachable | A request from outside the host reaches the expected origin through the hostname. |

Every phase is `unknown`, `pending`, `healthy`, or `failed`. The overall lifecycle is `idle`,
`reconciling`, `ready`, `partial`, `error`, or `stale`. A tunnel is `ready` only when all eight
phases are healthy in the same reconciliation generation. A partial or failed result never becomes
an externally-ready claim.

Reconciliation is generation-based. Starting a reconciliation increments a monotonic generation
and marks all phases pending. Observations from an older generation are refused as stale, recorded
as an error, and cannot overwrite newer phase data. Completing a generation derives the lifecycle
from the observations and preserves exact phase errors for recovery.

## Configuration and persistence

The model is stored in the app's local settings record under `tunnelState`. It stores only safe
intent and observations: a local tunnel identifier, display name, hostname, origin URL, generation,
phase states, timestamps, bounded errors, and redacted action history. Provider credentials,
provider sessions, connector process identifiers, machine paths, host-specific identifiers,
caches, and runtime data are intentionally excluded.

The settings surface provides identity fields, an independent state picker for every phase, a
generation starter, completion action, reset action, recent history, and a status summary. The
controls are useful before a connector is available: they edit and preserve observations without
pretending that an unimplemented provider integration exists.

## Failure modes and recovery

- `unknown` means no observation exists. It is not a failed probe.
- `pending` means the current generation is in flight. It is not healthy.
- `failed` keeps the phase error visible and leaves the overall lifecycle in `error`.
- A delayed result becomes `stale` and is ignored. Start a new reconciliation after the underlying
  provider or connector has recovered.
- A generation completed with fewer than eight healthy phases remains `partial` or `error`, never
  `ready`.

Informational state changes use the app's non-blocking notification centre. Errors remain reviewable
there, and the history list records the action without storing credentials or runtime secrets.

## Export and security

Export produces UTF-8 JSON containing the current generation, all eight phase observations, safe
history metadata, and an explicit omission list. It does not export token material, provider
sessions, process identifiers, machine paths, connector runtime data, or caches. Import and export
are local renderer actions and do not invoke a provider connector.

The connector interface accepts only a tunnel id, hostname, origin URL, and reconciliation
generation. Provider implementations must keep secrets in protected local storage or a read-only
secret volume, never in arguments, environment variables, project files, history, logs, or exports.

## Verification

The ultra-speed lane intentionally did not run tests, type checks, lint, security checks,
accessibility checks, builds, packaging, installer execution, runtime interaction checks, or UI
captures. Those checks remain required before a release claims the feature is verified. Connector
health and external reachability also require a provider implementation and a real host.

## Suggested articles

- [Docker host](./docker-host.md) — the existing encrypted project-sharing route.
- [Server Edition](./server-edition.md) — serving the renderer through a self-hosted host.
- [Scheduled settings](../scheduled-settings.md) — persisted settings with bounded external sources.
- [Exports](../../exports.md) — format and omission rules for local exports.

