# Read-only Windows diagnostics

The **Windows diagnostics** node is a machine-local, read-only snapshot of useful host state. Add
it from the canvas context menu, the command palette, or the canvas-object menu. The node can be
renamed and coloured like other canvas objects, while the records it displays never enter the
shared project file.

## What it shows

The node has one tab for each bounded category:

- **Drives**: local fixed-drive letters, labels, file systems, capacity, and free space.
- **Storage**: physical storage model, media type, size, and reported health status.
- **Services**: service name, display name, state, start mode, and service type.
- **Startup**: startup entry name, command, registry or startup location, and user when reported.
- **Scheduled tasks**: task path, name, and state.
- **Updates**: installed hot-fix id, description, installation date, and installer identity when
  reported.
- **Network**: adapter state, link speed, MAC address, and reported IP addresses.
- **Event summary**: the most recent bounded System log entries, including time, provider, id,
  level, and a shortened message.

Each tab has a local plain-text filter and reports the number of matching rows. Long values stay
inside a scrollable table, so a large host inventory cannot resize the canvas node beyond its
interactive bounds.

## Configuration and persistence

The node persists only its title, colour, geometry, and normal canvas relationships in
`.nodeterm/project.json`. The diagnostic snapshot is fetched on node mount or refresh and is never
written to project state, local history, exports, peer mutations, or relay messages. A refresh is
always an explicit user action, and there is no background poller.

## Failure modes and recovery

The trusted desktop boundary invokes only fixed, allowlisted native PowerShell queries with no user
supplied command text. Each query has an eight-second timeout and a 384 KiB output bound. An empty
successful result is shown separately from a query failure. A failed query names that the category
could not be read and leaves the machine unchanged. Non-Windows shells and the browser Server
Edition show an honest unavailable message because these native queries belong to the Windows
desktop host.

The node has no controls for starting, stopping, deleting, enabling, disabling, installing,
updating, changing network settings, clearing logs, or elevating privileges. It is an observation
surface only. Retry the category by using Refresh after the host or a missing Windows provider is
available.

## Security and privacy

Queries run in the main process, with `-NoLogo`, `-NoProfile`, and `-NonInteractive`. Arguments are
fixed constants, and no shell text, credentials, environment values, absolute paths, process ids,
or raw stderr cross into the renderer. Records are sanitised and bounded before crossing the typed
IPC boundary. The service is not registered in relay dispatch, so a remote project cannot ask the
desktop to inspect its machine through this feature.

## Verification

The implementation is in `src/core/windows-diagnostics.ts`, its shared typed contract is in
`src/shared/windows-diagnostics.ts`, and the native channels are
`windows-diagnostics:read` and `windows-diagnostics:snapshot`. The renderer surface is
`src/renderer/nodes/WindowsDiagnosticsNode.tsx`. The current ultra-speed lane intentionally did
not run tests, type checks, lint, runtime interaction checks, accessibility checks, packaging, or
UI captures. Those remain required follow-up evidence before this feature can be described as
fully verified.

## Suggested articles

- [Node kinds](./node-kinds.md)
- [Windows support](../../windows-support.md)
- [Local history](../../local-history.md)
- [Command palette](../../command-palette.md)

