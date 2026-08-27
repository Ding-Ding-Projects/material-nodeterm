# Multiverse door entry

Multiverse portal doors can request a numeric code, a passphrase, or either method. This entry
surface is separate from toy locks: a door credential is used by the portal transition flow, while
a toy lock only adds a local presentation speed bump. The entry panel does not import, share, or
reuse toy-lock state.

## Guided entry

`UniverseDoorEntryPanel` presents the enabled methods as a real Material Design 3 segmented
control. The panel includes a local plain-text search field with its own adjacent anchored full
regex builder. Filtering never changes the configured policy. The search field starts in plain-text
mode and only enters regex mode when the user opens the builder.

Numeric entry uses a text control with numeric keyboard hints, an exact digit limit, and an explicit
instruction naming the required number of digits. Passphrase entry uses a password control with a
bounded 256-character limit and an instruction naming the minimum length. Empty values, malformed
numeric values, wrong lengths, and out-of-range passphrases are rejected inline before the caller
receives a submission. The panel has keyboard-operable method selection, visible focus, screen
reader names and states, a cancel action, and a disabled submit action while the caller is busy.

The destination label is supplied by the caller as an exact fact. It is displayed beside the
localized explanatory copy and is not stored in the credential policy.

## Schema 3 portability

`PortableUniverseDoorEntryV3` is the portable policy. It contains:

- `schemaVersion: 3`;
- a bounded door identifier;
- one or both supported methods;
- the default method; and
- bounded numeric-code and passphrase length rules when those methods are enabled.

The validator rejects unknown fields, duplicate methods, case-colliding door identifiers, invalid
length rules, unsupported methods, and any schema version other than 3. It also rejects accidental
credential-shaped fields instead of silently dropping them.

Portable exports therefore never contain numeric values, passphrases, credential fingerprints,
vault material, provider sessions, machine paths, or runtime handles. A local application-data
binding contains only the stable vault key, the selected method, and the `credential-vault` storage
marker. The vault adapter is owned by the caller and must never place the secret in project files,
logs, exports, history, or diagnostics.

Import of this policy is pure. It does not contact a provider, open a process, launch a portal, or
perform deployment. A destination computer must configure or rebind its local credential before a
door can be used.

## Failure and recovery behavior

The entry policy is validated before a caller stores or submits a value. A rejected value remains
in the panel for correction, but the secret is never included in validation messages. A caller that
cannot reach its vault or cannot verify the door reports that condition as a non-blocking error and
keeps the door closed. The policy does not provide a bypass route, and it does not grant access to
any other door or toy lock.

## Three surfaces

- **Desktop:** the anchored entry panel is available to the Electron renderer and delegates the
  final credential check and vault operation to its owning door flow.
- **Server Edition:** the same React panel can be rendered by the browser edition; its owning
  server flow supplies the local credential boundary and must not put credentials in the portable
  projection.
- **Mobile companion:** the companion can display the portable policy and an unbound Configure or
  Rebind route. It must keep the same credential omission rules when its own implementation is
  added.

## Verification status

This implementation lane intentionally did not run tests, type checks, lint, builds, packaging,
installer execution, runtime interaction, accessibility review, security review, or UI captures.
Those checks remain pending for the integrated portal flow. The feature's schema validator and
panel are reusable seams for that later verification pass.

## Suggested articles

- [Door-only universe navigation](./door-only-universe-navigation.md)
- [Portable project schema 3](../projects/portable-schema3.md)
- [Portable canvas projection](../projects/portable-canvas-projection.md)
- [Toy locks](../../toy-locks.md)

