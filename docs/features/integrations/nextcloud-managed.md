# Managed Nextcloud, no socket

Status: implemented as a guided hosting node, with source verification intentionally unrun in the
ultra-speed delivery lane.

## Behaviour

Create **Managed Nextcloud** from the Node Catalog. The profile owns exactly three fixed services:
PostgreSQL for the database, Redis for cache and file locking, and the Nextcloud Apache web service.
They run on an internal Docker network. Only the web service publishes a loopback address selected
by the user. The generated Compose definition contains no Docker socket mount, no host network,
and no privileged mode.

The node exposes real context and folder pickers, a bounded project name, a loopback port control,
and a fixed operation picker. It never accepts arbitrary images, tags, Compose text, entrypoints,
environment editing, shell commands, or raw request input. Every search field has its own local
plain-text search and adjacent anchored full regex builder: managed services, operation choices,
and verified snapshot choices are separate fields with separate state.

The operation picker offers:

| Operation | Fixed sequence |
| --- | --- |
| Deploy | preflight, secret files, PostgreSQL, Redis, web |
| Update | preflight, versioned backup, web image pull and restart |
| Backup | preflight, local snapshot write |
| Restore | preflight, restore snapshot, PostgreSQL, Redis, web |
| Rollback | preflight, rollback snapshot, PostgreSQL, Redis, web |

Long operations report queued, running, completed, cancelled, and failed states at the node that
started them. Restore and rollback use the existing two-key confirmation flow. The host process
owns the Docker argument vector and rejects values that are not in the typed action contract.

## Secret files and local binding

The trusted host generates or resolves secret values and writes bounded local secret files for the
database password, the Nextcloud administrator password, and the instance secret. The renderer
receives only opaque vault-key names. Secret values never enter the project file, node action,
Compose editor, logs, exports, history, or issue records.

The project projection carries `nextcloudManagedIntent`, containing only the profile choice and
safe service topology. The machine-local workspace index carries `nextcloudManagedBinding`, which
contains the selected Docker context, local data and backup folders, loopback port, and opaque
secret-key names. Importing a project never contacts Docker, creates a container, writes a secret,
starts a process, or deploys a service. On another computer the node remains unbound until the
person chooses its local context and folders.

The folders are selected through native browse controls and validated again in the trusted host
before use. The service project name, snapshot id, context, port, and paths are bounded. Traversal,
control characters, unsupported values, and missing snapshot selection are refused with an inline
recovery message.

## Update, backup, restore, and rollback

Updates pull only the fixed web image, after creating a local versioned backup. The host does not
claim the update is complete until the web service restart command finishes. Backups use a fixed
volume archive command and keep the running stack unchanged. Restore and rollback select a verified
snapshot, unpack it into the managed data volume, and restart the three services in dependency
order. Cancellation leaves the prior service state in place whenever the host can safely do so;
failure is reported as failure rather than as a partial success.

## Failure modes and recovery

- **No Docker context:** the context picker remains empty with an explicit start-or-configure
  message. No command is guessed.
- **Missing folder:** Browse for a data folder and backup folder before enabling an operation.
- **Invalid name, port, path, or snapshot:** the operation is refused before any host mutation.
- **Socket or privileged configuration:** the fixed profile rejects it. These capabilities are not
  available to this node.
- **Secret-file failure:** deployment does not start. Existing service state is not reported as
  changed.
- **Pull, backup, restore, or restart failure:** the progress surface stays failed and retains the
  bounded diagnostic output. It does not turn a failed item into a green batch.
- **Imported on another computer:** safe profile intent remains visible; local context, folders,
  secret keys, process state, and generated runtime data remain absent until explicit binding.

## Surface coverage

- **Desktop:** the node catalog, canvas node, native folder pickers, trusted host IPC, secret-file
  creation, fixed Docker execution, progress and destructive confirmation are wired.
- **Server Edition:** the portable intent and renderer surface are shared. The browser host must
  supply its own local Docker adapter before operations become available; unavailable operations
  stay disabled with their reason.
- **Mobile companion:** the companion can display the safe unbound intent. It does not receive
  paths, credentials, process state, or a remote Docker control channel.

## Verification boundary

This ultra-speed implementation lane intentionally ran no tests, type checks, lint, reviews,
security checks, accessibility checks, builds, packaging, installer execution, runtime interaction,
or UI captures. The source implementation and direct documentation are present. Runtime and
built-artifact evidence remain unverified under the issue's explicit boundary.

## Suggested articles

- [Service nodes](service-nodes.md)
- [Docker host manager](../remote/docker-host.md)
- [Portable project schema 3](../projects/portable-project-schema.md)
- [Portable Node Universes and Hosting Program](../../plans/2026-08-26-portable-node-universes-and-hosting-program.md)
