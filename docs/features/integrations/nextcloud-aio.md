# Nextcloud All-in-One hosting profile

**Status:** profile and fixed deployment plan implemented. Runtime execution, live capacity probes,
and packaged-app verification remain outside this ultra-speed lane and are recorded as unverified.

The **Nextcloud AIO** manager is a canvas node that describes one private deployment of the official
Nextcloud All-in-One master container. It is a guided profile, not a generic container launcher:
there is no image editor, Compose editor, command field, entrypoint field, environment editor, or
credential field.

## What the profile contains

The portable profile is schema version 1 and records only safe deployment intent:

| Value | Default | Portable? |
| --- | ---: | --- |
| Official image digest | `nextcloud/all-in-one@sha256:8ef360995740aecc18a471f51da76d4609d964adcbda2e7baefb1e7d1048d3b4` | Yes |
| Requested storage | 100 GiB | Yes |
| Requested memory | 4096 MiB | Yes |
| Requested CPUs | 2 | Yes |
| Setup port | 8080 | Yes |
| HTTPS port | 8443 | Yes |
| Binding | Private loopback | Yes |
| Automatic updates | On | Yes |
| Backup retention | 7 days | Yes |

The node's display label and these bounded values are written through the schema 3 portable canvas
projection. The Docker host address, Docker context, container name, volume identity, process state,
capacity observations, backup files, setup state, and credentials stay in the local binding layer.
When a project is imported on another computer, the node opens unbound and offers Configure or
Leave Unbound. Import itself does not contact Docker, start a container, create a volume, or open a
network connection.

## Docker socket authority, plainly stated

The AIO master container needs the Docker API to create and manage its child containers. The fixed
plan mounts `/var/run/docker.sock` as a read-only bind mount and never sets `privileged`. A read-only
mount protects the socket file from writes, but it does **not** reduce authority once a process can
send Docker API requests through that socket. In practical terms, accepting this profile grants the
master container control of the Docker daemon and therefore host-level container authority.

This disclosure appears beside the profile controls and in the deployment-plan preview. The plan
also drops every Linux capability and sets `no-new-privileges`; those hardening measures do not
change the Docker-daemon authority of the socket and are not presented as a sandbox promise.

The fixed plan uses Docker's ordinary `bridge` network, two explicitly selected host ports, one
named volume for AIO configuration, and the official image digest. Both binding choices remain
loopback-bound in this lane; a later private reverse proxy or tunnel owns any broader exposure
after health verification. It never accepts a user-supplied mount, network, image, command, or
argument vector.

## Guided operation

1. Add **Managers → New manager… → Nextcloud AIO**.
2. Set the Docker host address through the validated HTTP(S) or SSH address field. Credentials are
   not accepted in the address and must be resolved through the local credential store.
3. Choose bounded storage, memory, CPU, ports, and private binding. The defaults are real values,
   not fake placeholder text.
4. Review the fixed deployment plan. It names the pinned image, ports, volume, socket authority,
   and the fact that privileged mode is never used.
5. Deploy only after the bound host reports ready. The setup address is then the selected host with
   port 8080. Complete AIO's own first-user setup there; the admin credential is never placed in the
   canvas profile or in a command argument.

The node distinguishes unbound, capacity unknown, capacity insufficient, ready, starting, ready,
updating, backup, restore, and failed states. Unknown capacity is not treated as zero or as a pass.
Progress, cancellation, retry, and partial outcomes belong to the host runtime seam and must be
reported from that runtime's real events before an operation is called complete.

## Update, backup, restore, and tunnel seam

The lifecycle controls are intentionally separate operations:

- **Update image** keeps the existing volume, checks the pinned image and host capacity, and only
  replaces the master container after the new container is healthy. The prior image identity remains
  available for rollback until health verification is complete.
- **Create backup** requires a local destination selected through the native folder picker, checks
  capacity before starting, reports byte progress when the host supplies it, and writes atomically.
- **Restore backup** requires a selected local backup and a reviewable version and ownership match.
  It never overwrites a live deployment without the two-key destructive confirmation flow, and a
  failed restore keeps the prior volume available for rollback.
- **Cloudflare Tunnel handoff** is not an alternate deployment path. It becomes available only
  after local health verification, then passes the selected service and port to the separate tunnel
  flow. The tunnel connector never receives the Docker socket.

These operations are fixed host-runtime requests, not shell strings. A missing host bridge leaves a
control disabled with its exact reason rather than opening a generic command prompt.

## Failure modes and recovery

| State | Meaning and recovery |
| --- | --- |
| Unbound | No machine-local Docker host is selected. Configure or leave the portable node unbound. |
| Capacity unknown | The host did not provide storage, memory, or CPU facts. Refresh the host probe. |
| Insufficient capacity | The requested profile exceeds a reported resource. Lower the request or free capacity. |
| Docker unavailable | Start or repair the selected Docker host, then retry the bounded health probe. |
| First setup pending | Open the AIO setup address and complete its own account creation. No credential is copied here. |
| Health probe failed | Keep the old deployment, read the exact host error, and retry or roll back. |
| Backup or restore interrupted | Preserve the source and destination, report partial state, and resume only after validation. |
| Tunnel unavailable | A tunnel is never offered until local health is verified. |

The local application-data directory is the recovery source for host bindings and operation history.
Portable import cannot recover credentials or host-specific files because it never receives them.

## Security and privacy

- The image is the official `nextcloud/all-in-one` image pinned by digest and linked to its Docker
  Hub source in `src/shared/nextcloud-aio.ts`.
- `privileged` mode is hard-coded out of the plan. The UI has no control that can add it.
- The socket authority disclosure is not softened by the read-only mount wording.
- No credential, token, host-specific path, container id, process id, or backup path enters
  `project.json`, schema 3 exports, logs, history, or the deployment preview.
- Profile validation rejects unknown keys, unsafe object keys, malformed ports, duplicate ports,
  out-of-range capacity values, control characters, and any image other than the pinned official
  digest.
- Import is side-effect free. It does not call Docker, create resources, pull an image, or start a
  process.

## Surfaces and verification boundary

- **Desktop:** the new manager node, guided profile controls, fixed plan preview, local host binding,
  and portable projection are wired in the shared renderer path.
- **Server Edition:** the same platform-free profile and renderer controls are available. A future
  host runtime must be registered through the shared core bridge rather than by adding desktop-only
  process code.
- **Mobile companion:** the companion has no service-node runtime. A future read-only profile summary
  can consume the portable intent without receiving the local Docker binding.

This lane deliberately did not run tests, type checking, linting, security checks, builds, packaging,
installer execution, runtime interaction checks, or UI captures. The fixed profile implementation and
documentation are present, but those evidence Chuts remain open for the complete release pass.

## Suggested articles

- [Service nodes](./service-nodes.md)
- [Portable canvas projection](../projects/portable-canvas-projection.md)
- [Docker host](../remote/docker-host.md)
- [Destructive confirmation](../../destructive-confirmation.md)
- [Cloudflare Tunnel planning](../../plans/2026-08-26-portable-node-universes-and-hosting-program.md)
