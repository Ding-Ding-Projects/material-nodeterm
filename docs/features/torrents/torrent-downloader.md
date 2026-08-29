# Torrent Downloader

The Torrent Downloader is a canvas node for local peer-to-peer transfers. It uses the documented
WebTorrent runtime, prefers the packaged dependency, and can install the pinned runtime into the
user data directory when a development or portable installation does not carry it.

## Behaviour

Create it from the canvas context menu under **Canvas objects**, or from the command palette as
**New torrent downloader**. Paste a `magnet:?xt=urn:btih:...` URI or choose a local `.torrent` file
through the native picker, then inspect its metadata. Inspection never starts the user-approved
download action. After metadata arrives, choose the files, browse to a destination, apply that
destination to the task, and use **Start**.

The node creates a machine-local task and waits for metadata. The metadata view lists every safe
relative file path, its byte size, and a checkbox for selection. Its plain-text-first file filter
has an adjacent full anchored regex builder, plus filtered select and clear actions. File paths
containing `..`, empty segments, control characters, or an absolute root are rejected before they
can escape the chosen destination. The destination preflight checks that the folder exists, is
writable, and has enough reported free space when the host exposes that measurement.

Each task reports status, percentage, downloaded and total bytes, current speed, peer count, and an
ETA when the runtime can calculate one. Pause, resume, cancel, and retry operate on the real
WebTorrent handle. Retry keeps the task identity and reconciles against the existing local data.
Remove task stops the handle and removes only the machine-local task record through the shared
two-key destructive confirmation; downloaded files remain on disk. The node also exposes a task
search with plain text as the default and the same adjacent full anchored regex builder.

## Configuration

Seeding is per task and defaults to **Do not seed**. Its searchable picker has its own isolated
plain-text and regex state. The bounded choices are never, a ratio up to 10.0, or a duration up to
24 hours. A duration starts when the download completes, not when the policy is selected. Completed
files remain on disk when seeding ends. The task queue is persisted under the application's machine-local data directory in
`torrent-downloader/tasks.json`; it is not written into `.nodeterm/project.json`.

The project record stores only the node id, layout, colour, title, and optional magnet intent. It
never stores a local source-file path, destination, process handle, peer address, cache, or runtime
state. A cloned project therefore opens with a safe unbound node and a clear route to choose local
files and a destination on the new computer.

## Restart recovery

On service startup, tasks previously marked as downloading or waiting for metadata are re-opened
against the same source and changed to paused after reconciliation. A missing or corrupt local task
snapshot does not invent downloads or block application startup. Completed, cancelled, and failed
tasks remain available for review, retry, or removal.

Packaged Windows builds use WebTorrent's TCP peer transport and DHT with optional uTP disabled.
The native uTP listener can be refused by the operating system after WebTorrent's constructor has
already returned, so it cannot be allowed to decide whether the desktop process survives startup.
Other supported runtimes may use uTP, but its asynchronous bind error is contained by the service
and falls back to the still-working TCP transport.

## Failure modes

- A malformed magnet URI is rejected before WebTorrent is called.
- A torrent file that is not readable, is not a regular file, or exceeds the bounded metadata limit
  is refused with the exact reason.
- Missing WebTorrent is reported as unavailable while the service attempts the pinned user-scoped
  auto-install route. The node never claims the runtime is bundled when it was not loaded.
- An optional uTP bind error cannot escape as an uncaught main-process exception. The runtime stays
  available over TCP and records the degraded transport detail. A fatal client error is contained,
  marks the runtime unavailable, and marks active tasks failed without ending the application.
- A missing, unwritable, non-folder, or undersized destination disables the start path and names the
  recovery action.
- A runtime error moves only that task to `failed`; other tasks remain intact and a retry action is
  available.
- A task with no selected files cannot be started successfully. Existing files are never deleted by
  cancel or retry.

## Security and portability

The runtime runs locally and is loaded through its supported ESM entry point from packaged
resources, the declared application dependency, or a user-scoped install of the pinned WebTorrent version. No arbitrary shell command,
remote converter, or unbounded source path is accepted. Paths are resolved inside the chosen
destination and metadata is capped by file count, source size, path length, and queue snapshot
length. Task snapshots use a unique temporary file before replacement and are stored with owner-only
permissions where the host supports them.

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
cancel/retry, restart reconciliation, corrupt snapshots, bounded seeding, the relay refusal, the
packaged Windows uTP policy, asynchronous uTP fallback, and fatal client-error containment. The
client-error regression is mutation-checked by removing the listener, observing the exact emitted
errors fail the focused test, restoring the listener, and observing the focused test pass.

## Suggested articles

- [Canvas node kinds](../canvas/node-kinds.md) - shared node persistence and sizing.
- [File converter](../../file-converter.md) - local file intake and destination safety patterns.
- [Local history](../../local-history.md) - machine-local state and recovery records.

