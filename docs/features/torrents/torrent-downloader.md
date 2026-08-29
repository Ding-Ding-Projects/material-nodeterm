# Torrent Downloader

The Torrent Downloader is a canvas node for local peer-to-peer transfers. It uses one pinned,
MIT-licensed WebTorrent runtime bundled in the application package. A missing bundle is reported as
unavailable; it never consults PATH, npm, a registry, or a network fallback.

## Behaviour

Create it from the canvas context menu under **Canvas objects**, or from the command palette as
**New torrent downloader**. Paste a `magnet:?xt=urn:btih:...` URI or choose a local `.torrent` file
through the native picker. A destination folder is required before the add action is enabled.

The node creates a machine-local task and waits for metadata. Before a client contacts trackers,
DHT, or peers, the user must accept a disclosure naming those contacts, the local IP address,
seeding, and the destination. A metadata-only task is paused and deselected until its destination,
free space, quota, and selected paths pass a second preflight. The metadata view lists every safe
relative file path, its byte size, and a checkbox for selection. File paths containing `..`, empty
segments, control characters, drive or UNC roots, reserved names, trailing dot or space, or an ADS
colon are rejected before they can escape the chosen destination. The destination preflight requires
a known free-space measurement and reserves payload plus bounded piece/temp overhead against a
per-task and global quota.

Each task reports status, percentage, downloaded and total bytes, current speed, peer count, and an
ETA when the runtime can calculate one. Pause, resume, cancel, and retry operate on the real
WebTorrent handle. Retry keeps the task identity and reconciles against the existing local data.
The node also exposes a task search with plain text as the default and an adjacent regex-builder
panel for deliberate pattern matching. Tasks support keyboard-selectable rows, shift-range selection,
select-all and invert selection, reviewable bulk pause, resume, cancel, retry, remove, and redacted
clipboard export actions with per-item outcomes. Informational failures use the app notification
centre, while mutation facts are appended to the machine-local torrent history log.

## Configuration

Seeding is per task and defaults to **Do not seed**. The bounded choices are never, a ratio up to
10.0, a duration up to 24 hours, or explicitly indefinite. Completed files remain on disk when seeding ends. The task
queue is persisted under the application's machine-local data directory in
`torrent-downloader/tasks.json`; it is not written into `.nodeterm/project.json`.

The project record stores only the node id, layout, colour, title, and optional magnet intent. It
never stores a local source-file path, destination, process handle, peer address, cache, or runtime
state. A cloned project therefore opens with a safe unbound node and a clear route to choose local
files and a destination on the new computer.

## Restart recovery

On service startup, tasks previously marked as downloading, seeding, or waiting for metadata become
**recoverable paused** records. The service does not create a client or contact the network until the
user explicitly resumes, at which point source, destination, disk, quota, consent, and selected paths
are checked again. A missing or corrupt local task snapshot does not invent downloads or block
application startup. Completed, cancelled, and failed tasks remain available for review, retry, or
removal.

## Failure modes

- A malformed magnet URI is rejected before WebTorrent is called.
- A torrent file that is not readable, is not a regular file, or exceeds the bounded metadata limit
  is refused with the exact reason.
- Missing or version-mismatched WebTorrent is reported as unavailable. The service never installs a
  runtime during startup or from a user-scoped fallback.
- A missing, unwritable, non-folder, or undersized destination disables the start path and names the
  recovery action.
- A runtime error moves only that task to `failed`; other tasks remain intact and a retry action is
  available.
- A task with no selected files cannot be started successfully. Existing files are never deleted by
  cancel or retry.

## Security and portability

The runtime runs locally and is selected only from the package's declared, version-pinned WebTorrent
files. No arbitrary shell command, remote converter, PATH/global/npm lookup, or unbounded source path
is accepted. Paths are resolved inside the chosen destination and metadata is capped by file count,
source size, path length, and queue snapshot length. Task snapshots use a unique temporary file
before replacement and are stored with owner-only permissions where the host supports them.

Torrent source and destination paths are machine-local. They are not portable project content and
are omitted from project export/import. Import has no network, process, or download side effect.

## Surfaces

- **Desktop:** full local runtime, native source and destination pickers, and the canvas node.
- **Server Edition:** the same CorePlatform service and renderer operate on the server machine; its
  in-app directory picker supplies the local host path.
- **Relay:** deliberately unavailable until a host-routed torrent RPC is added. The viewer does not
  silently download on the wrong computer.
- **Mobile companion:** no live transfer surface is added in this lane. A future companion protocol
  can show read-only task summaries without carrying local paths or runtime handles.

## Verification

The focused verification matrix covers valid and invalid magnets, torrent-file metadata, file
selection, traversal rejection, destination preflight, progress/speed/peers/ETA, pause/resume,
cancel/retry, restart reconciliation, corrupt snapshots, bounded seeding, history persistence,
bounded selection, and the relay refusal. The current lane ran only its focused source Chuts. It did
not run the general suite, type checks, builds, installer execution, runtime interaction checks, or
UI captures; those remain explicit follow-up Chuts for the release pass.

## Suggested articles

- [Canvas node kinds](../canvas/node-kinds.md) - shared node persistence and sizing.
- [File converter](../../file-converter.md) - local file intake and destination safety patterns.
- [Local history](../../local-history.md) - machine-local state and recovery records.
