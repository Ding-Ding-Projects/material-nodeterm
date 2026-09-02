# MD3 shared primitives (`src/renderer/ui/md3/`)

**Status:** primitives shipped, and the app's shared controls now render them. The seven
primitives that did not exist (`Checkbox`, `TextArea`, `Slider`, `NumberField`, `Radio`,
`Progress`, `Tabs`) have been built and adopted where the audited source uses those controls.
The large remainder is the raw `<button>` population — see [Migration status](#migration-status).

## Why this exists

The Material Design 3 rewrite (`design/v2/`) landed as fourteen parallel lanes, each shipping its
own scoped BEM classes into `src/renderer/styles.md3.css` (now 8,000+ lines). The result is that
"a filled pill button", "a status chip" and "a floating menu surface" each exist several times
over — `.md3-kids-filled-btn`, `.confirm__btn.primary`, `.term-node__status--busy`,
`.kanban-badge--running` — all describing the same handful of shapes from
[`design/v2/md3/HANDOFF.md`](../design/v2/md3/HANDOFF.md)'s component-recipe table, each with
slightly different literals.

`src/renderer/ui/md3/` is the extraction: one definition per shape, read straight out of that
recipe table and the shipped `.dc.html` prototypes' own `style=""` attributes (the bundle
documents itself that way — see `design/v2/HANDOFF-README.md`, "Recreate pixel-perfectly").
Future work that needs a button, a text field, a status chip, and so on should reach for these
instead of writing a fifteenth scoped class.

## What's in the barrel

```ts
import {
  Button, IconButton, Fab, Switch, TextField, Chip, StatusChip,
  Card, ListRow, Menu, Dialog, Badge, SegmentedButton, Checkbox, TextArea,
  Slider, NumberField, Radio, Progress, Divider
} from '@renderer/ui/md3'
```

Importing anything from the barrel (`index.ts`) also pulls in `primitives.css`, so no separate
stylesheet import is required.

Three primitives were added for the recurring shapes the per-panel copies kept getting wrong:

| Component | Recipe | Replaces |
| --- | --- | --- |
| `SearchField` | 44px docked search pill (`'dense'` = 40px), input + trailing slot for the `.*` regex trigger; `min-height` and `flex: 0 0 auto`, never `height` + `flex-basis` | `.md3-history-search`, `.md3-status-search`, `.md3-settings-search`, `.cluster-search`, `.notif-center__search input`, `.startpage__searchbar` |
| `ChipRow` | wrapping chip row, never height-capped; optional `collapseAfter` folds the tail behind a "+N more" chip | every `max-height` + `overflow-y: auto` chip row (Node Catalog profiles/categories, CloudFormation pills, Cloudflare tunnel pills) |
| `Snackbar` + `SnackbarStack` | inverse-surface transient message, fixed bottom-left, `--mdx-snackbar-inset` lets a tall dialog lift it clear of its footer | `.toast` / `.toast-stack`, `.easter-eggs__toast` |

The bilingual secondary line every `Localized` renders is `.mdx-secondary` (on tokens), no longer
a Tailwind utility string.

### The raw-control guard

`node scripts/check-md3-controls.mjs` (`npm run check:md3-controls`) fails on any `<button>`,
`<input>`, `<select>` or `<textarea>` rendered outside `ui/md3/` and the delegating `ui/*`
wrappers, unless the file is listed in `scripts/md3-raw-controls-allowlist.json`. The allowlist
was generated once from the tree and may only shrink: a migrated file must be removed from it
(the guard fails on a stale entry too), and a new file starts clean.
`src/renderer/ui/md3/rawControls.guard.test.ts` pins the guard and the allowlist to the tree.

The allowlist holds three files on purpose: `AppErrorBoundary.tsx` (a crash surface must render
with no dependency that can itself fail, so it keeps two raw buttons wearing the `mdx-btn`
classes), and `ContextMenu.tsx` and `ExplorerPanel.tsx` (their `.ctx-item` rows are the
radius-owner pinned menu recipe and wait for a `ListRow`-based rewrite of the keyboard model).
The legacy `Dock.tsx` left the allowlist when the duplicated bottom dock was deleted — the nav
rail FAB, the `.md3-canvas-actions` pill and the merged zoom `Controls` already owned every one
of its actions. Everything else renders through the primitives.

Two cascade rules make a migrated surface actually look like the primitive:

- **A surface that keeps a shape of its own re-keys its rule onto the primitive class.** The
  welcome cards, Kids tiles and PIN keys, the switcher trigger, the kanban half-pill and the nav
  rail items are written as `.mdx-btn.md3-welcome__card { … }`, not `.md3-welcome__card { … }`: a
  single class ties with the primitive's own class and loses on load order, while the compound
  selector outranks it. Add `height: auto; min-height: 0;` when the shape is taller or shorter than
  the primitive's pill.
- **A descendant element selector must not reach a primitive.** Every `.panel button`,
  `.panel input`, `.panel select` and `.panel textarea` rule in both stylesheets carries
  `:not(.mdx-btn):not(.md3-icon-btn):not(.mdx-chip):not(.mdx-row)…` guards (the neutralization
  sweep of 2026-09). A bare element token outranks a primitive's class by specificity, so without
  the guard the old recipe silently paints over the primitive. Write new descendant rules with the
  same guards, or better, against the primitive class (`.panel .mdx-btn { … }`).

| Component | Recipe | Notes |
| --- | --- | --- |
| `Button` | 40px pill; `filled` / `tonal` / `outlined` / `text`, plus a `danger` colour overlay | New CSS (`.mdx-btn*`) |
| `IconButton` | 44px round (`'dense'` = 40px, `'compact'` = 32px for node headers, frame label pills and card heads; a `.mdx-icon-btn__swatch` child is the colour-picker dot) | Reuses `.md3-icon-btn` verbatim |
| `Fab` | 56px, r16, `primary-container` (`'small'` = 40px, r12) | Reuses `.md3-fab` verbatim |
| `Switch` | 52×32 track, 16px→24px knob | Re-exports `ui/Switch.tsx` — see below |
| `TextField` | Outlined, 56px, r16, floating notched label, `trailingSlot` | New CSS (`.mdx-field*`) |
| `Chip` | 32px, r8, assist/filter (`selected`) | New CSS (`.mdx-chip*`) |
| `StatusChip` | 28px pill (`'compact'` = 24px), tone map, pulsing dot on `running`/`attention` | New CSS (`.mdx-status-chip*`) |
| `Card` | Generic tonal surface, `tone` × `shape`, optional `interactive` hover | New CSS (`.mdx-card*`) |
| `ListRow` | Icon tile + label/sub + trailing (kbd chip) — menu/palette/list row shape | New CSS (`.mdx-row*`) |
| `Menu` | Floating panel, r28 `surface-container-high` (`compact` = r20) | New CSS (`.mdx-menu*`); positioning is the consumer's job |
| `Dialog` | Centered modal + scrim, r28, Escape/scrim-click/focus-return | New CSS (`.mdx-dialog*`) |
| `Badge` | 16px min-width pill or 8px dot, optional `corner` positioning | New CSS (`.mdx-badge*`) |
| `SegmentedButton` | 40px pill container, selected segment filled `secondary-container` | New CSS (`.mdx-seg*`) |
| `NumberField` | Dense numeric outlined field with tabular values | New CSS (`.mdx-number-field`) |
| `Radio` | Native radio grouping with M3 selected dot and focus state | New CSS (`.mdx-radio`) |
| `Progress` | Determinate or indeterminate linear progress with ARIA values | New CSS (`.mdx-progress*`) |
| `Tabs` | Keyboard-roving tablist with selected state and focus ring | New CSS (`.mdx-tabs*`) |
| `Divider` | 1px `outline-variant` hairline, horizontal/vertical | New CSS (`.mdx-divider*`) |

Every component is a thin wrapper: a root class, a variant class, forwarded DOM props, a
`forwardRef` where the underlying element is one a caller would plausibly need a ref to, and a
`className` escape hatch. None of them own state they don't have to — `Menu` in particular owns
no positioning logic at all; pair it with `ui/AnchoredPopover.tsx` (already used by every existing
menu/palette in this app) the way a consumer already does today.

### `Switch` is a re-export, not a rebuild

`ui/Switch.tsx` already implemented the exact HANDOFF recipe (52×32 track, `.md3-switch` /
`.md3-switch__knob` in `styles.md3.css`) before this lane started. `ui/md3/Switch.tsx` re-exports
it rather than shipping a second, competing implementation — the barrel is complete without
duplicating a control that was already correct.

### Why `mdx-` and not `md3-`

Every class this file *defines* (Button, TextField, Chip, StatusChip, Card, ListRow, Menu, Dialog,
Badge, SegmentedButton, Divider) is prefixed `mdx-`, not `md3-`, even though the rest of the app's
MD3 classes use `md3-`. `primitives.css` isn't imported by anything in the built app today — the
moment something imports the `ui/md3` barrel, its class names become global in the same document
as `styles.md3.css`. Reusing `md3-` risks colliding with a same-named class one of the fourteen
migration lanes already shipped under that prefix, silently changing that lane's visuals the
moment this barrel gets its first real consumer. `mdx-` guarantees that can't happen.

Two components deliberately do **not** follow that rule, because an exact, already-correct shared
class already exists and reusing it beats duplicating the recipe under a second name:

- `IconButton` reuses `.md3-icon-btn` (`styles.md3.css`, commented there as "Shared 44px round
  icon button — every app-bar action").
- `Fab` reuses `.md3-fab` (same file, the nav rail's node-creation FAB).

`IconButton`'s `active` prop applies the class `.is-active`, which `Canvas.tsx` already writes
onto a raw `.md3-icon-btn` for its dictation toggle — but no rule currently exists for that
combination in `styles.md3.css`, so that toggle has no visible active state today. This barrel's
`.mdx-icon-btn.is-active` rule (in `primitives.css`) fixes that retroactively, but only once
something actually imports `ui/md3` — it is inert dead weight in the bundle until then.

### `TextField`'s floating label and its one real limitation

The outlined text field's "notch" (the small gap the label sits in, cut into the top border) works
in every existing implementation of this pattern — including the one already in
`styles.md3.css`'s `.md3-field__label`, and the Clone-dialog prototype it's copied from — by
painting a solid patch behind the label that matches whatever surface the field sits on. CSS
cannot know that surface on its own. `TextField` exposes it as `--mdx-field-surface` (default
`--md-surface-container-high`, the surface every dialog in the design bundle sits on), settable on
the field or an ancestor when it's placed somewhere else. This is a real, stated limitation, not a
bug: get the surface wrong and the label's backdrop patch will show a seam against its true
background.

### `Dialog` is deliberately self-contained

`ConfirmDialog.tsx` / `DestructiveConfirmGate.tsx` share `dialog-stack.ts` and `confirm-key.ts` —
window-level machinery that stacks several open dialogs and is careful about not stealing an Enter
or Escape meant for a terminal or the command palette. `ui/md3/Dialog` does not plug into that
stack; it owns its own portal, scrim, Escape handler and focus-return, scoped to itself. A
primitives lane shouldn't quietly grow into a second, competing dialog-stack implementation. A
consumer that needs the app's shared stacking/Enter behaviour should keep using `ConfirmDialog`
today — wiring `Dialog` into `dialog-stack.ts` is a follow-up for whichever lane actually migrates
a call site onto it.

### `StatusChip` vs. the app's existing status chips

HANDOFF's literal recipe is 28px, 11.5px/700. Two existing, feature-owned peers render something
close but not identical: `TerminalNode.tsx`'s `.term-node__status` (26px, and no `success-container`
"ok" tone) and the kanban board's `.kanban-badge` (24px, the same tone map minus "ok"). `StatusChip`
is the literal-spec canonical version — including a `'compact'` (24px) size that matches
`.kanban-badge`'s footprint — for whichever future lane migrates those call sites onto it. It does
not replace either today.

## Migration status

**The app's three shared controls now delegate to the primitives**, which moved roughly 68 files
without touching a single call site:

| Shared control | Renders | Files reached |
| --- | --- | --- |
| `ui/Button` | `md3/Button` (`primary` → filled, `default` → outlined, `ghost` → text) | ~30 |
| `ui/Input` | the MD3 outlined field, dense | ~22 |
| `ui/Select` | the same field anatomy, with a drawn chevron | ~16 |
| `ui/SegmentedPill` | `md3/SegmentedButton` | (already delegated) |

Delegating `ui/Button` also fixed the contrast defect this document recorded below and left open:
`primary` painted `text-white` on `--md-primary`, which is `#D0BCFF` in the dark theme, so the
app's most prominent button was white on light lavender. It now uses `--md-on-primary`.

### Six primitives were built because nothing existed to adopt

`Checkbox`, `TextArea`, `Slider`, `NumberField`, `Radio`, `Progress` and `Tabs` had no entry in the barrel,
so every call site needing one was *forced* to hand-roll it. The native controls paint through the
shared stylesheet rather than rebuilding their input semantics from a
`div`: the native input carries label association, the keyboard model, the role and its state
announcements, and form participation, and a rebuilt one has to reimplement each of those.

Adoption after building them:

| Raw control | Before | After |
| --- | --- | --- |
| `type="checkbox"` | 16 | 1 (the definition) |
| `<textarea>` | 12 | 1 (the definition) |
| `type="range"` | 14 | 4 (definition, plus two exempt) |
| `<select>` | 18 | 3 (definition, plus two doc-comment mentions) |
| `type="radio"` | 9 | 1 (the definition) |
| `role="progressbar"` | 3 | 1 (the shared primitive) |

Two sliders are deliberately exempt: the colour picker's hue and alpha tracks paint a rainbow and
a checkerboard, so there the track **is the data** rather than chrome, which the design rules
exempt. Painting an MD3 track over them would destroy the picker to make it tidier.

### What is still not migrated

**546 raw `<button>` elements across 141 of 232 renderer components**, in 18 scoped class families
(`toylock-btn` 58, `sc-btn` 23, `mc-button` 23, `onb-btn` 7, and a long tail) all describing the
same handful of shapes. Delegation cannot reach these: each is an individual edit, and each will
change how that surface looks, so it wants eyes on the built artifact rather than a sweep.

`Radio` and `Progress` now use shared primitives. Tooltip and tabs remain feature-owned because
their positioning and tab-list state are coupled to their owning surfaces; the full source
inventory records those surfaces and their style markers in
`docs/features/appearance/material-3-audit.md`.

### Full desktop source audit

The 2026-08-26 audit names 201 desktop and site rows in
`docs/features/appearance/material-3-audit.md`. `scripts/check-material-audit.mjs` checks the
hand-written list, exact implementation markers, style markers, shared primitive exports, the
legacy numeric-field defect, keyboard tooltip semantics, and a deletion mutation. The audit is
source-only in that lane, so it deliberately leaves built-artifact clipping and pixel evidence
unverified until a permitted runtime pass.

## The one bug fixed outside this directory

`ui/Button.tsx`'s `default` variant hover was `hover:bg-[rgba(255,255,255,0.06)]` — a literal
white overlay, expressed as a Tailwind arbitrary value rather than an authored CSS declaration, so
the theme guard (which scans `styles.css`/`styles.md3.css` text, not compiled Tailwind output)
could not see it. It read fine on the dark theme's near-black `panel-header` background and was
nearly invisible on the light theme's near-white one. Fixed to
`hover:bg-[rgba(var(--tint-rgb),0.06)]` — `--tint-rgb` is the app's existing theme-correct ink
tint (white in dark mode, `--md-on-surface`'s literal in light mode; see `styles.css`), already
the established idiom for exactly this kind of overlay elsewhere in the stylesheet. Same opacity,
same visual weight in dark mode, now visible in light mode too.

**Fixed since, when `ui/Button` was delegated to the primitive — kept here for the reasoning:** the same component's `primary` variant renders
`text-white` unconditionally. In the dark theme, `bg-accent` resolves to `--md-primary`'s dark
literal (`#D0BCFF`, a light lavender) with white text on top — low contrast, and not what
`--md-on-primary` (`#381E72`) would give it. This wasn't in this lane's stated scope (the task
named the one hover value specifically) and touching it risks a visual change to every existing
`<Button variant="primary">` call site without a way to eyeball the result from here, so it's
recorded rather than changed.
