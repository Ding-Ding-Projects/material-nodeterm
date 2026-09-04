# Advanced media pipelines

**Category:** [Files and media](./README.md)

Advanced media is the second file-tool surface. It is intentionally separate from the express file
converter because some operations create several files, write a destination directory, or need a
bounded local process. The implementation is shared by the desktop app and Server Edition through
the `CorePlatform` seam.

## Behaviour

The catalog is explicit and grouped by capability:

| Capability | Built-in behaviour | Output |
| --- | --- | --- |
| Image inspection | Reads PNG, JPEG, GIF, WebP, BMP, and ICO headers, including dimensions and MIME type | JSON text |
| Archive listing | Reads ZIP central-directory metadata and TAR headers | JSON text |
| Archive extraction | Extracts ZIP and TAR entries after strict path and size validation | Validated files in a chosen folder |
| Archive creation | Creates a ZIP or TAR from selected files | ZIP or TAR |
| PDF inspection | Validates the PDF header, counts pages, and reports encryption | JSON text |
| PDF text extraction | Reads bounded literal text strings from an unencrypted PDF | UTF-8 text |
| Media probing | Runs the verified `ffprobe` executable with a generated argument vector | Validated JSON |
| Image OCR | Runs the verified Tesseract executable against an image | UTF-8 text |
| PDF OCR | Rasterizes one PDF page with the verified PDF rasterizer, then runs Tesseract | UTF-8 text |

Image transcoding, audio transcoding, video transcoding, and 7-Zip container operations are not
pretended to be available. They remain visible as unavailable capabilities in the existing
converter catalog until a verified adapter is shipped.

## Configuration and persistence

The queue is persisted below the application data directory at
`advanced-media/jobs.json`. It contains operation ids, selected source paths, destination choices,
progress, warnings, and terminal status. It does not contain source bytes, credentials, process
environment values, or external tool output beyond bounded error text. A running item is restored
as queued after an app restart.

External tools are described by a package-owned manifest and installed below
`advanced-media/tools`. Each record carries the exact HTTPS source, version, executable name, and
SHA-256 digest. The manager refuses a missing or mismatched digest, never searches `PATH`, never
accepts an arbitrary URL, and writes through an exclusive temporary file followed by an atomic
rename. An empty manifest is valid and keeps external rows disabled.

## Guided operation

Every operation has a catalog row with source and target formats, lossy disclosure, input and output
budgets, entry and page limits, and a timeout. Queue requests require a selected source and a real
destination file or folder. Archive extraction rejects absolute names, drive-letter names,
traversal segments, links, devices, duplicate entries, encrypted ZIP records, unsupported ZIP
methods, oversized entries, and aggregate output over the configured budget.

Progress is emitted with a phase, percentage, bytes read, bytes written, total bytes, and a factual
message. A cancellation request aborts a running external process or marks a queued item cancelled.
Pausing stops new work without claiming that an active process paused. Retries are available only
for failed or cancelled items. Existing destinations are refused rather than overwritten.

## Process boundary

External tools run with `shell: false`, an absolute verified executable path, bounded argument count
and argument length, a reduced environment, hidden windows, a hard deadline, and capped stdout and
stderr. The renderer never supplies a raw command line. The adapter creates each argument from a
validated path or a fixed option. Cancellation kills the child process and the queue records the
cancelled state.

## Failure modes

- A source that is missing, not a regular file, or over the adapter budget is refused before queue
  admission.
- A malformed ZIP, TAR, image, or PDF fails the operation and leaves the source and destination
  unchanged.
- An output that fails its format validator is removed before success is reported.
- A destination that already exists is refused with a choose-another-destination message.
- A missing or digest-mismatched external tool remains unavailable. The app does not fall back to a
  developer machine executable or silently use a similarly named binary.
- A timed-out, cancelled, non-zero, or oversized external process is recorded as failed or
  cancelled with the exact bounded reason.
- A partial batch keeps each output and status separate. One successful item never turns failed or
  cancelled siblings green.

## Security considerations

Archive paths are treated as hostile input. Extraction uses a strict relative-path allowlist and
checks the destination path again before every write. Writes use private mode and atomic rename.
The source is never deleted or modified.

The external process boundary has no shell, no arbitrary environment expansion, no network grant,
and no credentials. Tool installation accepts only package-owned HTTPS URLs and recorded digests.
The dependency manager stores only validated binaries in application data. It does not put them in
the repository, release notes, logs, exports, or user project files.

PDF text extraction is deliberately conservative. It is not a complete PDF renderer and does not
claim to recover text from encrypted, malformed, scanned, or font-only pages. OCR of those pages is
a separate operation with its own rasterizer and Tesseract dependency.

## Verification

The focused verification plan must cover ZIP and TAR traversal refusal, duplicate and oversized
entries, atomic destination writes, PDF encryption and page limits, image signature and pixel
limits, queue restart recovery, cancellation, timeout, process output caps, argv shell refusal,
digest mismatch, and partial batches. External-tool cases must run against the packaged verified
tool, not a tool discovered on `PATH`. The ultra-speed implementation boundary for this lane did
not run tests, type checks, lint, security checks, builds, installer execution, runtime interaction,
or UI captures.

## Suggested articles

- [File converter](../../file-converter.md)
- [Exports](../../exports.md)
- [Atomic writes](../../atomic-writes.md)
- [Local history](../../local-history.md)
- [Material Design 3 primitives](../../md3-primitives.md)

