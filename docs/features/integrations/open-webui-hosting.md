# Open WebUI hosting node

The Open WebUI node is a guided local Docker host for the official Open WebUI image. It keeps
the service private by binding the selected port to `127.0.0.1`, stores its data in a named
Docker volume, and leaves public exposure to a separate tunnel handoff after health is ready.

## Configuration

The node offers a discovered Docker context, a bounded host port, and one of two providers:

- Reuse existing local Ollama. The container reaches the host's Ollama API through Docker's
  `host.docker.internal` mapping. If that API is not reachable, startup reports the dependency
  state and does not claim the service is ready.
- OpenAI-compatible endpoint. The endpoint must be HTTPS, or HTTP on loopback, and cannot contain
  credentials. An optional OS credential reference is an opaque key only. The API key itself is
  never written to the canvas, a Docker argument, logs, exports, or backups.

The image is fixed to `ghcr.io/open-webui/open-webui:v0.8.3`, an official versioned image. The
surface accepts no custom image, entrypoint, command, Compose text, socket, or arbitrary
environment editor. The container has a restart policy, dropped capabilities, no-new-privileges,
bounded process and memory limits, a temporary filesystem for scratch space, and persistent data
at `/app/backend/data`.

## First-user bootstrap and health

The service keeps authentication enabled. A healthy container is reported as `awaiting-first-user`
until the first person completes Open WebUI's own registration flow. nodeterm does not create an
account, guess an owner, or turn a healthy container into a claim that sign-in succeeded. Status
distinguishes unconfigured, Docker unavailable, existing Ollama unavailable, stopped, starting,
healthy, unhealthy, and error states. Health is checked at the local `/health` endpoint.

## Backup, restore, update, and rollback

Backups are compressed copies of the persistent volume made by a fixed, bundled Alpine utility
image. Each record includes an id, timestamp, byte size, source image, and whether it was created
automatically. Restore and update preserve an automatic copy first. Updates pull the same pinned
official image before replacing the container. Rollback restores the newest automatic backup and
leaves the volume in place. A failed operation reports the concrete error and retains the prior
data and recovery copy.

## Portability and tunnel boundary

The canvas stores only safe display intent. Docker context, volume, container state, local URL,
provider credentials, and runtime data remain machine-local under application data. Importing a
project cannot launch Docker, pull an image, start a container, or create a tunnel. A portable
project reopens with an explicit configure path.

The tunnel control is a handoff, not an automatic exposure. It succeeds only after local health
is ready and returns the local URL for the separate guided tunnel flow. It never creates DNS,
publishes a port, or stores tunnel credentials.

## Failure modes and recovery

If Docker is unavailable, choose an available context or start Docker through the host's normal
installation flow. If Ollama reuse is selected but the local API is stopped, start Ollama or
switch to the OpenAI-compatible provider. If health fails after an update, use the preserved
automatic backup and rollback path. The existing volume is never removed by stop, update, restore,
or rollback.

## Implementation and verification record

The shared contract is `src/shared/open-webui.ts`; the platform-free lifecycle is
`src/core/open-webui/manager.ts` and `register-ipc.ts`; desktop and Server Edition wiring uses the
same RPC names; the canvas node is rendered by `ServiceNode.tsx` and
`components/open-webui/OpenWebUiPanel.tsx`. The feature is listed in the integration inventory and
uses the existing local Ollama and Docker-context seams.

This ultra-speed lane intentionally did not run tests, type checks, lint, security or accessibility
checks, builds, packaging, installer execution, runtime interaction, or captures. Those checks are
required before a release-grade verification claim.

### Suggested articles

- [Service nodes](service-nodes.md)
- [Local Ollama suite manager](../../ollama-manager.md)
- [Server Edition and Docker](../../SERVER.md)
- [Scheduled settings](../../scheduled-settings.md)

