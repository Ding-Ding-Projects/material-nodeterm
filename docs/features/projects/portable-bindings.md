# Portable bindings

Schema 3 carries safe node intent separately from destination-machine bindings. Import creates a
fresh project identity and leaves every node unbound. It never starts a provider, launches a
process, restores a session, adopts a local executable, or copies a credential.

## Guided destination choices

After import, the binding wizard enumerates Configure, Rebind, Adopt, Deploy, Locate Asset, and
Leave Unbound. Each unavailable route remains visible with its exact reason. Configure, Rebind,
Adopt, and Locate Asset accept only opaque local references. Credential values, executable paths,
process state, provider responses, and arbitrary command strings are not portable fields.

Bindings live in a machine-local store with an atomic replacement path. A failed update restores
the prior record. Import itself never calls this store, so opening an archive cannot silently
change the destination machine.

## Verification

Focused checks cover strict blueprint and local-binding validation, forbidden fields, unknown keys,
disabled actions with reasons, local persistence, snapshot and rollback, cancellation, and the
empty binding result returned by import. Platform-specific provider or SSH behavior remains outside
this lane until a real local resource is available.

## Suggested articles

- [Portable project schema 3](./portable-schema3.md)
- [Portable media assets and sidecars](./portable-media-assets.md)
- [Project history and archives](./project-history-and-archives.md)
