# Remote & SSH

Two different ways nodeterm reaches a machine that isn't the one in front of you.

- [SSH projects](./ssh-projects.md) — opening a project on a remote host over SSH, with
  terminals, files, git, and the board all running there while the canvas stays local.
- [Server Edition](./server-edition.md) — the same renderer, self-hosted and served to any
  browser over plain HTTP/WebSocket.
- [OAuth callbacks from remote sessions](./oauth-callbacks.md) — bounded SSH forwarding on the
  desktop and a single-use host-local callback completer in the Server Edition.
- [Docker host manager](./docker-host.md) - guided local and SSH context management for containers,
  images, volumes, networks, Compose profiles, statistics, logs, and fixed typed tasks.

See also [Agents](../agents/README.md) for how agent hooks and permission modes work across an
SSH connection, and [Packaging](../packaging/README.md) for how the headless notification host
is installed.
