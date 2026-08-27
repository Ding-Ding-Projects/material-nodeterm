# Repository grouping and canvas drill-through

**Category:** [Canvas](./README.md)

The sessions sidebar groups open projects by their resolved repository root. A group frame can be
opened as a temporary canvas view, and a group that carries a safe project reference can open the
referenced project through the normal project-travel route.

## Behaviour

Repository grouping keeps the repository level above the project level. A single project whose
folder is the repository root uses one combined header. Multiple projects sharing a repository,
or a project rooted below the repository root, retain a project row beneath the repository header.
Projects without a resolved repository form their own fallback bucket. Local and SSH projects are
kept separate even when their path text happens to match, because they run on different machines.

The active repository's unbound worktrees are shown as adoptable rows. A row names its branch and
path and offers **Bind** when it has a branch. Binding reuses the existing worktree attachment
path, creating a normal group frame. Detached worktrees remain visible but cannot be bound until a
branch is checked out.

Selecting **Open as canvas** on a group frame creates an in-memory drill context. The frame and its
siblings leave the visible node set, while direct children are promoted into root coordinates.
The breadcrumb stays outside the canvas so an empty group still has a visible return path. Escape
returns when focus is not inside a terminal or editable control, and the breadcrumb button always
returns to the parent canvas.

A group may also carry `projectRef: { projectId }` as safe display intent. The target project is
resolved from the local project catalog at click time. Missing, unavailable, and closed targets
remain visible as an unavailable reference and refuse the action. A valid target is opened through
the existing project-travel route, and the breadcrumb returns to the source project. The reference
does not copy nodes, credentials, process state, or machine-local bindings.

## Persistence and safety

Repository roots and unbound worktree rows are runtime facts. The worktree store retains resolved
roots per project while active-project status and orphan lists remain scoped to the active project.
The store remains the single owner of worktree listing and status reads.

The group drill context, parent node snapshot, and parent viewport are in-memory navigation state.
Autosave merges the visible drilled subset back into the complete parent snapshot, re-nesting child
coordinates and preserving siblings. A child deleted during the drill remains deleted, and a new
child is nested under the drilled group before persistence. Leaving the drill clears its temporary
state and restores the parent viewport.

`projectRef` is a bounded, portable identifier only. It is carried through the normal node
serialization path and contains no path, host, account, credential, process, or session data.

## Failure modes

- A repository root cannot be resolved: the project uses its own fallback bucket and no guessed
  repository name is shown.
- Worktree listing fails: existing worktree facts remain unchanged rather than being replaced with
  an empty result.
- A detached adoptable worktree is selected: the row stays visible and Bind is disabled with the
  exact detached-head reason.
- A referenced project is missing, unavailable, or closed: the reference is muted and drill is
  refused. Reopening the target project makes the same reference usable again.
- A group has no children: the drill opens an empty canvas with the breadcrumb still available.
- A project changes while a group drill is active: the drill is exited before project travel so
  the source snapshot cannot be written under another project's identity.

## Verification boundary

The implementation commit is `451605b314c709da56c67bc176c78424898ecc26` on
`feat/program-75-grouping-drill-through`, based on the reconciled `origin/main` tip
`54164b84dce0b7e62787b1de2885405ff4ed821c`. This lane did not run tests, lint, type checks,
builds, packaging, runtime interaction, reviews, audits, or captures. Those checks remain with the
integration owner.

## Suggested articles

- [Canvas and node lifecycle](./canvas-and-lifecycle.md) for node mounting, parking, and viewport
  navigation.
- [Projects and tabs](../projects/projects-and-tabs.md) for project identity and switching.
- [Source control and worktrees](../source-control/source-control-and-worktrees.md) for binding and
  repository facts.
