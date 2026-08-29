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
no polling timer to leak at shutdown; `dispose()` closes the one live handle. Opening or replacing
a watch handle is only a **recovering** state: every event/error/rearm invalidates policy
synchronously, and the exact handle-generation/sync-epoch token becomes healthy only after a
strict canonical read is acknowledged. A late read from before another event cannot heal the newer gap, and disposal
invalidates every token so an event queued before shutdown is inert when it eventually runs.

Record mutations do not write a document derived from process-local cache. Rename, enable and
disable each enter the shared SQLite transaction, strictly read the current canonical record,
change only their field, and compare-publish the observed revision. This is why a process that
cached OFF cannot erase another process's newer ON merely by renaming the mode.

An unsealable credential (a keychain reset, a machine migration) reads as **"cannot verify"** and
leaves the mode **locked**, rather than throwing or falling open. The documented recovery is
deleting `~/.nodeterm/shared/`, which clears the record and the credential together.

## Which way it fails

Deliberate, and asserted:

- **A corrupt record may display the OFF default, but policy is unavailable.** Destructive actions
  therefore take the two-key path and record mutations refuse to overwrite the recoverable bytes.
- **A failed read preserves the last-known state.** Only `ENOENT` proves there is no record. A
  permission or I/O failure says nothing about whether Kids mode is on and must not silently turn
  it off; on first boot there is no earlier fact to preserve, so the in-memory default remains off.
- **A shell that cannot reach the IPC leaves the renderer display OFF but policy unavailable.** It
  neither claims Kids mode is ON nor spends that unknown fact as permission for an ordinary delete.
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

## The screens (Home / Gate / Grown-up)

Before 2026-08-19 this document described the record, the policy, and the settings section — but
there was no Kids-facing UI at all: `<Canvas/>` rendered unconditionally regardless of the shared
record, so turning Kids mode on changed launch-time flags and the destructive gate without ever
changing what was on screen. `src/renderer/components/kids/` is that UI, matching
`design/v2/MD3 Kids Mode.dc.html`'s three screens (Home, the parent gate, the grown-up screen) plus
one screen the design does not draw (the kid-scoped activity canvas a tile opens into).

### Routing is fail-closed, at the App root

`App.tsx` no longer renders `<Canvas/>` unconditionally. It reads `useKidsMode()`'s `hydrated` and
`enabled` and picks exactly one of three things: a neutral splash while `hydrated` is still false
(so the very first frame of a cold start never flashes the full developer canvas — dock, tab bar,
every project — to a child before the one IPC round trip to read the shared record has answered),
`<KidsShell/>` once hydrated and on, or `<Canvas/>` once hydrated and off. `<Canvas/>` is not
merely hidden while Kids mode is on — it is not mounted at all.

### Four tiles are real; two are an honest placeholder

The design lists six tiles. Only four map to something this app actually has:

| Tile | Backing | Notes |
| --- | --- | --- |
| Talk to Beep | a real Claude agent node (`createAgentNode`) | permission mode comes from the SAME production funnel every other agent launch uses (`ensureActiveAgentLaunchPlan('canvas-new-agent', 'claude')`), so it is narrowed to `manual`/`plan` by `gateKidsPermissionMode` automatically — nothing kids-specific was added to the launch path |
| Type things | a real plain terminal node (`createTerminalNode`) | gated by the grown-up screen's "Allow the real terminal" switch |
| Draw | a real `StickyNode`, not the canvas's line/arrow `AnnotationNode` | see below |
| My stickers | a real counter (`state/kidsActivity.ts`), not a hand-set number | |
| Story time | **placeholder** | no read-aloud story library exists anywhere in this codebase |
| Sounds | **placeholder** | no sound-matching feature exists anywhere in this codebase |

The two placeholders render as visibly disabled tiles carrying a "Soon" badge and a `title`
explaining why, rather than as buttons that look interactive and silently do nothing — the
decorative-UI rule's own escape hatch ("intentionally illustrative, plainly labelled") is what
licenses shipping them at all instead of hiding the tiles outright.

**Why "Draw" is a `StickyNode` and not an `AnnotationNode`:** the brief explicitly allows either.
An `AnnotationNode` (a line/arrow) is created by dragging a rectangle on the developer canvas's own
pane — `Canvas.tsx`'s pointer-drag lifecycle, a file this lane does not own and should not fork a
copy of. This app has no freehand drawing/painting feature at all; a sticky note a kid can write
and colour on is the closest real, working stand-in, not a from-scratch canvas feature invented
for this lane. It is genuinely functional (a real `StickyNode`, same component the developer canvas
renders), just not literally "drawing".

### The kid-scoped canvas

`KidsActivityCanvas.tsx` is a second, independent `<ReactFlow>` instance (its own
`<ReactFlowProvider>`), never the developer canvas from `canvas/Canvas.tsx`. It renders the SAME
node components the developer canvas does — `TerminalNode`/`StickyNode`, imported unmodified —
because the terminal genuinely is the product (see `KIDS_DISCLOSURE`); there is no separate
"kid-safe" terminal implementation to fork and maintain. Three fixed node ids
(`kids-beep-node`/`kids-terminal-node`/`kids-draw-node`) mean "Type things" always reattaches the
same tmux/session-host session rather than cold-starting a fresh one on every visit — the same
persistence contract every other terminal node in this app already has. A small quick-switch strip
in the activity header lets a kid hop between the three without a round trip through Home; each is
created lazily on first visit and kept for the lifetime of that "away from Home" session.

**Known gap:** these three nodes are NOT part of any project's `project.json` and do not persist
across a full app restart the way ordinary project nodes do — they are recreated (with the same
fixed ids, so the underlying tmux/session-host session still reattaches once one exists) the first
time each tile is revisited after a restart. Giving them real project-scoped persistence would mean
Kids mode owning a slice of the workspace/projects store, which is out of this lane's file
ownership; a follow-up that wants persisted kid canvases should look there first.

### Stickers are earned, not decorative

A sticker is awarded once per "away from Home" session (i.e. once when the kid taps "Back to Beep"
in the activity canvas, not once per activity visited), and only if at least
`stickerThresholdMs()` (20s) of real time was spent — long enough that trying something briefly
still counts, short enough that opening and immediately leaving does not farm stickers. "Sessions
today" on the grown-up screen counts activity **navigations** logged in `state/kidsActivity.ts`,
never keystrokes: counting what was typed inside a REAL terminal — the very thing the "Allow the
real terminal" switch exists to gate — is a keylogger shape, and this whole mode's defensibility
rests on `KIDS_DISCLOSURE` being literally true. This is why "Words typed" from the design mock is
gone rather than implemented.

### The grown-up screen's switches, and their exact scope

Every switch is wired to something real; two of the five reach further than "just this screen",
and the copy next to each one says so rather than looking narrower than it is:

| Switch | What it actually does |
| --- | --- |
| Allow the real terminal | `state/kidsActivity.ts`'s `allowRealTerminal` — gates the "Type things" tile only |
| Allow Beep to answer freely | writes `settings.claudePermissionMode` directly (`'plan'` on / `'manual'` off) — the SAME app-wide setting Settings → Agents exposes, so while Kids mode is on this affects every agent on the machine, not only Beep. `activePermissionMode()` still applies `gateKidsPermissionMode` on top, so it can never widen past `manual`/`plan` regardless |
| Read every screen aloud | `settings.narratorEnabled` — the same app-wide narrator Settings → Speech controls; every Kids screen calls `narrateKidsScreen()` on entry through the existing `decideCanvasNarration` policy, so School mode's Cantonese suppression still applies |
| Daily time limit | `state/kidsActivity.ts`'s `dailyLimitMinutes` (on = 60, matching the design mock's own stat card; off = `null`). A real 60-second ticker in `KidsShell` accumulates minutes while a kid-facing screen is showing (never while the gate/parent screens are up) and routes to a PIN-only "times up" screen — the same `KidsGate` component in its `variant="timesUp"` mode, which drops the casual "Back to Beep" escape — the moment the limit is reached |
| Lock kids mode on launch | `state/kidsActivity.ts`'s `lockOnLaunch`, read ONCE at `KidsShell` mount to decide the starting screen (`gate` vs `home`) — a mid-session flip never yanks the current screen out from under a kid |

The scoping caveat on "Allow Beep to answer freely" is a deliberate trade, not an oversight: giving
it a Kids-only override would mean either mutating the active project's `defaultPermissionMode`
(there usually isn't a meaningful "active project" once the whole canvas is replaced by Kids mode)
or building a new override layer in `permissionMode.ts`/`kids-mode-policy.ts`, neither of which is
this lane's file to touch. The honest, working choice was to use the real setting and say so.

### PIN entry: the grown-up gate and the rail's first-time setup

`components/kids/PinPad.tsx` is a 4-digit numeric keypad matching the design's `gateKeys`/
`gateDots` layout (84px keys, r28, 4 dots, `⌫` in `tertiary-container`) — used both by `KidsGate`
(verifying) and by `EnableKidsModeDialog` (choosing a new one, with a second pad to confirm).
**Kids-mode PINs are fixed at exactly 4 digits**, enforced at every place THIS app lets a grown-up
CHOOSE one — `KidsModeSection.tsx`'s Settings fields (`onlyDigits4`) and the rail dialog — but
deliberately NOT enforced on a field that only VERIFIES an existing PIN (Settings' "Turn off"
unlock field, the "Current" field in "Change the grown-up PIN"), since that value may have been set
by another app sharing `~/.nodeterm/shared/`, or an older nodeterm build, and could be any shape. A
pad with only digit keys can never type a letter, so this is what keeps every PIN this app itself
creates enterable on the pad that later has to check it.

`window.nodeTerminal.kidsMode.verifyPin(pin)` is new IPC (`src/core/kids-mode.ts`,
`IPC.kidsModeVerifyPin`) — a read-only check with the SAME "no credential → true" honesty
`disable()` already has (a mode with no PIN ever set cannot lock anyone out of the screen that
administers it), never mutating the record, so the grown-up screen is reachable without leaving
Kids mode at all (unlike Settings' "Turn off", which always disables). It is **optional** on the
shared `KidsModeApi` type: the desktop preload implements it for real, but `src/renderer/bridge/
ws-bridge.ts` (the Server Edition's browser bridge) predates it and was not touched by this lane —
touching it was outside this lane's file ownership, and a one-line RPC addition there is a safe,
low-risk follow-up for whichever pass next owns that file. Until then, `verifyKidsModePin()` in
`bridge/stubs.ts` fails CLOSED (never open) when the method is absent, so the grown-up screen is
simply unreachable on the Server Edition rather than silently insecure. `KidsShell`/`KidsGate`/
`EnableKidsModeDialog` all reach the core store's `enable()`/`disable()` unchanged, so entering,
turning it on and turning it fully off already work on every surface `window.nodeTerminal.kidsMode`
does; only the read-only PEEK is desktop-only for now.

### The rail's entry point

`components/kids/entry.ts` exports `enterKidsModeFromRail()` — the "clean entry point" the nav
rail's `child_care` destination (owned by a different lane, and not yet built in this checkout)
calls instead of toggling a local view. It is not a view a child could navigate back out of: it
calls the real `enable()` action, and once the shared record's `enabled` flips to `true`, App.tsx's
own fail-closed routing swaps the canvas out on its own. If no grown-up PIN exists anywhere on this
machine yet, it opens `EnableKidsModeDialogHost` (mounted once, always, at the App root) instead of
enabling immediately, so a first-time user is never asked to remember a PIN they never chose.

### Surfaces (screens specifically, updates the table above)

| Surface | Screens |
| --- | --- |
| Desktop | full — Home/Gate/Grown-up/activity canvas, all real |
| Server Edition | Home/activity canvas work (same renderer, real `TerminalNode`/`StickyNode`, real IPC via the ws-bridge's existing `kidsMode` object); the grown-up gate cannot verify a PIN yet (`verifyPin` not wired into `ws-bridge.ts` — see above), so it is reachable in principle but always fails closed until that follow-up lands |
| Pages site | not applicable — no agents, no shell, unchanged from the rest of this document |
| Mobile companion | not applicable — a Kids canvas node is a real terminal/agent node like any other, so it is reachable over the existing transport once created on desktop/server, but there is no Kids-specific mobile screen (follow-up in `nodeterm-ios`, same as every other mobile note in this document) |

### Captured against a running build — and what is still only reviewed

This section used to say the Kids screens had never been photographed, because when they were
written the pass that built them was explicitly scoped to skip captures. That is no longer true,
and a heading that outlives its own facts is worse than no heading: everything below is now
driven and captured by `npm run shots -- --launch` against the built artifact, as REQUIRED
surfaces, so an unreachable one fails the run rather than quietly going missing again.

What is still only *reviewed* rather than observed is what happens **behind** these screens: the
six tiles opening their real nodes, the grown-up switches reaching `settings.claudePermissionMode`
and `settings.narratorEnabled`, the sticker threshold, and the daily-limit ticker routing to the
times-up screen. Those are stated as implemented and reviewed against the patterns they reuse
(`TerminalNode`, `createAgentNode`, `activeAgentLaunchPlan`, `decideCanvasNarration`), not as
watched working.

The Settings section itself IS captured, and re-captured against the Material Design 3 chrome
on 2026-08-19 (commit `8e37e640`) — this shot is current, not the pre-M3 one this paragraph
used to describe:

![The Kids mode settings section in the built app: the shared switch, the plain-language
disclosure that this is a user-experience lock rather than a security boundary, and the stated
unlock route](./assets/shots/app-settings-kids-mode.png)

That the disclosure is visible ON SCREEN — not merely present in the source — is the reason
this surface is a required capture at all: the mode's defensibility rests on a person having
been shown it.

Home, the grown-up gate and the grown-up screen are captured too, as REQUIRED surfaces so an
unreachable one fails the run:

| | |
| --- | --- |
| ![The Kids mode home screen: a robot avatar introducing itself as Beep, a Morning chip and sticker count, six large activity tiles, and a notice that Kids mode does not sandbox the terminal](./assets/shots/app-kids-home.png) | ![The grown-up gate: a four-digit PIN pad between the kid-facing home screen and the grown-up settings](./assets/shots/app-kids-gate.png) |
| **Home** — the disclosure sits on the screen the child uses, not only in a settings page. | **The gate** — a speed bump, and the docs say so rather than implying a security boundary. |

![The grown-up screen: time today, daily limit, stickers and sessions, an activity log, and permission switches for the real terminal, how freely the agent answers, reading screens aloud, a daily time limit and locking Kids mode on launch](./assets/shots/app-kids-parent.png)

Getting these took fixing the reason they had never been captured. `entry.ts` has always
documented the rail's Kids destination as the caller of `enterKidsModeFromRail()`, but the rail
shipped a placeholder that opened a settings page instead, so that function had **zero callers**
and the shell was unreachable. And once the rail was wired, the first-run flow still could not
complete: `EnableKidsModeDialog` rendered one `PinPad` for both the choose and confirm steps
with no `key`, React reused the instance, and because `push()` early-returns on a full pad every
tap on the confirm step was silently swallowed — **a first-time user could not turn Kids mode on
at all**. Both fixed; the second is pinned by
`EnableKidsModeDialog.pinpad-reset.test.tsx`, whose dialog-level case goes red when the `key` is
removed.

Still uncaptured: the activity canvas, the stickers screen and the times-up screen. Each needs a
kid to have spent real time in an activity first, which the harness cannot manufacture without
spawning the terminal those screens are counting.

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
- **`verifyPin` is desktop-only.** The Server Edition's `ws-bridge.ts` `kidsMode` object was not
  extended in the pass that added the screens (see "The screens" above) — it is a small, low-risk
  follow-up, not a design gap.
- **Story time and Sounds are placeholders**, and **kid-canvas nodes do not persist across a full
  app restart** the way project nodes do. Both are explained, with the reasoning, in "The screens"
  above rather than left as a silent gap.
- **The behaviour behind the new screens is reviewed, not observed.** Home, the gate and the
  grown-up screen are now captured from the built app on every `npm run shots` run; what has not
  been watched working is the tiles, the switches, the sticker threshold and the daily-limit
  ticker — see "Captured against a running build" above.
- **Remote account removal is not proven end-to-end here.** The renderer authorization is covered,
  but a disconnected or ambiguous SSH-backed account cannot presently provide authoritative
  deletion evidence, and the browser edition exposes account management as unsupported. The current
  Desktop boundary can fall back or lose the remote command result in those cases, so its success
  must not be treated as proof that the remote credential disappeared. Repair and live
  remote-account verification remain separate work.

## Destructive-action coverage

There are **seven** `GuardedAction` values, and all seven have a real runtime path:

| `GuardedAction` | Current behaviour |
| --- | --- |
| `delete-node` | one planner covers canvas key/menu/header, kanban, Cmd/Ctrl+W, sessions sidebar, session-memory panel, and agent-control close; every surface uses the two-key gate in Kids mode ✅ |
| `delete-project` | always uses the two-key gate ✅ |
| `remove-worktree` | unbind stays non-destructive; deleting the directory requires a proof-bound two-key approval while policy is ON/unavailable, and a changed/unreadable checkout refuses ✅ |
| `discard-changes` | two-key gate in Kids mode; plain confirm when off ✅ |
| `remove-account` | the UI authorization and active-node funnel are two-key gated; authoritative deletion of disconnected/ambiguous SSH-backed account state remains the explicit limitation above |
| `remove-authenticator` | exact sealed-entry revision is re-read after confirmation and compared again inside the credential-store mutation; ON/unavailable policy uses the two-key gate ✅ |
| `revoke-device` | two-key gate in Kids mode; plain confirm when off ✅ |

`remove-worktree` separates **Unbind** from disk deletion. Unbind changes only the canvas binding
and remains available without a destructive authorization. Disk removal first discloses the exact
branch/path/inventory. In Kids mode the disk choice starts unticked, an OFF→ON change resets an
already-open dialog before paint, and Enter cannot commit the confirmation; the user may still opt
in deliberately with the checkbox and button. The resulting two-key confirmation spends an opaque
one-shot core proof. That avoids making the approval ambiguous about whether it merely unbound or
actually deleted bytes.

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

An authorization is bound to the exact target facts the dialog disclosed. Immediately before
commit, `createNodeDeletionCommitBarrier` re-reads the active project plus each node's id, type,
title, account binding, and live object/session generation. Orphan sessions receive a fresh scoped
session sweep before teardown. A missing/replaced target cancels with zero teardown. If a plain dialog
was opened under a known-OFF record and Kids mode turns on — or the record becomes unavailable — the
plain approval performs nothing and starts a fresh two-key request. Account, authenticator, and
worktree removal use the same one-shot live barrier with their own exact target identities.

## Verified against a running build

Not only by tests. On 2026-08-15 the mode was driven through a real packaged build over CDP, and
`docs/assets/shots/app-settings-kids-mode.png` is the capture — maintained by `npm run shots`
rather than taken by hand, so it goes stale loudly instead of quietly. The capture launcher now
runs its built app inside a disposable home and Electron profile, asks the live preload bridge to
confirm the expected `userData` path before any interaction, and removes only its owned process and
sandbox afterward. The real-home sentinel also covers the Kids and School mode records and their
credential files, so a future isolation regression fails instead of silently changing either
PIN-protected mode. The lock contract itself is unchanged: leaving Kids mode still requires the
grown-up PIN.

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
  src/renderer/lib/accountRemoval.test.ts src/renderer/lib/destructiveAuthorization.test.ts \
  src/renderer/lib/authenticatorRemoval.test.ts src/renderer/lib/worktreeRemoval.test.ts \
  src/renderer/state/kidsMode.test.ts \
  src/renderer/components/settings/sections/AccountsSection.test.tsx \
  src/renderer/components/settings/sections/AuthenticatorSection.test.tsx
node scripts/check-app-contract.mjs
```
