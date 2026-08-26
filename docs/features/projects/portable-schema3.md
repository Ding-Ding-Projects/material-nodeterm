# Portable project schema 3

Schema 3 defines the platform-free envelope used by portable project saves. Its manifest identifies
itself as `nodeterm-portable-project` with `schemaVersion: 3`, records a deterministic SHA-256,
raw-byte, compressed-byte, and requiredness record for every payload entry, and records omissions
instead of silently dropping optional material. `manifest.json` is required archive framing and is
not included in `manifest.entries`, which avoids hashing a document that contains its own hash.

## Inventory and safety

The canonical archive entries are `manifest.json`, `project.json`, and `history.bundle`, while the
hashed payload-required entries are `project.json` and `history.bundle`. The reader also recognises
`repository.bundle` and `files/` entries as optional. Vault material has no portable entry and is
always excluded. Unknown required entries are refused. Unknown optional entries are represented by
an omission with a reason and are not imported.

Entry paths must be relative, use forward slashes, contain no empty, dot, or parent segments, and
must not contain a drive prefix, leading slash, backslash, or NUL. Duplicate names and
case-colliding names are refused because extraction environments do not agree about case.

The envelope is bounded before content is accepted: 60,000 entries, 2 GiB of raw bytes, 512 MiB
of compressed bytes, 2 GiB per entry, 2,000 omissions, and a 4,096-byte UTF-8 path. Every recorded
digest and raw/compressed size is checked against the supplied bytes. A mismatch rejects the
complete envelope. Parsed metadata is checked against the same per-entry and aggregate ceilings
before payload handling. `parsePortableProjectV3Manifest` uses fatal UTF-8 decoding, so malformed
bytes cannot become replacement characters and pass JSON parsing. Omission paths are unique,
case-collision checked, and cannot contradict included entries.

`src/core/portable-project-import.ts` uses the same inventory for the complete archive read. It
validates every payload hash before migration or staging, refuses destination collisions, and
publishes an optional destination from an import-owned sibling stage. The staged runtime file is
re-readable by the workspace store, while the original schema 3 projection is retained beside it
for future canvas scopes.

## Migration boundary

Pure V1 and V2 migration removes exact identity fields such as `id`, paths, account references,
capability acknowledgements,
navigation history, execution bindings, SSH details, credentials, vault material, tokens, and
passwords recursively, with bounded depth and node counts.
The module has no filesystem, process, desktop, or credential imports, so migration cannot acquire
machine-local state as a side effect.

## Verification status

The schema 3 validator, manifest builder, and atomic import seam live in
`src/core/portable-project-v3.ts`, `src/core/portable-project-import.ts`, and are re-exported by
`src/core/project-archive.ts`. This implementation lane intentionally did not run
tests, type checking, linting, builds, packaging, or runtime captures. Those checks remain required
before the roadmap item is marked complete.

## Suggested articles

- [Project history and archives](./project-history-and-archives.md)
- [Projects and tabs](./projects-and-tabs.md)
- [Password manager](./password-manager.md)
