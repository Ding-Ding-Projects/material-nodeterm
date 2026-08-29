# Shared hosted-service backups

The shared backup framework gives hosted-service integrations one portable, reviewable archive
contract. GitLab, Nextcloud, Open WebUI, and later hosted-service nodes can provide their own
resource exporter and importer while reusing the same identity checks, archive framing, and
failure handling.

## Archive contract

The platform-free contract is defined in `src/shared/hosted-service-backup.ts`, with the Node-side
archive engine in `src/core/hosted-service-backup.ts`. A backup is identified by
`nodeterm-hosted-service-backup` schema version `1` and contains:

- `mimetype`, `manifest.json`, and `omissions.json` framing entries;
- one `resources/<resource-id>` entry for each portable resource;
- the service identifier, service version, edition, and durable owner identifier;
- the minimum reader version and exporter version;
- raw and compressed byte totals, a SHA-256 hash for every resource, and a canonical payload hash;
- an explicit encryption choice, either `none` or password-protected AES-256-GCM using scrypt;
- omission records for credentials, machine-local bindings, external state, unsupported resources,
  and resources over the documented limit.

Resource identifiers and archive paths are validated before they are written. Absolute paths,
drive-letter paths, traversal segments, duplicate resources, and case-confusable paths are refused.
The manifest never contains a host path, process identifier, container identifier, daemon identity,
credential, or secret-derived value. A provider-specific adapter keeps those values in application
data and supplies them again only during an explicit local binding or restore operation.

## Compatibility and ownership

`checkHostedBackupCompatibility` runs before any restore staging or service mutation. It checks the
service identifier, reader version, accepted editions, owner identifier, and every required
resource. Each resource is checked for kind, version, edition, capacity, and writability. Missing
optional resources are reported as warnings. Missing required resources, incompatible versions,
edition mismatches, insufficient capacity, and read-only targets prevent restore.

An owner mismatch is not inferred from a matching display name. The default result refuses it. A
caller may present an explicit adoption decision, which allows the compatibility result to proceed
while retaining a warning that the destination creates a new local binding. This distinction keeps
copying a portable archive separate from silently taking ownership of an existing hosted service.

## Atomic creation and storage

`createHostedServiceBackup` builds and verifies the complete archive before a destination is
touched. `writeHostedServiceBackupAtomic` performs a storage preflight, writes a unique temporary
file with restrictive permissions, and publishes it through the shared retrying atomic rename
helper. A failed write removes only its own temporary file and leaves the previous backup intact.

Restore staging is always under an absolute, application-data path supplied by the provider adapter.
That path is runtime-only and cannot enter the manifest. `preflightHostedBackupStorage` checks free
space plus a safety margin before creating staging files. Staged resources are removed after a
successful restore or after a failed restore.

## Preview, confirmation, progress, and rollback

`previewHostedServiceRestore` reads and verifies the archive, evaluates compatibility, and returns
the resources that can be used plus every omission. It does not mutate a provider. The preview is
always marked as requiring confirmation.

`restoreHostedServiceBackup` requires a completed two-key destructive-action confirmation bound to
the exact service identifier and resource set. The framework receives only confirmation results,
never password or key material. It stages and hashes all resources first, asks the adapter for a
machine-local rollback snapshot, then invokes the adapter's apply method. If apply fails or the
operation is cancelled, the adapter's rollback method is called before the original error is
returned. A rollback failure is reported separately instead of being hidden.

Both creation and restore accept an `AbortSignal` and progress callback. Progress reports the real
phase, bytes, resource count, and total work. Cancellation before provider mutation removes the
staging directory without changing the service. Adapters should also honour the signal while
their provider-specific apply and rollback work is running.

## Encryption and privacy

Plain archives are useful for local file management and remain structurally inspectable. Password
archives wrap the finished ZIP in an authenticated envelope. A wrong password and a tampered
encrypted payload are intentionally reported as one authentication failure, rather than guessing
which condition occurred. Passwords never appear in a manifest, archive entry, progress event,
history record, log, export, or provider request.

Backups are not a deployment command. Import and restore do not start containers, call a provider,
download images, reconnect accounts, or apply a remote change until a compatible target, explicit
preview, completed confirmation, local rollback snapshot, and staged bytes all exist.

## Verification status

This implementation lane adds the shared contract and core engine. Tests, build verification,
provider adapters, renderer wiring, and built-artifact interaction evidence remain separate work and
are intentionally not claimed here.

Suggested articles: [Minecraft backups](./minecraft-backups.md), [project archives](../projects/project-history-and-archives.md), and [file converter](../../file-converter.md).

