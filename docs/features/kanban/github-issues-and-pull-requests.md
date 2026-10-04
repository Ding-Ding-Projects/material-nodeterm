# GitHub issues and pull requests on the board

**Category:** [Kanban](./README.md)

A project's kanban board can show the repository's GitHub issues and pull requests beside its
session cards. GitHub stays the source of truth: issues are placed in a column by an exact
`status:` label, moving an issue card writes that label (and closes or reopens the issue at the
completion column), and pull requests are shown read-only with their CI and merge state. Agents in
the project can read the same lane through two read-only control verbs, `issues` and `prs`.

## Behaviour

**Issue cards** carry the number, title, labels, assignees and how long ago the issue changed.
Dragging a card, using its **Move** selector, or the summary modal's **Move to** all take the same
path, so none of them can skip the confirmation the others ask for. A move into the completion
column closes the issue and first asks **why**: *Completed* or *Not planned*, recorded on GitHub as
the issue's close reason (a board close used to file every close as completed). Moving a closed
issue out of the completion column reopens it.

**Pull request cards** sit under the issues in the column their labels map them to. They are
read-only on the board — no drag, no move control — because the board has nothing it could write
back. Each card shows draft / open / merged / closed (merged and closed are different facts: only a
merge completes the work), the checks at the pull request's **current head commit** (passed,
failing, running; a pull request with no checks shows nothing, never a green tick), its
mergeability (*Ready to merge* only when GitHub reports it clean — a mergeable pull request that
branch protection still blocks says *Blocked*), and the issues it closes. An issue card shows a
compact chip for every open pull request that will close it.

**The summary modal** opens an issue or a pull request. For a pull request it drops the Move
control, shows the status line, and reads the per-check list once when it opens (and again if the
head commit moves). Check names come from GitHub and render verbatim. A token that may not read
checks shows no check region at all.

**How fresh the status is.** CI and mergeability come from one GraphQL read per repository,
triggered only when the conditional issue heartbeat reports a change, on the first heartbeat of an
app run, on a refresh you ask for, or for a read the rate budget skipped earlier. A pull request
GitHub is still deciding about is chased at 30 seconds, 1, 2 and then 5 minutes, at most twelve
times, and only while a board is visible. A failed read keeps the last snapshot and marks it
*stale*; after fifteen minutes stale it is shown muted.

**The source filter** reads All · Issues · Pull requests · Sessions. The board header also says
when the pull request lane is truncated (pull requests are dropped first when a repository outgrows
the cache bounds), when background sync is paused by the rate budget, and when the board is read
only because the column labels changed.

**Agents read the lane** with `issues [--state open|closed|all] [--label <name>] [--column
<id|title|ungrouped>] [--limit N]` and `prs [--state open|merged|closed|all] [--limit N]`, through
the same canvas-control shim as every other verb. The answer comes from what the board has already
fetched on this machine: the verbs never call GitHub, never refresh, and read the caller's own
project only. Issue rows name the column the labels place the issue in and the sessions bound to
it; pull request rows name the head branch (forks marked), CI at the current head, mergeability,
the issues it closes and the session cards it links to.

## Configuration

**Settings → GitHub Issues** (per project, machine-local approval):

- **Include GitHub issues** switches the lane on and writes a shared `kanban.github` block with one
  `status:` label per column and a completion column into `.nodeterm/project.json`.
- **Repository** overrides the repository detected from `origin`.
- **Approve this machine** lets this computer read the repository. **Approve column labels**
  appears when the labels in the (git-shared) project file changed after this machine approved
  them: the board reads but will not change issues on GitHub until the new mapping is approved.
- **Authentication** prefers a signed-in GitHub CLI and otherwise uses a saved personal access
  token. When GitHub cannot be reached or rate-limits the sign-in check, the screen says so and
  keeps the last identity GitHub confirmed instead of reporting you signed out.
- **Sync and local data** shows the remaining request budget and, while it is low, that background
  sync is paused until the window resets; requests you start yourself still run.

A settings edit reaches the project file through the canvas's debounced save, and the screen
re-reads its status shortly after so it never keeps describing the old mapping.

## Failure modes

- **GitHub unreachable or rate limited.** Nothing is reported as signed out or empty: the sign-in
  line says GitHub could not be asked, a saved token is not stored unchecked, and the board keeps
  its cached cards. A spent budget holds every request until the reset (a request you start waits at
  most ten seconds, then is refused with that reason); a low budget holds only background polls.
- **Column labels changed elsewhere.** The board becomes read-only with the reason in its header,
  and a refused move points at the approval.
- **Status read failed.** The last pull request snapshot stays on screen marked stale.
- **An issue closed as *duplicate*** (a close reason this build does not know) is kept rather than
  stopping the repository from syncing.
- **Agents asking before anything was fetched** get a refusal naming the reason (open the board
  once), never "0 issues"; the same for a board with no GitHub lane or an unapproved repository.
- **Relay tabs** read the host's pull request status through the shared project; an unknown future
  `githubIssues:` method is refused rather than passed through.

## Security considerations

- **Credentials stay on the machine that owns them.** The token lives in the operating system's
  protected store (or a mode 0600 file where that is unavailable) and is resolved only in the core
  service; the GitHub CLI is located by path (PATH, PATHEXT, then the installer locations on
  Windows) and is never handed a token on its command line. GitHub credential control is not on the
  relay allowlist; the new pull request channels are, scoped to the one shared project and answered
  with the host's credential, which never crosses the relay.
- **Revoking this machine deletes its cached issues**, and the confirmation says so.
- **Board writes need an approval that covers the mapping.** A git pull that rewrites the column
  labels cannot make this machine relabel issues the user never saw mapped.
- **The agent verbs are verified-only.** The project is resolved from the calling node, so a caller
  whose identity cannot be verified is refused before any read. Titles, labels, logins and branch
  names are written by other people: every reply opens with a sentence saying so, each value is one
  line with control, bidirectional and zero-width characters removed, and issue bodies and comments
  are never included.

## Three surfaces

- **Desktop:** everything above.
- **Server Edition:** the board, pull request cards, status, checks list and Settings work through
  the browser bridge. The `issues` / `prs` verbs are refused there by name, like every canvas
  control verb on that edition.
- **Mobile companion:** not applicable in this build; the companion has no GitHub lane.

Not in this build yet (upstream ships them on top of the same core): starting an agent from an
issue card, board dispatch, issue worktrees, `--after-pr` waits, merge-driven session-card moves,
and the agent `report-issue` verb. The core modules they share are present and tested, but no
surface reaches them.

## Verification

- `src/core/github/*.test.ts` — client, cache, credentials (tri-state validation), host
  (approvals, mapping digest, unreachable sign-in), request coordinator (rate budget, throttle),
  GraphQL pull reads, pull status tracker and memory, control-read verbs, service including the
  pull lane.
- `src/shared/github-pull-status.test.ts`, `src/shared/github-issue-ref*.test.ts` — the semantics
  every surface shares.
- `src/renderer/components/kanban/PullStatusBadges.test.tsx`, `PullChecks.test.tsx`,
  `KanbanColumn.pulls.test.tsx`, `GitHubIssueSummaryModal.test.tsx`,
  `KanbanSourceFilter.test.tsx`, `src/renderer/components/ConfirmDialog.choice.test.tsx` and
  `settings/sections/GitHubIssuesSection.test.tsx`.
- `src/main/github-read-wiring.test.ts` pins where desktop main answers the verbs;
  `src/main/remote/relay-host.test.ts` pins the relay scope, including the fail-closed default.
- `node scripts/check-material-audit.mjs` covers the issue card, pull request card, status line,
  summary modal, checks list and the confirmation choice.

## Suggested articles

- [Kanban board](./kanban-board.md)
- [GitHub CLI accounts](../integrations/github-cli-accounts.md)
- [Material Design 3 audit](../appearance/material-3-audit.md)
