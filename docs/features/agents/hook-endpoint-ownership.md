# Hook endpoint ownership and failover

Every agent session that nodeterm starts reports status, runs canvas-control verbs and reads linked
context by posting to the loopback hook server. A tmux session outlives the app, so a session can
be pinned to an endpoint file whose listener has gone, or whose socket now belongs to a different
nodeterm instance. This article covers how the hook server refuses to take an endpoint it does not
own, and how the generated clients find their own instance again without ever sending a request
to an unrelated one. Ported from upstream `bd895ba1`, `bbb3a291`, `8b0009ec`, `9fad4769` and
`ba1d8731`, plus the nonfatal startup path from `b97278dd`.

## Behavior

- **Startup checks the existing advertisement first.** Before minting a bearer, the hook server
  reads the endpoint file left on disk (as data, never sourced) and probes every transport it names
  (`assertHookEndpointAvailable` in `src/core/agents/hook-socket-owner.ts`). Only a refused connect
  proves the file stale. A listener that accepts the advertised bearer on `/verify` and rejects an
  unrelated one is a live nodeterm owner; any other answer, a timeout or a malformed file is
  treated as "could not be authenticated". In both cases the file is left untouched and startup
  stops.
- **A Unix socket path is not ownership proof.** The local socket is removed only after a connect
  returns `ECONNREFUSED` and the inode is unchanged afterwards (`clearStaleHookSocket`). A live
  listener, a regular file, a symlink or an uncertain probe refuses the bind.
- **Only what this run published is removed.** The endpoint file is written atomically
  (`writeFileAtomic`, mode 0600) and `stop()` or a failed start removes it only when its bytes are
  still the ones this run wrote.
- **Startup failure never stops the app.** Desktop and Server Edition call `startForApp()`. When
  ownership cannot be taken, hooks stay disabled, the app keeps running, and a warning names the
  endpoint file and the recovery steps: a dialog on the desktop and a log line on the Server
  Edition. The warning never includes raw errors, which could carry a bearer.
- **A wrong bearer is answered 421 before any handler runs.** A request with no bearer stays 403.
  The managed hook script, the canvas-control shim and the context-link shim treat 421 like a dead
  transport for endpoint discovery, including inside the Codex network sandbox, because a 421
  proves the transport worked. A node-identity 403 or 400 from a real owner stays final.
- **Control and context requests stay on the owning instance.** The shared fragment
  `OWNED_ENDPOINT_FALLBACK_SH` (`src/core/agents/hook-endpoint-failover-sh.ts`) reads the owner
  reference from the primary endpoint's own token directory only. A fallback candidate is adopted
  when its directory holds the same per-node token, or, when the reference is empty, when its token
  directory is the same real directory. Anything else is skipped without being contacted, and the
  endpoint variables are restored so later diagnostics never name a skipped socket. Hook events
  keep the older, wider failover policy.
- **Fallback candidates are probed with a bound.** Before posting to an adopted candidate, the shim
  calls `/hook/verify` with a 1.5 second limit. A reverse-tunnel socket that accepts and never
  answers no longer hangs the call. The primary endpoint is never probed, and the real request has
  no client-side time limit because a confirmation-gated verb waits for a person.
- **The failure message matches the cause.** When a foreign endpoint was skipped and the owner did
  not answer, the shims print `FOREIGN_ENDPOINT_HINT`: the owning connection is unreachable and the
  state is temporary. When the primary is an SSH reverse-tunnel endpoint file
  (`~/.nodeterm/hook-endpoint*.env`) they print `TUNNEL_DOWN_HINT` (retry after the desktop
  reconnects). Otherwise the existing stale-endpoint advice applies. All four agent-facing texts
  (canvas skill and instructions block, context skill and instructions block) quote the same lead
  sentence and teach it as temporary.

## Configuration

There is no setting. The endpoint file lives at the usual `hook-endpoint.env` in the data
directory; SSH projects use the per-installation file described in
[SSH projects](../remote/ssh-projects.md).

## Failure modes

- **Another nodeterm instance owns the data directory:** the second instance starts with hooks
  disabled and says so; the first keeps serving. Close the other instance and restart.
- **A stale or malformed endpoint file with no live listener:** a refused connect is reclaimed
  automatically; a malformed file is preserved and the warning asks for it to be backed up and
  removed.
- **An unrelated HTTP service answers on the advertised port:** it is not authenticated as
  nodeterm, its advertisement is preserved, and hooks stay disabled until the file is inspected.
- **The desktop's SSH tunnel is down:** remote control and context calls fail with the
  owner-unreachable sentence instead of relaying another server's permanent refusal; retrying after
  the desktop reconnects succeeds.

## Security considerations

- Credentials never travel in argv. Every curl call site in the generated clients, including the
  new liveness probe, reads its headers from stdin (`--config -`).
- The owner reference is client-side routing, not authorization. The receiving server still checks
  every bearer, node token and verb. On an SSH host the token directory is shared per Unix account,
  so the match narrows the walk to one family of endpoints; it does not tell two desktops that drive
  the same account apart.
- The startup warning omits raw errors so a malformed header cannot echo a bearer into a dialog or
  log.

## Surfaces

- **Desktop:** full; the startup warning is a native dialog.
- **Server Edition:** full; the hook server is the same core listener and the warning is logged.
- **Mobile companion:** not applicable; the mobile wire protocol and node-identity rules are
  unchanged.

## Accessibility and localization

The only new user-facing text is the native startup warning, shown through the operating system
dialog with its own keyboard and screen-reader support. It is English only, like the other
main-process dialogs; the agent-facing shim messages are read by agents, not people.

## Verification

- `src/core/agents/hook-socket-owner.test.ts`, `hook-server.boot.test.ts`, `hook-server.sock.test.ts`
  and `hook-server.recovery.test.ts`: ownership probe, stale socket reclaim, nonfatal boot, 421.
- `src/core/agents/hooks/managed-script.test.ts`: the hook script re-reads the token after a dead or
  wrong-owner primary.
- `src/main/control-owner-failover.test.ts`, `src/main/owned-endpoint-walk.test.ts` and
  `src/main/control-owner-tunnel-down.test.ts`: both generated shims run under the real POSIX shell
  (`src/core/testing/posix-shell.ts`) against fixture endpoints, a stale tunnel socket and the real
  hook server standing in for an unrelated Server Edition.
- `src/main/canvas-control-shim.failover.test.ts` and `src/main/canvas-control-core.test.ts`,
  `src/core/context-link-core.test.ts`: 421 discovery, final 403, and the agent-facing wording.
- The macOS socket assertion in `owned-endpoint-walk.test.ts` switches on only when the sandbox hint
  carries upstream's `allow_unix_sockets` remedy, which this fork has not ported yet.
