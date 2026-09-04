# Agent support

**Category:** [Agents](./README.md)

nodeterm treats an AI coding agent CLI as just another kind of terminal node — with extra
behaviour layered on top wherever the specific agent supports it. Claude Code, Codex, Gemini,
opencode, Grok, and Cognition Devin are built in; any other CLI can be added as a custom agent
with basic support (spawn, terminal-title tracking, process status).

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
demand by drawing a connection between them on the canvas. Reading remains pull-based, while an
authenticated linked agent may send the fixed `notify --node <id>` inbox-check signal when shared
coordination context changes. The signal contains no transcript excerpt or caller-supplied text,
and is rate-limited per source-target pair.

**Restart-safe display status** keeps a lifecycle-bound last-known workflow state for each node.
The snapshot is display-only: it may restore a useful `RUNNING`, `NEEDS YOU`, or `DONE` label after
the app restarts, but it is never treated as live evidence. Operational state still expires, and a
fresh hook event always takes precedence over the snapshot. Claude and Gemini transcript tails, plus
Codex app-server thread status, are inspected only through bounded local readers when recovery is
requested. Remote-project nodes are left unknown when the local host cannot inspect their evidence.

The sessions sidebar groups rows by workflow state in the order **Need attention**, **Done**,
**Unknown**, and **Running**. Unread is a row-level notification affordance, not a workflow bucket,
so an unread completed session remains under **Done** and an unread session without state remains
under **Unknown**.

**Per-node model switching** lets a supported node choose one model from the configured gateway.
The choice is persisted on that node and reused for future launches, cold restores, and resumes.
Switching a running node validates the session and harness ownership, terminates only the expected
foreground agent process, recycles the persistent terminal so its current gateway environment is
present, and resumes the same provider conversation. See [Per-node model switching](./model-switching.md)
for the explicit-choice, failure-recovery, project-ownership, and relay boundaries.

### Agent-to-agent drag contract

The upstream interaction is a handle connection, not node reparenting. The source agent exposes a
`link-out` handle on its right edge and the destination exposes a `link-in` handle on its left edge.
Dragging the first handle onto the second creates one context-link edge when both terminal nodes
resolve to an agent in the upstream `CONTEXT_LINK_CAPABLE` list (`claude`, `codex`, `gemini`, or
`opencode`). The edge is bidirectional for reads, even though React Flow still stores one source and
one target. Self-links, duplicate pairs, plain terminals, unsupported agents, and non-terminal
targets are refused without changing the canvas.

This behavior is evidenced by upstream `src/renderer/nodes/TerminalNode.tsx` (the `link-out` and
`link-in` handles), `src/renderer/lib/noteLink.ts` (`classifyLink`, `pairKey`, and the link-map
builders), and `src/renderer/canvas/Canvas.tsx` (`onConnect`, duplicate suppression, and the
150-millisecond link-map write). The capability and lifecycle were introduced in upstream commits
`9bf37b71` and `49f3336d`, extended for per-agent messages in `25820ae5`, hardened for hand-launched
agents in `14aa9a97`, and made available in the Server Edition by `222e35cf`. The security fix in
`1bdfcde0` keeps renamed node titles single-line before any idle discovery note is sent to a session.

On success, the link is saved in the project's `bridges` data, the edge is included in the shared
canvas scene, and the core writes a per-node link document below its private application data. Each
agent reads only through its own hook-authenticated context-link route. The connection does not
send a transcript automatically. The existing idle-only discovery note is skipped for a working
session, and a failed context read returns an honest failure instead of granting another node
access. Removing the edge by double-click or the canvas edge-delete action removes the persisted
link; the existing canvas history treats link-edge state separately from node-array undo, so a link
gesture is not reported as a node move or a credential/session change.

The fork matches this upstream contract and additionally synchronizes bridge and lineage edges to
connected peers through its existing canvas scene mutation protocol. That peer synchronization is a
fork-specific extension, not a new meaning for the drag gesture. The fork also resolves its
context-link directory from the active platform on each call rather than caching one directory for
the process, which keeps a later server lifecycle from writing into an earlier lifecycle's data
directory. The fork adds an accessible `Link to another agent` header action with a searchable
keyboard picker; it invokes the same `onConnect` handler and therefore has the same capability,
duplicate, persistence, failure, and deletion semantics as the handle drag. It does not add body-drop
reparenting, automatic transcript exchange, new team roles, or a new session authority boundary.

## Configuration

- **Settings → Accounts**: account labels and optional default node colours for each managed Claude
  or Codex account. The **Default** swatch clears the override and restores the agent's own colour.
- **Settings → Agents** — default permission mode, agent hibernation (auto-exiting an idle,
  fully offscreen agent's CLI while keeping its shell and history, to save memory on very
  long-lived canvases), and the custom-agent list (command, label, color).
- **Settings → Notifications** — enable linked-agent inbox signals. The setting is off by default,
  and arbitrary terminal writes remain separately confirmation-gated.
- Per-project — an override permission mode, so a project that genuinely needs broader
  permissions doesn't require changing your global default.
- Per-node: which agent CLI launches, its selected gateway model when supported, which managed
  account it uses, and the colour captured at creation time.

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
- **A linked notification is refused** when the source is not authenticated, the target is not a
  context-link-capable agent, the persisted bridge edge is absent, or the existing delivery route
  refuses the request. These are explicit refusals, not silent delivery claims.
- **An account colour is missing or malformed**: the node falls back to the builtin agent colour;
  it never uses a colour from the other provider's account list. A phone-registered node gets its
  colour from the host's account settings, not from a phone-supplied display value.
- **Restart evidence is missing, stale, or malformed**: the row keeps its last-known display value
  when one exists, otherwise it remains unknown. A failed transcript or app-server read never turns
  into a guessed `DONE` state, and it never triggers a notification, process action, or hibernation.
- **A restored row is considered for hibernation**: it is excluded until a live event establishes
  current operational evidence. This prevents a display-only timestamp from being mistaken for an
  idle clock.

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
- The inbox signal reuses the authenticated main-process delivery path and records only stable
  notification targets. It never uses display-only ropes, mutable titles, or transcript content as
  authorization or notification payload.

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
- Enable linked-agent inbox signals, invoke `notify --node <id>` from one linked agent, and confirm
  the target becomes unread, the notification centre offers **Open agent**, and duplicate signals
  coalesce. Reload and confirm the actionable record contains no transcript content.
- Restart with a previously active node and confirm its last-known state is labelled as display
  continuity, while a fresh hook event replaces it and recovered state cannot trigger notification,
  authorization, or hibernation.
- Open the sessions sidebar with unread completed and unknown rows and confirm they remain in their
  workflow sections instead of moving into an Unread section.

The current ultra-speed implementation lane intentionally did not run tests, lint, type checks,
builds, packaging, runtime interaction, reviews, security or accessibility checks, or captures.
Those checks remain pending against the reconciled default branch and packaged application.

- Configure a model gateway, choose a discovered model for one supported node, and confirm the
  selected model is stored on that node while another node remains unchanged. For a running node,
  confirm the foreground process ownership check, persistent-session recycle, and same-conversation
  resume. Also confirm that an invalid gateway, relay node, busy session, failed recycle, and stale
same-model callback refuse without changing node data. This source-only lane did not run those
checks.

## Suggested articles

- [Devin CLI](./devin-cli.md) — the measured launch, hook, and capability details for Cognition
  Devin CLI 3000.4.25.
- [Node kinds](../canvas/node-kinds.md) — the agent node itself, alongside the terminal node
  it's built from.
- [Kanban board](../kanban/kanban-board.md) — how agent status renders on a card instead of a
  canvas node.
- [SSH projects](../remote/ssh-projects.md) — how hooks, permission modes, and managed accounts
  behave when the agent runs on a remote host.
- [Session continuity](../terminals/session-continuity.md) — the resumable-CLI relaunch this
  article references.
