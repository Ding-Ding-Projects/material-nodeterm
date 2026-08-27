# Nextcloud AIO hosting

Nextcloud AIO is a guided, private-first hosting profile on the canvas. It runs the pinned
official `nextcloud/all-in-one:2025.8.0` image through a selected local Docker context and never
accepts arbitrary images, entrypoints, Compose text, shell commands, or free-form environment
values.

## Behaviour

The node opens with a real Docker-context picker, a local binding choice, and a bounded port
control. `Loopback only` binds the selected port to `127.0.0.1`; `Private network` uses the
selected private binding. The port is validated to the inclusive range 1024–65535. Contexts are
discovered from the Docker CLI and are never typed into a command field.

The profile offers explicit Deploy, Start, Stop, Update image, Create backup, Restore, and
Rollback actions. Operations produce queued, running, completed, failed, and cancelled progress
records at the node that started them. A backup or restore operation chooses a discovered backup
record, never a path. Failed operations retain their prior valid state and report a concrete retry
route.

Every new search field has its own plain-text-first filter and adjacent anchored full regex builder.
The context and backup lists never share query state. Invalid patterns leave the list visible and
show the parser error beside the originating field.

## Docker authority and safety

The official AIO master container needs Docker control to create and supervise its child
containers. The profile therefore mounts the host Docker socket read-only and says this plainly in
the node: socket access can control the Docker host and is not a security boundary. The container
uses `no-new-privileges`, drops capabilities, uses a read-only root filesystem, and does not pass
`--privileged`. The image and helper image are fixed in the host manager; the renderer cannot
replace them.

The host manager invokes `docker` with argument arrays and fixed subcommands. It validates context,
backup, port, image, volume, and container identities at the trusted boundary. No credentials are
accepted by this profile. If a future AIO credential handoff is added, it must use the operating
system vault and remain outside the portable project file.

## Portability and local state

Schema 3 carries `nextcloudAioConfig`, which contains only the pinned image source, safe binding
mode, port intent, and fixed profile identifiers. It omits the Docker context name, endpoint,
socket, container id, volume contents, backup data, process state, host paths, and credentials.
Import is side-effect free. On another computer the node remains an explicit Configure state until
the user selects a local Docker context and deploys it.

Live status, context bindings, backup records, job ids, and process output remain machine-local.
The Server Edition exposes an explicit unsupported bridge for this desktop-owned Docker operation;
the mobile companion receives only the portable intent and an unbound state.

## Failure modes and recovery

- Docker unavailable or no context found: the node reports that condition and asks the user to
  start Docker or choose another context. It never treats a failed discovery as an empty healthy
  state.
- A context, image, volume, or backup record disappears: the operation is refused, the user is
  asked to refresh, and no guessed identifier is executed.
- A port is outside 1024–65535: the deploy action remains disabled until the value is corrected.
- Deploy, update, backup, restore, or rollback fails: the progress record is failed with the
  Docker exit reason; no success notification is emitted.
- A restore or rollback is cancelled: the active container and its existing volumes remain in
  place. A later operation can be retried from the explicit recovery tab.

## Verification boundary

This ultra-speed implementation lane intentionally ran no tests, type checks, lint, reviews,
security or accessibility checks, builds, packaging, installer execution, runtime interaction, or
UI captures. The source records the implementation and the no-check boundary; the owning
integration lane must produce all later verification evidence against the exact integrated commit.

## Suggested articles

- [Service nodes](service-nodes.md): shared canvas lifecycle, sizing, persistence, and appearance.
- [Docker host manager](../remote/docker-host.md): discovered Docker contexts and fixed typed
  operations.
- [Portable schema 3](../projects/portable-schema3.md): safe intent versus local bindings.
- [Shared provider services](provider-services.md): the credential and binding boundary used by
  other hosted integrations.
