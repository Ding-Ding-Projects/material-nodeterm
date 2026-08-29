# Provider accounts, vault references, OAuth callbacks, and local bindings

Provider accounts are named local profiles for services that a canvas node or project blueprint
may use. The profile list is a real, searchable settings surface. It supports known providers and
an explicitly configured custom provider, account labels, permissions, expiry, selection, and a
clear recovery path when sign-in is needed again.

## Portable versus local data

The project's portable `providerBlueprints` list contains only safe intent: an opaque blueprint id,
provider id, display label, optional account label, declared scopes, authentication kind, and a
validated endpoint. It does not contain a token, cookie, password, authorization code, vault bytes,
absolute path, process state, host identity, or cache.

The machine-local workspace index carries `providerBindings`. A binding points from a local project
or node to a portable blueprint and, optionally, an opaque credential-reference id. Bindings never
enter `.nodeterm/project.json`, so opening a project on another computer does not silently select a
credential that belongs to this one. The destination computer can explicitly configure, rebind,
adopt, or leave the blueprint unbound.

## Credential references

Credentials are write-only at the UI boundary. The core seals the value through the shell's
operating-system vault hook and returns only a reference id, provider, permission metadata,
creation/update times, and an optional expiry. A missing vault hook is an honest host limitation,
not permission to render the secret or place it in settings, project files, exports, logs, history,
or the renderer bundle. Clearing a credential replaces the sealed payload with an empty marker and
returns the profile to `needs-auth`.

The profile remains visible after expiry or revocation. Its status says `expired`, `revoked`,
`needs-auth`, or `error`, and the next action is explicit. An expired profile is never treated as a
valid credential and an unreadable store is never treated as an empty profile list.

## OAuth callback lifecycle

`Start OAuth sign-in` validates the authorization and redirect URLs, creates a short-lived callback
handle with a single-use state value, and opens the provider authorization URL. The state is bound
to the provider and profile and expires after ten minutes. A completion consumes the handle before
grading the callback value, so a replay or wrong provider cannot be retried against the same state.
Cancellation removes the pending handle. The callback value is written directly into the sealed
credential store and never returned by the service.

The callback surface reports pending, completed, expired, cancelled, and rejected outcomes. It does
not claim that a provider session is ready until a credential reference was actually stored.

## Selection and bindings

Selecting a profile changes the machine-local active profile only. Binding a profile to a project or
node creates a separate local binding and clears the selected flag from the previous binding for
that same project/node scope. Unbinding removes only the pointer; it never deletes the provider
profile or its credential. Removing a profile also removes bindings that reference its credential.

## Desktop and Server Edition boundaries

The service is implemented in `src/core/provider-accounts-service.ts` and is registered by both
`src/main/index.ts` and `src/server/index.ts` through the shared IPC contract. Electron uses its
operating-system vault hook. The Server Edition uses the same sealed-store interface supplied by
its host and exposes the same metadata-only browser API. A relay tab does not gain access to this
machine's provider store, because the provider-account namespace is a host-local core surface.

The renderer uses guided provider and authentication pickers, a profile search with an adjacent
anchored regex builder, write-only credential fields, status and expiry text, selection, binding,
clear, remove, and OAuth cancellation controls. Disabled actions name the missing project,
blueprint, or OAuth URL required to enable them.

## Failure modes and recovery

- A malformed provider id, oversized label, unsafe endpoint, or oversized credential is rejected
  before persistence.
- A missing profile or blueprint is reported as unavailable, never guessed from a display name.
- An expired callback is rejected and the user can start a fresh OAuth attempt.
- A failed vault read propagates as an unavailable store; it is not converted into an empty list.
- Clearing or removing a profile is local metadata cleanup. It does not revoke the account at the
  provider, which must be done through that provider's own account controls.

## Verification boundary for this lane

This implementation lane intentionally did not run tests, type checks, lint, security checks,
builds, packaging, installer execution, runtime interaction, or UI captures. The code and docs are
landed for the later verification lane; artifact production and release evidence must not be
described as feature verification.

## Suggested articles

- [Portable canvas projection](./portable-canvas-projection.md)
- [Portable project schema 3](./portable-schema3.md)
- [Password manager](./password-manager.md)
- [Projects and tabs](./projects-and-tabs.md)

