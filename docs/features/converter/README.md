# Converter pipelines

The converter surface provides bounded local transformations for structured data, text, binary
encodings, images, ZIP archives, and selectable PDF text. The full operating contract is in
[`../../file-converter.md`](../../file-converter.md), including the disabled-state policy for native
audio, video, OCR, and advanced PDF tools.

## Behaviour

The catalog is exhaustive for this build. It keeps unavailable formats visible with the exact
missing verified dependency. JSON Lines is a structured format rather than an extension guess,
image conversion uses the bundled `sharp` codec, and PDF inspection and selectable-text extraction
are bounded in-process operations. ZIP creation and extraction are available through the advanced
pipeline engine, which produces per-entry results for extraction.

Every operation validates source signatures, size, output bytes, and format before publishing. ZIP
entries must be relative, unique, non-empty paths. Traversal, symlink entries, malformed archives,
oversized expansion, and partial output are refused. Lossy operations disclose pixel, metadata,
animation, scan, or structure loss before the user starts them.

## Configuration and persistence

The ordinary queue persists at the app-data converter queue path. Multi-output advanced jobs use
the schema-versioned advanced queue in the same private converter directory. Concurrency is bounded,
progress is stage-labelled, and pause, cancel, retry, and crash recovery preserve the input.
Destination paths are user-selected and output publication is atomic and no-clobber unless the
existing confirmation route explicitly allows replacement.

## Security

Native tools are never found on `PATH` and no network service is used. `executeVerifiedTool` accepts
only a registered executable beneath the private converter-tools resource directory, verifies its
digest when configured, passes a fixed argv list with `shell: false`, strips the environment, and
enforces runtime and output limits. Credentials, source contents, and private paths do not enter
tool arguments, logs, queue snapshots, exports, or public records.

## Failure modes

An unavailable decoder remains disabled and names its recovery action. Invalid input, bounds
exhaustion, cancellation, output validation failure, destination collision, or a missing verified
tool produces a distinct queue outcome. A corrupt queue snapshot is quarantined and the app starts
with an empty advanced queue rather than treating corrupted state as success.

## Verification

The implementation is in `src/core/converter/advanced-pipelines.ts`, `advanced-queue.ts`, and the
ordinary queue registry. The assigned ultra-speed lane intentionally did not run tests, type
checking, builds, packaging, runtime interaction, security review, accessibility review, or UI
captures. Those Chuts remain open until the owning release lane runs them against the built artifact.

## Suggested articles

- [`../../file-converter.md`](../../file-converter.md), ordinary queue and browser staging
- [`../packaging/README.md`](../packaging/README.md), bundled dependency and installer rules
- [`../help/README.md`](../help/README.md), offline article browser

