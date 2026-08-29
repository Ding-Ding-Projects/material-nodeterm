# Node kinds

**Category:** [Canvas](./README.md)

Everything on a nodeterm canvas is a node. The primary persisted kinds are rendered by
the same underlying canvas engine — so they all pan, zoom, resize, group, and persist the same
way, while each contributes its own body content and header actions.

## Behaviour

| Kind | What it is |
| --- | --- |
| **Terminal** | A real shell backed by tmux or the standalone Windows session host. See [Session continuity](../terminals/session-continuity.md). Supports content search, AI-generated naming, markdown rendering of captured output, and clickable file/URL links in its output. |
| **Agent** | A terminal preset that launches an agent CLI (Claude Code, Codex, Gemini, opencode, Grok, or a custom command) as its first command. Adds status badges, a context-window meter, subagent cards, and (for capable agents) session renaming and conversation branching. See [Agent support](../agents/agent-support.md). |
| **Sticky note** | A free-text, colorable note. Can be linked to a terminal or agent node to feed its text into that session as context on demand. |
| **Group** | A real container node — other nodes can live *inside* it, and groups can nest inside groups. A group can optionally be bound to a git worktree, so every node created inside it inherits that worktree's directory. See [Source control & worktrees](../source-control/source-control-and-worktrees.md). |
| **Editor** | A Monaco-based code editor bound to a file path, with save, dirty-state tracking, and a markdown preview toggle for `.md` files. Image files render as an `<img>` preview instead of source text. |
| **Diff** | A read-only Monaco diff view comparing HEAD↔index (staged) or index↔working tree (unstaged) for a single file. |
| **Windows diagnostics** | A machine-local, read-only view of Windows drives, storage, services, startup entries, scheduled tasks, updates, network adapters, and recent System events. See [Read-only Windows diagnostics](./windows-diagnostics.md). |

Two other things render *on* the canvas but are not persisted node kinds: **subagent cards**
(ephemeral cards showing an agent's spawned subagents, connected by an edge to the parent
agent node — cleared on the next turn) and **loop/schedule/cron cards** (showing a recurring
agent invocation, which can outlive a session or even an app restart if it's a cron/schedule
rather than an in-session loop).

## Configuration

- **Settings → Appearance** — default new-node size, which non-destructive context-menu items
  and header buttons are shown or hidden.
- Per-node: color, title, tags, collapsed/expanded state, and the agent preset for agent nodes.
  These portable values are part of the persisted project file. On Windows, a terminal or agent
  node's selected shell profile is snapshotted separately in this machine's `LocalNodeExec`
  overlay; it is not written to the shared project file. See
  [Windows shell profiles](../terminals/windows-shell-profiles.md).
- Windows diagnostics persist only title, colour, geometry, and relationships. Their host records
  are fetched on demand and never become project data.

## Failure modes

- **A node kind's underlying capability is missing** (for example, an agent node for a CLI
  that isn't installed): the node still opens and shows the launch command it tried to run,
  rather than silently doing nothing — the failure is visible in the terminal output itself.
- **An unreadable or corrupted project file**: nodeterm never drops nodes it can't parse
  cleanly. A corrupt project is set aside under a timestamped filename rather than overwritten,
  so nothing is silently lost.
- **Windows diagnostics are unavailable** on a non-Windows desktop or in Server Edition: the node
  keeps its presentation state and reports the unsupported surface rather than showing a guessed
  empty inventory.

## Security considerations

- Editor and diff nodes read and write files through the same project-scoped filesystem access
  as everything else in nodeterm — they cannot reach outside the project's working directory
  on a remote (SSH) project.
- A sticky note linked to an agent node only pushes its text into that session on an explicit
  connect action or session start — it never executes as a command, even though the same
  delivery mechanism can send text into a terminal (which, for a plain terminal, *is*
  executed — this is why notes push to agent nodes with a clear one-shot message, not into
  plain terminals).
- Windows diagnostics use fixed native reads in the main process. No user text is interpreted as a
  command, no elevation is requested, and no write operation is exposed by the node.

## Verification

- Create one of each node kind from the canvas right-click menu, the bottom-dock **+** button,
  and the command palette (`⌘K`) — all three should offer the same set.
- Reload the app and confirm every node kind's state (position, size, color, and kind-specific
  data such as an editor's open file) survived exactly as it was.
- Group a mix of node kinds together, collapse the group, and confirm its children stay bound
  to it through a drag, a resize, and an app restart.
- The current ultra-speed lane intentionally did not run the Chuts, build, runtime interaction,
  accessibility pass, packaging, or HuiShots. Those evidence steps remain open.

## Suggested articles

- [Canvas & node lifecycle](./canvas-and-lifecycle.md) — how these nodes mount, park, and
  release memory as you navigate a large canvas.
- [Session continuity](../terminals/session-continuity.md) — the persistent backend under terminal
  and agent nodes.
- [Agent support](../agents/agent-support.md) — everything specific to the agent node kind.
- [Source control & worktrees](../source-control/source-control-and-worktrees.md) — binding a
  group node to a git worktree.
