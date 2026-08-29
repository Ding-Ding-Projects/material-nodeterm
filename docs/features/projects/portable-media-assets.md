# Portable media assets and sidecars

Schema 3 treats media as content, not as a machine path. An included image, audio stream, or video
is stored under assets/media/<sha256>.<extension>. The final bytes are read again before export,
and the recorded length, SHA-256, MIME type, extension, and detected kind must agree. Unsupported
or malformed bytes remain unavailable rather than being renamed from a file extension.

## Decisions

The export surface presents three explicit choices for every candidate:

- **Include** stores the exact bytes and a content-addressed reference.
- **Omit** stores an explicit omission record with the user's choice.
- **Locate Later** stores an unresolved identifier plus a safe display label. It never stores an
  absolute path and never derives the placeholder from a source path.

The picker is metadata-only until the user confirms export. The core then reads the selected source
through the privileged file boundary, so merely opening the picker cannot copy bytes or grant a
source path to the archive.

PNG, JPEG, GIF, WebP, AVIF, WAV, FLAC, MP3, Ogg Opus/Vorbis, MP4, QuickTime, and WebM signatures
are inspected within bounded input bytes. Dimensions must be paired, image dimensions cannot be
attached to audio or video, and images cannot carry a duration. Unknown formats remain visible as
unsupported choices.

## Sidecars and board history

Approved app-owned sidecars use the sidecars/ namespace. The portable board history path is
sidecars/.nodeterm/board-log.jsonl. Import parses this sidecar strictly, rejecting malformed JSON,
invalid entries, and unknown entry or author keys. The live board display parser remains tolerant
so one damaged live line cannot hide all other comments; export validation is stricter because an
archive must be reproducible.

Attachment upload sessions are host-owned. They enforce an owner identity, bounded quota, expiry,
serialized append operations, commit and rollback states, and expiry reaping. Uploaded bytes are
kept in the host's staging store and are never inferred from a browser filename.

## Privacy and failure behavior

Absolute paths, SSH connection data, credentials, process identifiers, provider state, and session
hydration are not portable media fields. A failed read is distinct from a missing file. Every
download or import checks length, hash, signature, and the relevant structural metadata before
offering the result. Cancellation leaves the existing destination unchanged.

## Verification

Focused checks cover signature detection, exact byte hashes and lengths, strict manifest keys,
Include/Omit/Locate Later decisions, deterministic archive output, media round trips, board-log
sidecar rejection, attachment ownership, quota, expiry, serialization, commit, and rollback.
The current implementation lane intentionally does not run the general test suite, type checks,
builds, packaging, UI launches, or captures.

## Suggested articles

- [Portable project schema 3](./portable-schema3.md)
- [Portable canvas projection](./portable-canvas-projection.md)
- [Project history and archives](./project-history-and-archives.md)
