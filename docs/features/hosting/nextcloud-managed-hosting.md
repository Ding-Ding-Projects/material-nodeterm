# Managed Nextcloud, no Docker socket

## Behaviour

The Nextcloud manager provisions one fixed, offline-known profile: a Nextcloud web service, a
PostgreSQL database, and Redis on a private user-defined network. The profile does not accept an
image, entrypoint, command, Compose document, or free-form environment editor. The application
uses direct typed Docker arguments and never mounts the Docker socket into any service container.

The install sequence is deterministic: create the private network, create the three named volumes,
write owner-only secret files, start PostgreSQL, wait for its readiness probe, start Redis, wait for
its probe, start the web service, then wait for the web health endpoint. The web port binds to
loopback only by default, so a deployment is private first.

## Configuration

The shared profile stores only a supported release, a bounded loopback port, safe volume names, a
safe network name, and the fixed `privateOnly` and `dockerSocket` flags. Machine-local binding data
stores the service container names, application-data directory, secret-file locations, current and
previous release, and tunnel-handoff state. Password values never enter the project file, logs,
exports, or command arguments.

## Update, backup, restore, and rollback

An update makes a backup before replacing the web container, then waits for the new web health
probe. The previous release remains recorded so rollback can recreate the known-good web image.
Backups contain a PostgreSQL dump and archives of the data and config volumes, with a manifest that
records the release, timestamp, byte size, and included resources. Restore stops the managed
containers, recreates the database, restores the dump and volumes, and reruns readiness checks.
Incomplete backups are omitted from the list rather than presented as usable.

Deletion of volumes and the local record is a separate destructive action. The caller must use the
application's two-key confirmation flow before requesting data deletion.

## Private-first and tunnel handoff

The manager exposes a handoff-preparation action only after database, Redis, and web readiness are
all true. That action marks the profile eligible for a later tunnel workflow; it does not create a
tunnel, alter DNS, or publish an endpoint. Tunnel credentials and connector state remain outside
the project file and are owned by the dedicated tunnel manager.

## Failure modes and recovery

Missing Docker, an unavailable daemon, a rejected image pull, a failed readiness probe, an invalid
profile value, or an interrupted backup returns an explicit error. The last known local profile is
kept, and the status distinguishes stopped containers from a missing deployment. Retrying install
reuses the same fixed profile shape. A failed update can be restored from the newest backup or
rolled back to the recorded previous release.

## Security considerations

Only the official, pinned image families are used: `nextcloud:<release>`, `postgres:16-alpine`, and
`redis:7-alpine`. The network and volumes carry a manager label for ownership. Secret files are
created in the private application-data directory with restrictive permissions and are passed to
containers by file path. The profile never accepts arbitrary shell input, and import of a project
file performs no network, deployment, process, or provider mutation.

## Verification status

The implementation is present in `src/shared/nextcloud.ts`, `src/core/nextcloud/manager.ts`,
`src/core/nextcloud/register-ipc.ts`, the preload and browser bridge, and the service-node panel.
This implementation lane intentionally did not run tests, type checks, lint, builds, packaging,
installer execution, runtime interaction, or UI captures. Those remain release evidence work.

Suggested articles: [Docker host manager](../remote/docker-host.md), [Server Edition](../remote/server-edition.md),
[Notifications](../../notifications.md), and [Local version history](../../local-history.md).
