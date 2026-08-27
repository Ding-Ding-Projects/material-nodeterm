# Files node

The Files node keeps one directory listing on the canvas beside the terminals that work in that
directory. It is a persisted canvas node, not a second Explorer tree. Each node has its own
directory, title, filter state, position, size, colour, and group membership.

## Behaviour

Create a Files node from the canvas add menu, the Dock, the project sidebar add menu, or the command
palette. Creation requires an active project directory. A project without a local directory or SSH
remote directory reports the unavailable state instead of silently falling back to the filesystem
root.

The node provides:

- clickable breadcrumbs and an Up action for directory navigation;
- a refresh action that re-reads the current directory;
- a local plain-text filter, with an adjacent anchored regex builder for deliberate regex searches;
- distinct loading, read-error, empty-directory, and no-match states;
- file and folder creation through the existing bounded filesystem API;
- file opening through the canvas file-routing event, preserving editor, image, and video handling;
- operating-system opening only for local files that are not suitable for a canvas editor;
- path copying and local file-manager reveal actions where the host supports them;
- a New terminal here action for the directory shown by the node.

The node title follows the current directory until the user renames it. A manual title is preserved
while navigation continues. The root breadcrumb is represented once, so the root path never renders
as a doubled separator.

## Filesystem selection

The filesystem is selected from the same session boundary as the editor node:

- local projects use the active session filesystem;
- SSH projects use the project SSH filesystem through `sshFs(projectId)`;
- relay sessions use the session API belonging to the relay host.

An SSH or relay listing never reaches the operating system file opener. This prevents a path from a
different machine from being mistaken for a local path that happens to have the same spelling.

## Creation and persistence

The node stores only safe project intent in the canvas node data:

- `kind: "files"`;
- the directory path used by the project filesystem;
- display title and title-following state;
- colour, position, size, collapsed state, and group membership.

Creation uses the existing `FsApi.list`, `FsApi.mkdir`, `FsApi.exists`, and `FsApi.write` methods.
Intermediate directories are created only when the user deliberately enters a nested name. A file
is opened through the existing canvas routing event after it is created. No new IPC channel is
introduced.

Project files do not contain credentials, provider sessions, process state, caches, host-specific
identifiers, or generated runtime data. A removed worktree displaces any Files node whose directory
was inside that worktree, including a node outside the group frame, so a dead directory is not
persisted indefinitely.

## Search

Plain text is the default and matches entry names case-insensitively. The adjacent `.*` control
opens the shared anchored regex builder for the node's own search state. Regex mode uses the real
renderer regex safety and bounded-candidate path. Invalid or refused patterns remain visible as an
error and fail open to the complete listing, so a malformed pattern cannot make files disappear.
Escape clears the active query and returns to the complete listing.

## Failure modes

The node keeps these states separate:

1. Loading means the directory request has not answered yet.
2. Could not read this folder means the filesystem request failed.
3. This folder is empty means the request succeeded with no entries.
4. Nothing matches means entries exist but the current filter excludes them.

Create failures report a non-blocking error notification and leave the existing listing unchanged.
An existing destination is never overwritten by file or folder creation. A local reveal action is
not offered in the Server Edition or for a remote filesystem because that action could not operate
on the correct host.

## Security and portability

The node does not accept a shell command, raw request, arbitrary filesystem provider, or hidden
machine binding. Terminal creation goes through the canvas's existing typed terminal path. File
opening goes through the existing `nodeterm:open-file` event, so the Files node cannot create a
second file-type router or accidentally send a remote path to the local operating system.

The mobile companion has no canvas or file-browsing surface. It attaches to terminal sessions over
the transport protocol, so a Files node is not applicable there until that protocol gains a
separate file-browsing contract. The desktop and Server Edition use the shared renderer and
filesystem API shape.

## Implementation records

The implementation is in:

- `src/renderer/nodes/FilesNode.tsx`
- `src/renderer/lib/filesNode.ts`
- `src/renderer/state/workspace.ts`
- `src/renderer/canvas/Canvas.tsx`
- `src/renderer/lib/addMenuSpec.tsx`
- `src/shared/types.ts`
- `src/shared/worktree.ts`

The implementation commit is
[`d00d7c6c483a51468eb431a070a6b3032e5aadd4`](https://github.com/Ding-Ding-Projects/material-nodeterm/commit/d00d7c6c483a51468eb431a070a6b3032e5aadd4).
The current lane also contains the reconciliation merge from the exact `origin/main` baseline and
the direct documentation update that records this feature.

## Verification boundary

This lane intentionally did not run tests, lint, type checks, builds, packaging, installer
execution, runtime interaction, reviews, audits, security checks, accessibility checks, or UI
captures. The implementation and documentation are therefore landed and unverified for those
surfaces. The next owner must run the appropriate checks against the exact integrated commit.

## Suggested articles

- [Canvas and lifecycle](../canvas/canvas-and-lifecycle.md)
- [Node kinds](../canvas/node-kinds.md)
- [Source control and worktrees](../source-control/source-control-and-worktrees.md)
- [File converter](../../file-converter.md)
- [Exports](../../exports.md)
