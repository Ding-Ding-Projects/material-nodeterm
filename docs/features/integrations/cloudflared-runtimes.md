# Cloudflared connector runtimes

The Cloudflared connector node runs a tunnel connector on this computer through one of three
explicit runtime choices: a per-user process, an on-demand Windows service, or a constrained Docker
container. This feature owns connector lifecycle only. Tunnel accounts, zones, hostnames, DNS, and
route configuration belong to the Cloudflare manager and tunnel wizard surfaces.

## Guided setup

Create **Cloudflared connector** from the canvas Managers menu. The node asks for a connector token,
an origin URL, and a runtime choice. The token field is write-only: selecting **Store token** writes
it to the app's machine-local data directory, applies owner-only ACLs, and clears the field. The
token is never written to the portable project file, settings exports, logs, process arguments, or
environment variables. Clearing the token stops the connector first and removes its local token
directory.

The origin URL is validated as an `http://` or `https://` URL without embedded credentials. Runtime
selection is a real segmented control, not a free-form command field. Docker limits are bounded to
0.25–4 CPUs, 128–4096 MB, and 32–1024 PIDs. The official image defaults to
`cloudflare/cloudflared:2025.8.1`; before launch it is pulled and resolved to a
`cloudflare/cloudflared@sha256:…` digest.

## Runtime behavior

### Per-user process

The desktop resolves a bundled `cloudflared` binary first. If the Windows binary is absent, it
downloads `cloudflared-windows-amd64.exe` from the official Cloudflare release metadata, checks the
published asset SHA-256 against the downloaded bytes, and stores it in the app's private data
directory. It then launches `tunnel --no-autoupdate run --token-file <protected-file>`. The token
file path is an argument, but the token value is not. Standard output and error are bounded and
redacted before display. A process exit becomes a visible failed or stopped state.

### Windows service

The **Install Windows service (UAC)** action is explicit and user initiated. It creates a demand-start
service whose command reads the same protected token file, then starts it after a visible Windows UAC
consent step. The service is not silently installed, elevated, or started. The service name is
derived from the validated node identity, and uninstall stops and removes only that service.

### Docker connector

The Docker runtime uses the verified digest and mounts the protected token file read-only at
`/run/secrets/cloudflared-token`. Its root filesystem is read-only, `no-new-privileges` is enabled,
all Linux capabilities are dropped, resources are bounded, and only ordinary bridge networking is
used for outbound connector traffic. It never uses privileged mode, host networking, or the Docker
socket. The container is labelled with the owning node and is removed on stop or uninstall.

## Health, logs, and recovery

The node reconciles process state or `docker inspect` state on every status request and broadcasts
status changes. A live process or container is not called healthy until a connector registration
signal is observed. If Docker cannot confirm the container, the node reports **degraded** rather
than inventing an offline or healthy result. Recent output is capped and redacted. Start can be
retried after a missing dependency, failed digest resolution, missing token, expired service, or
unreachable Docker daemon; the last failure remains visible beside the controls.

Uninstall is local and bounded: stop the process, service, or container, delete the node's protected
token directory, and forget its runtime state. It does not delete a tunnel in the provider, DNS
records, or any user's project files. A future destructive-action integration must put the uninstall
button behind the app's existing two-key confirmation surface before exposing it as a bulk action.

## Local versus portable state

The node's display label and ordinary canvas geometry are safe project content. Runtime choice,
origin, image tag, and resource limits are held in the machine-local `workspace.json` execution
overlay. The token, resolved binary, process state, service identity, container identity, image
digest, caches, and recent logs remain in the app's local data directory. `stripSharedNodeExec` and
`sanitizeInboundNode` remove the runtime overlay from project files and inbound canvas mutations.
Opening the project on another computer therefore shows an unconfigured connector with a clear
path to store a fresh token and choose a local runtime. Import performs no download, deployment,
provider mutation, process launch, or Docker action.

## Surface boundaries

This lane is implemented in the Windows desktop shell. The Server Edition and mobile companion do
not receive a cloudflared process or Windows service through a browser bridge. They must show the
runtime as unavailable until a host-specific connector manager is deliberately added, rather than
pretending that a browser can start a local service. The feature's UI uses the shared Material Design
3 tokens and existing focus, reduced-motion, keyboard, and screen-reader conventions.

## Verification boundary for this delivery lane

The ultra-speed delivery lane intentionally did not run tests, type checks, lint, security or
accessibility checks, installer execution, runtime interaction checks, or screenshots. The code records
the intended checks and fails closed at its runtime boundaries, but artifact production and
packaging evidence must not be described as proof that those checks ran.

## Suggested articles

- [Service nodes](./service-nodes.md)
- [Docker host](../remote/docker-host.md)
- [Portable schema 3](../projects/portable-schema3.md)
- [Packaging and automatic updates](../packaging/packaging-and-auto-update.md)
