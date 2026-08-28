# Agent-to-agent drag collaboration

Two context-capable agent nodes can be linked by dragging the collaboration handle in one node's
header onto the other node. The result is the existing bidirectional context link: both sessions can
read the other's linked transcript through the normal context-link tooling.

## Interaction contract

- The source handle uses the namespaced `application/x-nodeterm-agent-collaboration` drag type.
- The payload is versioned and bounded, and contains only the source node id and its agent id.
- A target highlights only while it receives a valid collaboration payload and is itself
  context-link-capable.
- The drop creates the same `bridge-<source>-<target>` context edge used by the existing handle
  connection path. Duplicate links and self-links remain no-ops under that path.
- Each idle linked agent receives the informational link notice as one submitted prompt. The
  delivery explicitly requests Enter, so the notice does not remain unsubmitted in the composer.
- Keyboard and touch users can activate the link button on two nodes in sequence. Selecting exactly
  two compatible agent nodes first also exposes **Link selected agents** in the node context menu.
- The pending source is shown with an accessible pressed state and a visible outline. Activating the
  same source again cancels the sequence; an invalid target is refused with a notification.

## Boundaries

This action does not move either terminal, restart a process, create a third session, change a
working directory, transfer a conversation, switch an account, or copy credentials. It is resolved
against the nodes in the active project, so a source and target from different projects cannot be
combined by this route. Custom agents participate only when their configured base agent exposes the
existing context-link capability. Other agent types remain visible but are not valid drop targets.

The collaboration action intentionally does not add a new message protocol or a new persistence
format. It calls the existing `onConnect` context-link implementation, which derives session ids,
titles, colors, handles, and link-map records locally. As a result, the project file stores only the
portable edge ids and never receives credentials or machine-local session data.

## Upstream basis and intentional omissions

The interaction follows the current upstream context-link behavior in `Canvas.tsx` and the bounded,
namespaced agent drag payload introduced by upstream commit
[`d1b7da3a`](https://github.com/eneskirca/nodeterm/commit/d1b7da3af28587716e7e4de2fb0db8cd18732c3f),
merged by `acc5d518`. The pinned upstream checkout was compared with `eneskirca/nodeterm` `main`
at `7d9cba33f7a29baa2a3cb010f07d351b87fc6e4d`.

Upstream does not define a separate conversation-transfer or agent-spawn-on-agent-drop contract.
Those behaviors are deliberately absent here. Folder drops continue to use their existing
same-agent sibling creation flow, and ordinary React Flow node movement remains ordinary movement.

## Verification boundary

The link-notice formatter and terminal-delivery planners have focused regression coverage. The
project-wide type check and built-artifact interaction remain unverified because the current base
contains unrelated syntax errors in other modules.

Suggested articles:

- [Agent support](./agent-support.md)
- [Linked-agent inbox notifications](./linked-agent-inbox-notifications.md)
- [Canvas node kinds](../canvas/node-kinds.md)
