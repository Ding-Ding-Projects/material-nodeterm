# Linux ISO VM node

**Category:** [Integrations](./README.md)

The Linux ISO VM is a one-shot canvas node for starting a real Linux guest from a local ISO. It is
separate from WSL: WSL selects a distribution-backed shell, while this node starts an isolated
QEMU virtual machine with its own virtual hardware and lifecycle.

## Creating and configuring

Choose **Managers → New manager… → Linux ISO VM** from the canvas menu. The node provides native
file pickers for the ISO and, in persistent install mode, the disk image. It does not accept a raw
QEMU command line or arbitrary arguments.

Two modes are available through a locally searchable picker whose adjacent anchored regex builder is
bound only to that picker:

* **Disposable live** starts the ISO with QEMU's snapshot mode. Writes go to a temporary overlay and
  are discarded when the VM stops. This is the default and is useful for safely trying a live image.
* **Persistent install** requires a user-selected qcow2 or raw disk. The disk remains in place after
  shutdown, so an installer can create a guest that is opened again later.

Memory is bounded to 512–32768 MiB, and CPUs to 1–16. The project projection stores these portable
choices, but ISO and disk paths remain machine-local. Reopening a project on another computer shows
the paths as unbound and provides the same Locate Asset pickers; importing a project never starts a
VM, downloads a tool, or changes a host.

Persistent install mode also offers **Create disk** through a folder picker. The manager checks free
space before creating a qcow2 disk with the bundled `qemu-img`, uses a collision-safe filename, and
reports the requested size and measured free space. Existing disks are inspected by their bytes so
the status identifies qcow2 (`QFI\\xfb`) versus raw instead of trusting a filename extension.

An optional expected ISO SHA-256 can be entered beside the ISO picker. The complete ISO is streamed
through a bounded file reader before startup, and the status reports both expected and actual
digests. A mismatch prevents QEMU from starting and leaves the prior stopped state intact.

Network is disabled by default. Enabling the user-mode network switch is an explicit, persisted
choice and is visible in the node status. No bridged adapter or host interface is ever selected by
the node.

## Bundled tools and acceleration

The core resolves `qemu-system-x86_64` and `qemu-img` only from the installed package's bundled
`resources/qemu/` directory. The pinned dependency manifest records the official QEMU Windows x64
installer URL, its published SHA-512, and an approximate 172 MiB installer size disclosure. The
packaging boundary requires both executable payload paths. A QEMU found on PATH cannot make the
node appear available, because that would make a development machine's installation look portable.
On a Server Edition host without packaged resources, the API reports the missing resource boundary
and does not expose a misleading viewer URL.

Packaging runs `npm run prepare:qemu`, which downloads the manifest-pinned installer, verifies its
SHA-512, extracts it to the package resource directory, and refuses to continue when either required
executable is absent. The approximately 172 MiB installer-size disclosure is shown before the
download; runtime does not perform this network operation.

The resource bootstrap creates the temporary installer with exclusive ownership, so a stale file or
another process's file is never overwritten or removed. If the freshly created installer cannot
start because the operating system reports `EACCES`, `EPERM`, or `EBUSY` before a child process
starts, the bootstrap makes at most three attempts with 50 ms and 100 ms delays. A child that did
start and exits nonzero is terminal and is not retried. The current process's temporary installer is
removed in `finally` after success, spawn refusal, child failure, or another thrown error; the
fixed URL, SHA-512 validation, shell-free arguments, and required payload checks remain unchanged.

On Windows hosts, WHPX is preferred when the setting is enabled. The actual accelerator is reported
as WHPX or TCG in the status result. A missing acceleration capability does not prevent a safe TCG
fallback; it is reported rather than silently claimed as WHPX.

## Lifecycle and display

Starting enters a starting phase, reserves free loopback ports, and constructs a fixed, validated argument vector containing the machine type, accelerator,
memory, CPU count, ISO, optional disk, snapshot mode, a loopback VNC display, and a loopback QMP
control socket. The process is spawned with `shell: false`; no user text is interpolated into a
shell command. Informational status and progress stay in the node and do not block the canvas.

The display and QMP endpoints bind to `127.0.0.1` only. QEMU receives a VNC display number and the
status reports its corresponding TCP port (`5900 + display number`). Startup waits for both sockets
and completes a QMP handshake before reporting running. An early QEMU exit, failed display bind, or QMP error is
persisted as an actionable error, with bounded stderr retained for diagnosis. The status surface
shows the loopback VNC address only when the local desktop can open it, plus the running phase,
selected mode, accelerator, and whether networking is enabled. Stop sends the
QMP `quit` command, waits for the process to exit, and escalates to bounded termination if a guest
does not respond. Stop remains available during startup so the operation can be cancelled. A QMP
timeout is shown as an error after bounded termination rather than treated as a successful stop.

The desktop's **Open display** action opens the verified loopback VNC address. Server Edition keeps
the display host-local and reports that a browser-safe proxy is not available, so it never tells a
browser to connect to its own `127.0.0.1` by mistake.

Snapshots use QMP's `savevm` and `loadvm` commands and accept only bounded opaque names made from
letters, numbers, dots, underscores, and hyphens. Restore uses a saved-snapshot picker with local
plain-text filtering and its own adjacent anchored regex builder, rather than asking the user to
retype a stored name. Snapshot names are persisted in the machine-local VM record with the process
state, never in the shared project file.

## Persistence and recovery

The portable `virtualMachineConfig` contains mode, memory, CPU, disk-size hint, network choice, and
WHPX preference. The machine-local `virtualMachineLocalPaths` contains only the selected ISO and
disk paths and is kept in the local execution overlay. Runtime process handles, ports, QMP state,
temporary overlays, and generated status are never exported.

If an ISO or disk is missing, the node remains present and says exactly which asset is unavailable.
The user can pick a replacement without editing project JSON. If the bundled tools are missing, the
node remains unstarted and identifies the package resource that needs to be restored. Runtime
process identifiers and startup generations are owned by the manager, and stale running records are
reconciled to an error at startup rather than attaching to or killing a guessed process. Corrupt or
unreadable machine-local state is surfaced as an error rather than reported as an absent VM. State
writes use unique, owner-identifying temporary files and the shared bounded atomic rename helper.
Stopping a disposable VM removes its temporary changes by QEMU snapshot semantics; the selected source ISO is
never modified.

## Security and limits

QEMU and qemu-img are invoked as bundled executables through argv arrays. The manager validates node
and snapshot identifiers, absolute paths, resource limits, and configuration mode before starting.
It never accepts arbitrary QEMU flags, shell fragments, network interfaces, host paths from a shared
project file, or credentials. The display and QMP control channel are loopback-only. Persistent disk
creation and destructive reset actions belong behind the app's existing two-key confirmation flow.

## Availability by surface

The desktop shell runs the local VM process. The Server Edition exposes the same bounded API on the
server host, so its browser page manages a VM on the machine running that server. The mobile
companion has no direct VM process boundary; it should present the node's portable configuration and
an explicit unbound state until its host protocol grows this capability.

## Verification boundary for the ultra-speed lane

The ultra-speed delivery lane intentionally did not run tests, type checks, lint, reviews, security
checks, accessibility checks, installer execution, runtime interaction checks, or UI captures.
Build and packaging evidence, when run by the release owner, proves artifact production only and
does not prove that the VM lifecycle is fully verified.

## Suggested articles

- [WSL instances](../wsl/wsl-instances.md): the distinct distribution-backed shell workflow.
- [Node kinds](../canvas/node-kinds.md): canvas persistence and node creation behavior.
- [Portable schema 3](../projects/portable-schema3.md): shared versus machine-local project data.
- [Service nodes](./service-nodes.md): the manager-node family and shared canvas behavior.

