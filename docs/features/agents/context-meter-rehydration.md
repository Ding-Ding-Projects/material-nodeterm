# Context meter rehydration at mount

**Category:** [Agents](./README.md)

A terminal session outlives the app: after a restart, a continuing agent session is usually idle
and sends no lifecycle hook event, and a hook event is otherwise the only thing that feeds the
per-node [context-window meter](./context-window-meter.md). When an agent node mounts with a known
session id, the renderer therefore asks the core to locate that session's transcript and start
tailing it, so the meter fills immediately instead of on the next prompt.

## Behavior

- **One handler in core, served by both shells.** `src/core/context-ensure.ts` registers the
  `context:ensure` channel through `CorePlatform`. The desktop (`src/main/index.ts`) and the Server
  Edition (`src/server/index.ts`) both call `registerContextEnsureIpc` with their own tails. Before
  this, the desktop had its own inline copy and the Server Edition registered the channel twice, so
  every browser ensure resolved twice through two different Claude fallbacks.
- **Each agent resolves through its own locator and tail.** Claude uses `resolveTranscript`, whose
  current-directory fallback keeps the managed account id so a managed-account node never reads
  the system transcript root. Codex and Gemini use `locateCodex` and `locateGemini`, keyed strictly
  by session id with no directory fallback, and are tracked on their own tails, whose parsers keep
  the per-agent token formulas separate. The switch is closed: Grok, OpenCode and custom agents get
  no mount-time reading rather than another agent's numbers. Grok has nothing to rehydrate from,
  because its meter reads a `signals.json` whose directory is learned only from a hook event.
- **SSH-project nodes resolve on their host.** On the desktop, a node that runs on an SSH project's
  host is located through `remoteTranscriptRefFor`, the same locator, jail and hit cache the chat
  view's transcript read uses, and tracked on the remote context tail. Remote rehydration covers
  Claude only, the same boundary the hook listener draws: a remote Codex or Gemini node gets no
  mount-time reading.
- **Remoteness has two claims.** The renderer sends whether the node belongs to an SSH project
  (`remoteSession` in `TerminalNode.tsx`), and the desktop also checks for a live ControlMaster for
  the node. Either claim makes the session remote. The renderer's claim matters because a mount
  can run before the node's terminal process, and so its ControlMaster, exists.
- **The node is remembered.** When a session is tracked for a node, the shell records the node to
  session association its hook listener records for a live event, so closing the node releases the
  tail and the per-node context reading reaches the companion's context ring.

The channel carries `(sessionId, cwd, accountId, agentId, nodeId, remote)`. This order keeps the
agent id in fourth place, where every earlier build of this app sent it; upstream nodeterm sends
the node id before the agent id.

## Configuration

There is no setting. The call is made for every agent node that shows a context meter and has a
session id. The meter's own display states are described in
[Context-window meter](./context-window-meter.md).

## Failure modes

- **An unresolved remote session is terminal.** If the host could not be asked (no ControlMaster
  yet, an unresolved remote home, a failed ssh call) or found no transcript, the ensure ends with no
  reading. It never falls through to a local resolver, which would read this machine's disk and
  could meter an unrelated local session that shares the working directory.
- **A remote claim on the Server Edition is refused.** The Server Edition has no SSH-project
  manager, so a node the browser marks as remote gets no mount-time reading.
- **Nothing negative is cached.** A miss and a failed read look the same to the remote locator, so
  neither is remembered; the next mount or the next hook event tries again in full. The only
  de-duplication is of identical requests still in flight, keyed on every field that changes the
  answer, and it is released when the request settles. The Codex and Gemini locators keep their
  existing bounded indexes, which refresh every 30 seconds, so a session created in the last 30
  seconds may only be found on a later mount.
- **Relay tabs are not covered.** The node calls the viewing app's own bridge, so a relay tab's
  meter still fills only on its next hook event.

## Security considerations

- Every located local path passes the shell's local transcript jail
  (`isSafeLocalTranscriptPath`: Claude's system and managed-account project roots, Gemini's
  temporary root and Codex's sessions root), the same jail a hook-reported path passes. The jail is
  never widened to the home directory.
- A remote path passes `isSafeRemoteTranscriptPath` inside `remoteTranscriptRefFor`, because the
  host's answer crosses a machine boundary before it is read.
- Wire arguments are hand values: anything other than a non-empty string reads as absent, the
  session id must match `SESSION_ID_RE`, and only a literal `true` counts as a remote claim.
- `context:ensure` remains a relay cast in `src/main/relay-rpc-policy.ts`; its handler only reads
  transcripts under the jailed roots and changes no state beyond which file a tail watches.

## Surfaces

- **Desktop:** full, including the remote leg for SSH-project nodes.
- **Server Edition:** full for local sessions through the real `context.ensure` bridge member in
  `src/renderer/bridge/ws-bridge.ts`; SSH-project sessions are refused as described above.
- **Mobile companion:** not applicable. The companion reads the per-node context ring the shells
  publish and has no transcript of its own to rehydrate.

No control, copy or rendered element is added, so there is no Material 3 audit row and no new
localized string.

## Verification

- `src/core/context-ensure.test.ts` pins per-agent routing, the closed switch, that a Codex node
  never reaches Claude's resolver even when sharing a working directory with a Claude session, the
  terminal remote answer, the renderer's remote claim with no remote leg, the jail, node
  bookkeeping, no negative caching and in-flight de-duplication.
- `src/main/context-ensure-wiring.test.ts` pins that the desktop registers the core handler once,
  admits paths through the local jail, answers `null` only when neither remote claim holds, routes
  remote reads through the jailed locator and caches nothing on a miss, and that the Server Edition
  registers the handler exactly once with no remote leg.
- `src/renderer/nodes/title-gate.test.ts` pins that the node passes the agent id, node id and
  remote claim, and that the old `claude:remote` agent-id sentinel is gone.
- `src/renderer/bridge/ws-bridge.namespaces.test.ts` pins the bridge cast's arguments.

## Suggested articles

- [Context-window meter](./context-window-meter.md) - display states, generation fencing and privacy.
- [Context-window progress](./context-window-progress.md) - provider telemetry sources.
- [SSH projects](../remote/ssh-projects.md) - ControlMaster reuse and remote transcript reads.
