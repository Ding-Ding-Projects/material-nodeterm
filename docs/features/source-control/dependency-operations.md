# Branch dependency operations

**Category:** [Source control](./README.md)

Branch dependency operations let a project record that one branch is based on another and then
run the small set of safe, typed operations needed to maintain that relationship. The relationship
is branch-owned, not worktree-owned, so removing a checkout does not erase the dependency.

## Operation inventory

The implementation keeps one explicit inventory in `src/shared/dependency-operations.ts`:

| Operation | Command shape | Network | Repository mutation |
| --- | --- | --- | --- |
| Set branch parent | `git config git-town-branch.<child>.parent <parent>` | No | Yes |
| Clear branch parent | `git config --unset git-town-branch.<child>.parent` | No | Yes |
| Sync branch | `git rebase <parent>` | No | Yes |
| Propose pull request | `gh pr create --base <parent> --head <child> ...` | Yes | No |
| Ship branch | `git merge --ff-only <child>` in the parent checkout | No | Yes |

The shared config key follows the git-town convention so the relationship remains readable by
compatible tooling, while the app does not require git-town to be installed. The link record remains
the project-owned relationship and the config entry is its operational projection.

## Guided request boundary

Every guided request carries a project id, link id, branch dependency link, operation id, and owning
checkout path. The planner accepts only a `dependency` link whose source and target are branch
endpoints in the same repository. It rejects node endpoints, cross-project endpoints, mismatched
repository paths, self-links, invalid Git refs, missing project or link identity, and a link id that
does not match the supplied link. This prevents an operation from selecting a similarly named branch
owned by another project.

Paths are bounded to 4,096 characters, branch names to 256 characters, project and link ids to 128
characters, and command output to 512 KiB. The planner emits only fixed executable names and argv
arrays. It never accepts shell text, command concatenation, an arbitrary executable, an arbitrary
working directory from a free-form command field, or an unvalidated argument.

## Progress and cancellation

The typed `dependencyOperation` API reports `queued`, `running`, `completed`, `failed`,
`cancelled`, and `unavailable` progress phases through `gitDependencyProgress`. Progress is
indeterminate in the sense that Git does not provide a reliable byte or step count for these
operations, so the API reports one bounded operation unit rather than inventing percentages.

Cancellation is accepted while an operation is queued and before its process starts. A local Git or
GitHub CLI process receives an abort signal after execution begins. Remote transport does not expose
the same cancellation primitive, so the operation reports its actual terminal result rather than
claiming that a remote process stopped. A missing parent, unavailable checkout, invalid link, missing
GitHub CLI, missing sign-in, and an invalid target state are explicit unavailable or failed results,
not empty success values.

## Safety and recovery

Sync runs in the child branch's owning checkout. A rebase conflict remains visible and tells the user
to resolve it in that terminal, then run `git rebase --continue` or `git rebase --abort`. Ship first
checks that the target checkout is on the named parent and then uses `--ff-only`, so a moved parent
cannot silently create a merge commit. Clear is idempotent when the config key is already absent.

Pull request creation uses the configured parent as the base and the child as the head. It reuses the
existing GitHub CLI authentication path and bounds CLI output. The source-control surface must keep
proposal authentication and network failures visible with a retry or sign-in route.

## Persistence and availability

The branch dependency link is persisted with the owning project's links. The machine-local Git config
projection is written only through the privileged Git service. A project link is never inferred from
merge-base state, a branch name, a worktree name, or a stale checkout. If its owning project or exact
link identity is unavailable, the operation remains unavailable until the project reloads the link.

The current implementation exposes the typed Electron preload and Server Edition forwarding seams.
Renderer link authoring and link rendering are owned by the link-model lane, while this article and
the operation planner define the shared contract that those surfaces consume.

## Verification state

The source implementation is present in `src/shared/dependency-operations.ts` and
`src/core/git-service.ts`. Tests, lint, type checks, builds, packaging, runtime interaction,
accessibility and security review, and built-artifact captures were not run in this implementation
lane. The integration owner must run the focused checks and confirm the user-facing controls before
marking the roadmap item complete.

## Suggested articles

- [Source control and worktrees](./source-control-and-worktrees.md) for checkout scope and safe removal.
- [Projects and tabs](../projects/projects-and-tabs.md) for project ownership and repository scope.
- [GitHub API capabilities](../integrations/github-api.md) for bounded pull request and forge operations.
