# Kids mode

A friendlier, safer surface for a child using nodeterm — and the **near-opposite** of School mode.

| | School mode | Kids mode |
| --- | --- | --- |
| Purpose | make a screen look serious in a classroom | make the app safer and gentler for a child |
| Playfulness | **removed** — forces English, hides dim sum, Cantonese, funny levels | **kept** — all of it stays |
| Restrictions | none | agent permission modes that act unsupervised are refused; every destructive action is gated |
| Record | `~/.nodeterm/shared/school-mode.json` | `~/.nodeterm/shared/kids-mode.json` |
| Credential | `school-mode.credential.json` | `kids-mode.credential.json` |

They share a record-plus-PIN *shape* and nothing else. That is why they are separate records with
separate credentials rather than two profiles of one thing — a child must not be able to leave kids
mode using a PIN an adult set for an exam.

## What it can honestly promise, and what it cannot

**This is the most important section in the document.**

nodeterm's core function is arbitrary shell access plus AI agents that run commands. That cannot be
made safe for a child by hiding user interface, because **the terminal is the danger surface and it
is also the product**.

So the mode draws a deliberately narrow line, and says so on every surface that offers it:

> Kids mode keeps things friendly and asks before anything is deleted. It does NOT sandbox the
> terminal — a typed command can still do anything your account can do, so stay nearby.

That string is `KIDS_DISCLOSURE` in `src/shared/kids-mode-policy.ts`, and a test asserts its wording.
A feature that overstates its protection is worse than no feature, because somebody relies on it.
The precedent is this app's toy locks, which already tell the user outright that they are "a speed
bump, not real security".

| Kids mode **can** | Kids mode **cannot** |
| --- | --- |
| refuse permission modes that let an agent act without asking | sandbox the shell |
| force the destructive-action confirmation on | restrict what a typed command may do |
| keep copy and touch targets friendly | stop a determined child running anything a normal user could |

## Permission modes

| Mode | While kids mode is on |
| --- | --- |
| `manual` | allowed — asking every time is exactly right here |
| `plan` | allowed — the safest of the set; it proposes without acting |
| `auto` | **refused** — auto-approves most actions, so a child would not see them coming |
| `acceptEdits` | **refused** — auto-approves file writes, so edits happen with nobody looking |
| `bypassPermissions` | **refused** — its entire purpose is acting without asking |

A refused mode degrades to **`manual`**, not to the next-loosest option. The safe direction when a
value is rejected is the most conservative one: degrading "bypass everything" to "auto" would still
be a large widening of what happens unattended.

An **unrecognised** value degrades the same way. Modes arrive from hand-editable, git-shared JSON
and end up interpolated into a command line, so `gateKidsPermissionMode` re-validates at the
decision point rather than trusting the TypeScript type — the same rule `approvalFlags` follows.

`unclassifiedPermissionModes()` exists to catch a silent gap: every mode the app knows about must
be explicitly allowed or explicitly refused **with a reason**. A mode added to `AgentPermissionMode`
later would otherwise fall into the refused branch with a generic message, and nobody would notice
kids mode had quietly formed an opinion about a mode no one had considered.

## The lock

Entering needs no proof; **leaving needs the grown-up PIN**. The PIN is never stored — only a scrypt
hash over a per-credential random salt, sealed at rest through the OS credential vault where one
exists and written as raw 0600 bytes where it does not (the Server Edition has no keychain).

That mechanism is `src/core/shared-mode-credential.ts`, shared with School mode. It was **extracted
rather than copied**: a second hand-maintained copy would drift, and a drift here means one mode's
lock behaving differently from the other's. Only the credential moved — the record storage and
record semantics stay per-mode, because coupling two near-opposite features further would be
wrong. The generic watcher lifecycle is shared only so both records survive the same absent-at-boot
filesystem shape.

The record watcher itself uses the shared lifecycle in `src/core/shared-record-watch.ts`. A first
run normally has no `~/.nodeterm/shared/` directory to watch, so it holds exactly one watcher on the
nearest existing ancestor, promotes toward the shared directory as it appears, and retries the
promotion immediately after this process writes the first record. Promotion also reloads once:
another app may have created and written the record before the narrower watcher was armed. There is
no polling timer to leak at shutdown; `dispose()` closes the one live handle, and a lifecycle
generation makes an event queued before shutdown inert when it eventually runs.

An unsealable credential (a keychain reset, a machine migration) reads as **"cannot verify"** and
leaves the mode **locked**, rather than throwing or falling open. The documented recovery is
deleting `~/.nodeterm/shared/`, which clears the record and the credential together.

## Which way it fails

Deliberate, and asserted:

- **A corrupt record reads as OFF.** A malformed byte must not leave a child in a mode nobody can
  confirm the state of, and must not lock an adult out of their own app.
- **A failed read preserves the last-known state.** Only `ENOENT` proves there is no record. A
  permission or I/O failure says nothing about whether Kids mode is on and must not silently turn
  it off; on first boot there is no earlier fact to preserve, so the in-memory default remains off.
- **A shell that cannot reach the IPC leaves the renderer store OFF.** Defaulting to on would apply
  restrictions nobody asked for and imply a protection that is not in force.
- **A wrong PIN leaves the mode on.** Obviously — but it is tested, because "fails open" is the
  failure that matters.

## Composition with School mode

Both can be on at once. School mode's suppression wins over Kids mode's playfulness (it is the
stricter presentation lock, and a classroom wanting the safety restrictions should get both), while
Kids mode's restrictions always apply. Neither weakens the other — a rule that only ever *adds*
restrictions cannot produce a surprising combination.

## Surfaces

| Surface | State |
| --- | --- |
| **Desktop** | store booted in `src/main/index.ts`, IPC via preload, Settings → Kids mode |
| **Server Edition** | store booted in `src/server/index.ts`, real ws-bridge implementation — not a stub; the same settings section, since it is plain renderer code |
| **Pages site** | not applicable — it runs no agents and has no shell |
| **Mobile companion** | follow-up in `nodeterm-ios` |

Both shells are asserted by the `kids-mode` row in `scripts/check-app-contract.mjs`, because this
repo has shipped a one-shell core change three times and the boundary tests cannot tell you a
feature is *missing* from the other shell.

## Still outstanding

- **A real agent CLI observed starting with the narrowed flag.** Everything up to the command
  line is now verified — the resolver narrows it (unit test), every launch site goes through the
  resolver (`permissionMode.funnel.test.ts`, which fails if any site reads the raw setting), and
  the mode itself works in a running build. What remains unobserved is the CLI actually launching
  under it, which needs a logged-in agent this environment does not have. Driving the palette
  headlessly to create a Claude node did not reliably land one, so this is stated as unverified
  rather than dressed up.
- **Real-device validation with a child and supervising adult.** The implementation security
  review completed on 2026-08-15 and found the close-surface and worktree-default gaps recorded
  below; those paths are now covered by behaviour tests and mutation probes. That review is not a
  substitute for observing whether the disclosure and confirmations are understood on real
  hardware, so this product-level validation remains outstanding.

## Destructive-action coverage

There are **six** `GuardedAction` values, and all six have a real runtime path:

| `GuardedAction` | Current behaviour |
| --- | --- |
| `delete-node` | one planner covers canvas key/menu/header, kanban, Cmd/Ctrl+W, sessions sidebar, session-memory panel, and agent-control close; every surface uses the two-key gate in Kids mode ✅ |
| `delete-project` | always uses the two-key gate ✅ |
| `remove-worktree` | no Enter-confirm in Kids mode; disk deletion starts unticked, including an already-open dialog when Kids mode turns on ✅ |
| `discard-changes` | two-key gate in Kids mode; plain confirm when off ✅ |
| `remove-account` | confirmation happens before credentials, transcripts, serialized bindings, or login sessions are removed; cancelling preserves all of them, and approval closes login nodes through the already-authorized node funnel without a second prompt ✅ |
| `revoke-device` | two-key gate in Kids mode; plain confirm when off ✅ |

`remove-worktree` is handled differently from `delete-node` on purpose. The two-key gate cannot
express an option, so replacing the dialog with it would hide whether the directory is deleted.
Instead, Kids mode keeps that choice visible, resets it to **off** on entry (even while the dialog
is open), and disables Enter confirmation. The user can still opt in deliberately with the
checkbox and button.

## Where the permission gate is actually applied

`activePermissionMode()` in `src/renderer/state/permissionMode.ts` — the single funnel every agent
launch site goes through. Kids mode runs **last**, after claude's CLI-version gate, because the two
answer different questions: the version gate asks *can this CLI express the mode at all*, kids mode
asks *should it be allowed to*. Running kids mode first would let a version downgrade re-widen a
mode it had just refused.

It is **agent-agnostic**, unlike the version gate. "May act without asking" is a property of the
mode, not of which CLI implements it.

`permissionMode.kids.test.ts` covers the wiring rather than the policy — including that the
resolver never produces a permissive mode while kids mode is on. Deleting the gate call turns four
of those red; the policy's own unit tests stay green, which is exactly why the wiring needed its
own coverage.

## Where the destructive gate is applied

Every node/session close enters `requestDeleteNodes` in `src/renderer/canvas/Canvas.tsx`, which
uses the pure `planNodeDeletion` + `dispatchNodeDeletion` funnel in
`src/renderer/lib/nodeDeletion.ts`. That includes the canvas Delete key and menu, React Flow node
header × buttons, the kanban menu, Cmd/Ctrl+W, the sessions sidebar and session-memory panel, and
agent-control `close`. Removing an account first uses the separate pure account-removal planner;
only its approved transaction asks the node funnel to close that account's login sessions, marked
as already authorized so no second prompt can appear after credentials are gone. React Flow expands
a group deletion to its descendants before its callback; the funnel reduces that set back to roots
so confirming "delete frame" still frees its children rather than deleting them.

With Kids mode on, every surface receives the two-key gate. With it off, the historical contracts
remain: canvas deletion is gated, kanban/sidebar/agent-control use a plain confirmation, and
Cmd/Ctrl+W closes immediately. This makes Kids mode consistent without silently changing the
ordinary-mode product contract.

## Verified against a running build

Not only by tests. On 2026-08-15 the mode was driven through a real packaged build over CDP, and
`docs/assets/shots/app-settings-kids-mode.png` is the capture — maintained by `npm run shots`
rather than taken by hand, so it goes stale loudly instead of quietly.

What was observed, through the real IPC and the real UI:

| | |
| --- | --- |
| `window.nodeTerminal.kidsMode` present, `load()` answers | the bridge is real, not a stub |
| starts OFF | the default is the safe one |
| `enable('4321')` turns it on | first-run PIN establishes the credential |
| a wrong PIN is refused and it STAYS ON | the failure that matters most |
| the correct PIN turns it off | |
| the settings UI flipped ON with no reload | the renderer store hydrated **and** is subscribed to the shared record |
| the disclosure is on screen | not merely in the source — the whole basis for offering this |
| the refused modes render with their reasons | generated from the policy table, not retyped |

And the command-line chain, verified statically because every link is source-level:

```
settings / project override
  -> resolvePermissionMode
  -> gatePermissionMode        (claude CLI version)
  -> gateKidsPermissionMode    (kids mode — LAST, so it can only narrow)
  -> withPermissionMode        -> the flag on the command line
```

`permissionMode.funnel.test.ts` asserts nothing bypasses it: no file outside a named allow-list
reads `settings.claudePermissionMode`, the gate is applied to the RETURNED value, and no
`withPermissionMode` call passes a hardcoded mode. Probed by adding a bypassing launch site (red)
and by unwiring the gate (red).

## Verifying a claim here

```bash
npx vitest run src/core/kids-mode.test.ts src/shared/kids-mode-policy.test.ts \
  src/renderer/state/permissionMode.kids.test.ts src/renderer/lib/nodeDeletion.test.ts \
  src/renderer/lib/accountRemoval.test.ts
node scripts/check-app-contract.mjs
```
