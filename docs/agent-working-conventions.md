# Agent working conventions

A sanitized distillation of the maintainer's private, cross-project instruction set, republished
here so any agent (or human) working in this repository inherits the same discipline without
access to the private source. Two things were deliberately left behind: the private conversational
naming that instruction set uses, and every product/host detail that has no business in a public
repository. Nothing in this file is weakened by that omission — these are the load-bearing rules,
in ordinary technical language.

`AGENTS.md` covers repository mechanics (boundaries, testing habits, commit style). This file
covers **session discipline**: how a work session is run, verified, finished, and cleaned up.

## Session-finishing passes

Work sessions end through named passes, in increasing weight. Each is a checklist, not a mood.

**Finish-up** — write an honest handoff first (what actually exists, not what was intended), then
integrate and push every branch so nothing can be lost, and only then — under fresh, explicit,
per-pass authorization — remove what is *proven* redundant. It does not build installers or ship a
release, and must never be described as having done so.

**Integrate-and-clean** — merge every branch and linked worktree into the default branch, push
everything, then (again only with fresh authorization) delete the branches and worktrees whose
tips are proven merged.

**Release-grade shutdown** — the heavyweight finish: preserve every valid dirty change, reconcile
the remote, make CI green, build the installable artifacts locally through the repository's real
release path, ship and verify exactly one release, integrate everything into the default branch,
and only then reduce the repository to a single clean checkout of one branch. Its gates are
non-negotiable; a blocked gate is reported with evidence, never waived to finish.

## Authorization discipline

- A request to run a pass authorizes its **constructive** half only: preserve, integrate, build,
  test, ship, verify.
- The **destructive** half — deleting branches, worktrees, stashes, directories — requires a
  separate, explicit confirmation given *during the current pass*. An authorization from an
  earlier pass, an earlier day, or a standing preference does not count.
- Deletion authorization is never permission to bypass preservation rules. Before any branch is
  deleted, its tip must be proven an ancestor of the pushed default branch
  (`git merge-base --is-ancestor`). A branch that cannot safely be made an ancestor is kept and
  reported, and the pass is honestly incomplete.
- Resolve every deletion target to an exact path before acting. Never recursively delete a
  repository root, a home directory, an unresolved variable, a glob, or any checkout holding
  uncommitted, unmerged, or unpushed work.

## Preservation first

- A tidy branch list is never worth losing work. Review every dirty diff and commit each coherent
  body of work on the branch that owns it before anything else happens.
- If the remote is ahead of the local branch, fetch and reconcile through the repository's normal
  merge policy. Never force-push, rewrite, or silently replace the remote tip.
- Push every branch carrying unique commits before integration begins, so the work survives any
  later mistake.
- Never commit secrets, dependency trees, build output, caches, or another agent's scratch files
  merely to make status look clean. Name what was deliberately excluded and why.

## Verification discipline

- **Verification never blocks the next batch of work.** Suites and capture runs are slow; run
  them in the background and keep implementing — but the next batch continues in its **own fresh
  worktree** created from the reconciled default tip, never in the checkout a suite is reading.
  A test run and an edit in the same tree produce a verdict about a tree that no longer exists,
  which is worse than no verdict: it looks like evidence.
- A verdict binds to the exact commit it ran against. Record that commit beside the result; if
  the tree moved on, the result is superseded and must be re-run before it satisfies any gate.
- Never widen a timeout, skip a case, or accept a stale verdict to make a batch look finished.
  Parallelism buys wall-clock time, never evidence.
- A cancelled, skipped, pending, or superseded CI run is not a green run.

## Mutation-test your own guards

A test meant to catch a specific mistake is unproven until it has been *watched to fail* on that
mistake. Reintroduce the exact defect, confirm the test goes red, restore, confirm green — and
**verify the mutation actually applied to the file before trusting the result**. A text
replacement that silently matches nothing produces a passing run that proves only that nothing
changed; this exact false pass has happened in this repository more than once.

## Multi-agent orchestration

When work is distributed across agents:

- One orchestrator owns sequencing and integration; implementers own **disjoint file sets**,
  stated explicitly up front. Two agents in one file is how a regression arrives dressed as a
  merge conflict resolution.
- Every implementer's report is verified **adversarially** by a separate agent that reads the
  actual diff, runs the checks itself, and is licensed to find nothing — a reviewer under
  pressure to produce findings invents them.
- Observation-only watcher agents may poll CI or long jobs, but a watcher's report is a signal to
  re-verify, not a verdict.
- Reviewers are told not to edit. Review and repair are different jobs, and only repair needs
  worktree isolation.
- An agent's claim of completion is never accepted on the summary alone: read the diff, run the
  suite, and re-run at least one of its claimed mutation tests independently.

## Honest reporting

- State plainly what was **not** verified. "Landed and unverified" is a legitimate status;
  "done" for unverified work is not.
- "Could not check" and "checked — there is nothing" are different facts and must never collapse
  into each other, at any layer.
- When blocked, name the exact blocker, what already finished, and the smallest next step that
  would unblock — not a generic offer to continue.
- Total-success language is reserved for total, verified success: release shipped, CI green,
  every requested item genuinely complete. Partial completion is described as partial.
- When a mistake is discovered, say so immediately and concretely; if it broke something, the
  breakage is the headline, not a footnote.

## What was omitted, and why

The private source expresses these rules through project-internal naming and carries operational
details of the maintainer's own machines and private products. None of that survives
sanitization into a public repository — by that source's own explicit rule — and none of it is
needed: the discipline above is complete in ordinary language. If a rule here ever seems to
conflict with the private source, the private source wins for the maintainer's own sessions and
this file should be corrected to match its *intent*.
