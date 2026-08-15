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
| **Desktop** | store booted in `src/main/index.ts`, IPC via preload |
| **Server Edition** | store booted in `src/server/index.ts`, real ws-bridge implementation — not a stub |
| **Pages site** | not applicable — it runs no agents and has no shell |
| **Mobile companion** | follow-up in `nodeterm-ios` |

Both shells are asserted by the `kids-mode` row in `scripts/check-app-contract.mjs`, because this
repo has shipped a one-shell core change three times and the boundary tests cannot tell you a
feature is *missing* from the other shell.

## Still outstanding

- **The settings surface.** The store, policy, IPC and both shells are wired; the section a user
  actually toggles it from is not built yet.
- **The destructive gate.** `requiresDestructiveGate` is implemented and tested but is not yet
  called from the destructive-action paths, so today it changes nothing. (`gateKidsPermissionMode`
  IS now wired — see below.)
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

## Verifying a claim here

```bash
npx vitest run src/core/kids-mode.test.ts src/shared/kids-mode-policy.test.ts \n  src/renderer/state/permissionMode.kids.test.ts
node scripts/check-app-contract.mjs
```
