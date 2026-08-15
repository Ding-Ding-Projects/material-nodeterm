# Kanban board

**Category:** [Kanban](./README.md)

Every project can be viewed as a Trello-style board instead of (or alongside) its canvas. The
board is not a separate feature bolted onto the canvas — its cards *are* the project's live
session nodes, derived from the same underlying data every time the board renders.

## Behaviour

Toggle the board from the icon on the active project's tab, or a keyboard shortcut. The canvas
stays mounted underneath the board (rather than being torn down), so agent-status listeners and
running terminals are entirely unaffected by which view you're looking at.

**Columns** are simple named lists (To Do / In Progress / Done by default, fully editable). A
virtual **Ungrouped** column — never deletable, always first — holds every session with no
column assignment, so the board never opens looking empty just because nothing's been sorted
yet. Dragging a card between columns only changes board metadata; it never moves canvas nodes,
changes their group, or otherwise touches the canvas.

**Cards** show a session's title, color, kind, and live status badges (the same "RUNNING" /
"NEEDS YOU" states described in [Agent support](../agents/agent-support.md)), plus an unread
dot. Clicking a card briefly expands it in place; opening it fully launches the **card modal**.

**The card modal is a second live view of the same tmux session** — not a snapshot, not a
read-only preview. For a terminal or agent card, you can type into it exactly as you would on
the canvas, search its content, dictate into it, and trigger the same rename/branch actions the
canvas node exposes. Closing the modal doesn't touch the underlying session; it only tears down
that second view.

**Metadata** — members (assigned from active board participants), a due date, and a priority —
lives alongside the board's column assignments and is unaffected by which nodes exist on the
canvas at any given moment (a deleted node's leftover metadata is pruned lazily, not
immediately, so nothing is lost by a transient state).

**The board log** is an append-only, per-project activity feed: comments people leave on a
card, plus automatic entries for column moves, assignment changes, and due-date changes. It's
visible as a flyout on a canvas node and as the default-open right panel inside the card modal.

## Configuration

- Board layout (columns, and which session is assigned to which column) is part of the
  project's own file, so it's git-shareable exactly like canvas layout.
- Your personal choice of canvas view vs. board view is remembered locally per browser/install,
  not shared through the project file.

## Failure modes

- **A card's underlying node was deleted**: its board assignment is pruned on the next board
  change rather than leaving a dangling reference that could resurrect a phantom card.
- **A malformed or legacy board shape on disk** (hand-edited, or from an older version of the
  app): the board falls back to the default column set instead of failing to render, so a bad
  file can't boot-loop the app on the board view.
- **A remote (relay) session**: the board log bridges to the host that owns the project rather
  than reading local files directly, since a relay tab has no local filesystem of its own to
  read a log from.

## Security considerations

- Board activity (comments, moves) is stored in the same project-scoped location as the rest
  of a project's data — nothing about it is sent anywhere beyond the project's own storage
  path (local disk, or the SSH/relay host that actually owns the session).
- The card modal reaches the exact same session the canvas node does, through the same
  transport — it doesn't open a second, less-authenticated path into a terminal.

## Verification

- Create a card in a non-default column, confirm its column pill renders on the matching canvas
  node, and confirm dragging it on the board doesn't move or regroup the canvas node.
- Open a terminal card's modal, type a command, close the modal, then open the node on the
  canvas and confirm the output is there — one session, two views.
- Assign a member and a due date to a card, and confirm both appear in the board log as
  discrete, timestamped entries.

## Suggested articles

- [Agent support](../agents/agent-support.md) — the status model a card's badges reflect.
- [Node kinds](../canvas/node-kinds.md) — what a card actually mirrors.
- [Session continuity](../terminals/session-continuity.md) — why the card modal and the canvas
  node can show the same live output.
