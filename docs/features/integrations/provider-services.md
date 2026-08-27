# Shared provider services

Provider integrations use one core boundary for account metadata, credential storage, OAuth PKCE
callbacks, resource discovery, and destination-machine bindings. Desktop and Server Edition
register the same service through `CorePlatform`; the browser bridge does not invent a second
account store.

## Provider catalog and accounts

The catalog is finite and guided. Google, Microsoft 365, GitHub, Amazon Web Services, and CalDAV
remain visible when their trusted adapter is absent, with the exact unavailable reason. An adapter
supplies its capabilities, authorization route, callback exchange, and resource list. The renderer
receives only bounded labels, opaque account ids, connection state, and disabled-state reasons.

`provider-accounts.json` is private application data. Account metadata is stored beside a sealed
credential payload through `SecureStore`. Desktop uses the operating-system vault through the
platform seal/unseal hooks. Server Edition uses the existing owner-only `0600` fallback. Access and
refresh tokens, passwords, OAuth verifiers, callback state, and provider responses never cross the
renderer bridge or enter a project file.

## OAuth callback lifecycle

OAuth adapters use authorization-code PKCE. Core creates a high-entropy verifier, SHA-256 challenge,
and single-use state value. At most 64 sign-ins may wait at once and each expires after ten minutes.
Authorization URLs must preserve the generated state and use HTTPS. The callback must target the
exact configured loopback route, carry a live unused state, and arrive before expiry. The pending
record is consumed before exchange, so replay and repeated error callbacks fail.

No callback is typed into a form. The trusted shell delivers the callback URL to core. Provider
credentials returned by a successful adapter exchange are sealed immediately; only the resulting
account summary is returned to the interface.

## Local bindings and portability

`portable-node-bindings.json` stores destination-only account and resource references. The schema 3
project projection carries feature intent, layout, relationships, capabilities, and safe settings.
It omits credentials, account sessions, callback state, machine paths, host identities, runtime
processes, caches, and generated data.

The binding wizard uses searchable account and resource lists, each with an adjacent anchored regex
builder. Configure, Rebind, and Adopt require a connected account and a resource verified by that
account's adapter. Locate Asset uses the local file picker. Deploy remains visible but disabled
until a provider-specific deployment flow is installed. Leave Unbound is always available. Import
does not open the wizard or call any provider.

## Failure and recovery

- An unreadable credential store rejects the operation and is never presented as an empty list.
- A missing adapter leaves its provider visible and disabled with the adapter reason.
- Unknown, expired, replayed, mismatched, or refused OAuth callbacks create no account.
- A missing or unavailable account cannot produce a local binding.
- A provider resource must be returned as available by its adapter before binding.
- Binding persistence snapshots the prior file and restores it when publication fails.

## Verification boundary

This ultra-speed implementation lane did not run tests, type checks, lint, reviews, security or
accessibility checks, builds, packaging, installer execution, runtime interaction, or UI captures.
The implementation is source-complete for the shared service boundary; individual provider adapters
and their provider-specific deployment behavior belong to their own lanes.

## Suggested articles

- [Portable project binding wizard](../projects/portable-bindings.md)
- [Calendar nodes](../calendar/README.md)
- [Special-universe Shop nodes](aws-universe-shop.md)
- [Service nodes](service-nodes.md)

