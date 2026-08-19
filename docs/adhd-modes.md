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

| Mode | What it does |
| --- | --- |
| **Focus** | Fades every node except the one being worked in. |
| **Low stimulation** | Less motion, quieter colour, and only the notifications that need an answer. |
| **Time awareness** | Shows elapsed time on the node itself, not in a menu. |
| **One thing at a time** | Keeps one next action — in your words — visible on the canvas. |
| **Momentum** | Notes when a node has sat untouched, stating the elapsed time and nothing else. |

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

### The copy states facts, never verdicts

Time blindness is one of the most consistently reported difficulties and almost no software helps
with it, so time awareness and momentum say what is true and stop:

> Nothing has changed here for 40 min.

There is no streak, no score, no ranking, no congratulation, and nothing phrased as a question with a
right answer ("still working on this?"). Those are the feature deciding something about the person,
which it has no standing to do. The elapsed readout is deliberately coarse above a minute — a
second-by-second counter is itself a distraction.

"Not now" is respected for **30 minutes** (`SNOOZE_MINUTES`), stated in the interface rather than
kept secret, and it is a real timestamp rather than a flag that clears on the next render.

## Where the logic lives

Everything decidable is pure and unit-tested in
[`src/renderer/lib/adhdModes.ts`](../src/renderer/lib/adhdModes.ts) — opacity, spotlight target,
elapsed formatting, the momentum decision, the snooze, the CSS variables and the notification filter.
The canvas and the settings section only wire it up.

`normalizeAdhdModes()` re-validates every field on read. `settings.json` is hand-editable and travels
between versions, and these values reach a CSS opacity and a timer comparison: an out-of-range
`focusDim` of `5` would otherwise be applied as `-4`. Only a literal `true` enables a mode, so a
migrated string cannot switch one on.

## Surfaces

| Surface | State |
| --- | --- |
| **Desktop** | Full — all five modes, the settings section, canvas focus dimming and the one-thing pin. |
| **Server Edition** | Full — the modes are pure renderer state written through the same `settings` store, so the browser build gets them with no bridge work. |
| **Mobile companion** | Not applicable in this release. _nodeterm mobile_ (separate repository) has no canvas, so focus dimming and the one-thing pin have nothing to apply to; time awareness and low stimulation are a reasonable follow-up there and are recorded as such rather than claimed. |

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
- Driven end to end against the **built** artifact: the section is reachable from the Settings
  destination, all five switches expose their accessible names, and toggling Focus publishes
  `data-adhd="on"`, `data-adhd-focus="on"` and `--nt-adhd-dim: 0.45` — exactly `1 − 0.55`, the
  default fade.
- Captured as a required surface by `scripts/capture-shots.mjs`
  ([`app-adhd-modes.png`](./assets/shots/app-adhd-modes.png)).
