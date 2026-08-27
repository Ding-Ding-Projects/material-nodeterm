# Shared hosted-resource backup and restore

Status: **implemented as a platform-free framework for later hosted-service nodes.** This lane
defines the portable archive contract and the local publication seam. It does not deploy a service,
contact a provider, start a process, or choose credentials.

## Behaviour

`src/shared/backup-restore.ts` is the single contract for hosted-resource backups. A manifest records
the framework schema, product, resource id and kind, edition, source, ownership evidence, resource
version, payload hashes, byte totals, and explicit omissions. A backup must contain at least one
required payload entry. A hosting node can therefore consume the same contract for a database,
uploads volume, configuration set, or complete service without inventing a new archive format.

`src/core/backup-restore.ts` frames the manifest and payload as a bounded ZIP archive. The archive
reader rejects unsafe paths, traversal, absolute paths, duplicate or case-colliding entries,
unsupported ZIP features, oversized entries, decompression-bomb totals, checksum mismatches, and
unknown payloads. A corrupt archive remains an invalid result rather than disappearing from a list.

## Version, edition, resource, and ownership review

Restore review is explicit and side-effect free. The selected destination resource must match the
recorded id and kind. Community-to-Enterprise restore is an upgrade and requires an explicit
option. Enterprise-to-Community restore and restoring a newer resource into an older version are
disabled unless the caller explicitly allows the downgrade. Owned or adopted resources require an
opaque owner id. External or unknown ownership is never treated as owned; it requires explicit
adoption or remains refused.

Version ordering is conservative. Numeric dotted versions can be compared; other version strings
produce an unknown verdict and a visible warning. Credentials and provider sessions are always
omissions, so a successful review still tells the hosting node that local re-entry is required.

## Publication, progress, cancellation, and rollback

`HostedBackupArchiveStore.publish` validates the complete archive, refuses an existing destination,
writes a unique temporary file, and publishes it through the shared retrying atomic writer. A
failed publication removes only its own temporary file. `runBackupRestoreTransaction` gives every
long operation a phase, bounded progress value, byte counts where known, cancellation state, and
an honest terminal message. Staging and validation happen before publication. A failed restore can
invoke the adapter's rollback callback, and the rollback contract is versioned, resource-bound,
hash-bound, and expiry-checked before use.

`backupHostedResource` connects an adapter's verified description and byte-aware capture to the
same staged transaction, so future nodes get one consistent path for preflight, capture, archive
validation, collision-safe publication, cancellation, and terminal progress.

The adapter seam is deliberately narrow:

- `describe` returns verified resource facts;
- `capture` returns payload entries plus explicit omissions;
- `prepareRestore` stages without publishing and can emit byte-aware progress;
- `validateRestore` checks the staged destination;
- `publishRestore` applies the reviewed change;
- `rollbackRestore` restores the prior state after a failed publication or validation;
- `disposeRestore` removes staging litter after the operation.

No adapter method receives an arbitrary shell command, raw provider request, credential value, or
unvalidated host path.

## Guided controls and search

The framework exports a hand-written guided-control inventory covering resource, edition, version,
archive, review, backup, restore, cancellation, and rollback actions. Each list or picker has its
own plain-text-first search field and an adjacent anchored full regex-builder contract:

- saved backups;
- verified destination resources;
- archive entries and omissions;
- restore review evidence and warnings;
- backup, restore, and rollback operation history.

Each disabled action carries a concrete reason, such as missing verified resource metadata, an
unaccepted review, or the absence of an unexpired rollback contract. Later hosting nodes should
bind these controls to their Material Design 3 surfaces and keep each field's query, pattern,
flags, validation, and mode isolated.

## Persistence and privacy

The archive store is local to the host shell. It stores only validated archive bytes under a
resource-and-backup identifier. Provider sessions, credentials, machine paths, process state,
host identifiers, caches, and generated runtime data never enter the portable manifest or payload.
Import and restore review make no network request and perform no provider mutation until the owning
hosting node receives an explicit reviewed action.

## Surfaces

- **Desktop:** the core publisher is available to the Electron shell for future hosting nodes.
- **Server Edition:** the same platform-free contract can be hosted on the server machine; no
  client receives credentials or provider state.
- **Mobile companion:** the companion may display safe backup metadata, but live publication and
  restore require an implementation in its separately maintained surface.

## Verification boundary

This ultra-speed implementation lane intentionally ran no tests, type checks, lint, reviews,
security checks, accessibility checks, builds, packaging, installer execution, runtime
interaction, or UI captures. The source contract and documentation are present; those verdicts
remain unverified.

## Suggested articles

- [Portable bindings](../projects/portable-bindings.md)
- [Portable schema 3](../projects/portable-schema3.md)
- [Project history and archives](../projects/project-history-and-archives.md)
- [Service nodes](service-nodes.md)
