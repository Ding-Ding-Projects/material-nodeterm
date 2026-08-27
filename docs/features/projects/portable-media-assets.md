# Portable media assets

Portable schema 3 projects carry project-owned image, audio, and video assets by content address.
The asset identifier is the SHA-256 of the bytes, so two copies of the same media deduplicate and
the importer can verify the bytes independently of the filename. Source filenames may be displayed
while choosing an export, but source paths and machine identity are never written to the portable
manifest.

## Include, Omit, and Locate Later

Before export, the guided media picker lists every candidate and offers three explicit decisions:

- **Include** copies validated bytes into the archive under `assets/media/<sha256>.<extension>`.
- **Omit** leaves the media out and records a user-choice omission.
- **Locate Later** leaves an unresolved placeholder identified by the content address and records
  that the source is machine-local. The destination can offer a later file picker without guessing
  or silently dropping the node.

The picker has a plain-text search field and an adjacent anchored full regex builder. Each row is a
real set of buttons, with keyboard focus, pressed state, and an accessible decision group. A missing,
unsupported, or invalid source remains represented by an omission or placeholder and includes a
bounded reason. Include is disabled with that exact reason when no bundled parser can prove the
media facts. No blank path textbox or arbitrary command is used as a fallback.

## Validation and privacy

Collection uses a regular-file check, a bounded streaming hash, signature detection, MIME and extension
normalisation, and SHA-256. Export re-reads the selected file under the 512 MiB per-asset bound,
refuses a file that changed after preparation, and requires parser-proved facts before publication.
Images decode through the bundled image parser, WAV parses its format and data chunks, and MP4 or
QuickTime parses movie timing plus video-track dimensions. Frame counts are recorded for decoded
images. Formats with a recognised signature but no bundled structural parser remain available for
Locate Later or Omit, never Include. Extension-only claims are rejected. Recognised signatures cover
common PNG, JPEG, GIF, WebP, AVIF-labelled image inputs, WAV, MP3, Ogg, FLAC, MP4, QuickTime, and
WebM media. The schema bounds each asset at 512 MiB and the manifest at 10,000 assets. Imported
manifests require schema 3, matching content addresses, safe labels, valid media kinds, and bounded
dimensions, durations, and frame counts.

Portable media does not contain credentials, provider sessions, process state, host identifiers,
absolute paths, cache data, or generated runtime data. Import validation is pure and has no network,
deployment, process-launch, download, or provider side effect. A corrupt or mismatched asset rejects
the asset rather than applying partial bytes.

## Persistence and availability

The portable manifest belongs in the schema 3 `project.json` projection. The source path is a
machine-local binding used only by the export picker. Included bytes are archive entries; omissions
and unresolved placeholders remain in the manifest so the destination can present Configure,
Locate Asset, or Leave Unbound actions later. The browser edition and mobile companion should use
the same platform-free manifest and document their carrier limitations before wiring a picker.

The desktop bridge returns only path-free decision candidates and a single-use preparation id.
Decisions cross the bridge as bounded `{ assetId, decision }` records. Included bytes are written
under `assets/media/<sha256>.<extension>` and are covered by the outer schema 3 entry hashes. Import
matches every resolved manifest record to exactly one archive entry and repeats signature, hash,
size, and parser-fact validation before writing anything. Project data and media are staged together
beside a new destination, then the complete directory is published by one atomic rename. Failure or
cancellation removes only that task's temporary directory.

## Verification status

The media contract and parser proof are implemented in `src/core/portable-media-assets.ts`; real
container bytes and atomic destination publication are implemented in
`src/core/portable-project-import.ts`; the typed desktop bridge is declared in
`src/shared/portable-media.ts` and carried through `src/shared/ipc.ts`, `src/preload/index.ts`, and
`src/main/index.ts`; and the guided surface is
`src/renderer/components/PortableMediaDecisionDialog.tsx`. This lane deliberately did not run tests,
type checking, linting, reviews, security checks, accessibility checks, builds, packaging, installer
execution, runtime interaction, or captures. These source changes are therefore implemented but
unverified.

## Suggested articles

- [Portable project schema 3](./portable-schema3.md)
- [Portable canvas projection](./portable-canvas-projection.md)
- [Project history and archives](./project-history-and-archives.md)
- [File converter](../files/file-converter.md)
