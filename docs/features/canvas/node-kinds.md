# Node kinds

**Category:** [Canvas](./README.md)

Everything on a nodeterm canvas is a node. Torrent Downloader joins the existing node kinds, and
every one is rendered by
Everything on a nodeterm canvas is a node. The canvas has terminal, document, media, manager, and
utility kinds, and every one is rendered by
the same underlying canvas engine — so they all pan, zoom, resize, group, and persist the same
way, while each contributes its own body content and header actions.

New nodes are selected through the [Unified Node Catalog](./node-catalog.md), which keeps the
kind-specific factory, safe defaults, dependency ids, and availability reason together. The FAB,
empty-canvas context menu, group context menu, and command palette all expose that same registry.

## Behaviour

| Kind | What it is |
| --- | --- |
| **Terminal** | A real shell backed by tmux or the standalone Windows session host. See [Session continuity](../terminals/session-continuity.md). Supports content search, AI-generated naming, markdown rendering of captured output, and clickable file/URL links in its output. |
| **Agent** | A terminal preset that launches an agent CLI (Claude Code, Codex, Gemini, opencode, Grok, or a custom command) as its first command. Adds status badges, a context-window meter, subagent cards, and (for capable agents) session renaming and conversation branching. See [Agent support](../agents/agent-support.md). |
| **Sticky note** | A free-text, colorable note. Can be linked to a terminal or agent node to feed its text into that session as context on demand. |
| **Group** | A real container node — other nodes can live *inside* it, and groups can nest inside groups. A group can optionally be bound to a git worktree, so every node created inside it inherits that worktree's directory. See [Source control & worktrees](../source-control/source-control-and-worktrees.md). |
| **Editor** | A Monaco-based code editor bound to a file path, with save, dirty-state tracking, and a markdown preview toggle for `.md` files. Image files render as an `<img>` preview instead of source text. |
| **Diff** | A read-only Monaco diff view comparing HEAD↔index (staged) or index↔working tree (unstaged) for a single file. |
| **Torrent Downloader** | A local WebTorrent task surface with magnet or `.torrent` intake, metadata/file selection, destination preflight, progress, recovery, and bounded seeding. See [Torrent Downloader](../torrents/torrent-downloader.md). |
| **Linux ISO VM** | A one-shot QEMU Linux guest with guided ISO/disk pickers, disposable live and persistent install modes, loopback VNC/QMP, and bounded resources. It is distinct from WSL. See [Linux ISO VM](../integrations/linux-iso-vm.md). |
| **Calendar** | A guided calendar view for local events and imported ICS files, with provider account and calendar pickers for CalDAV, Google Calendar, and Microsoft 365. Agenda, week, month, recurrence, timezone, offline cache, create/edit preview, and destructive delete confirmation all live in the node. |
| **Alarm Clock** | A one-shot or recurring wall-clock reminder with an explicit timezone, DST-safe planning, snooze, dismiss, and missed-occurrence history. See [Alarm Clock nodes](../../alarm-clock.md). |

Two other things render *on* the canvas but are not persisted node kinds: **subagent cards**
(ephemeral cards showing an agent's spawned subagents, connected by an edge to the parent
agent node — cleared on the next turn) and **loop/schedule/cron cards** (showing a recurring
agent invocation, which can outlive a session or even an app restart if it's a cron/schedule
rather than an in-session loop).

Alarm Clock nodes are persisted node kinds. Their schedule intent and redacted occurrence history
travel with the project; notification handles and any machine-specific runtime state do not.

## Configuration

- **Settings → Appearance** — default new-node size, which non-destructive context-menu items
  and header buttons are shown or hidden.
- Per-node: color, title, tags, collapsed/expanded state, and the agent preset for agent nodes.
  These portable values are part of the persisted project file. On Windows, a terminal or agent
  node's selected shell profile is snapshotted separately in this machine's `LocalNodeExec`
  overlay; it is not written to the shared project file. See
  [Windows shell profiles](../terminals/windows-shell-profiles.md).
- Calendar nodes persist only `calendarConfig` intent: provider, opaque account/calendar references,
  timezone, view, weekend visibility, and cache preference. OAuth values, local ICS paths, event
  cache, provider sessions, and host identifiers remain in machine-local application data.
- Alarm Clock nodes additionally persist the recurrence, local wall-clock time, selected IANA
  timezone, snooze interval, sound and narrator choices, and bounded occurrence history. They never
  persist a claim or mechanism for waking a powered-off computer.

## Failure modes

- **A node kind's underlying capability is missing** (for example, an agent node for a CLI
  that isn't installed): the node still opens and shows the launch command it tried to run,
  rather than silently doing nothing — the failure is visible in the terminal output itself.
- **An unreadable or corrupted project file**: nodeterm never drops nodes it can't parse
  cleanly. A corrupt project is set aside under a timestamped filename rather than overwritten,
  so nothing is silently lost.
- **A provider is offline or lacks consent**: the node keeps its last valid local cache, labels it
  stale/offline, and names the exact recovery action. It never treats a failed read as an empty
  calendar and never accepts an arbitrary URL or credential field.

## Security considerations

- Editor and diff nodes read and write files through the same project-scoped filesystem access
  as everything else in nodeterm — they cannot reach outside the project's working directory
  on a remote (SSH) project.
- A sticky note linked to an agent node only pushes its text into that session on an explicit
  connect action or session start — it never executes as a command, even though the same
  delivery mechanism can send text into a terminal (which, for a plain terminal, *is*
  executed — this is why notes push to agent nodes with a clear one-shot message, not into
  plain terminals).

## Verification

- Create one of each node kind from the canvas right-click menu, the bottom-dock **+** button,
  and the command palette (`⌘K`) — all three should offer the same set.
- Reload the app and confirm every node kind's state (position, size, color, and kind-specific
  data such as an editor's open file) survived exactly as it was.
- Group a mix of node kinds together, collapse the group, and confirm its children stay bound
  to it through a drag, a resize, and an app restart.
- Add a Calendar node, choose Local, import a bounded ICS file, switch between Agenda/Week/Month,
  change timezone, and confirm the source path is not present in the saved project state. Provider
  rows should remain disabled with an exact reason until a trusted account binding exists.

## Suggested articles

- [Canvas & node lifecycle](./canvas-and-lifecycle.md) — how these nodes mount, park, and
  release memory as you navigate a large canvas.
- [Session continuity](../terminals/session-continuity.md) — the persistent backend under terminal
  and agent nodes.
- [Agent support](../agents/agent-support.md) — everything specific to the agent node kind.
- [Source control & worktrees](../source-control/source-control-and-worktrees.md) — binding a
  group node to a git worktree.
- [Scheduled settings](../../scheduled-settings.md) — timezone-aware settings that can overlay a
  calendar node's display choices.
