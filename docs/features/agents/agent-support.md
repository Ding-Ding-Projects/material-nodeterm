# Agent support

**Category:** [Agents](./README.md)

nodeterm treats an AI coding agent CLI as just another kind of terminal node — with extra
behaviour layered on top wherever the specific agent supports it. Claude Code, Codex, Gemini,
opencode, and Grok are built in; any other CLI can be added as a custom agent with basic
support (spawn, terminal-title tracking, process status).

## Behaviour

**Detection is hook-driven, not output-scraped.** Rather than parsing terminal text to guess
whether an agent is thinking, waiting on you, or done, nodeterm installs each agent's own
lifecycle hooks (each CLI's native mechanism for this — Claude Code's hooks, for example) so
the agent itself reports its state changes. Those events normalize into one shared four-state
model regardless of which agent produced them:

| State | Meaning | Shown as |
| --- | --- | --- |
| `working` | The agent is actively doing something. | Pulsing "RUNNING" badge. |
| `waiting` / `blocked` | The agent needs a decision from you (a permission prompt, a question). | "NEEDS YOU" badge, unread dot, optional OS notification. |
| `done` | The current turn finished. | Badge clears; a completion notification fires if the window isn't focused. |

**Capabilities are membership, not a single flag per agent.** Every capability — resumable
sessions, subagent visualization, permission-mode support, context-window metering, session
renaming, conversation branching, canvas control, and more — is its own list of which agent ids
belong to it, because agents genuinely differ: some can be resumed after a restart and some
can't, some name their own sessions but have no rename command, only Claude Code currently
supports branching a conversation into a new node. The UI checks these lists rather than
hard-coding "if this is Claude" anywhere, which is what lets a new agent gain most of the
shared feature set just by joining the right lists.

**Permission mode** controls how cautiously an agent starts — from "ask for everything" to
"proceed without asking" — and is translated per agent into that agent's own actual flag
syntax (they are not standardized across CLIs). A mode a given CLI genuinely cannot express is
never silently mapped onto the nearest one; it's simply not applied, so you never end up with
broader permissions than you asked for because of a translation gap.

**Managed accounts** let you run several logged-in Claude Code or Codex identities side by side,
each isolated by its own configuration directory or account home. Each account can carry an
optional default node colour from Settings → Accounts. A newly created node uses the selected
account's colour instead of the builtin agent colour, while an existing node keeps its baked colour
and a manually recoloured node is never rewritten. Claude and Codex account lists are resolved
independently, so matching ids in the two lists cannot cross-colour nodes. nodeterm never handles
or stores your credentials itself; the agent CLI's own login flow does, scoped to that directory.

**Context links** let two agent-capable nodes read each other's conversation transcript on
demand by drawing a connection between them on the canvas — a pull, not a push: nothing is
sent automatically, an agent has to ask for the linked context when it wants it.

## Configuration

- **Settings → Accounts**: account labels and optional default node colours for each managed Claude
  or Codex account. The **Default** swatch clears the override and restores the agent's own colour.
- **Settings → Agents** — default permission mode, agent hibernation (auto-exiting an idle,
  fully offscreen agent's CLI while keeping its shell and history, to save memory on very
  long-lived canvases), and the custom-agent list (command, label, color).
- Per-project — an override permission mode, so a project that genuinely needs broader
  permissions doesn't require changing your global default.
- Per-node: which agent CLI launches, which managed account it uses, and the colour captured at
  creation time.

## Failure modes

- **The agent CLI isn't installed**: the node still opens and shows the failed launch command
  in its terminal output, so the problem is visible rather than the node silently doing
  nothing.
- **A permission mode the CLI's installed version doesn't support** (an old agent CLI, a mode
  added in a newer release than what's on your machine): the mode gracefully degrades to no
  flag at all — the CLI's own default behaviour — rather than passing an unrecognized flag that
  could make the CLI refuse to start.
- **A hook event never arrives** (the agent crashed, or hooks were never installed for it): the
  node's status simply never updates rather than being guessed. An unknown state is never
  treated as "finished" — that distinction matters for dependent nodes waiting on this one.
- **An account colour is missing or malformed**: the node falls back to the builtin agent colour;
  it never uses a colour from the other provider's account list. A phone-registered node gets its
  colour from the host's account settings, not from a phone-supplied display value.

## Security considerations

- Agent hook traffic is local: each running session's hooks report to a loopback HTTP server
  the app runs on the same machine, authenticated with a per-session token, never a
  network-exposed endpoint.
- Managed-account isolation is by configuration directory, not by intercepting or storing
  tokens — nodeterm never sees or persists your agent CLI credentials.
- Account colours are presentation-only settings. The host resolves them at node creation and
  stores the resulting node colour with the node, while account credentials, paths, and process
  state remain outside the portable project file.
- Canvas control (an agent creating or managing nodes from inside its own session) is
  explicitly opt-in per environment and scoped to the session that requested it; an agent
  cannot control a canvas it wasn't given that capability in.

## Verification

- Start an agent node, ask it something that requires a permission decision, and confirm the
  node badge flips to "NEEDS YOU" and (if the window is unfocused) an OS notification fires.
- Set a per-project permission-mode override, open a new agent node in that project, and
  confirm the launched command reflects the override rather than the global default.
- Add a second managed account, log it in, and confirm a node bound to it uses an isolated
  configuration directory (separate login state from your first account).
- Set a Claude or Codex account's default node colour, create a node under that account, and
  confirm the node takes that colour while an existing node remains unchanged. Clear the swatch
  and confirm subsequent nodes use the builtin agent colour.
- The implementation lane records the account-colour behavior, but this ultra-speed delivery
  boundary does not run tests, type checks, lint, runtime interaction checks, or screen captures.
- Connect two agent-capable nodes with a context link and confirm one can pull the other's
  transcript on request, and that a plain terminal or an agent outside the capability list is
  not offered the option.

## Suggested articles

- [Node kinds](../canvas/node-kinds.md) — the agent node itself, alongside the terminal node
  it's built from.
- [Kanban board](../kanban/kanban-board.md) — how agent status renders on a card instead of a
  canvas node.
- [SSH projects](../remote/ssh-projects.md) — how hooks, permission modes, and managed accounts
  behave when the agent runs on a remote host.
- [Session continuity](../terminals/session-continuity.md) — the resumable-CLI relaunch this
  article references.
