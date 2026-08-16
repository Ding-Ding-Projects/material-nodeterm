# Projects & tabs

**Category:** [Projects](./README.md)

A project is one canvas — one page of nodes — shown as one tab. Terminals, notes, and every
other node belong to exactly one project.

## Behaviour

Projects appear as a row of tabs, orderable by drag-and-drop, with the same order shared
between the tab bar and the sessions sidebar. Opening a folder either creates a new project
bound to it or, if that folder already has a project, switches to the existing one — folders
and projects are de-duplicated by working directory rather than always minting a fresh project.

**Switching** commits the currently active project's live canvas state back into storage
before loading the next one, so nothing from the outgoing project is lost mid-switch. The
incoming project's saved camera position (pan/zoom) is restored on a genuine switch; an
in-place reload triggered by an external change (for example, a git pull that touched the
project file, or a multi-device sync landing) deliberately keeps your *current* camera instead
of resetting it, since jumping the view during a background reload elsewhere is disorienting.

**Closing a project** (via the tab's caret menu) is non-destructive: the project is hidden from
the tab bar but its nodes and sessions are left exactly as they were, reachable again from a
"Recently closed" list. Its persistent sessions simply detach, the same as if you'd switched
away. Permanently deleting a project — which does tear down its sessions — only happens from
that "Recently closed" list's own remove action, so an accidental tab close is always recoverable.

## Configuration

- A project's working directory is set once, via the folder picker, and used as the default
  `cwd` for every terminal and agent node created inside it.
- **Settings → sidebar** — auto-collapse behaviour for inactive projects, and whether the
  active project's group frames stay expanded by default. Manual collapse/expand choices you
  make are remembered per project and per frame across restarts.

## Failure modes

- **A project's underlying folder can't be read** (deleted, unmounted, or — for an SSH project
  — unreachable): the project's tab renders greyed-out as "unavailable" rather than being
  silently dropped from the list, so you can still see it exists and try again later.
- **A project's file is corrupted** on disk: it's set aside under a timestamped filename
  (`project.json.corrupt-<timestamp>`) instead of being overwritten or silently discarded, so
  recovery is always possible.
- **Two devices edit the same project concurrently** (for example, over a synced folder): an
  external change to the project file while you have no unsaved edits reloads silently; if you
  *do* have unsaved edits, you're offered an explicit choice between reloading the external
  version or keeping yours, rather than either one winning automatically.

## Security considerations

For a local (non-SSH) project, the project file lives alongside your code at
`<project-folder>/.nodeterm/project.json` in plain, git-shareable JSON — it carries canvas
layout and portable node configuration, not credentials or executable selections. Session
identifiers, account bindings, a node's legacy custom `shell`, Windows `terminalProfileId`, and
advanced SSH execution fields that are specific to *this machine* are kept out of that shared file
and stored in the separate `LocalNodeExec`/machine-local index instead. They are also stripped from
portable exports and inbound canvas mutations, so committing `.nodeterm/project.json` or accepting
a peer update cannot select an executable or replace this machine's profile snapshot.

## Verification

- Create a project from a folder, add a few nodes, switch to another project and back, and
  confirm the canvas layout and camera position were preserved.
- Close a project from the tab menu, confirm its tab disappears but its sessions keep running,
  then reopen it from "Recently closed" and confirm everything is exactly as you left it.
- Edit the project's `.nodeterm/project.json` file externally (or have another machine on a
  shared folder change it) while the project is idle, and confirm nodeterm picks up the change
  without prompting; then make an unsaved edit and repeat, confirming you're now asked to
  choose.

## Suggested articles

- [Canvas & node lifecycle](../canvas/canvas-and-lifecycle.md) — what happens inside a project
  once it's the active one.
- [Node kinds](../canvas/node-kinds.md) — the group-node worktree binding, which ties a folder
  concept below the project level to a specific git branch.
- [Source control & worktrees](../source-control/source-control-and-worktrees.md) — the git
  repository a project's folder usually is.
- [SSH projects](../remote/ssh-projects.md) — a project whose folder lives on a remote host.
