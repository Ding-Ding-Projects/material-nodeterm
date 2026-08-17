# Source control & worktrees

**Category:** [Source control](./README.md)

A git panel on the canvas, backed by your system's own `git` (and `gh` where relevant) rather
than a bundled git implementation — so it behaves exactly like your command line does.

## Behaviour

**The panel.** File-level stage/unstage, discard, branch switch/create, commit (with an
optional AI-generated commit message), push/sync/publish, a `gh` sign-in prompt when needed,
and recent-commit history. Clicking a changed file opens a diff node on the canvas rather than
a separate window, so the diff sits right next to the terminal you're working in.

**Scope.** The panel doesn't always operate on the project's root folder — it operates on a
*selected scope*, which is either the project's main checkout or one of its bound git
worktrees (see below). Selecting a worktree in the canvas automatically preselects it as the
panel's scope.

**Worktrees.** A git worktree — a second working copy of the same repository, checked out to a
different branch — binds to a canvas **group** node. Every terminal or agent node created
inside that group inherits the worktree's directory as its working directory automatically, so
"one agent per branch" is just "one group per branch": create a worktree, drop an agent node
inside its group, and that agent's every command runs against the isolated checkout.

Worktree creation is one step from the pane menu, command palette, or source-control panel —
it resolves the repository root, lists existing worktrees for adoption, and creates a new one
if none fits. Bindings are reconciled against `git worktree list` on a schedule: if a bound
worktree's directory is deleted outside the app, its group is marked stale (nothing new spawns
into the dead path, and unbinding is the only action offered) rather than silently continuing
to hand out a path that no longer exists.

**Merging** always asks for confirmation and merges into the base branch's own working tree
(never force-pushing); pushing the merge to the remote is a separate, explicitly opt-in choice
disclosed in the same dialog, defaulting to off, because a push to a shared remote can't be
politely undone the way a local merge can.

## Configuration

- **Settings → Agents** — which local agent CLI (if any) generates commit messages and how, and
  the extra prompt appended to that generation.
- **Unbind** only drops the canvas binding and never deletes the checkout. Disk removal is a
  separate confirmed action. A checkout of a pre-existing branch keeps that branch; a branch which
  nodeterm created locally is deleted only if Git proves it reachable and its exact full ref still
  points at the tip disclosed by the removal proof.

## Failure modes

- **A `git` read fails** (a transient filesystem hiccup, a corrupted index): this is reported
  as a failure, never as "this worktree/branch doesn't exist" — a failed read must never be
  mistaken for evidence that something is actually gone, since that distinction is what
  prevents accidentally treating a temporary git error as grounds for deleting something real.
- **A worktree was deleted outside the app**: its group becomes visibly stale rather than
  quietly continuing to accept new nodes pointed at a directory that no longer exists.
- **The repository is on a remote (SSH) host**: worktree operations currently refuse rather
  than guess, because the underlying path-existence check runs locally and would otherwise
  report "everything is gone" for a perfectly healthy remote repository. This is a stated v1
  limitation, not a silent gap — the affordance shows up disabled with the reason, rather than
  disappearing.
- **Another program writes after the final proof check**: nodeterm serializes its own supported
  removal processes and remeasures immediately before invoking Git, but no portable filesystem
  transaction can freeze a non-cooperating editor between that check and `git worktree remove`.
  Keep editors and shells idle after reviewing the final inventory; any change observed before the
  invocation refuses and requires a fresh confirmation.

## Security considerations

- nodeterm shells out to your own `git`/`gh` binaries with your own credentials and your own
  git configuration — it does not intercept, store, or transmit git credentials itself.
- Worktree removal that would touch a dangerous path (the repository root itself, your home
  directory, or the filesystem root) is refused outright, regardless of how the removal was
  triggered.
- Live-directory removal requires a fresh opaque one-shot proof. It binds the canonical repository,
  checkout, common and administrative directories; their physical generations; the full branch
  ref and tip; index state; every tracked, untracked and ignored file byte; empty directories; and
  symlink targets. Only `ENOENT` is absence—permission, I/O and malformed-path errors refuse.
- Directory creation and branch creation are separate machine-local provenance facts. Editing a
  shared project file cannot manufacture branch-deletion authority.
- Nothing this feature does leaves your machine unless you explicitly choose to push.

## Verification

- Stage a file, commit with an AI-generated message, and confirm the message reflects the
  actual staged diff.
- Create a worktree from the source-control panel, drop a terminal node into its group, and run
  `pwd` — it should print the worktree's path, not the main checkout's.
- Delete a bound worktree's directory outside the app, then reopen nodeterm and confirm the
  group is marked stale rather than silently accepting new nodes into the dead path.

## Suggested articles

- [Node kinds](../canvas/node-kinds.md) — the group node a worktree binds to.
- [Agents](../agents/agent-support.md) — AI-generated commit messages, and running an agent
  scoped to a worktree.
- [Projects & tabs](../projects/projects-and-tabs.md) — how a project's own folder relates to
  the repository this panel operates on.
