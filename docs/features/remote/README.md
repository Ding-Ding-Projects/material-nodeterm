# Remote & SSH

Two different ways nodeterm reaches a machine that isn't the one in front of you.

- [SSH projects](./ssh-projects.md) — opening a project on a remote host over SSH, with
  terminals, files, git, and the board all running there while the canvas stays local.
- [Server Edition](./server-edition.md) — the same renderer, self-hosted and served to any
  browser over plain HTTP/WebSocket.
- [Docker host](./docker-host.md) — free encrypted project sharing through a Docker-hosted relay.
- [Cloudflare tunnels](./cloudflare-tunnels.md) — account, zone, tunnel, route, connection, and
  DNS control-plane inventory with typed previews and unmanaged-route preservation. This lane does
  not run a connector runtime.

See also [Agents](../agents/README.md) for how agent hooks and permission modes work across an
SSH connection, and [Packaging](../packaging/README.md) for how the headless notification host
is installed.
