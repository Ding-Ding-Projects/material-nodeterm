# Grok session ids, models and home directory

Grok is a builtin agent. This article covers three things nodeterm decides about a grok node
from grok's own CLI rather than from Claude's: whether it can choose the node's session id up
front, which models the node may be started on, and where grok's home directory is.

## Behavior

- **Session ids are minted on grok's own probe.** `src/core/grok-cli.ts` runs `grok --help` once
  per process and looks for `--session-id` on a word boundary (so `--session-id-file` and a mention
  inside another flag's description do not count). When grok supports the flag, a new grok node is
  created with a fresh session id and launches with `--session-id <id>`, placed before grok's `--`
  separator. The node can then be resumed after a restart even if its agent never fired a hook.
  Claude's probe never decides this for grok, and grok's never decides it for Claude.
- **An id that already exists is never reused.** grok refuses a `--session-id` that already
  exists under its session directory for that folder. The renderer keeps a per-folder set of the
  ids grok already owns (`src/renderer/state/grokSessionIds.ts`, filled through
  `window.nodeTerminal.grok.takenSessionIds`), and `mintFreeGrokSessionId` re-mints against it; after
  three collisions it mints nothing and the node launches without the flag. The first node in a
  folder nobody has opened yet is minted before that set arrives (node creation is synchronous).
- **Models come from `grok models`.** The same probe runs `grok models` and reads only the indented
  bullets under "Available models:". The transfer-with-model picker offers grok exactly that list,
  never the model gateway's catalogue, because grok's own configuration, not the environment,
  decides where its models are served. The `--model` flag goes before grok's `--` separator.
- **The session map survives a restart.** The mapping from a grok session id to its session
  directory, learned from hooks, is written to `grok-session-dirs.json` under the app's data
  directory, so a grok node's name resolves straight after a restart.
- **GROK_HOME is asked of the login shell on Linux.** When `GROK_HOME` is not in nodeterm's own
  environment, the Linux login shell is asked once; if it names another directory, grok's hook
  file is written there too. When the probe finds nothing, a console warning says hooks went to the
  default `~/.grok`.

## Configuration

No new setting. Model switching uses the existing transfer-with-model flow. To point nodeterm at a
non-default grok home on Windows, set `GROK_HOME` in the environment nodeterm is launched from.

## Failure modes

- grok missing, `--help` failing or timing out: no session id is minted and no models are offered;
  the launch line is exactly what it was before this change.
- `grok models` failing or unparseable: an empty model list (no model switching), never a partial
  one.
- An unreadable or hand-edited `grok-session-dirs.json`: an empty map; every entry is re-validated
  as a safe session id before it is used.
- A remote (SSH) grok node's session name still does not resolve: the reader seam exists in
  `readAgentSessionName`, but the desktop's SSH implementation is not wired yet.
- Subagent cards for grok are not available in this build (grok is not in `SUBAGENT_CAPABLE`).

## Security considerations

- The probe and the taken-id read run on the machine the node launches on. The taken-id read lists
  directory names only and never opens a session file.
- A relay tab routes both calls to the host; `grok-cli:caps` and `grok-cli:taken-session-ids` are on
  the relay request allowlist (`src/main/relay-rpc-policy.ts`).
- A minted id is a v4 UUID and is validated again before it is placed on a command line.
- On Windows the probe runs an npm `.cmd` install through the escaped cmd.exe path described in
  [Windows CLI resolution and npm shim execution](../windows/cli-shim-execution.md).

## Surfaces

- **Desktop:** full.
- **Server Edition:** full; `registerGrokCliIpc` runs in the server shell and the browser bridge
  calls it over WS-RPC.
- **Relay tabs:** the probe and the taken-id read answer for the host.
- **Mobile companion:** not applicable; it launches no agent.

## Verification

- `src/core/grok-cli.test.ts` (help and models parsing, the injectable runner),
  `src/core/grok-session-mint.test.ts`, `src/shared/agents/config.capabilities.test.ts`,
  `src/shared/agents/model-gateway.test.ts`, `src/shared/agents/launch.test.ts`.
- `src/renderer/state/workspace.session-id.test.ts`: grok mints on its own probe only, the flag sits
  before `--`, and a warmed folder whose taken id is generated first re-mints (mutation-checked red
  with the check bypassed).
- `src/server/handlers/index.test.ts`: the server shell registers the grok handler
  (mutation-checked red with the registration removed).
- `src/core/grok-session.test.ts`, `src/core/agents/grok-paths.test.ts`,
  `src/core/agents/hooks/index.test.ts`, `src/core/agent-session-name.test.ts`.
- Device checklist: see the grok items in
  [Windows CLI resolution and npm shim execution](../windows/cli-shim-execution.md) and
  `docs/grok-agent.md` §9; no grok binary was available where this was ported.

## Suggested articles

- [Agent support](./agent-support.md)
- [Model switching](./model-switching.md)
