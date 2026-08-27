# cloudflared connector runtimes

## Behavior

The Cloudflare Tunnel connector runtime is owned by the desktop main process and offers three
guided choices:

- **Per-user process** starts the discovered `cloudflared` executable as the current user.
- **Windows service** creates and starts an owned Windows service on Windows only. Service creation
  may require administrator approval, and the UI reports that requirement before the action.
- **Docker connector** starts a pinned `cloudflare/cloudflared` image in a discovered Docker context
  and selected network.

The surface presents discovered executables, Docker contexts, and Docker networks as pickers. Each
picker has local plain-text search plus its own adjacent anchored full regex builder. No field accepts
an arbitrary command, shell fragment, image, entrypoint, argument list, environment map, or service
definition.

Every connector has a real lifecycle state: unconfigured, disabled, starting, running, stopping,
stopped, or failed. Start and stop publish bounded queued, starting, health-check, running,
completed, failed, and cancelled progress. Restart stops the owned runtime and starts the same
validated binding. Health reads the process, service, or owned container through a bounded command
and reports the exact observed state. A runtime never stops or removes an object it did not create.

## Fixed execution contracts

All three runtimes execute the same fixed tunnel command shape:

```text
cloudflared tunnel --no-autoupdate run --token-file <token-file> <tunnel-reference>
```

The per-user process invokes this argv directly. The Windows service receives a validated service
command assembled from the discovered executable, generated owned service name, token-file path,
and selected tunnel reference. The Docker connector uses the pinned image, a generated owned
container name, a read-only token-file bind mount, no network by default unless a discovered network
is selected, read-only root, dropped capabilities, `no-new-privileges`, bounded CPU, memory and PID
limits, and no Docker socket or host network.

The main process uses `execFile` and `spawn` with argument arrays. A non-zero result is a failure,
not an assumed healthy state. Output is bounded and is not copied to the renderer when it could
contain credentials.

## Credentials and local state

Tunnel tokens are accepted only by the protected main-process credential route. They are stored in
the operating-system credential store through Electron `safeStorage` when available, with an
owner-only restricted-file fallback when the operating-system store is unavailable. The token is
never placed in an argument, environment variable, project file, renderer bundle, log, export,
history entry, or remote record.

At start, the main process materializes a short-lived owner-only token file under application data.
The per-user process and Docker connector read that file. The Windows service uses the same local
file and reports an explicit permission recovery message if its service account cannot read it. The
token file is removed when the owned runtime stops. Credential status distinguishes missing,
unavailable, and corrupt storage without revealing the value or describing its shape.

Runtime rows carry an owner marker and generated names. Stop, restart, and cleanup actions are
scoped to that marker and the exact selected node. Existing services, containers, and networks are
never adopted or modified implicitly.

## Portable project intent

`CLOUDFLARED_RUNTIME_PORTABLE_BLUEPRINT` and `CloudflaredRuntimeIntent` contain only safe intent:
schema version, node identity, node layout, runtime choice, tunnel reference, auto-start preference,
network choice intent, and relationships. They omit credentials, executable and token paths, service names,
Docker context and network identifiers, container names, process state, caches, and health results.

Importing the intent performs no executable discovery, Docker request, service mutation, token read,
process launch, download, or provider request. On another computer the user must explicitly choose
Configure, Rebind, Locate Asset, or Leave Unbound through the guided surface. Export and import
reports these omissions without exposing a private path or credential.

## Disabled states and recovery

The runtime option catalog keeps unavailable choices visible with an exact reason:

| Reason | Recovery shown beside the disabled choice |
| --- | --- |
| `platform-unsupported` | Use the per-user process or Docker connector on this platform. |
| `executable-missing` | Select a discovered executable or complete the documented local install route. |
| `docker-unavailable` | Start Docker and refresh contexts. |
| `context-unavailable` | Select an available context and refresh. |
| `network-unavailable` | Select `none` or refresh and choose a current network. |
| `credential-missing` | Save a tunnel token in protected local credential storage. |
| `credential-store-unavailable` | Unlock or repair the operating-system credential store. |
| `service-permission-required` | Approve service creation or use the per-user process. |
| `service-unavailable` | Refresh owned service state and use the displayed recovery action. |
| `invalid-selection` | Reopen the picker and choose a currently discovered value. |

If the executable, service, Docker context, network, or token disappears between discovery and
start, the action fails closed and names the value that must be refreshed. A failed start leaves the
previous valid binding intact. Cancellation kills only the operation process for the displayed
operation id. Informational and progress messages are non-blocking and remain reviewable.

## Implementation and surface inventory

| Surface | Implementation | Search and builder |
| --- | --- | --- |
| Shared portable intent and typed selections | `src/shared/cloudflared-runtime.ts` | `CLOUDFLARED_RUNTIME_SEARCH_FIELDS` |
| Credential storage and lifecycle manager | `src/main/remote/cloudflared-runtime.ts` | Main-process only, no renderer command input |
| Per-user process | `CloudflaredRuntimeManager.start()` | Discovered executable picker |
| Windows service | `cloudflaredWindowsServiceArgs()` and manager lifecycle | Owned service picker |
| Docker connector | `cloudflaredDockerArgs()` and manager lifecycle | Context and network pickers |
| Local runtime records | `cloudflared-runtime-records.json` in application data | Runtime records search |

## Verification boundary

This ultra-speed implementation lane intentionally did not run tests, type checking, lint, review,
security or accessibility checks, builds, packaging, installer execution, runtime interaction, or
UI captures. The source documents the intended contracts; those checks remain unverified until the
owning integration lane runs them against the exact merged commit.

## Suggested articles

- [Remote and SSH features](./README.md)
- [Docker host manager](./docker-host.md)
- [Portable schema 3](../projects/portable-schema3.md)
- [Packaging and updates](../packaging/README.md)
