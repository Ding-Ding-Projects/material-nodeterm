# Cloudflare Tunnel wizard

## Behavior

The one-click Tunnel wizard is a review-first route for exposing one discovered local origin
through Cloudflare. It loads a bounded discovery snapshot and presents populated choices for the
Cloudflare account, zone, hostname, origin host, discovered container, attached network, published
port, and the verified origin. The hostname is the only free-entry value. It is normalized and
validated as a DNS name inside the selected zone before the review can proceed.

Each picker has its own local plain-text search field and an adjacent anchored full regex builder.
The picker remains searchable when its list is short. A selection is an opaque id from the latest
discovery snapshot. The renderer cannot submit an API request, shell command, container command,
entrypoint, environment value, or arbitrary origin URL.

The review step names the account, zone, hostname, origin, local credential binding, and the exact
external operations: creating one Tunnel, creating or adopting the selected hostname route, and
verifying the selected origin. Creation rechecks the selection against the same discovery snapshot
and reports preflight, creation, routing, verification, completion, cancellation, or failure
progress. Cancellation uses an `AbortSignal`; a cancelled or failed operation leaves the prior
local binding active and returns to a retained review so the user can refresh or retry.

## Configuration and portability

The wizard accepts a `CloudflareTunnelWizardApi` supplied by the trusted host boundary. The host
implementation is responsible for Cloudflare API calls, host discovery, Docker discovery, route
conflict handling, and bounded rollback. The renderer receives only labels, details, state, and
opaque ids.

The schema 3-safe intent contains the requested hostname, zone name, origin protocol and port, the
desired host kind, and the desired container and network labels. It also carries bounded relationship
ids. It does not contain Cloudflare account ids, zone ids, host ids, container ids, network ids,
tokens, credential values, machine paths, process state, caches, or generated runtime data. The
trusted host binds the node locally using the provider-account reference and the stable local vault
key `provider-account:<account-id>`; the credential itself never enters this shape.

Importing a project does not discover a host, contact Cloudflare, create a Tunnel, create a DNS
record, start a connector, or bind credentials. A destination computer must explicitly Configure,
Rebind, Adopt, Deploy, Locate Asset, or Leave Unbound through its local binding flow before an
operation begins.

## Failure modes and recovery

- An unavailable account, zone, host, container, network, port, or origin remains visible with its
  reason and cannot be selected.
- A stale selection is rejected when the host boundary revalidates it. The wizard does not substitute
  a similarly named resource.
- A hostname outside the selected zone, a malformed DNS label, or a missing required choice keeps
  Review tunnel disabled and states the next correction.
- Discovery failure is distinct from an empty discovery result. The wizard preserves no guessed
  values and offers Refresh discovery.
- Cancellation is safe before publication and preserves the prior local binding. A failed route or
  local binding reports the exact failed phase and retains the review for retry or rebinding.
- Existing unmanaged routes are not replaced implicitly. A host adapter must expose a route conflict
  as a reviewable failure or an explicit adoption choice.

## Security considerations

Cloudflare credentials remain in protected local storage behind the host boundary. The UI sees an
opaque account reference and the binding stores only a stable vault-key name. Credentials are never
placed in arguments, environment variables, portable project data, logs, exports, progress text,
captures, or the renderer bundle.

The connector path is selected by a later runtime lane. It must use a token file or protected secret
volume, read-only root, dropped capabilities, no privileged mode, no host network, no Docker socket,
and bounded resources. This wizard never launches that connector and never accepts an arbitrary
shell path as a replacement.

## Surfaces

- **Windows desktop:** the full discovery, review, progress, cancellation, and local binding route.
- **Server Edition:** the same renderer can show the wizard when a trusted server adapter supplies
  discovery and creation; it must describe that operations run on the server host.
- **Relay sessions:** the feature remains unavailable until a trusted host exposes the adapter.
- **Mobile companion:** portable intent may be displayed as unbound; creation and credential binding
  require a supported host surface.

## Verification boundary

This ultra-speed implementation lane did not run tests, type checking, lint, review, security or
accessibility checks, builds, packaging, installer execution, runtime interaction, or UI captures.
The source implementation and documentation do not prove that a provider adapter, host discovery,
or packaged runtime is wired. Those checks remain unverified for the verification lane.

## Suggested articles

- [Tunnel inventory plan](../../plans/2026-08-26-portable-node-universes-and-hosting-program.md)
- [Shared provider services](./provider-services.md)
- [Docker host manager](./docker-host.md)
- [Portable project binding wizard](../projects/portable-bindings.md)
- [Portable schema 3](../projects/portable-schema3.md)
