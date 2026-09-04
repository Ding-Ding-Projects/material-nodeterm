# Cross-project links and agent harnesses

This article records the scoped implementation of the useful behavior from upstream PR #422. The
behavior is split across the current nodeterm architecture. It does not import the PR wholesale,
and it does not copy its scratch planning files.

## Typed links

`Endpoint` and `Link` in `src/shared/types.ts` replace the old meaning-by-array convention. A link
has one of three kinds:

- `context` connects context-capable agent nodes or a sticky note and a terminal.
- `lineage` records a display-only spawned-by relationship.
- `dependency` records a branch, node, or foreign-project dependency.

Endpoints are explicit. A local node uses `{ ref: "node", nodeId }`, a node in another project uses
`{ ref: "xnode", projectId, nodeId }`, and a repository branch uses `{ ref: "branch", repoPath,
branch }`. Shared project files store a same-project branch path as `.`, and expand that marker only
in the owning local project. The project file reader validates bounded identifiers, drops malformed relationships,
and migrates legacy `bridges` and `ropes` while preserving their ids. Optional link purpose and
display-only metadata is bounded and retained in portable projection. New writes emit `links` and
retain the old arrays only in memory for compatibility with older readers.

Canvas synchronization has dedicated `link-upsert` and `link-remove` mutations. The shared mutation
validator, ordering state, publisher, background-project store, and active React Flow view all
understand the typed relationship set. Cross-project endpoints survive publication because only
local node endpoints need to be present on the active canvas.

## Foreign projections and project-aware navigation

When a local project has a typed context or lineage link to an `xnode`, the canvas derives one
`xproject` node from the target project's stored node. The projection is never serialized, is
excluded by `isEphemeralNodeId`, and is visibly marked with the target project's name and colour.
Its secondary open control travels to the owning project. A live local projection uses a unique
viewer id and `requireExisting: true`, so it can co-attach to an existing session but can never
create a session that belongs to the foreign project. Missing, closed, unavailable, and remote
targets show an explicit unavailable state. Remote project projections are intentionally not
started from the local machine.

The three canvas-control open verbs accept an optional `--project <id|cwd>`. The target must already
be open in the current workspace and must be a local project. A cross-project open creates the real
node in the target project's serialized store, applies that project's account and permission
defaults, and records only a source-project lineage link to an `xnode` endpoint. If the target is
not active, its launch is held in the machine-local pending-launch overlay and starts when the target
project is next viewed. `--group` and `--after` are rejected for a cross-project request because
their ids are scoped to the caller's canvas. Unknown, closed, unavailable, SSH, and relay targets
never fall through to the caller's canvas.

Context-link documents resolve cross-project endpoints against the complete project set, so both
endpoints can read one another's context without copying the target node into the source project.
The map falls back to legacy same-project bridge arrays for older files. A missing target node is
omitted from the map and remains an explicit unavailable link in the inspector.

Group frames can carry a persisted `projectRef` containing only a stable project id. The group
context menu can assign or clear a reference. The frame shows the referenced project and its
unavailable state. Opening an ordinary group promotes its direct children into root coordinates;
editing the drilled view merges those children back into the complete stored node set, preserving
links to hidden siblings so they cannot be lost. Opening a referenced group switches to the target project and the breadcrumb's
Return action switches back. Escape returns from a drill when focus is not in a text field or
terminal. `DrillContext`, `drillGroupChildren`, `remergeDrilledNodes`, `drillSingleNode`, and
`mergeSingleNode` keep these transforms platform-free and reversible.

The `DrillBreadcrumb` component is a canvas-level Material Design 3 status strip. It names the
current group, node, or referenced project, provides a keyboard-focusable Return control, and
does not claim that a remote or unavailable target was opened.

## Dependency operations and submodules

`src/shared/worktree.ts` parses recursive `git submodule status` output into bounded
`SubmoduleEntry` records and preserves `ok: false` when the read fails. The core Git service exposes
`submoduleList`, `setBranchParent`, `unsetBranchParent`, `syncBranch`, `proposeBranch`, and
`shipBranch` through the desktop preload and Server Edition bridge. Branch dependency helpers in
`src/renderer/lib/link-authoring.ts` keep the link set and the
`git-town-branch.<child>.parent` configuration write together. A failed configuration write
does not create a link that would claim a stack relationship that was never recorded. Removing a
branch dependency removes its configuration when possible and reports an unset failure without
pretending the repository changed.

`syncBranch` rebases a checked-out child onto its configured parent, `proposeBranch` opens a pull
request with that parent as the base when the GitHub CLI is available, and `shipBranch` performs a
checked-out parent fast-forward with no forced merge. Conflicts and missing parent configuration
remain explicit failures. Canvas dependency edges match repository path and branch, so same-named
branches in separate repositories cannot be joined accidentally. The canvas-control commands `link-branches --base <parent> --branch
<child>` and `sync-stack [--branch <child>]` expose the same operations to a control-capable agent.

`planSubmoduleLinks` and `existingDependencyLinkKeys` provide an idempotent, no-ghost planning seam
for project-reference groups. They create a reference group for an open submodule project first,
then create the visible dependency relationship on a later pass after that group has an id. An
unopened submodule is retained as an unresolved repository fact rather than becoming a fabricated
canvas node.

## Custom agents and model switching

Custom agents may select a built-in base harness, a launch command, extra arguments, environment
assignments, and a display colour. `resolveAgentConfig` is the single effective configuration used
by labels, prompt grammar, capability checks, restart eligibility, and node creation. Environment
values support bounded `${env:NAME}` and `${env:NAME:fallback}` expansion. A custom `PATH` warns
when it does not preserve the inherited path, and remote launches never replace the host path with a
local value.

`assembleLaunchCommand` and `assembleResumeCommand` build fresh and resumed commands from the
same fields. Arguments are shell-split and re-quoted, model values are bounded and capability
checked, and missing environment references are surfaced in the preview. The renderer preview
filters secret-like environment names, so a key or token reference is reported as unavailable
instead of being printed into command text. Put such values in a custom environment assignment;
the trusted core expands those assignments inside the process environment. Local PTYs and Windows
session-host sessions receive custom environment values through the process environment. Persistent
local tmux sessions leave arbitrary custom assignments unapplied because a safe staging transport is not
available, and remote sessions likewise do not place those values in SSH or tmux arguments. Both
boundaries are surfaced as warnings rather than exposing a value through argv. The application stores
only non-secret gateway settings. A gateway credential is write-only and is kept only in encrypted
host credential storage. If that storage is unavailable, saving a literal key fails closed and the
UI keeps the environment-variable route available. Server Edition routes discovery through its
authenticated core boundary without receiving a stored secret. Model discovery uses a validated
HTTP(S) gateway URL, a bounded timeout, and an OpenAI-compatible `/v1/models` response capped at
512 KiB. The
discovered model list is the source for the node context-menu model chooser, and changing a model
updates the node before restarting its idle resumable conversation. Gateway values are omitted from
remote SSH arguments and remain unapplied there until a host-side secret-safe transport exists.

The optional Restart on subscription setting strips the configured provider variables on a fresh
agent launch so the agent can use its own provider or subscription. It is one-shot per node when
requested from the canvas, preserves account-isolation variables, and is disabled for relay
sessions whose environment belongs to another core. It never writes a credential into a node,
project file, log, or command argument.

Claude, Codex, and the existing account paths remain current-architecture behavior. Codex account
switching and local-to-SSH conversation transfer continue to recycle one node, preserve the
conversation identity, and keep the source copy when a transfer is requested. The new harness and
model fields are carried through the same node serialization and cold-restore paths rather than
creating a second account or session system.

## Material Design 3, accessibility, and portable boundaries

The new picker, inspector, projection node, drill breadcrumb, settings rows, and model menu use
the existing Material Design 3 tokens and controls. Buttons have visible labels or accessible
names, focusable targets, bounded overlays, readable status text, and responsive sizing. The link
picker keeps project and node selection separate from branch selection, asks for both child and
parent branches before creating a branch dependency, disables impossible link kinds with a reason,
and keeps the source node unavailable as its own target. The projection's
foreign state is conveyed in text and colour, so colour is not the only status channel.

`projectRef` is safe intent and is included in the portable canvas projection. Machine-local shell
selection, credentials, process state, account stores, session ids, SSH connection details, and
gateway secrets remain outside portable data. Schema 3 validation bounds the reference id and
rejects unknown nested fields. The Server Edition receives the same typed link and model APIs over
its existing RPC bridge, while remote project projection is an explicit unsupported boundary
rather than a local fallback.

## Verification and excluded work

This implementation lane intentionally did not run tests, type checking, linting, builds,
packaging, UI interaction, or captures, as required by issue #86. The result is therefore
implementation work with verification pending. No Git metadata, scratch planning files, mobile
companion code, TUI behavior, or unrelated upstream PR changes were merged into this lane. Archive
publication, release work, and external issue or discussion updates are outside this bounded
implementation.

Suggested articles:

- [Projects and tabs](./projects-and-tabs.md)
- [Portable canvas projection](./portable-canvas-projection.md)
- [Agents](../agents/README.md)
- [Source control](../source-control/README.md)
