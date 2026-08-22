# ADHD modes

Five interface accommodations you switch on independently. Settings → Interface → **ADHD modes**.

They change how the interface behaves and nothing else. They are **not** a diagnosis, an assessment
or advice, they make no claim of clinical benefit, and nothing about them is recorded, counted or
sent anywhere. Each is named for what it *does* rather than who it is for, so a person can use one
without disclosing anything to a colleague reading over their shoulder.

## Why five switches and not one

Independence is the load-bearing design decision, not a layout preference.

Attention difficulties do not arrive as a single setting. Someone may want a quieter interface
without time nudges; someone else may want the nudges *precisely because* they are hyperfocusing and
would like interrupting. Bundled behind one master switch, most people turn the whole thing off to
escape the single part that does not suit them — and then have none of it.

**All five are off by default.** These are accommodations, not an opinion about how anyone should
work, and a mode that enables itself has decided something about the user it has no standing to
decide.

## The modes

| Mode | What it does | Where you see it |
| --- | --- | --- |
| **Focus** | Fades every node except the one being worked in. | The canvas |
| **Low stimulation** | Less motion, quieter colour, and only the notifications that need an answer. | The whole app |
| **Time awareness** | Shows elapsed time on the node itself, not in a menu. | A chip in the node's header, and in the kanban card modal |
| **One thing at a time** | Keeps one next action — in your words — visible on the canvas. | A pinned bar under the app bar |
| **Momentum** | Notes when a node has sat untouched, stating the elapsed time and nothing else. | Floated over that node's own terminal |

### Focus dims; it never hides

This is a rule, not a default. An interface that makes work disappear is a worse problem than a busy
one — especially for the person this is for, who may not remember what was there. So:

- `focusDim` is clamped to **0.1–0.8** (`FOCUS_DIM_MIN`/`FOCUS_DIM_MAX`), which is the "never hides"
  rule expressed as a number: at the strongest setting an unfocused node is still at 20% opacity.
- Nothing in the stylesheet sets `display: none`, `visibility: hidden` or `pointer-events: none`.
- Hovering or focusing an unfocused node returns it to full opacity, so reaching for something never
  requires turning the mode off first.
- With focus **off**, `nodeOpacity()` returns `1` unconditionally — a bug in the mode flag cannot
  blank the canvas.

The spotlight follows the **selected** node, not the hovered one. Selection is deliberate and
survives the pointer moving away; a spotlight that chases the mouse is the opposite of a focus aid.
With several nodes selected there is no spotlight at all, rather than an arbitrary one.

### Low stimulation composes with the platform, it does not fight it

`--nt-adhd-motion-scale` is a **multiplier**, not a switch, and the mode only ever *removes* motion.
A person who has already asked their operating system for less motion has asked once and must not
have to ask again — so nothing here restores a duration that `prefers-reduced-motion` took away.

Colour is quieted with `saturate()`, so the accent still reads as the accent and every contrast floor
`styles.theme.test.ts` enforces is untouched: only saturation moves.

**It never silences a notification that costs real work to miss.** `allowsNotification()` keeps
`needs-you` — an agent blocked on a permission prompt still needs answering — and drops only `done`
and `informational`. Silencing the first would make the mode cost the user work rather than save
them noise.

It reaches two things, and the classification is made once in each rather than per call site:

- **In-app toasts.** Every notification the canvas raises goes through `lib/adhdNotify.ts` instead
  of the raw store push, so no call site can opt itself out by accident.
  `adhdKindForNotification()` is the single judgement, and it reads a decision the notifications
  store had already made: `warning` and `error` are the two kinds that persist until a person
  dismisses them, so those are `needs-you`, `success` is `done`, and `info`/`progress` are
  `informational`.
- **The agent OS notification.** `sound` at that call site is already `'needsYou'` or `'done'` — an
  agent stopped on a permission prompt versus a turn that ended — so the real kind is threaded
  straight into the decision rather than re-derived from anything.

**A quieted notification is not deleted.** It is pushed already dismissed: it never appears as a
toast, and it is still in the notification centre, still unread, still counted by the bell. Low
stimulation removes the interruption, not the information — deleting the record would make the mode
cost the user something, which is the failure the whole design is arranged around.

Two deliberate exemptions, stated rather than left silent:

- **The completion chime and the narrator are not filtered by this mode.** Both already have their
  own switches (`soundEffects`, the narrator's language), and the five-independent-switches argument
  applies to them too: someone who wants a quiet screen may specifically want the audio, and folding
  it in here would take that choice away.
- **The "Notifications enabled" confirmation is not filtered.** It fires from the person's own click
  on the consent dialog a moment earlier. A permission switch that proves nothing when flipped reads
  as broken, and this mode is about unsolicited interruptions — that is the opposite of one.

### The copy states facts, never verdicts

Time blindness is one of the most consistently reported difficulties and almost no software helps
with it, so time awareness and momentum say what is true and stop:

> Nothing has changed here for 40 min.

There is no streak, no score, no ranking, no congratulation, and nothing phrased as a question with a
right answer ("still working on this?"). Those are the feature deciding something about the person,
which it has no standing to do. The elapsed readout is deliberately coarse above a minute — a
second-by-second counter is itself a distraction.

"Not now" is respected for **30 minutes** (`SNOOZE_MINUTES`), stated in the interface rather than
kept secret, and it is a real timestamp rather than a flag that clears on the next render. It is one
setting, not one per node: a person who says "not now" means it, and quieting only the node they
happened to click would leave the other fourteen still talking.

### What "where the work is" costs, and why it costs almost nothing

A clock in a menu does not help time blindness, so the elapsed readout has to sit on the node — and
a canvas routinely holds dozens of them. Two consequences shaped the implementation
([`lib/nodeActivity.ts`](../src/renderer/lib/nodeActivity.ts)):

- **One clock, not one per node.** A single module-level interval wakes every reader about once a
  minute. It is started by the first reader and stopped by the last, so with both modes off no timer
  exists at all — the property an accommodation that is off by default owes the people who leave it
  off. A minute is the right granularity because `formatElapsed()` is minute-granular anyway; a
  per-second counter is itself a distraction.
- **Activity is recorded outside the store.** "Something changed here" has to be written on every
  byte a terminal produces (and every keystroke into it — a person composing a long prompt in a
  silent pane is working, and nudging them would interrupt the exact work this protects). In a
  zustand store that would re-render the canvas thousands of times a second on a flooding terminal,
  so it is a plain `Map` write that nothing subscribes to, and the minute tick is what makes a reader
  look at it again.

The momentum note **floats over** the terminal rather than sitting above it in the layout: a strip
with real height would change the body's size, and a terminal that resizes because a note appeared
sends `SIGWINCH` to whatever is running in it. It ignores the pointer entirely except for its "Not
now" button, so a drag through it still selects terminal text, and nothing about it animates or takes
focus.

The chip's tooltip carries the second fact — how long the session has been open — worded as **"open
in this window"**, because that is the only version the app can honestly claim: a relaunch reattaches
a tmux session that may be days old.

## Where the logic lives

Everything decidable is pure and unit-tested in
[`src/renderer/lib/adhdModes.ts`](../src/renderer/lib/adhdModes.ts) — opacity, spotlight target,
elapsed formatting, the momentum decision, the snooze, the CSS variables and the notification filter.
It imports nothing from a store, so every rule can be tested without a canvas.

The wiring around it is deliberately thin, and each piece is its own file so it can be tested as the
thing that actually ships:

| File | What it does |
| --- | --- |
| [`lib/nodeActivity.ts`](../src/renderer/lib/nodeActivity.ts) | Records when each node opened and last changed; owns the one shared minute ticker. |
| [`components/AdhdNodeSurfaces.tsx`](../src/renderer/components/AdhdNodeSurfaces.tsx) | The elapsed chip and the momentum note. Neither decides anything itself. |
| [`lib/adhdNotify.ts`](../src/renderer/lib/adhdNotify.ts) | The one funnel every in-app notification passes through, and the one place a `NotificationKind` becomes an ADHD classification. |

`TerminalNode`, `CardModal` and `Canvas` only mount and call these.

`normalizeAdhdModes()` re-validates every field on read. `settings.json` is hand-editable and travels
between versions, and these values reach a CSS opacity and a timer comparison: an out-of-range
`focusDim` of `5` would otherwise be applied as `-4`. Only a literal `true` enables a mode, so a
migrated string cannot switch one on.

## Surfaces

| Surface | State |
| --- | --- |
| **Desktop** | Full — all five modes: the settings section, canvas focus dimming, the one-thing pin, the elapsed chip, the momentum note and the notification filter. |
| **Server Edition** | Full — the same components and the same `settings` store. Nothing here crosses a bridge: activity is recorded in the renderer from the PTY stream it already receives, and the notification filter reads two renderer stores, so the browser build gets all five with no server work. |
| **Kanban board** | Partial, and decided rather than overlooked — see below. |
| **Mobile companion** | Not applicable in this release. _nodeterm mobile_ (separate repository) has no canvas, so focus dimming and the one-thing pin have nothing to apply to; time awareness and low stimulation are a reasonable follow-up there and are recorded as such rather than claimed. |

### The kanban board: the chip yes, the note no

The board is a second view of the same sessions, so each of these two modes was asked about
separately rather than answered once for "the board".

- **The elapsed chip shows in the card modal.** That modal co-attaches the live session — it is a
  place work actually happens — so a clock the user would have to leave it to find is the exact
  failure time awareness exists to fix. Activity is recorded from the modal's own data path too, so
  a session whose canvas node has been released offscreen while the card is open does not look
  untouched while somebody is sitting in it.
- **The momentum note does not.** Its whole job is to catch your eye when you are *not* looking at
  that node. Opening the card is the act of looking, so the note would appear at the moment the
  person took the action it was going to ask for — which reads as a reprimand, not a nudge. The
  canvas node already carries it.
- **Neither shows on the card itself** (collapsed or expanded). A board is a survey surface: twenty
  cards each carrying a ticking clock is precisely the noise low stimulation exists to remove, and
  the fact is one click away in the modal.

## Interaction with School and Kids modes

Explicit rather than accidental:

- **School mode** does not suppress any of this. Its contract is about Cantonese, funny levels,
  personal vocabulary and the dim-sum surprise being treated as not installed; an accommodation is
  not an optional flourish and removing it would be the opposite of what School mode is for.
- **Kids mode** replaces the whole canvas with `KidsShell`, so focus dimming and the one-thing pin
  have no canvas to act on while it is enabled. The settings themselves persist untouched and resume
  when Kids mode is turned off.

## Verification

- [`src/renderer/lib/adhdModes.test.ts`](../src/renderer/lib/adhdModes.test.ts) — 23 tests covering
  the defaults, the independence of each mode, the dim clamp in both directions, hand-edited
  settings, the spotlight target, elapsed formatting, the momentum threshold and snooze window, the
  notification filter, and that the momentum text carries no verdict.
- [`src/renderer/components/AdhdNodeSurfaces.test.tsx`](../src/renderer/components/AdhdNodeSurfaces.test.tsx)
  — 18 tests that mount the **real production components** rather than re-testing the pure functions:
  the readout is gated on the setting (off renders nothing, with activity recorded and waiting), the
  momentum decision reaches a render with its own text verbatim, the note is a `role="status"` region
  that focuses nothing, "Not now" writes a real timestamp and puts every node's note away, six nodes
  share **one** interval while both modes off start none, and the chip reads as a whole sentence to a
  screen reader without being a live region that announces itself every minute.
- [`src/renderer/lib/adhdNotify.test.ts`](../src/renderer/lib/adhdNotify.test.ts) — 9 tests on the
  notification funnel, including the safety property this page claims: an error or warning survives
  **all 32 combinations** of the five modes, and survives a hand-edited `settings.json` that claims
  something nonsensical. Also that a quieted notification is still in the centre, unread, and was
  never briefly a live toast in any intermediate render.
- Each of those three guards was watched go red before it was trusted: removing the elapsed chip's
  setting gate, stubbing out the momentum decision, and giving each subscriber its own interval each
  turn the suite red, and restoring them turns it green. (The first attempt at the gate test stayed
  green under its break, because the component had two independent reasons to render nothing —
  that duplicate reason was removed so the gate has exactly one owner.)
- `scripts/check-app-contract.mjs` carries the wiring rows: that the chip and the note are mounted in
  `TerminalNode`, that the chip is mounted in `CardModal`, that `Canvas` imports `notify` from the
  filtered funnel rather than the raw store, and that the OS-notification gate threads the call
  site's own `sound` kind through. Every needle carries a delimiter, so a rename or a commented-out
  line cannot satisfy it — these two modes shipped once as switches wired to nothing, and a
  substring guard is how that happens again.
- Driven end to end against the **built** artifact: the section is reachable from the Settings
  destination, all five switches expose their accessible names, and toggling Focus publishes
  `data-adhd="on"`, `data-adhd-focus="on"` and `--nt-adhd-dim: 0.45` — exactly `1 − 0.55`, the
  default fade.
- Captured as a required surface by `scripts/capture-shots.mjs`
  ([`app-adhd-modes.png`](./assets/shots/app-adhd-modes.png)).

**Not yet verified, stated rather than implied:** that built-artifact run and that capture cover the
settings section and focus dimming. Three states were owed a capture beyond that: a node carrying
the elapsed chip, a node carrying the momentum note with its "Not now", and the notification centre
holding a quieted notification while low stimulation is on. The first two now have entries in
`scripts/capture-shots.mjs` (`app-adhd-elapsed-chip` — required, reachable in seconds since "just
now" renders the instant a node opens — and `app-adhd-momentum-note`, which genuinely cannot render
sooner than the real five-minute floor on `momentumMinutes` and is therefore gated behind
`NT_SHOTS_SLOW=1` and skipped, not failed, on an ordinary run). Neither has actually been run by this
change, so there is no capture file to point to yet and no claim that either has been *seen*
rendering in a packaged build — only that the harness now knows how to reach and photograph them.
The notification filter is still owed a capture entirely; nothing here drives that state.
