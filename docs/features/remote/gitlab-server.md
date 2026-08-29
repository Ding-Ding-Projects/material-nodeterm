# GitLab Server hosting

**Category:** [Remote & SSH](./README.md)

The GitLab Server node provisions a local GitLab Community Edition or Enterprise Edition container
through the application's trusted Docker boundary. It is a guided hosting profile, not a general
container runner: the UI has no image, entrypoint, environment, Compose, or shell editor.

## Behavior

Choose one of the official GitLab 18.2.1 or 18.3.1 CE/EE profiles. Each profile is pinned to its registry digest
and starts with four managed Docker volumes: `/etc/gitlab`, `/var/log/gitlab`, `/var/opt/gitlab`,
and `/var/opt/gitlab/backups`. The host binding is always `127.0.0.1` and the port is validated
between 1024 and 65535, so a newly provisioned service is private-first.

Before creating anything, the core checks Docker availability, free capacity, and whether the local
port can be bound. A root credential is generated in a 0600 secret file and mounted read-only at the
container's fixed secret path. The initial credential is available to the owner exactly once through
the handoff control. It is never placed in the project document, logs, exports, Docker arguments, or
environment editor because this node has no such editor.

Readiness is rechecked against the local `/users/sign_in` endpoint while the container is running.
The status distinguishes unconfigured, starting, ready, stopped, and error states. Informational
updates remain non-blocking, while stopping and restoring use the application's two-key confirmation
surface.

## Backup, restore, update, and rollback

Backup invokes the fixed GitLab backup command inside the managed container and records only redacted
metadata locally. Restore accepts only a backup identifier previously recorded by this node, then
invokes the fixed restore command. Updating pulls another pinned catalog profile and recreates only
the managed container while retaining all four volumes. Rollback returns to the previously pinned
profile and swaps the record so a second rollback remains explicit and reversible.

The local origin is offered to the tunnel wizard only after readiness succeeds. The tunnel route is a
separate, later decision. Creating a GitLab node never publishes a port or creates an external route.

## Portability and local state

The shared project stores the node kind, display label, layout, and safe profile intent only. The
container name, volume names, secret file, credential handoff state, backup records, host port, and
runtime status live under the machine's application data directory. Importing a project therefore
does not create a container or make a network call. A new machine shows the node as unconfigured and
offers the same explicit CE/EE Configure path.

## Failure modes and security

- Docker unavailable, insufficient capacity, or a busy port is reported before any managed resource
  is created, with a retry action at the same surface.
- An image profile not present in the shipped catalog, an invalid node id, a malformed port, or an
  unknown backup identifier is refused by the core even if a renderer is modified.
- Container start, readiness, update, restore, and rollback failures retain the existing record and
  volumes. They are not reported as ready based on a successful Docker command alone.
- The image, environment, executable, arguments, volume names, mount targets, and bind address are
  all core-owned constants or validated derived values. No arbitrary command, Compose text, host
  socket, privileged mode, host network, or public bind is accepted.

## Implementation and verification boundary

| Concern | Implementation |
| --- | --- |
| Shared contracts and pinned catalog | `src/shared/gitlab.ts` |
| Docker lifecycle and local persistence | `src/core/gitlab/server-manager.ts` |
| Desktop and Server Edition registration | `src/core/gitlab/register-ipc.ts`, `src/main/index.ts`, `src/server/handlers/index.ts` |
| Renderer panel | `src/renderer/components/gitlab/GitLabServerPanel.tsx` |
| Node integration | `src/renderer/nodes/ServiceNode.tsx` |

This ultra-speed lane intentionally did not run tests, type checks, lint, security review,
accessibility review, installer execution, runtime interaction checks, or HuiShots. The implementation
is therefore not presented as runtime-verified.

## Suggested articles

- [Docker host](./docker-host.md)
- [Server Edition](./server-edition.md)
- [Exports and local history](../exports-and-history.md)
- [Projects and tabs](../projects/projects-and-tabs.md)
