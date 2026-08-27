# Open WebUI hosting

**Category:** [Hosted service nodes](./README.md)

The Open WebUI hosting node runs the pinned official Open WebUI image in a selected Docker
context. It keeps its application data in a named persistent volume, can reuse an Ollama service
already running on the local machine, and offers an OpenAI-compatible provider mode without placing
an API key in the project or Docker command line.

## Behaviour

The node starts with a safe Ollama intent: model `llama3.2`, local Ollama reuse enabled, and port
`3000`. The node catalog offers it as an available guided entry. The context picker is populated
from Docker's discovered local and SSH contexts. The model and context searches are plain text by
default and each has its own adjacent anchored regex builder.

Deploy creates or reuses a node-owned volume and container, labels the container for ownership, and
starts only the pinned `ghcr.io/open-webui/open-webui:v0.6.37` image. The local Ollama route uses
the fixed `http://host.docker.internal:11434` bridge. The OpenAI-compatible route records only a
validated base URL locally and leaves API-key entry to Open WebUI's own first-user/provider setup.

The health surface distinguishes unbound, checking, running, first-user setup required, stopped,
unreachable, and failed. A running local endpoint can be opened only after a verified health read.
An SSH-context deployment remains honest that this desktop cannot probe or open the remote HTTP
endpoint without a separate tunnel.

## Configuration and persistence

The portable `openWebUiIntent` contains only schema version, feature id, provider kind, model,
Ollama-reuse choice, and port. The local application-data file `open-webui-bindings.json` contains
the selected Docker context, node-owned container and volume names, local endpoint, optional
provider URL, image history, and backup timestamp. It is written atomically with owner-only mode.

The local binding is excluded at the shared project and peer boundaries. Opening the same project on
another computer shows an unbound node with Configure or Deploy available, and import performs no
network, deployment, image pull, provider mutation, process launch, or download action.

## Backup, restore, update, and rollback

Backup asks for a local destination folder and streams the node-owned data volume into a timestamped
`.tar.gz` file. Restore asks for a local `.tar.gz`, validates that archive members stay below the
`data/` root, then uses the existing two-key destructive confirmation before overwriting the volume.
The source file is never modified.

Update pulls the same pinned image, recreates only the owned container while retaining its named
volume, and records the prior image. Rollback uses that recorded prior image. If recreation fails,
the manager attempts to restore the prior image and reports the outcome instead of claiming a green
update. Every long operation reports queued, running, completed, failed, or cancelled state and
keeps a bounded operation list in the node.

## Failure modes and security

- Missing Docker or an unavailable context leaves the node usable for intent editing and names the
  exact next action. It never falls back to a free-form command.
- A same-named unowned container is refused. The manager does not adopt or remove it.
- A malformed, unsafe, or non-archive restore source is refused before the volume changes.
- Provider credentials are not accepted in URL fields, command arguments, project data, logs, or
  exports. The API-key step belongs to Open WebUI's authenticated first-user setup.
- Host paths are accepted only after local absolute-path, file-type, and link checks. Paths are not
  copied into the portable project.

## Verification boundary

This implementation lane intentionally did not run tests, type checks, lint, reviews, security or
accessibility checks, builds, packaging, installer execution, runtime interaction, or UI captures.
Those are release and verification work for the owning task after this implementation commit. The
source and documentation here describe the implemented routes, not a completed runtime verdict.

## Suggested articles

- [Docker host manager](../remote/docker-host.md)
- [Portable project projection](../projects/portable-canvas-projection.md)
- [Unified Node Catalog](../canvas/node-catalog.md)
- [Local Ollama suite manager](../../ollama-manager.md)
