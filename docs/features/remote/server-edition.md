# Server Edition

**Category:** [Remote & SSH](./README.md)

The exact same renderer nodeterm's desktop app uses, served headless from a Linux (or macOS)
host and reached from any browser — so your terminals, editors, source control, board, and
agents live on a machine you can reach from anywhere, rather than only the one in front of you.

## Behaviour

The server is plain `node:http` and a WebSocket connection speaking an RPC protocol — no
Electron, no native window. A thin browser-side bridge fills in the same API surface the
desktop app's preload script exposes, so the renderer code genuinely doesn't know which shell
it's running under. Terminals, the file/editor/diff experience, the full git panel, the kanban
board, and agent-status badges (RUNNING / NEEDS YOU, subagent cards, the context meter) all work
in the browser exactly as they do on desktop.

**Authentication** is single-user: a password you set on first run, checked against a secure
HTTP-only cookie, with an `Origin` header check on every request to prevent a different site's
page from silently issuing commands to your server through your browser's stored session.

**The headless notification host** is a separate deployment mode of the same server: install it
on any Linux box you SSH into, and it runs as a background service whose only job is watching
agent hooks and forwarding RUNNING/NEEDS-YOU events to your phone as push notifications — with
no open inbound port, since the hook server stays loopback-only and outbound push goes out over
plain HTTPS.

## Configuration

```bash
npm run server:dev     # build + serve; open the printed local URL and set a password
```

For the headless notification host, a single install script builds it and runs it as a systemd
service; re-running the same script updates it in place.

## Failure modes

- **Phone pairing is desktop-host-only.** Server Edition has no desktop LAN pairing listener or
  local OS SSH-key store, so the browser bridge reports `pairing.supported = false`. The quick
  pairing button is absent and Settings → Phone explains where to pair instead of calling
  rejecting stubs. A Docker deployment is already the host the browser is attached to; mobile
  push registration for that host follows the SSH-possession grant documented in `docs/SERVER.md`.
- **The browser's own capabilities are missing something the desktop app assumes** (a
  filesystem dialog, for instance): the affected feature degrades to a documented in-browser
  equivalent (an in-app folder browser instead of the OS-native file picker) rather than
  silently no-op'ing — every place the renderer reaches through the bridge either has a real
  implementation or an explicit, visible "not supported here" state.
- **The WebSocket connection drops**: reconnection is automatic; in the interim, actions that
  need the connection are refused with a visible offline indicator rather than queued silently
  and possibly lost.

## Security considerations

- Single-user auth means exactly that: this is meant for one person reaching their own machine,
  not a shared multi-tenant deployment. Put it behind your own network access control (a VPN,
  an SSH tunnel, or a reverse proxy you trust) for anything beyond a private LAN.
- The `Origin` check on every request exists specifically to prevent another open browser tab
  from silently using your authenticated session against the server.
- The headless notification host is deliberately designed to need no open inbound port at all —
  it only ever makes outbound HTTPS connections, which is a meaningfully smaller attack surface
  than exposing a listening service to the internet.

## Verification

- Run `npm run server:dev`, open the printed URL from a different device on the same network,
  set a password, and confirm you can open a terminal and see it run.
- Confirm the kanban board, source-control panel, and agent status badges behave identically to
  the desktop app for the same project.
- Install the headless notification host on a spare Linux box, start an agent session there
  over SSH, and confirm a push notification arrives on your phone when the agent needs input —
  with no port other than SSH itself open on that host.

## Suggested articles

- [SSH projects](./ssh-projects.md) — the other remote-access path, which runs a project on a
  remote host while your canvas stays local, rather than serving the whole app remotely.
- [Packaging & auto-update](../packaging/packaging-and-auto-update.md) — how the headless
  install script is built and kept current.
- [Agent support](../agents/agent-support.md) — the hook-driven status this server forwards as
  push notifications.
