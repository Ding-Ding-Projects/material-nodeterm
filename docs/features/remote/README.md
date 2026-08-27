# Remote & SSH

Two different ways nodeterm reaches a machine that isn't the one in front of you.

- [SSH projects](./ssh-projects.md) — opening a project on a remote host over SSH, with
  terminals, files, git, and the board all running there while the canvas stays local.
- [Server Edition](./server-edition.md) — the same renderer, self-hosted and served to any
  browser over plain HTTP/WebSocket.
- [Docker host manager](./docker-host.md) - guided local and SSH context management for containers,
  images, volumes, networks, Compose profiles, statistics, logs, and fixed typed tasks.
- [Cloudflare Tunnel inventory](./cloudflare-tunnel-inventory.md) - bounded tunnel, route, and DNS
  inventory with preserved ingress routes, hostname conflict review, and explicit DNS adoption.
- [Cloudflare Tunnel wizard](./cloudflare-tunnel-wizard.md) - one-click review-first route with
  populated account, zone, hostname, host, container, network, port, and origin choices, local
  credential binding, portable intent, cancellation, and recovery.
- [cloudflared connector runtimes](./cloudflared-runtimes.md) - guided per-user process, Windows
  service, and pinned Docker connector lifecycles with local token storage and portable intent.

See also [Agents](../agents/README.md) for how agent hooks and permission modes work across an
SSH connection, and [Packaging](../packaging/README.md) for how the headless notification host
is installed.
