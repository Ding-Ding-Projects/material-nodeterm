# Files node

**Category:** [Canvas](./README.md)

The Files node is a directory view that stays on the canvas beside the terminals and agents using
the same folder. It is a persisted canvas object, not a replacement for the Explorer drawer: each
node remembers one directory and can be placed beside another directory or worktree.

## Behaviour

Create it from the canvas pane menu, the command palette, or the navigation FAB. It starts at the
active project's folder, or at the bound worktree folder when created inside a worktree group. A
project without a folder has an explicit notice path and never guesses the filesystem root.

The header provides collapse, colour, rename, parent navigation, refresh, and close. Breadcrumbs
keep the root and a clickable shortened path for deep directories. Selecting a folder navigates in
place and persists the new directory. The title follows the directory until the user renames it.

The listing has four distinct states: loading, could not read the folder, an empty folder, and a
valid folder whose current filter matches nothing. Ignored entries are shown with the same subdued
treatment as Explorer. Clicking a folder navigates. Clicking a file uses the shared Canvas file
route for editor, image, PDF, and video handling. A file that is not safe to render is handed to
the local operating system only when the listing is local.

## Search, selection, and actions

The filter is plain text by default and case-insensitive. Its adjacent `.*` action opens the full
anchored regex builder, including flags, syntax feedback, samples, matches, and capture groups.
Invalid or unsafe patterns fail open for visibility while showing the exact error, so a malformed
pattern never makes files disappear silently.

Rows support Ctrl/Command selection, Shift range selection, drag data, and a bulk toolbar. The
toolbar reports the exact selected count and offers copy paths and clear selection. The row context
menu offers open, new file, new folder, new terminal in a directory, copy path, and local reveal.
Create prompts use the existing path validator, which rejects empty names, absolute paths, drive
letters, traversal, and trailing separators, and creates intermediate directories only after
validation.

Dragging a row onto a folder navigates to that folder after validating the internal drag payload.
Malformed or external payloads are ignored. This is a navigation affordance, not an implicit move
or copy, so no data is changed by a drag.

## Local and SSH projects

The Files node reads through the active WorkspaceSession. Local projects use the session's local
filesystem; SSH projects use the project's SSH filesystem over its existing ControlMaster; relay
projects use the peer filesystem exposed by their session. The path is a resolved binding, not a
credential, process identity, or provider session.

Remote paths never reach `shell.openPath` or `shell.reveal`, because those operate on this computer
and could open an unrelated local file with the same spelling. Remote files return to Canvas's
shared `nodeterm:open-file` route, which already knows how to read through the remote filesystem.

## Portability and persistence

The shared project projection stores safe canvas presentation and a relative Files intent when the
directory is below the local or remote project root. Machine-specific absolute paths are resolved
again from the destination project's local folder or SSH `remoteCwd`. Credentials, SSH connection
details, process state, caches, and local editor applications are never placed in the project
file. Import does not browse, connect, open, create, move, or launch anything.

Worktree removal displaces Files nodes whose directory was inside the removed worktree, returning
them to the group's or project's fallback folder. This prevents a stale absolute directory from
remaining in the shared save while preserving the canvas object.

## Failure modes and security

- A failed read is displayed as a read failure, never as an empty folder.
- A missing project folder is reported before node creation; `/` is not used as a fake project root.
- A rejected name is not partially applied and cannot create intermediate directories.
- A local reveal action is absent for SSH, relay, and browser-only sessions.
- The node never accepts an arbitrary shell command. New terminal uses the existing Canvas terminal
  creation route and directory binding.
- File previews stay bounded by the existing editor and filesystem limits. Unsupported or oversized
  files remain untouched and retain their explicit operating-system handoff state.

## Surfaces

- **Desktop:** full local and SSH node behavior, native local file-manager reveal, shared editor/video
  handoff, selection, creation, and context actions.
- **Server Edition:** the same node and session filesystem through the browser bridge. Native local
  reveal is not offered because a browser cannot control the host file manager; browsing remains
  available.
- **Mobile companion:** no canvas filesystem surface exists in the companion protocol yet. This is a
  documented follow-up for the companion rather than an invented local-path behavior.

## Verification

Create the node through each creation surface and reopen the project. Navigate, refresh, collapse,
rename, select, copy, and clear. Exercise plain text and regex filtering, invalid regex feedback,
empty and unreadable folders, new file/folder creation, path rejection, drag navigation, local
editor/video handoff, and local reveal. Repeat on an SSH project and confirm the local shell reveal
action is absent and the shared remote file route is used.

## Suggested articles

- [Node kinds](./node-kinds.md) — the canvas object catalogue and persistence rules.
- [Canvas & node lifecycle](./canvas-and-lifecycle.md) — mounting, parking, and resizing nodes.
- [Projects & tabs](../projects/projects-and-tabs.md) — project folder binding and reopen behavior.
- [SSH projects](../remote/ssh-projects.md) — remote project session and filesystem boundaries.
- [File converter](../../file-converter.md) — conversion workflows for files selected from a project.
