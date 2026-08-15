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
| `auto` | allowed, and the loosest on the list |
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
directory watcher stay per-mode, because a difference there is harmless and coupling two
near-opposite features further would be wrong.

An unsealable credential (a keychain reset, a machine migration) reads as **"cannot verify"** and
leaves the mode **locked**, rather than throwing or falling open. The documented recovery is
deleting `~/.nodeterm/shared/`, which clears the record and the credential together.

## Which way it fails

Deliberate, and asserted:

- **A corrupt record reads as OFF.** A malformed byte must not leave a child in a mode nobody can
  confirm the state of, and must not lock an adult out of their own app.
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
- **Wider destructive coverage — and the earlier version of this bullet was WRONG.** It claimed
  worktree removal "already opens the super gate unconditionally". It does not: it renders a plain
  `ConfirmDialog` with `enterConfirms`, and its delete-from-disk option defaults to ON for a
  worktree nodeterm created. A security review caught it. The true state:

  | `GuardedAction` | today |
  | --- | --- |
  | `delete-node` | consults the policy ✅ |
  | `delete-project` | already opens the super gate unconditionally ✅ |
  | `remove-worktree` | hardened: no Enter-confirm, disk deletion always an unticked opt-in ✅ |
  | `discard-changes` | bare `window.confirm()` ❌ |
  | `revoke-device` | plain `ConfirmDialog` ❌ |
  | `clear-history` | not wired ❌ |

  So **two of six** remain unprotected. `discard-changes` and `revoke-device` live outside
  `Canvas.tsx`, which owns `openDestructiveGate`, so wiring them needs the gate plumbed through —
  real work, not a one-line change, and left undone rather than half-done.

  `remove-worktree` was handled differently from `delete-node` on purpose. Routing it to the
  two-key gate would have LOST the disk-deletion choice, because that gate cannot express an
  option — so instead the choice is always shown and always starts unticked, and no keystroke can
  confirm. Surfacing an implicit deletion beats replacing it with a harder confirmation of the
  same implicit thing.
- **A security review**, before this is offered to anyone as child-safety. The survey that scoped
  the M3 overhaul was explicit that a child-facing gate in front of a real PTY needs its own review
  independent of any UI timeline.

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

`deleteNodeFromKanban` in `src/renderer/canvas/Canvas.tsx`. With kids mode ON it opens the two-key
super-confirmation; with it OFF the behaviour is byte-identical to before.

Wiring this surfaced a **pre-existing inconsistency**, which is recorded rather than quietly
resolved: deleting a session from the canvas (the Delete key) has always opened the super gate,
while deleting the same session from the board opened a one-button confirm — identical action,
identical node, two different confirmations. Its comment even claimed they matched. Kids mode now
makes them agree; making them agree for *everyone* is a product decision, not a wiring fix, so the
off-path was left exactly as it was.

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
npx vitest run src/core/kids-mode.test.ts src/shared/kids-mode-policy.test.ts \n  src/renderer/state/permissionMode.kids.test.ts
node scripts/check-app-contract.mjs
```
