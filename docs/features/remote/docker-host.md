# Docker host manager

## Behavior

The Docker host canvas node is a guided manager for the Docker CLI context selected on the current
computer. It discovers local, SSH, and other saved contexts, reports when one is unavailable, and
keeps each resource area usable when a different area cannot be read.

The manager has separate searchable tabs for containers, images, volumes, networks, Compose
projects, and fixed typed container tasks. Each search starts in plain-text mode and has an adjacent
anchored regex builder. Resource rows show their real lifecycle state. Container rows also show
bounded statistics and expose recent redacted logs.

Long-running actions publish queued, running, completed, failed, or cancelled progress in the node.
The active operation can be cancelled. A completed operation refreshes host state, while a failed
operation keeps its exact recovery message and never reports a guessed result.

## Guided operations

Container creation accepts only a small built-in image catalog. It assigns a generated name,
ownership label, CPU, memory, and PID limits, drops all capabilities, sets
`no-new-privileges`, and defaults to a read-only root filesystem with a bounded temporary folder.
The user chooses no network or one discovered Docker network. There is no image, entrypoint,
environment, Compose text, command, or shell field.

Lifecycle controls cover start, stop, restart, pause, and unpause. Destructive container, image,
volume, and network removal uses the application's two-key confirmation flow. Built-in Docker
networks cannot be removed from this manager.

Typed execution is deliberately closed. The user chooses a discovered container and one fixed task:
operating-system summary, working directory, workspace listing, Git status, or Node version. The
renderer cannot submit a command string or arguments.

Compose discovery lists saved projects and their available profiles. Start, stop, and restart
re-discover the project configuration inside the main process before invoking Docker. Absolute
Compose paths never cross into the renderer or project file.

## Portability and local binding

The node catalog creates a schema 3 safe blueprint containing only neutral intent: select a context
on this computer, a catalog image id, no-network default, read-only-root preference, and bounded
resource limits. The context name and endpoint, daemon socket, SSH identity, credentials, Compose
paths, container and image ids, statistics, logs, job ids, and process state remain machine-local.

Importing the project does not inspect Docker, connect over SSH, pull an image, create a container,
or run any lifecycle action. The destination user must select an available local binding and start
an explicit operation.

## Failure modes and recovery

- If the Docker executable or context store is unavailable, the context surface names that state
  and asks the user to start Docker or configure a context.
- If one resource command fails, that tab reports the command's bounded error while other resource
  tabs retain their successfully read data.
- If a resource disappears between discovery and action, the operation fails without substituting
  another id. Refresh the manager and choose the current resource.
- If an SSH context cannot connect, repair that context outside nodeterm and retry from the same
  surface. Credentials are never requested or stored by this manager.
- Cancellation terminates only the operation process that owns the displayed job id. It never stops
  an unrelated container or removes host data.

## Security considerations

The renderer sends a discovered context name, discovered resource identifier, and one member of a
closed action union. The main process revalidates every value and invokes `docker` through argument
arrays with no shell. Output is byte-bounded. Control characters are removed, and obvious
credential-like log values are redacted before they reach the renderer.

The manager never mounts the Docker socket inside a created container, never uses privileged mode,
never accepts arbitrary images or commands, and never writes credentials, host endpoints, paths, or
live resource identifiers into the portable project.

Server Edition exposes an explicit unsupported result for this desktop-owned capability. A browser
cannot safely claim a Docker CLI installation or local host ownership.

## Verification

This ultra-speed implementation lane did not run tests, type checking, lint, review, security or
accessibility checks, builds, packaging, installer execution, runtime interaction, or captures.
Those checks remain unverified and must not be inferred from the source implementation.

## Suggested articles

- [Remote and SSH features](./README.md)
- [Unified Node Catalog](../canvas/node-catalog.md)
- [Portable schema 3](../projects/portable-schema3.md)
