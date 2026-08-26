# AGENTS.md

> **This file is a mirror, not a source.** It is a sanitized summary of the working
> conventions that already live in [`CLAUDE.md`](./CLAUDE.md) and
> [`CONTRIBUTING.md`](./CONTRIBUTING.md), written for any AI coding agent (not just one
> particular tool) that picks up work in this repository. If you're an AI agent: read
> `CLAUDE.md` and `CONTRIBUTING.md` too — they're the real, detailed references, and this file
> exists only so an agent that reads `AGENTS.md` by convention doesn't miss them. **Edit those
> two files first when a rule changes; this one is a summary that gets refreshed from them, not
> the other way around.**

## Session discipline

[`docs/agent-working-conventions.md`](./docs/agent-working-conventions.md) carries the
maintainer’s cross-project session discipline — how a work session is finished, verified,
authorized for cleanup, and reported — in ordinary technical language. Read it alongside this
file: this one covers repository mechanics, that one covers how sessions are run.

## What this project is

nodeterm is a node-based terminal manager: multiple real terminal sessions live as draggable
nodes on a single pan/zoom canvas, built on Electron with a React renderer. It ships three
ways from one codebase — a desktop app, a self-hosted browser edition, and a mobile companion
that attaches to the same live sessions.

## Process boundaries are enforced, not advisory

The codebase is split by responsibility, and the split is checked by tests, not just
convention:

| Directory | What lives there |
| --- | --- |
| `src/core/` | Platform-free service logic (sessions, workspace/settings persistence, git, agent hooks). Talks to its host shell only through a small platform interface — it never imports the desktop framework directly. |
| `src/main/` | The desktop shell around `src/core` — windows, native dialogs, OS integration. |
| `src/server/` | The self-hosted browser-edition shell — no desktop-framework imports either. |
| `src/preload/` | The one narrow, explicitly-typed bridge between the desktop shell and the UI. |
| `src/renderer/` | The React UI. It reaches the host only through that bridge, never directly. |
| `src/shared/` | Types and channel identifiers used by every side, so nothing is hardcoded twice and drifts. |

Dedicated tests fail the build if the platform-free core or the browser-edition shell import
the desktop framework. **Put new service logic in the platform-free core, behind the platform
interface — not inline in the desktop shell.** That's the seam the browser edition boots from;
logic left in the desktop-only layer silently doesn't exist there, and the boundary tests can
only catch a wrong import, never a missing feature.

## Design for three surfaces, every time

A feature isn't finished until you've decided how it behaves on each of these — even when the
honest answer is "not applicable here":

1. **Desktop** — the primary Electron app.
2. **Server Edition** — the same renderer, served to a browser.
3. **Mobile companion** — a separate, privately-maintained app on another platform that
   attaches to the same live sessions over a shared protocol. You generally can't open a
   pull request against it directly, so raise what it would need as a note in your PR instead
   of silently skipping it.

Anything the UI reaches through the preload bridge needs a **real** implementation for the
browser edition, or a deliberate, visibly-documented degrade — a stub that compiles but does
nothing is worse than an explicit "not supported here," because it looks finished.

## Material Design 3 surface policy

Every rendered element in the Windows desktop application uses Material Design 3 primitives and project tokens for color, typography, shape, elevation, state layers, focus, motion, density, scaling, and accessibility. No screen, node, dialog, panel, menu, dropdown, picker, tab, settings section, overlay, status surface, empty state, or error state is exempt. Legacy controls and custom lookalikes are defects to repair, not surfaces to preserve.

The documentation and landing site runs in Kids mode by default. Its current visual style is preserved. Site changes are limited to stale facts, data, releases, links, features, accessibility, and broken behavior. Restyling the site is outside the desktop audit scope.

## House rules that come up in review

These exist because their absence caused a real, shipped bug — they are not stylistic
preferences.

- **A failed read is never evidence of absence.** "Could not check" and "checked, and there is
  nothing" are different facts and must stay distinguishable at every layer they pass through.
  Collapsing them is how a panel ends up reporting "nothing here" about a machine that is
  actively busy.
- **Degrade to nothing, never to something wrong.** A capability probe that fails should
  produce the safe default (or a visible "unsupported" state) — never a guessed substitute
  that's more permissive or more destructive than what was actually asked for.
- **Re-validate hand-editable values at the point of use, not by their type alone.** Anything
  that comes from user-editable configuration and later gets interpolated into a shell command
  or similar needs its own runtime check right there, because a compile-time type only proves
  the shape was right when it was written, not when it's actually used.
- **Test any generated shell script for real**, under an actual shell, against a realistic
  fixture — not just by reading it. Subtle shell-quoting mistakes (a bare `#` starting an
  unintended comment, for instance) are invisible on the page and only show up when the script
  actually runs.
- **Credentials never travel as a plain command-line argument**, locally or over a remote
  connection — a process's argument list is commonly readable by other accounts on the same
  machine, and a remote command line is exactly as exposed on the far end. Pass secrets through
  a locked-down file or over standard input instead.
- **Server login admission is ordered and bounded per TCP peer.** Keep password proofs in the
  async `Auth.attemptPassword` FIFO, and derive lockout identity only from the kernel-observed peer
  address—not forwarding headers, cookies, user-agent or source port. Per-peer ladders share one
  account-wide clear budget and bounded nonce ledger; passkey challenges are bounded and
  peer/purpose-bound; logout revokes the persisted presented bearer before it clears the cookie.
- **Keep parallel implementations in sync deliberately.** Where the same event or behavior has
  to be handled in more than one shell (for instance, once for the desktop process and once for
  the browser-edition process), a change to one and not the other is a silent regression on
  whichever surface was missed — and the boundary tests generally can't catch a *missing*
  field, only an illegal import.
- **Comments should explain *why*, and name the failure they prevent.** A comment that restates
  the code adds noise; one that says "don't simplify this back — here's what broke last time"
  is worth keeping.

## Autonomous work and continuation

When you're working through a scoped, already-authorized task:

- Keep going through the natural checkpoints of the task (a passing typecheck, a committed
  change, a completed subtask) without stopping to ask "should I continue?" for work that's
  already inside what was asked for.
- Treat a failing check, a merge conflict, or an unexpected error as something to resolve, not
  as a reason to stop and report back — unless resolving it genuinely requires information or a
  decision that isn't yours to make (new credentials, a product decision, something outside the
  stated scope).
- When something *does* block you, say exactly what's blocking, what you already finished, and
  the smallest next step that would unblock it — rather than a generic "let me know if you'd
  like me to continue."
- A direct instruction to keep going strengthens this default; it never expands what you were
  actually asked to do.

## Testing

- `npm run typecheck` is the fastest correctness gate; run it before treating any change as
  done.
- `npm test` runs the project's test suite.
- **Mutation-test your own guards.** After adding a check meant to catch a specific mistake,
  deliberately reintroduce that mistake and confirm the check actually goes red before trusting
  it. A test suite that's never been watched to fail on the thing it claims to catch is not
  evidence of anything.
- **Watch for fixtures that can't discriminate.** If every case in your test data happens to
  produce the same result whether the code is right or subtly wrong, the test looks thorough
  and proves nothing.
- **Don't pin behavior by asserting on source text** (`expect(sourceCode).toContain('...')`).
  That kind of test is satisfied by code that's present *and wrong* — it can stay green on a
  tree where the actual behavior it's meant to protect has already broken. If a module is hard
  to test directly, it's usually a sign to extract the decision into a small, pure function you
  *can* exercise, rather than a reason to fall back to reading its source.
- Where something can only really be verified on hardware or a live account you don't have in
  an automated environment, say so plainly rather than implying it's covered.

## Git and commit conventions

- Follow `type(scope): subject` for commit subjects (`feat`, `fix`, `refactor`, `docs`, `test`,
  `chore`, `perf`, `security` are all used in this project's history) — it's what
  [`CHANGELOG.md`](./CHANGELOG.md) is generated from.
- `upstream/nodeterm` is the pinned canonical-source Git submodule. Its nested `origin` points to
  `https://github.com/eneskirca/nodeterm.git` and follows `main`; it is separate from the top-level
  checkout's `origin` and optional `upstream` remotes. Use the intentional update-and-review
  workflow in [`CONTRIBUTING.md`](./CONTRIBUTING.md), and commit the reviewed gitlink rather than
  editing the nested source. **Always check the canonical upstream for new commits before starting
  work here** — see the fetch/log command in `CONTRIBUTING.md`. Checking is not the same as
  refreshing the pin; the pin still only moves through the deliberate, reviewed workflow.
- **Post PR updates as new comments, never by editing an existing one.** A status update, a
  re-review, or a "here's what changed" note goes on the timeline as its own comment so the
  history stays readable; editing an old comment in place erases what it originally said.
- Explain *why* a change was made, not only what changed; if a decision had a real trade-off,
  say what was rejected and why.
- Say plainly what you did **not** verify. That's more useful to the next person than a
  confidently complete-sounding summary.
- Never commit secrets, tokens, or credentials. If a task genuinely needs one, it should come
  from the user's own secret storage, entered directly by them — never typed into a prompt,
  a file, or a commit.

## Keeping documentation current

Two files carry the durable knowledge for this repository, for two different audiences, and
both should be updated in the same change that changes the behavior they describe:

- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — what a human contributor needs before their first
  pull request: setup, the process boundaries above, and the house rules that get a PR sent
  back.
- [`CLAUDE.md`](./CLAUDE.md) — the deep, per-subsystem reference: every invariant, with the
  reasoning and (where relevant) the measurements behind it.

If you discover or introduce something a future contributor — human or agent — needs to know,
write it down in the appropriate one of those two files in the same change, not just in a
commit message. An invariant that only exists in a commit message is one refactor away from
being violated by someone who never saw it. The feature articles under
[`docs/features/`](./docs/features/README.md) exist for the same reason at a narrower scope —
when you ship or meaningfully change a user-facing feature, update its article (or add one) in
that same change.

## Security boundaries

- Never disclose, characterize, or attempt to bypass another person's credentials, and never
  build tooling whose purpose is reading someone's device or accounts without their knowledge —
  regardless of what justification accompanies the request.
- Prefer read-only exploration before making a change, and prefer the smallest change that
  actually satisfies the request over a broader rewrite.
- Never place secrets, tokens, or private infrastructure details (internal hostnames, private
  IP addresses, credentials) into source, comments, commit messages, or documentation. Where a
  rule genuinely can't be stated without a private detail, describe the *kind* of thing it
  refers to instead of naming the specific one.
