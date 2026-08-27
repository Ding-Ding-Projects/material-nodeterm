# Comment attachments

Comments and Activity support portable project attachments for generic files and media. The
composer accepts files through a semantic picker, drag and drop, and clipboard paste where the
host provides file data. Every selected item appears in a removable queue before the comment is
posted.

## Behaviour

The queue displays the original display name, byte size, detected kind, read status, progress-ready
state, and a bounded validation error. Image, audio, and video items receive safe local previews;
other files remain generic download items. An empty comment and a failed attachment read are
different states. A comment with no text is still postable when it has at least one validated file.

The host detects kind and MIME from bounded file bytes, never from an extension or browser MIME
claim. The shipped limit is 6 MiB per attachment, 16 items per comment, and 255 UTF-8 bytes for a
display name. The server upload path stays below the 8 MiB WebSocket frame budget by staging browser
Blobs through its authenticated HTTP upload endpoint.

## Portable storage and integrity

Posted files are copied into `.nodeterm/board-attachments/` using collision-safe content-addressed
identifiers with a random suffix. The board-log entry stores only the id, display name, detected
kind, MIME, byte count, SHA-256, stable reference, and relative archive path. It never stores an
absolute source path. A source read and board-log append form one transaction. If the log write
fails, files created by that operation are removed.

Schema 3 project archives carry the board log under `comments/` and the referenced carriers under
`assets/attachments/`. Import validates safe names, references, archive paths, kinds, byte counts,
SHA-256 values, and byte signatures before staging. After restart, previews and downloads read the
carrier again and repeat the integrity check. Missing, changed, or unreadable carriers remain an
honest failure instead of an empty comment or a guessed file.

## Surfaces

- **Desktop:** native file paths are consumed by the privileged host. Clipboard and browser-origin
  files use the existing bounded upload staging route. Local project folders and connected SSH
  projects use the same transaction, atomic publication, and carrier validation rules.
- **Server Edition:** browser-owned Blobs use the authenticated upload endpoint and are then handled
  by the same local project archive store. The renderer never sends attachment bytes through the
  WebSocket RPC channel.
- **Mobile companion:** no mobile attachment protocol was added in this lane. The companion can
  continue to show text comments and must present the attachment capability as unavailable until a
  bounded carrier protocol is agreed.

## Accessibility and presentation

The queue is keyboard reachable, has named remove actions, exposes byte size and status to assistive
technology, and keeps filenames wrapping instead of clipping. The drop region has a picker fallback,
works at narrow widths and high display scales, and respects reduced motion. Existing language modes,
funny-level styling, School mode, notifications, local history, and export boundaries remain the
owners of surrounding copy and records. Attachment names, MIME values, sizes, and integrity facts
remain exact.

## Security

Attachment paths are checked for symlink or reparse-point ancestors before reads and writes. Archive
paths are fixed relative names and cannot escape the destination. Remote storage uses an atomic
temporary file and a decoder selected from available POSIX-compatible tools rather than assuming a
single `base64` dialect. No credential picker, secret field, network preview, third-party converter,
or remote media service is introduced.

## Verification

The source implementation is present on issue #94's isolated branch. This lane intentionally did
not run tests, lint, type checks, builds, packaging, runtime interaction, reviews, security or
accessibility audits, or captures. The integration owner must regenerate the offline docs bundle,
run focused portable round-trip and failure-path checks, exercise the built Desktop and Server
Edition surfaces, and capture the resulting states before treating this feature as verified.

## Suggested articles

- [Portable media assets](./media-gallery.md)
- [Project history and archives](../projects/project-history-and-archives.md)
- [Exports](../exports.md)
- [Kanban board](../kanban/README.md)
