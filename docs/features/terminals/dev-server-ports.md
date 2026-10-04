# Dev-server ports

A terminal node's header (and its kanban card modal) shows the TCP ports its session is listening
on, as a small chip such as `:5173` or `3 ports`. A row of the chip's menu opens
`http://localhost:<port>` in a browser node beside the terminal. On an SSH project it first
forwards the same port over the project's existing SSH connection, so the URL the tool printed in
the terminal works on this computer.

## Behavior

- **Discovery by ownership.** A port belongs to a node only when its listening socket is held by
  a process in that node's tmux pane tree. The probe is one generated POSIX shell script
  (`src/core/dev-ports.ts`) that lists the app's own tmux panes and reads listeners with `ss`,
  else `lsof`, else `/proc/net/tcp` and the processes' socket inodes. It runs locally, or over the
  project's ControlMaster in one round trip for an SSH project. Nothing is connected to; nobody
  else's ports are looked at.
- **Ephemeral ports** (32768 and above) are not counted on the chip; they are listed one level
  down under **Other ports**, because they are almost always a tool's own helper endpoint.
- **When it scans.** When the project comes on screen and when the window regains focus; a few
  seconds after one of the project's terminals changes agent status; on a slow timer (30 s local,
  60 s SSH) only while the window is focused; and whenever the chip's menu is opened. Never while
  the window is in the background.
- **Forwarding (SSH projects, desktop).** The forward binds `127.0.0.1` only, keeps the port
  number or refuses with the reason (the local port is taken on `127.0.0.1` or `::1`, or the
  computer refuses to bind it), and never forwards a port below 1024 without asking. A different
  local port is only ever offered as an explicit choice. The host-side target is derived from a
  fresh scan in core, never from the renderer. Forwards are cancelled when the node's session
  ends or a successful scan no longer lists the port, and forgotten when the project disconnects.
  **Stop forwarding** closes one explicitly.

## Configuration

None. The chip appears only when a session listens on a port.

## Failure modes

- **Windows desktop, local project:** the local probe needs a POSIX shell, so the scan answers
  `unsupported` and no chip is drawn. SSH projects from Windows work, because the probe runs on
  the host.
- A scan that could not run (a dead SSH connection, a broken tmux) is reported as unreachable,
  never as "no ports".
- A host with none of `ss`, `lsof` or a readable `/proc/net/tcp` reports `no-listener-tool`.
- A port bound to an address that is not a plain IP literal cannot be forwarded and says so.

## Security considerations

- The forward never binds a LAN address: an unfinished app is not published to the network the
  computer is on.
- The forward address and both ports are re-validated where the `ssh -O forward` arguments are
  built, because the address came from another machine's command output.
- Scanning and forwarding are host-only for relay peers (`src/shared/host-control.ts`): a peer
  can neither list the host's ports nor make it bind one.

## Surfaces

- **Desktop:** full, including SSH forwarding.
- **Server Edition:** the server registers the same core service for its own machine, and the
  browser bridge is a real namespace. The chip lists the server's ports, but its rows are
  informational: a browser tab has no browser node, and a page the viewer opened would load on the
  viewer's machine, where the server's loopback port is not. SSH projects answer `unsupported`
  there, because the server has no SSH ControlMaster.
- **Relay tabs:** `unsupported`; the chip is not drawn.
- **Mobile companion:** not applicable.

## Verification

`dev-ports.test.ts` and `dev-ports.realsh.test.ts` (the generated script under a real shell, and
end to end with tmux and a listener), `dev-ports-service.test.ts`, `port-forward.test.ts`,
`devPorts.test.ts` (renderer cadence and labels), `useDevPortScanner.test.tsx`,
`PortsChip.test.tsx`, `PortsChip.browser.test.tsx`, the `devPorts` case in
`ws-bridge.namespaces.test.ts`, and `dev-ports-wiring.test.ts`.

Ported from upstream `4e6e8607` and `6bad4a60`.
