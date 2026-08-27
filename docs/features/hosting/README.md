# Hosted service nodes

**Category:** Hosting

Hosted service nodes are guided, local-first managers for services that run in a selected Docker
context. They keep safe user intent in the project projection and keep host bindings, runtime state,
paths, and credentials in local application data.

## Articles

- [Open WebUI hosting](./open-webui-hosting.md), persistent data, local Ollama reuse, provider setup,
  health, backup, restore, update, and rollback.

## Shared boundaries

- A hosting node never accepts an arbitrary image, entrypoint, shell command, Compose document, or
  environment editor.
- Import is data-only. It does not contact a host, deploy a container, download an image, or mutate
  a provider.
- Secrets remain in the operating-system credential store or in the provider's own first-user setup;
  they never enter a project file, log, export, or command argument.

## Suggested articles

- [Docker host manager](../remote/docker-host.md)
- [Portable project projection](../projects/portable-canvas-projection.md)
- [Unified Node Catalog](../canvas/node-catalog.md)
