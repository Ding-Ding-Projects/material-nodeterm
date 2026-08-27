# Hosted-service Cloudflare Tunnel handoff

The hosted-service handoff is an explicit second step after a local service has passed its health
check. A hosted-service panel discovers loopback origins, lets the user choose one, checks its health,
and only then enables the exposure confirmation and Cloudflare Tunnel action. Importing a project
never contacts Cloudflare, starts a connector, or changes a local service.

## Guided flow

The panel uses three real pickers: a discovered local origin, an available Cloudflare account, and an
available zone. Each picker has a local plain-text search field and an adjacent anchored regex builder.
Unavailable accounts and zones stay visible with the reason and the next action. There is no command
field, raw request editor, arbitrary endpoint field, or free-form connector configuration.

The user first selects an origin and chooses **Verify local health**. The origin must be loopback HTTP,
and the health path must be a local path. A successful health response is shown with its measured
latency and timestamp. An unavailable, unhealthy, or timed-out response leaves the tunnel action
disabled. The check is a prerequisite, not a label that can be overridden by a provider response.

The user then reviews the hostname hint and path prefix, selects the Cloudflare account and zone, and
checks the explicit external-exposure confirmation. The surface first reads the adapter capability
record. Tunnel creation, connector startup, and external verification must each be advertised as
available before the final action is enabled. Only that final action calls the provider adapter. The
adapter receives an opaque local credential key resolved from the protected credential store. The
credential value never reaches the renderer, the project file, a command argument, a log, or an export.

Progress names each stage: local health, provider binding, tunnel creation, connector start, and
external reachability. The handoff can be cancelled. A created tunnel with unverified external
reachability is reported as a partial result and remains available for recovery rather than being
reported as complete. DNS routing, connector health, local origin health, and external reachability
are separate facts.

## Portable and local state

`CloudflareTunnelIntent` in `src/shared/cloudflare-tunnel-handoff.ts` is the project-portable part.
It contains the service id, origin intent, hostname hint, path prefix, explicit-exposure policy, and
private-origin policy. It does not contain a Cloudflare account, zone, tunnel id, connector id,
credential, local endpoint, host identity, process id, cache, or connector state.

The machine-local binding is stored through `LocalNodeBindingStore` in
`portable-node-bindings.json`. It contains only the provider identity, zone and tunnel references,
the selected origin id, an opaque credential-store key, and the last verified local-health timestamp.
The binding store uses atomic writes and a snapshot restore if the local binding write fails.

The selected local host and port are reviewed in the origin picker and handed to the provider adapter
only as the validated loopback origin. They are not written to the project file. The adapter cannot
replace the reviewed origin with an arbitrary endpoint, and a hostname hint is routing intent rather
than proof that DNS or external reachability exists.

When a project is opened on another computer, the portable intent remains visible while the local
binding is absent. The user must configure a local origin, rebind an available Cloudflare account and
zone, or leave the intent unbound. Import itself has no network or provider side effect.

## Failure and security behavior

- A missing local origin is an unavailable state, not an empty successful list.
- A failed or timed-out health probe prevents exposure and names the recovery action.
- A missing account, unavailable zone, or missing local credential prevents provider mutation.
- An unavailable adapter capability keeps the handoff disabled and names the missing capability.
- The provider adapter is called only after local health is healthy and exposure is explicitly confirmed.
- Provider deadlines are bounded. Cancellation never reports external reachability as verified.
- Connector creation and external reachability are reported independently, including partial outcomes.
- Secrets remain in the operating-system credential store. The UI handles only the account selection and
  an opaque vault reference resolved in the core process.
- A hostname hint is validated as a DNS name, and the origin is restricted to loopback HTTP so the
  handoff cannot silently republish an already-public endpoint.

## Implementation and availability

The shared contract is implemented in `src/shared/cloudflare-tunnel-handoff.ts`. The sequencing and
machine-local binding coordinator is `src/core/cloudflare-tunnel-handoff.ts`. The guided renderer
surface is `src/renderer/components/CloudflareTunnelHandoffPanel.tsx`.

The core class accepts a provider adapter rather than embedding credentials, shell commands, or an
unbounded network client. Cloudflare account and zone adapters are supplied by the Cloudflare manager
lane. Until that adapter is registered on a shell, the picker must show the unavailable reason and the
handoff remains disabled. This is an honest capability boundary, not a simulated success.

## Verification boundary

This ultra-speed implementation lane intentionally did not run tests, type checks, lint, builds,
packaging, reviews, security checks, accessibility checks, installer execution, runtime interaction,
or UI captures. Build and packaging evidence from the parent integration lane will prove artifact
production only. Runtime health, provider API behavior, connector behavior, and external reachability
remain unverified until the adapter is wired and the built application is exercised.

Suggested articles: [Shared provider services](provider-services.md), [Service nodes](service-nodes.md),
and the [Portable Node Universes and Hosting Program](../../plans/2026-08-26-portable-node-universes-and-hosting-program.md).
